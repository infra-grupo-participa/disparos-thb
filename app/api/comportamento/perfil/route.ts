import { NextResponse } from "next/server";
import { guard } from "@/lib/guard";
import { escopoVisibilidade, paramsEscopo } from "@/lib/papeis";
import { queryOne } from "@/lib/db";
import { sqlEscopo } from "@/lib/services/contato";
import { eventoDe } from "@/lib/services/evento";

export const runtime = "nodejs";

// GET /api/comportamento/perfil?evento=&edicao= — retrato do lead pela resposta a
// CADA canal: responde WhatsApp (respondeu disparo), abre e-mail (abriu/clicou),
// atende ligação. Classifica em perfis humanos e mede o engajamento por canal.
type Perfil = {
  total: number; com_acao: number;
  resp_wa: number; resp_em: number; resp_li: number;
  engajado_multi: number; so_wa: number; so_em: number; so_li: number; frio: number; sem_acao: number;
};

export async function GET(req: Request) {
  // Portal do evento RESOLVIDO (cookie/query) contra a whitelist da conta (0145).
  const g = await guard({ portal: eventoDe(req) });
  if (!g.ok) return g.res;

  const evento = eventoDe(req);
  const edicao = new URL(req.url).searchParams.get("edicao");
  // Recorte por equipe (27/07): o retrato é da base que quem olha enxerga.
  const { verTudo, equipeId, usuarioId } = paramsEscopo(escopoVisibilidade(g.sessao));

  const p = (await queryOne<Perfil>(
    `with base as (
       select v.comprador_id
         from cs.contatos_evento v
        where v.evento = $1 and ($2::text is null or v.edicao = $2)
          and ${sqlEscopo({ rid: "v.responsavel_id", eq: "v.equipe_id", nome: "v.responsavel" }, { verTudo: 3, usuario: 4, equipe: 5 })}
     ),
     flags as (
       select
         b.comprador_id,
         exists(select 1 from cs.disparo_contatos dc where dc.comprador_id = b.comprador_id and dc.respondeu) as wa,
         exists(select 1 from cs.email_contato ec where ec.comprador_id = b.comprador_id and (ec.abriu_em is not null or ec.clicou_em is not null)) as em,
         exists(select 1 from cs.ligacoes l where l.comprador_id = b.comprador_id and l.resultado = 'atendeu') as li,
         (exists(select 1 from cs.disparo_contatos dc where dc.comprador_id = b.comprador_id and dc.enviado)
          or exists(select 1 from cs.email_contato ec where ec.comprador_id = b.comprador_id and ec.recebidos > 0)
          or exists(select 1 from cs.ligacoes l where l.comprador_id = b.comprador_id)) as teve_acao
       from base b
     )
     select
       count(*)::int as total,
       count(*) filter (where teve_acao)::int as com_acao,
       count(*) filter (where wa)::int as resp_wa,
       count(*) filter (where em)::int as resp_em,
       count(*) filter (where li)::int as resp_li,
       count(*) filter (where (wa::int + em::int + li::int) >= 2)::int as engajado_multi,
       count(*) filter (where wa and not em and not li)::int as so_wa,
       count(*) filter (where em and not wa and not li)::int as so_em,
       count(*) filter (where li and not wa and not em)::int as so_li,
       count(*) filter (where teve_acao and not wa and not em and not li)::int as frio,
       count(*) filter (where not teve_acao)::int as sem_acao
     from flags`,
    [evento, edicao, verTudo, usuarioId, equipeId],
  )) ?? {
    total: 0, com_acao: 0, resp_wa: 0, resp_em: 0, resp_li: 0,
    engajado_multi: 0, so_wa: 0, so_em: 0, so_li: 0, frio: 0, sem_acao: 0,
  };

  return NextResponse.json({ ok: true, perfil: p });
}
