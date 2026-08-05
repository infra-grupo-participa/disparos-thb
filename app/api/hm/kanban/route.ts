import { NextResponse } from "next/server";
import { guard } from "@/lib/guard";
import { ehMaster, escopoVisibilidade, paramsEscopo } from "@/lib/papeis";
import { query } from "@/lib/db";
import { parseBody, HmMoverSchema } from "@/lib/validators";
import { listaResponsaveis, sqlEscopo } from "@/lib/services/visibilidade";
import { moverEstagioHm, podeAgirCardHm, cancelamentoBloqueado, HM_ESTAGIOS_CANCELAMENTO } from "@/lib/services/hm";

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
  const g = await guard({ portal: "HM" });
  if (!g.ok) return g.res;
  const sessao = g.sessao;
  const sp = new URL(req.url).searchParams;
  // Filtros multi-valor: o mesmo parâmetro repetido (?canal=A&canal=B) — dentro
  // do filtro a leitura é OU, entre filtros é E.
  const lista = (nome: string) => { const v = sp.getAll(nome); return v.length ? v : null; };
  // Escopo de visibilidade (recorte de SEGURANÇA): master vê tudo; gestor vê o
  // pool + todos os cards da equipe dele; operador comum vê o pool + só os
  // cards atribuídos a ele. O filtro por responsável (abaixo) é conveniência.
  const { verTudo, equipeId, usuarioId } = paramsEscopo(escopoVisibilidade(sessao));
  // Produto/board (0155): a MESMA esteira serve HM, Aurum e ETHB — o board é
  // recortado por produto. Default 'HM' (o board histórico); os boards novos
  // chamam esta rota com ?produto=AURUM|ETHB. Isola os cards entre os boards.
  const produto = ((): "HM" | "AURUM" | "ETHB" => {
    const p = (sp.get("produto") || "HM").toUpperCase();
    return p === "AURUM" || p === "ETHB" ? p : "HM";
  })();
  const f = [lista("responsavel"), lista("canal"), lista("turma"), verTudo, usuarioId, equipeId, produto];

  const colunas = await query(
    `select e.chave, e.nome, e.cor, e.aba
       from cs.estagios e
      where e.ativo and e.evento = 'HM'
      order by e.ordem`,
  );

  const cards = await query(
    `select k.comprador_id, k.nome, k.email, k.telefone, k.turma, k.plano, k.categoria_entrada,
            k.estagio_chave, k.estagio_nome, k.estagio_aba, k.responsavel, k.tags, k.apto_ativacao,
            k.responsavel_id, k.equipe_id, k.equipe_nome, k.equipe_cor, k.equipe_tipo,
            ch2.atribuicao_admin, ch2.inbox_status,
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
       join cs.contatos_hm ch2 on ch2.comprador_id = k.comprador_id
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
        and k.produto = $7                       -- board do produto (0155)
        -- Escopo (predicado único, visibilidade.ts): vejo tudo OU é card LIVRE
        -- (sem id, sem equipe E sem texto órfão) OU é MEU OU é da minha equipe.
        and ${sqlEscopo({ rid: "k.responsavel_id", eq: "k.equipe_id", nome: "k.responsavel", tags: "k.tags" }, { verTudo: 4, usuario: 5, equipe: 6 })}
      order by k.ordem, k.atualizado_em desc nulls last, k.nome`,
    f,
  );

  // Sócios convidados (aba "SÓCIOS T39"): NÃO são compradores nem cards
  // financeiros — vivem pendurados no titular (cs.hm_socios). O board os mostra
  // como cards azuis na Ativação, para o Thomas liberar o acesso. Array separado
  // de propósito: o sócio jamais entra na cobrança nem nas lentes financeiras.
  // Sócios herdam a visibilidade do TITULAR: só aparecem se o card do titular
  // é visível para esta equipe (pool ou da minha equipe), ou se vejo tudo.
  const socios = await query(
    `select s.socio_id, s.contato_hm_id, s.nome, s.email, s.telefone, s.link_facebook, s.origem,
            s.ativ_searchie, s.ativ_comunidade, s.ativ_grupo,
            s.titular_comprador_id, s.titular_nome, s.titular_turma, s.titular_origem,
            s.titular_cancelado, s.checks_feitos, s.status, s.estagio_chave,
            (s.aluno_id is not null) as na_base,
            (s.titular_aluno_id is not null) as titular_na_base
       from cs.vw_hm_socios s
       -- Sócio pertence ao board do produto do TITULAR (0155): filtra sempre,
       -- inclusive p/ o master (senão sócio de Aurum vazaria no board HM).
       join cs.contatos_hm t on t.comprador_id = s.titular_comprador_id and t.produto = $4
      where $1::boolean
         or exists (
              select 1 from cs.contatos_hm_kanban tk
               where tk.comprador_id = s.titular_comprador_id
                 and ${sqlEscopo({ rid: "tk.responsavel_id", eq: "tk.equipe_id", nome: "tk.responsavel", tags: "tk.tags" }, { verTudo: 1, usuario: 2, equipe: 3 })})
      order by s.titular_nome, s.nome`,
    [verTudo, usuarioId, equipeId, produto],
  );

  // Quem pode assumir um contato = a equipe ATIVA (cs.usuarios), não só quem já
  // tem card. Lista RECORTADA por nível (regra única em listaResponsaveis,
  // visibilidade.ts): master = todos + legados; gestor = a própria equipe;
  // operador = só ele. O seletor não pode oferecer destino que
  // atribuirResponsavelHm vai recusar.
  const responsaveis = await listaResponsaveis(sessao, "HM", {
    sql: `select distinct responsavel from cs.contatos_hm where responsavel is not null and responsavel <> ''`,
  });
  // `qtd` alimenta a régua de canais fixos: o placar do canal INTEIRO, sem os
  // filtros da tela — o número é "quantas vendas o evento fez", não "quantas
  // estou vendo agora".
  // RECORTADO POR PRODUTO (05/08/2026). Sem o filtro, esta consulta varria
  // cs.contatos_hm inteira: o board do Aurum listava no dropdown de canal os
  // canais do HM ("HT29", "HT ATM", "Live Direto ao Ponto"...) e a régua somava
  // cards de outro board — inclusive gente que comprou Aurum mas cujo card
  // ficou no HM, inflando o placar de "ETHB SP" com quem o board nem mostra.
  // O placar continua sendo do canal INTEIRO (ignora os filtros da tela); o que
  // ele deixa de ignorar é o board.
  const tagRows = await query<{ tag: string; eh_turma: boolean; qtd: number }>(
    `select t as tag, t ~ $1 as eh_turma, count(*)::int as qtd
       from cs.contatos_hm, unnest(tags) t
      where produto = $2
      group by t
      order by tag`,
    [RE_TURMA, produto],
  );

  return NextResponse.json({
    ok: true,
    colunas,
    cards,
    socios,
    responsaveis,
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
  const g = await guard({ portal: "HM" });
  if (!g.ok) return g.res;
  const sessao = g.sessao;
  const p = await parseBody(req, HmMoverSchema);
  if (!p.ok) return p.res;
  const { compradorId, estagioChave, antesDe } = p.data;
  // Gate de AÇÃO (28/07, leitura ≠ ação): mover é ESCRITA — operador só no pool
  // e nos cards DELE. O card do colega aparece no board (escopo de leitura),
  // mas o arrasto recusa com 403 'card_de_outro_operador' (o front traduz).
  const acao = await podeAgirCardHm(sessao, compradorId);
  if (acao !== "ok") {
    return NextResponse.json({ ok: false, reason: acao }, { status: 403 });
  }
  // Trava dos cancelados (27/07): mexer num card já em Reclamada/Reembolsado, ou
  // MOVER um card PARA essas colunas, é só do MASTER (admin do GP). Demais: 403.
  const souMaster = ehMaster(sessao);
  const destinoCancel = HM_ESTAGIOS_CANCELAMENTO.includes(estagioChave);
  if (!souMaster && (destinoCancel || (await cancelamentoBloqueado(sessao, compradorId)))) {
    return NextResponse.json({ ok: false, reason: "cancelamento_so_admin_gp" }, { status: 403 });
  }
  const posicao = antesDe === undefined ? undefined : { antesDe };
  const r = await moverEstagioHm(compradorId, estagioChave, sessao.nome || "cs", posicao);
  // `faltando` são os itens do checklist que barraram a entrada em "Ativação
  // Realizada" — o board mostra a lista em vez de um erro genérico.
  if (!r.ok) return NextResponse.json({ ok: false, reason: r.reason, faltando: r.faltando }, { status: 400 });
  return NextResponse.json({ ok: true });
}
