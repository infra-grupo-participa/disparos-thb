import { NextResponse } from "next/server";
import { isAuthed, getSessao } from "@/lib/auth";
import { query } from "@/lib/db";
import { parseBody, HmMoverSchema } from "@/lib/validators";
import { moverEstagioHm } from "@/lib/services/hm";

export const runtime = "nodejs";

// As tags do card carregam coisas diferentes e o board as filtra em separado:
//   TURMA  → "Origem T29" (de onde veio) · "Turma T39" (a turma atual, ganha ao
//            pagar) · "Aurum A5"
//   CANAL  → por onde entrou ("HT ATM", "Live Direto ao Ponto", "Imersão POA",
//            "HT28", "HM - Programa de Implementação")
//   PÚBLICO → quem é ("Aluno THB", "Aluno Aurum", "Lead novo") — entra no filtro
//            de canal, porque é assim que o time pergunta ("quem é aluno THB?").
const RE_TURMA = "^(Origem|Turma|Aurum) ";

// GET /api/hm/kanban — colunas (estágios HM, com a aba) + cards do overlay
// cs.contatos_hm. Sem edição/evento: o HM é um espaço próprio (turma T39).
// Os totais das colunas NÃO vêm daqui: um card pago aparece em duas colunas
// (espelho do pagamento no Comercial), e só a tela sabe dessa regra.
export async function GET(req: Request) {
  if (!isAuthed()) return NextResponse.json({ ok: false }, { status: 401 });
  const sp = new URL(req.url).searchParams;
  const responsavel = sp.get("responsavel") || null;
  const canal = sp.get("canal") || null;
  const turma = sp.get("turma") || null;
  const f = [responsavel, canal, turma];

  const colunas = await query(
    `select e.chave, e.nome, e.cor, e.aba
       from cs.estagios e
      where e.ativo and e.evento = 'HM'
      order by e.ordem`,
  );

  const cards = await query(
    `select k.comprador_id, k.nome, k.email, k.telefone, k.turma, k.plano, k.categoria_entrada,
            k.estagio_chave, k.estagio_nome, k.estagio_aba, k.responsavel, k.tags, k.apto_ativacao,
            k.reuniao_em, k.entrevista_em, k.pagamento_em,
            um.descricao as ultima_msg,
            me.criado_em as entrou_estagio_em
       from cs.contatos_hm_kanban k
       left join lateral (
         select i.descricao from cs.interacoes i
          where i.contato_hm_id = k.contato_hm_id
          order by i.criado_em desc limit 1
       ) um on true
       left join lateral (
         select i.criado_em from cs.interacoes i
          where i.contato_hm_id = k.contato_hm_id and i.tipo = 'mudanca_estagio'
          order by i.criado_em desc limit 1
       ) me on true
      where ($1::text is null or k.responsavel = $1)
        and ($2::text is null or $2 = any(k.tags))
        and ($3::text is null or $3 = any(k.tags))
      order by k.ordem, k.atualizado_em desc nulls last, k.nome`,
    f,
  );

  const respRows = await query<{ responsavel: string }>(
    `select distinct responsavel from cs.contatos_hm where responsavel is not null and responsavel <> '' order by responsavel`,
  );
  // `qtd` alimenta a régua de canais fixos: o placar do canal INTEIRO, sem os
  // filtros da tela — o número é "quantas vendas o evento fez", não "quantas
  // estou vendo agora".
  const tagRows = await query<{ tag: string; eh_turma: boolean; qtd: number }>(
    `select t as tag, t ~ $1 as eh_turma, count(*)::int as qtd
       from cs.contatos_hm, unnest(tags) t
      group by t
      order by tag`,
    [RE_TURMA],
  );

  return NextResponse.json({
    ok: true,
    colunas,
    cards,
    responsaveis: respRows.map((r) => r.responsavel),
    canais: tagRows.filter((t) => !t.eh_turma).map((t) => t.tag),
    turmas: tagRows.filter((t) => t.eh_turma).map((t) => t.tag),
    canaisQtd: Object.fromEntries(tagRows.filter((t) => !t.eh_turma).map((t) => [t.tag, t.qtd])),
  });
}

// PATCH /api/hm/kanban — move um card de coluna e/ou o reordena na vertical.
// body: { compradorId, estagioChave, antesDe? } — antesDe é o card que fica logo
// abaixo dele (null = fim da coluna, ausente = topo). Arrastar só na vertical é
// um PATCH com o mesmo estagioChave: o serviço reordena e não mexe na timeline.
export async function PATCH(req: Request) {
  const sessao = await getSessao();
  if (!sessao) return NextResponse.json({ ok: false }, { status: 401 });
  const p = await parseBody(req, HmMoverSchema);
  if (!p.ok) return p.res;
  const { compradorId, estagioChave, antesDe } = p.data;
  const posicao = antesDe === undefined ? undefined : { antesDe };
  const r = await moverEstagioHm(compradorId, estagioChave, sessao.nome || "cs", posicao);
  // `faltando` são os itens do checklist que barraram a entrada em "Ativação
  // Realizada" — o board mostra a lista em vez de um erro genérico.
  if (!r.ok) return NextResponse.json({ ok: false, reason: r.reason, faltando: r.faltando }, { status: 400 });
  return NextResponse.json({ ok: true });
}
