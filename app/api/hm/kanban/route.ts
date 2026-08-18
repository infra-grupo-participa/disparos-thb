import { NextResponse } from "next/server";
import { guard } from "@/lib/guard";
import { produtoDaRequisicao } from "@/lib/produto-hm";
import { ehMaster, escopoVisibilidade, abasDaEsteira, ESTEIRA_COMPARTILHADA_PRODUTO, paramsEscopo, type Ator } from "@/lib/papeis";
import { query } from "@/lib/db";
import { parseBody, HmMoverSchema } from "@/lib/validators";
import { listaResponsaveis, sqlEscopo } from "@/lib/services/visibilidade";
import { moverEstagioHm, podeAgirCardHm, cancelamentoBloqueado, HM_ESTAGIOS_CANCELAMENTO, HM_STAGE_SOLICITOU_CANCELAMENTO } from "@/lib/services/hm";

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
  // Produto/board (0155): a MESMA esteira serve HM, Aurum e ETHB — o board é
  // recortado por produto. Default 'HM' (o board histórico); os boards novos
  // chamam esta rota com ?produto=AURUM|ETHB. Isola os cards entre os boards.
  //
  // 0187: o portal validado é o do produto PEDIDO, não "HM" literal. Com o literal,
  // uma conta com HM e sem AURUM passava pelo gate e lia o board do Aurum — o
  // `guard` tem de cobrir o que a query VAI ler. Vem no topo: nada pode usar
  // g.sessao antes do gate.
  const produto = produtoDaRequisicao(req);
  const g = await guard({ portal: produto });
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
  // Esteira compartilhada (0210/0212): a lista de abas que ESTA SESSÃO
  // alcança neste board, resolvida por FUNÇÃO (cs.usuario_funcoes) — cada
  // função (comercial/ativação) soma uma aba. Resolvido aqui, no JS, e mandado
  // como `text[]` — o SQL só compara a aba do CARD contra essa lista e o
  // produto do card contra `ESTEIRA_COMPARTILHADA_PRODUTO`. `produto` entra na
  // conta (abasDaEsteira) para o bônus não vazar para AURUM/ETHB quando o
  // board pedido é outro.
  const abas = abasDaEsteira(sessao as Ator, "HM", produto);
  const f = [lista("responsavel"), lista("canal"), lista("turma"), verTudo, usuarioId, equipeId, produto, abas, ESTEIRA_COMPARTILHADA_PRODUTO];

  const colunas = await query(
    `select e.chave, e.nome, e.cor, e.aba, e.origem_movimento
       from cs.estagios e
      where e.ativo and e.evento = 'HM'
      order by e.ordem`,
  );

  const cards = await query(
    `select k.comprador_id, k.nome, k.email, k.telefone, k.turma, k.plano, k.categoria_entrada,
            k.estagio_chave, k.estagio_nome, k.estagio_aba, k.responsavel, k.tags, k.apto_ativacao,
            -- ativ_gps (0297/0298): o board precisa do selo de pendência do GPS no
            -- card — sem isso o frontend não tem como sinalizar o único item que
            -- fica faltando para aluno antigo/renovação (D2). Os outros ativ_*
            -- não estão aqui de propósito (o board já resume isso em
            -- apto_ativacao); GPS é o único que ganhou selo próprio no card.
            k.ativ_gps,
            k.responsavel_id, k.equipe_id, k.equipe_nome, k.equipe_cor, k.equipe_tipo,
            -- Duplo responsável (0211/0212): dono POR ABA, para o card mostrar
            -- os dois quando divergem do vigente (k.responsavel_id) — é a
            -- informação que a feature existe para preservar; sem isto no
            -- SELECT do board, o duplo responsável é só coluna no banco.
            k.responsavel_comercial_id, k.responsavel_comercial,
            k.responsavel_ativacao_id, k.responsavel_ativacao,
            ch2.atribuicao_admin, ch2.inbox_status,
            -- 0217: null = ninguém abriu esse card ainda. O board mostra o selo
            -- "NOVO" pulsando enquanto for null. Vem da tabela, não da view: o
            -- join com cs.contatos_hm já existe aqui (ch2) desde a 0163.
            ch2.visto_em,
            k.reuniao_em, k.entrevista_em, k.pagamento_em, k.pagamento_previsto_em,
            -- Saldo quitado: não deve mais nada. Colore o card de verde sutil (0099).
            (coalesce(fin.quitado, false) or coalesce(fin.saldo_a_perseguir, 1) <= 0) as quitado,
            -- 0214/board: quitado · em_dia · atrasado · aguardando — pagamento_previsto_em
            -- RECONCILIADO com cs.hm_pagamentos (a razão), não a data crua. Mesmo join
            -- que já lê fin acima (nenhum custo adicional): só mais uma coluna da view.
            fin.status_parcela,
            -- D3 (0283): a régua de próxima cobrança/inadimplência — SÓ SINALIZA,
            -- nunca move card (a leitura acontece aqui e no health-check/alerta;
            -- nenhum caminho de escrita deste módulo usa estas 3 colunas).
            fin.situacao, fin.proxima_cobranca_em, fin.dias_sem_pagar, fin.inadimplente,
            -- 13/08: adimplencia no card. parcelas_* so entram no rotulo quando
            -- a pessoa esta MESMO num parcelamento (contratadas > 1 e ao menos
            -- uma paga) -- dizer "0 de 12" para quem nao pagou nenhuma e ruido,
            -- e e a maioria. Medido: dos 27 atrasados, so 1 esta parcelando.
            fin.parcelas_pagas, fin.parcelas_contratadas,
            -- 11/08: "quanto essa pessoa ainda deve" é a pergunta que o comercial
            -- faz o dia todo e que só existia dentro da ficha. Vai para o card.
            -- null = o sistema não sabe (não é zero) — o card então não afirma nada.
            fin.saldo_a_perseguir as saldo,
            -- EXPLICAÇÃO DO CRÉDITO PRÓ-RATA (13/08, pedido do Marcio): "eles vão
            -- explicar o motivo do pró-rata com base nessa observação". O card
            -- precisa sinalizar quando HÁ crédito e NÃO há explicação — medido em
            -- produção: 88 pessoas com crédito e ZERO com o motivo preenchido.
            -- fin e ch2 ja estao no FROM; o LATERAL do Aurum e o mesmo de
            -- lib/services/hm-relatorio.ts (casa por documento, não por id).
            fin.credito, ch2.credito_obs,
            au.credito as aurum_credito, au.excecao as aurum_excecao,
            au.excecao_motivo as aurum_excecao_motivo, au.obs as aurum_obs,
            -- Parcelando: pagou ≥1 parcela e ainda deve. O espelho no Comercial mostra
            -- esse card em "Pagamento Parcelado", não em "Pagamento Realizado" (0108).
            (fin.situacao = 'mensalidade_em_curso') as parcelado,
            -- Falso-verde: o pacote foi cravado ignorando o crédito pró-rata e o
            -- pagamento que virou esse crédito segue contado como pagamento. O saldo
            -- dá zero por coincidência aritmética, não por quitação (0112). Enquanto
            -- o comercial não decide quanto cobrar, o card avisa em vez de mentir.
            (cd.comprador_id is not null) as conferir_saldo,
            -- 0195: cancelamento. cancelado_na_hotmart = a propria Hotmart
            -- confirmou (reembolso/chargeback), que e o vermelho forte do card.
            -- Sem confirmacao da Hotmart, e cancelamento registrado pelo comercial:
            -- mesmo vermelho, rotulo diferente.
            (ch2.cancelamento_efetivado_em is not null) as cancelado,
            (ch2.hotmart_cancelado_em is not null) as cancelado_na_hotmart,
            ch2.cancelamento_motivo,
            -- Motivo categorizado + prazo pedido (0306/B4): direto de ch2 (já no
            -- FROM) — a view cs.contatos_hm_kanban ainda não expõe essas duas
            -- colunas, e mexer nela hoje é risco (envelope de subselect derrubou
            -- o board nesta mesma sessão). O front usa cancelamento_prazo para o
            -- selo de prazo vencido.
            ch2.cancelamento_motivo_tipo, ch2.cancelamento_prazo,
            um.descricao as ultima_msg,
            me.criado_em as entrou_estagio_em,
            -- A MESMA pessoa nos OUTROS boards (0164): o operador do Aurum precisa
            -- saber que ela já está em "Acesso Liberado" no HM antes de abordar como
            -- se fosse contato novo. Vem como texto pronto ("HM: Entrevista
            -- Finalizada") porque o card só tem espaço para um selo.
            op.resumo as outros_portais
       from cs.contatos_hm_kanban k
       -- 0163: com card por PESSOA × PRODUTO, casar por comprador_id multiplica as
       -- linhas (quem tem card no HM e no Aurum voltava 2x, com o financeiro do board
       -- errado). O join é pelo CARD.
       join cs.contatos_hm ch2 on ch2.id = k.contato_hm_id
       left join cs.vw_hm_financeiro fin on fin.contato_hm_id = k.contato_hm_id
       left join cs.vw_hm_credito_duplo cd on cd.comprador_id = k.comprador_id
       -- Aurum casa por DOCUMENTO (a view é overlay da planilha do Victor, não
       -- tem comprador_id). O limit 1 e obrigatorio: subquery escalar sem limite
       -- derruba a query inteira com ERROR 21000 (a lição da 0168/0201).
       left join public.compradores co_doc on co_doc.id = k.comprador_id
       left join lateral (
         select a.credito, a.excecao, a.excecao_motivo, a.obs
           from cs.vw_aurum_saldo a
          where a.documento = regexp_replace(coalesce(co_doc.documento, ''), '[^0-9]', '', 'g')
          limit 1
       ) au on true
       left join lateral (
         select string_agg(o.outro_produto || ': ' || coalesce(o.outro_estagio, '?'), ' · '
                           order by o.outro_produto) as resumo
           from cs.vw_card_outros_portais o
          where o.contato_hm_id = k.contato_hm_id
       ) op on true
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
        -- 0296: o board do AURUM é do evento de SP. A padronização do kanban é
        -- registrar as vendas do ETHB SP, e a tag é o que decide — não a cidade
        -- de quem comprou (o resumo "⟦HM origem⟧ ... Porto Alegre/RS" da ficha é
        -- o ENDEREÇO da pessoa, e gente de POA/GO comprou o evento de SP).
        -- As 6 fichas sem a tag são lançamentos de saldo, não venda do evento:
        -- continuam existindo inteiras (R$ 134.165 no razão, aluno provisionado,
        -- timeline), só não ocupam o board. Filtro de TELA, nada é apagado.
        and (k.produto <> 'AURUM' or k.tags @> array['ETHB SP'])
        -- Escopo (predicado único, visibilidade.ts): vejo tudo OU é MEU OU é
        -- da minha equipe (OU esteira). poolRestrito (0265): card LIVRE (sem
        -- id, sem equipe, sem texto órfão) deixou de ser "pool visível a
        -- todos" no HM/AURUM/ETHB — a venda nova nasce sem operador (fila de
        -- entrada da gestão) e só quem verTudo (master + Kelly,
        -- gerente_distribuidor) enxerga até ser distribuída.
        and ${sqlEscopo(
          { rid: "k.responsavel_id", eq: "k.equipe_id", nome: "k.responsavel", tags: "k.tags", aba: "k.estagio_aba", produto: "k.produto" },
          { verTudo: 4, usuario: 5, equipe: 6, abas: 8, produto: 9 },
          { poolRestrito: true },
        )}
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
                 -- poolRestrito (0265): o sócio herda a visibilidade do
                 -- TITULAR — se o card do titular está na fila sem dono
                 -- (invisível ao operador comum), o sócio pendurado nele
                 -- também fica, pela mesma regra.
                 and ${sqlEscopo(
                   { rid: "tk.responsavel_id", eq: "tk.equipe_id", nome: "tk.responsavel", tags: "tk.tags", aba: "tk.estagio_aba", produto: "tk.produto" },
                   { verTudo: 1, usuario: 2, equipe: 3, abas: 5, produto: 6 },
                   { poolRestrito: true },
                 )})
      order by s.titular_nome, s.nome`,
    // O sócio herda a visibilidade do TITULAR — inclusive pelo ramo esteira: os
    // sócios vivem justamente na Ativação, então sem $5/$6 aqui o card do
    // titular apareceria no board e os sócios dele sumiriam.
    [verTudo, usuarioId, equipeId, produto, abas, ESTEIRA_COMPARTILHADA_PRODUTO],
  );

  // Quem pode assumir um contato = a equipe ATIVA (cs.usuarios), não só quem já
  // tem card. Lista RECORTADA por nível (regra única em listaResponsaveis,
  // visibilidade.ts): master = todos + legados; gestor = a própria equipe;
  // operador = só ele. O seletor não pode oferecer destino que
  // atribuirResponsavelHm vai recusar.
  // `funcao: "comercial"` (0265, pedido do Marcio: "só quem é do comercial no
  // dropdown, tipo a Jusy, a Kelly e o Jonathan"): o dropdown "Operador
  // (vigente)" da ficha do HM É `responsavel_id` — o campo comercial (ver
  // CAMPOS_HM_COMERCIAL em lib/papeis.ts). Esta MESMA lista também alimenta o
  // filtro "responsável" da tela (conveniência de busca) — restringir por
  // função aqui restringe os dois juntos, de propósito: não faz sentido
  // filtrar a tela por alguém que não pode mais ser destino de atribuição.
  const responsaveis = await listaResponsaveis(sessao, "HM", {
    sql: `select distinct responsavel from cs.contatos_hm where responsavel is not null and responsavel <> ''`,
  }, "comercial");
  // `qtd` alimenta a régua de canais fixos: o placar do canal INTEIRO, sem os
  // filtros da tela — o número é "quantas vendas o evento fez", não "quantas
  // estou vendo agora".
  const tagRows = await query<{ tag: string; eh_turma: boolean; qtd: number }>(
    // 13/08 — `and produto = $2`. Faltava, e a régua do board do AURUM contava
    // os cards do HM junto: o canal "ETHB SP" aparecia com 50 num board de 35
    // cards. São 35 PESSOAS; as outras 15 linhas são o card que essas mesmas
    // pessoas têm no HM (as 15 de sempre, card por pessoa × produto desde a
    // 0163). O mesmo filtro conserta a LISTA de canais logo abaixo, que oferecia
    // no Aurum canais que só existem no HM — e filtrar por eles não devolvia nada.
    //
    // "Placar do canal INTEIRO" segue valendo para o que a frase quis dizer:
    // ignora os filtros DA TELA. O produto não é filtro de tela, é o board.
    `select t as tag, t ~ $1 as eh_turma, count(*)::int as qtd
       from cs.contatos_hm, unnest(tags) t
      where coalesce(produto, 'HM') = $2
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
  // O board que pediu o movimento (0174). O GET já recorta os cards por produto;
  // o PATCH não passava essa informação adiante, então arrastar um card no board
  // do Aurum movia o card do HM da mesma pessoa — silenciosamente, porque as duas
  // operações "deram certo". Mesma família da 0163: card por pessoa × produto.
  //
  // ⚠️ 0187 — ESCRITA cross-produto. Este handler direciona a escrita por
  // `?produto=`, então o `guard` TEM de validar esse mesmo produto. Com "HM"
  // literal, `PATCH /api/hm/kanban?produto=AURUM` era aceito por uma conta sem o
  // portal AURUM e movia de fato o card do board do Aurum: o gate de ação
  // (podeAgirCardHm → cardEscopoHm) casa só por comprador_id, SEM filtro de
  // produto, então podia aprovar avaliando o card do HM enquanto a query real
  // mexia no do Aurum. Resolver o produto ANTES do guard fecha isso.
  const produtoDoBoard = produtoDaRequisicao(req);
  const g = await guard({ portal: produtoDoBoard });
  if (!g.ok) return g.res;
  const sessao = g.sessao;
  const p = await parseBody(req, HmMoverSchema);
  if (!p.ok) return p.res;
  const { compradorId, estagioChave, antesDe, cancelamentoMotivoTipo, cancelamentoPrazo } = p.data;
  // Gate de AÇÃO (28/07, leitura ≠ ação): mover é ESCRITA — operador só no pool
  // e nos cards DELE. O card do colega aparece no board (escopo de leitura),
  // mas o arrasto recusa com 403 'card_de_outro_operador' (o front traduz).
  const acao = await podeAgirCardHm(sessao, compradorId, produtoDoBoard);
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
  // O movimento com motivo numa tacada (0306/B3): o operador arrasta o card PARA
  // "Solicitou Cancelamento" já explicando o motivo, no mesmo gesto — sem isso
  // ele move e depois esquece de voltar na ficha para explicar. Grava ANTES de
  // mover: a trava de entrada (B1, moverEstagioHm) lê `cancelamento_motivo_tipo`
  // do card no banco, então se o UPDATE viesse depois do mover, a própria trava
  // recusaria o movimento que estava trazendo o motivo. `antesDe`/reposição não
  // dependem disto — só o campo em si precisa existir antes da checagem.
  if (estagioChave === HM_STAGE_SOLICITOU_CANCELAMENTO && (cancelamentoMotivoTipo !== undefined || cancelamentoPrazo !== undefined)) {
    const sets: string[] = [];
    const vals: unknown[] = [compradorId, produtoDoBoard];
    if (cancelamentoMotivoTipo !== undefined) { sets.push(`cancelamento_motivo_tipo = $${vals.push(cancelamentoMotivoTipo) }`); }
    if (cancelamentoPrazo !== undefined) { sets.push(`cancelamento_prazo = ${cancelamentoPrazo ? `$${vals.push(cancelamentoPrazo)}::date` : "null"}`); }
    if (sets.length) {
      await query(
        `update cs.contatos_hm set ${sets.join(", ")}, atualizado_em = now()
          where comprador_id = $1 and coalesce(produto, 'HM') = coalesce($2, 'HM')`,
        vals,
      );
    }
  }
  const posicao = antesDe === undefined ? undefined : { antesDe };
  // `souMaster` (0290/B2): mesma exceção da trava de cancelados logo acima —
  // as 5 colunas "de fato" (boleto gerado, pagamento parcelado/realizado,
  // cancelamento, reembolsado) recusam gesto manual, exceto do master (D3).
  const r = await moverEstagioHm(compradorId, estagioChave, sessao.nome || "cs", posicao, produtoDoBoard, souMaster);
  // `faltando` são os itens do checklist que barraram a entrada em "Ativação
  // Realizada" — o board mostra a lista em vez de um erro genérico. `coluna`/
  // `direcao` (0290): a trava de coluna-da-Hotmart diz QUAL coluna e se foi
  // entrada ou saída, para a tela montar a mensagem certa.
  if (!r.ok) return NextResponse.json({ ok: false, reason: r.reason, faltando: r.faltando, coluna: r.coluna, direcao: r.direcao }, { status: 400 });
  return NextResponse.json({ ok: true });
}
