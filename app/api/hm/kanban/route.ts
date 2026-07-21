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
  // Filtros multi-valor: o mesmo parâmetro repetido (?canal=A&canal=B) — dentro
  // do filtro a leitura é OU, entre filtros é E.
  const lista = (nome: string) => { const v = sp.getAll(nome); return v.length ? v : null; };
  const f = [lista("responsavel"), lista("canal"), lista("turma")];

  const colunas = await query(
    `select e.chave, e.nome, e.cor, e.aba
       from cs.estagios e
      where e.ativo and e.evento = 'HM'
      order by e.ordem`,
  );

  const cards = await query(
    `select k.comprador_id, k.nome, k.email, k.telefone, k.turma, k.plano, k.categoria_entrada,
            k.estagio_chave, k.estagio_nome, k.estagio_aba, k.responsavel, k.tags, k.apto_ativacao,
            k.reuniao_em, k.entrevista_em, k.pagamento_em, k.pagamento_previsto_em,
            -- Saldo quitado: não deve mais nada. Colore o card de verde sutil (0099).
            (coalesce(fin.quitado, false) or coalesce(fin.saldo_a_perseguir, 1) <= 0) as quitado,
            -- Parcelando: pagou ≥1 parcela e ainda deve. O espelho no Comercial mostra
            -- esse card em "Pagamento Parcelado", não em "Pagamento Realizado" (0108).
            (fin.situacao = 'mensalidade_em_curso') as parcelado,
            -- Falso-verde: o pacote foi cravado ignorando o crédito pró-rata e o
            -- pagamento que virou esse crédito segue contado como pagamento. O saldo
            -- dá zero por coincidência aritmética, não por quitação (0112). Enquanto
            -- o comercial não decide quanto cobrar, o card avisa em vez de mentir.
            (cd.comprador_id is not null) as conferir_saldo,
            um.descricao as ultima_msg,
            me.criado_em as entrou_estagio_em
       from cs.contatos_hm_kanban k
       left join cs.vw_hm_financeiro fin on fin.comprador_id = k.comprador_id
       left join cs.vw_hm_credito_duplo cd on cd.comprador_id = k.comprador_id
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
      where ($1::text[] is null or k.responsavel = any($1))
        and ($2::text[] is null or k.tags && $2)
        and ($3::text[] is null or k.tags && $3)
      order by k.ordem, k.atualizado_em desc nulls last, k.nome`,
    f,
  );

  // Sócios convidados (aba "SÓCIOS T39"): NÃO são compradores nem cards
  // financeiros — vivem pendurados no titular (cs.hm_socios). O board os mostra
  // como cards azuis na Ativação, para o Thomas liberar o acesso. Array separado
  // de propósito: o sócio jamais entra na cobrança nem nas lentes financeiras.
  const socios = await query(
    `select socio_id, contato_hm_id, nome, email, telefone, link_facebook,
            ativ_searchie, ativ_comunidade, ativ_grupo,
            titular_comprador_id, titular_nome, titular_turma, titular_origem,
            titular_cancelado, checks_feitos, status,
            (aluno_id is not null) as na_base,
            (titular_aluno_id is not null) as titular_na_base
       from cs.vw_hm_socios
      order by titular_nome, nome`,
  );

  // Quem pode assumir um contato = a equipe ATIVA (cs.usuarios), não só quem já
  // tem card. Assim um operador novo aparece no seletor de responsável antes da
  // primeira atribuição — senão ninguém consegue atribuir a ele. A união preserva
  // responsáveis legados que porventura não estejam mais em usuarios.
  const respRows = await query<{ responsavel: string }>(
    `select responsavel from (
        select nome as responsavel from cs.usuarios where ativo
        union
        select distinct responsavel from cs.contatos_hm where responsavel is not null and responsavel <> ''
     ) u
     order by responsavel`,
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
    socios,
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
