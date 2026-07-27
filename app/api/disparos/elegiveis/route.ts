import { NextResponse } from "next/server";
import { getSessao } from "@/lib/auth";
import { escopoVisibilidade, paramsEscopo } from "@/lib/papeis";
import { query } from "@/lib/db";
import { eventoDe } from "@/lib/services/evento";

export const runtime = "nodejs";

// GET /api/disparos/elegiveis — auxílio inteligente ao operador: quem está PRONTO
// para receber disparo, sem ele ter que garimpar no board. Dois critérios que o
// SDR entende:
//   - "novos"  → nunca receberam disparo neste evento
//   - "frios"  → receberam, mas sem novo contato há mais de N dias
//   - "ambos"  → a união (default)
// Sempre exclui quem não tem telefone e quem deu opt-out. Ordena os mais frios /
// nunca-abordados primeiro, para o operador atacar a fila do topo.
export async function GET(req: Request) {
  const sessao = await getSessao();
  if (!sessao) return NextResponse.json({ ok: false }, { status: 401 });
  const evento = eventoDe(req);
  const sp = new URL(req.url).searchParams;
  const modo = (sp.get("modo") || "ambos") as "novos" | "frios" | "ambos";
  const dias = Math.min(Math.max(Number(sp.get("dias") || 7), 1), 90);
  const limite = Math.min(Math.max(Number(sp.get("limite") || 500), 1), 2000);

  // Filtro de elegibilidade conforme o modo — sobre o último disparo enviado.
  const filtroModo =
    modo === "novos" ? "u.ultimo is null"
    : modo === "frios" ? "u.ultimo is not null and u.ultimo < now() - make_interval(days => $2)"
    : "u.ultimo is null or u.ultimo < now() - make_interval(days => $2)";

  type Elegivel = {
    comprador_id: string; nome: string; telefone: string; edicao: string | null;
    ultimo_disparo_em: string | null; motivo: string;
  };

  let contatos: Elegivel[];
  if (evento === "HM") {
    // Ramo HM: destinatários do overlay (cs.contatos_hm_kanban, análogo ao /api/send),
    // respeitando nao_contatar + opt_out. O RECORTE é de segurança: cada um só recebe
    // sugestões de cards que vê (operador: pool + os dele; líder: pool + a equipe;
    // GP/admin: tudo). Predicado idêntico ao do board/tabela.
    const { verTudo, equipeId, usuarioId } = paramsEscopo(escopoVisibilidade(sessao));
    contatos = await query<Elegivel>(
      `with ult as (
         select dc.comprador_id, max(dc.enviado_em) as ultimo
           from cs.disparo_contatos dc
           join cs.disparos d on d.id = dc.disparo_id
          where d.evento = 'HM' and dc.enviado
          group by dc.comprador_id
       )
       select v.comprador_id, v.nome, v.telefone, null::text as edicao,
              u.ultimo as ultimo_disparo_em,
              case when u.ultimo is null then 'nunca' else 'frio' end as motivo
         from cs.contatos_hm_kanban v
         left join ult u on u.comprador_id = v.comprador_id
        where v.telefone is not null and v.telefone <> ''
          and not coalesce(v.nao_contatar, false)
          and v.comprador_id not in (select comprador_id from cs.contatos where opt_out)
          and ($3::boolean
               or (v.responsavel_id is null and v.equipe_id is null)
               or v.responsavel_id = $4::uuid
               or v.equipe_id = $5::uuid)
          and (${filtroModo})
        order by (u.ultimo is null) desc, u.ultimo asc nulls first, v.nome
        limit $1`,
      [limite, dias, verTudo, usuarioId, equipeId],
    );
  } else {
    contatos = await query<Elegivel>(
      `with ult as (
         select dc.comprador_id, max(dc.enviado_em) as ultimo
           from cs.disparo_contatos dc
           join cs.disparos d on d.id = dc.disparo_id
          where d.evento = $1 and dc.enviado
          group by dc.comprador_id
       )
       select v.comprador_id, v.nome, v.telefone, v.edicao,
              u.ultimo as ultimo_disparo_em,
              case when u.ultimo is null then 'nunca' else 'frio' end as motivo
         from cs.contatos_evento v
         join cs.contatos ct on ct.comprador_id = v.comprador_id and ct.evento = v.evento
         left join ult u on u.comprador_id = v.comprador_id
        where v.evento = $1
          and v.telefone is not null and v.telefone <> ''
          and not coalesce(ct.opt_out, false)
          and (${filtroModo})
        order by (u.ultimo is null) desc, u.ultimo asc nulls first, v.nome
        limit $3`,
      [evento, dias, limite],
    );
  }

  const nunca = contatos.filter((c) => c.motivo === "nunca").length;
  return NextResponse.json({
    ok: true,
    contatos,
    total: contatos.length,
    resumo: { nunca, frios: contatos.length - nunca, dias, modo },
  });
}
