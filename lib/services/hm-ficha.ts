import { query, queryOne } from "@/lib/db";

// A ficha completa de um aluno HM, em um só lugar. A tela (GET /api/hm/contato/[id])
// e a exportação em XLSX leem daqui — se as duas montassem a ficha por conta
// própria, a planilha exportada logo diria uma coisa e o drawer outra.

export type ContatoHmFicha = Record<string, unknown> & { nome?: string | null };

export type FichaHm = {
  contato: ContatoHmFicha;
  socios: Record<string, unknown>[];
  /** 0203 + webhook do Respondi (17/08): sócios ANTERIORES deste titular — quem
   *  saiu e quando. Sem CPF (não usado na tela). Vazio quando nunca houve troca. */
  historicoSocios: Record<string, unknown>[];
  prorata: Record<string, unknown> | null;
  /** 0231: a linha CONGELADA da planilha do Victor, quando existe — a mesma conta
   *  que gerou o link de pagamento enviado ao aluno. Null = o crédito é cálculo
   *  do sistema, não número conferido com a planilha. */
  prorataFonte: Record<string, unknown> | null;
  linksSaldo: Record<string, unknown>[];
  timeline: Record<string, unknown>[];
  formularios: Record<string, unknown>[];
  financeiro: Record<string, unknown> | null;
  /** Saldo do Aurum ETHB SP (0158) — overlay por documento. Null se não for do Aurum. */
  aurumSaldo: Record<string, unknown> | null;
  /** Saldo do BOARD, em reais (0174): pacote da OFERTA DE ENTRADA menos o pago no ciclo
   *  (59.000 no Aurum, `pacote_regra − pago_no_ciclo` no HM). Null quando ainda não dá
   *  para calcular (aluno da base sem crédito pró-rata, situação `incalculavel`). */
  saldoCheio: string | null;
  /** A mesma pessoa nos OUTROS boards (0164) — vazio se ela só existe neste. */
  outrosPortais: Record<string, unknown>[];
  /** Todas as marcações de reunião/entrevista — inclusive as que foram remarcadas. */
  agendamentos: Record<string, unknown>[];
  /** O histórico de versões da ficha (0097) — como a planilha: ver e recuperar. */
  versoes: { id: number; resumo: string; autor: string | null; criado_em: string }[];
  /** HISTÓRICO FINANCEIRO (12/08): a razão (`cs.hm_pagamentos`) deste card, do mais
   *  recente para o mais antigo. Pedido do Marcio: "dentro do card do aluno, uma
   *  micro aba de financeiro, tipo histórico de pagamentos, e aí a gente consegue
   *  ver toda a linha do tempo do pagamento dele". Filtrado por PRODUTO — sem
   *  isso o card do HM mostraria a mensalidade do Aurum como se fosse dele. */
  pagamentos: Record<string, unknown>[];
};

// Retorna null quando o comprador não tem card HM.
//
// `produto` (0164): desde a 0163 a mesma pessoa pode ter card em HM e AURUM. A ficha
// é aberta por comprador_id, então SEM o produto o queryOne devolveria um card ao
// acaso — clicar no card do Aurum podia abrir a ficha do HM. Quando o produto não vem
// (rotas antigas), cai no card mais antigo, que é o comportamento histórico.
export async function fichaHm(compradorId: string, produto?: string | null): Promise<FichaHm | null> {
  // `responsavel_id` (+ equipe, da view 0140) e `atribuicao_admin` (0142, só na
  // tabela — a view do kanban não a expõe) entram na ficha porque o front
  // decide com eles entre "Assumir", leitura e o cadeado da trava do admin.
  const contato = await queryOne<ContatoHmFicha>(
    `select k.comprador_id, k.nome, k.email, k.telefone, k.turma, k.turma_origem, k.plano, k.categoria_entrada,
            k.estagio_chave, k.estagio_nome, k.estagio_aba, k.responsavel,
            k.responsavel_id, k.equipe_id, k.equipe_nome, k.equipe_cor, ch.atribuicao_admin,
            -- Histórico por aba (0211/0212): dono do card em cada aba, mesmo
            -- depois que ele muda de aba. A view contatos_hm_kanban já expõe
            -- os ids e os nomes derivados (LEFT JOIN) desde a 0211.
            k.responsavel_comercial_id, k.responsavel_ativacao_id,
            k.responsavel_comercial, k.responsavel_ativacao,
            k.reuniao_em, k.reuniao_resultado, k.reuniao_gravacao_url,
            k.entrevista_em, k.entrevista_resultado, k.entrevista_gravacao_url,
            k.pagamento_forma, k.pagamento_parcelas, k.pagamento_em, k.apto_ativacao,
            k.pagamento_meio, k.pagamento_previsto_em, k.acordo, k.oferta_saldo_codigo, k.link_saldo_enviado_em,
            k.nao_contatar, k.nao_contatar_motivo, k.revisar, k.revisar_motivo,
            k.ativ_searchie, k.ativ_comunidade, k.ativ_grupo, k.ativ_pesquisa, k.ativ_gps, k.grupo_informes, k.pendencia,
            k.cancelamento_em, k.cancelamento_motivo, k.cancelamento_valor, k.link_facebook,
            k.cancelamento_efetivado_em, k.cancelamento_origem,
            k.hotmart_cancelado_em, k.hotmart_cancelamento_evento, k.hotmart_cancelamento_transacao,
            k.hotmart_status, k.hotmart_status_em, k.canal_aquisicao,
            k.rev_searchie, k.rev_comunidade, k.rev_grupo, k.rev_pesquisa,
            k.acessos_revogados_em, k.acessos_revogados_por, k.acessos_a_remover, k.aluno_id,
            k.tags, k.observacoes, k.criado_em, ch.produto, ch.id as contato_hm_id,
            -- credito_obs (0207/F4): motivo do pró-rata manual. Não está na view
            -- contatos_hm_kanban (nenhum campo credito_* insumo está — só o
            -- calculado sai via fn_hm_prorata, abaixo), então vem direto da
            -- tabela, no mesmo select que já busca atribuicao_admin/produto por ali.
            ch.credito_obs,
            -- intencao_pagamento/_obs (0281) e contato_inicial_em (0280): mesmo
            -- motivo do credito_obs acima — só existem na tabela, não na view do
            -- kanban. Sem elas aqui a ficha reabria em branco (undefined) depois
            -- do PATCH gravar, e a trava da 0284 então recusava o desfecho que o
            -- operador tinha acabado de preencher.
            ch.intencao_pagamento, ch.intencao_pagamento_obs, ch.contato_inicial_em
       from cs.contatos_hm_kanban k
       -- 0164: join pelo CARD. Com card por pessoa×produto, casar por comprador_id
       -- cruzaria o card do HM com o do Aurum (a mesma regressão da 0163).
       join cs.contatos_hm ch on ch.id = k.contato_hm_id
      where k.comprador_id = $1
        and ($2::text is null or ch.produto = $2)
      order by ch.criado_em asc
      limit 1`,
    [compradorId, produto ?? null],
  );
  if (!contato) return null;

  const produtoCard = (contato as unknown as { produto?: string | null }).produto ?? "HM";

  // 0187: o id do CARD já resolvido acima (a query de `contato` filtra por produto).
  // Toda sub-query da ficha ancora NELE — nunca em `comprador_id`, que é da PESSOA e
  // casa com os cards de todos os boards dela. Sem isso, sócios/timeline/agendamentos
  // do card do Aurum apareciam misturados na ficha do HM (e no XLSX exportado).
  const cardId = (contato as unknown as { contato_hm_id: string }).contato_hm_id;

  // Bloco financeiro: o que já foi registrado + a sugestão para o formulário de
  // pagamento. A sugestão vem de cs.fn_hm_sugestao_financeira porque o papel do
  // app não lê public.compras / hm_product_catalog (RLS sem grant). Buscado aqui
  // (mais cedo que antes) porque o SALDO CHEIO do card não-Aurum (abaixo) passa a
  // sair de `fin.saldo_a_perseguir` — mesma consulta, sem abrir outra.
  const financeiro = await queryOne(
    `select ch.valor_total, ch.valor_pago, ch.aluno_id, ch.categoria_entrada,
            ch.saldo_a_pagar_manual, ch.saldo_a_pagar_manual_por, ch.saldo_a_pagar_manual_em,
            s.sugestao_valor_total, s.hotmart_bruto,
            -- situacao (0165): o drawer precisa distinguir "não deve" de "ainda não
            -- dá para calcular" (aluno da base sem crédito do analista) — nesse caso
            -- exibir o saldo cheio faria o operador cobrar a mais.
            fin.situacao,
            -- saldo_a_perseguir (0174): pacote_regra − pago_no_ciclo, com o valor_total
            -- cravado tendo precedência — é a MESMA conta que o board persegue. Vira o
            -- saldo cheio do card não-Aurum, abaixo.
            fin.saldo_a_perseguir,
            -- 0185: a conta ABERTA no card. O Marcio pediu o pro-rata explicito: nao
            -- basta o total, o operador tem de conseguir dizer ao aluno de onde saiu
            -- (pacote da oferta de entrada - o que ja pagou - credito pro-rata).
            fin.pacote_regra, fin.pago, fin.credito
       from cs.contatos_hm ch
            cross join lateral cs.fn_hm_sugestao_financeira(ch.comprador_id) s
            left join cs.vw_hm_financeiro fin on fin.contato_hm_id = ch.id
      where ch.comprador_id = $1
        and ($2::text is null or ch.produto = $2)
      -- ⚠️ fn_hm_sugestao_financeira devolve MAIS DE UMA linha para quem tem várias
      -- compras (4 no caso da Ana Paula). O limit 1 sozinho pegaria uma ao acaso —
      -- a maior sugestão é a estável e a útil (o pacote cheio, não uma parcela).
      order by ch.criado_em asc, s.sugestao_valor_total desc nulls last
      limit 1`,
    [compradorId, produto ?? null],
  );

  // SALDO CHEIO DO BOARD (0174). Era 14.700 fixo no front — número do HM, que o
  // card do AURUM exibia errado (lá o pacote é 60.000 com 1.000 de entrada, logo
  // 59.000 de saldo). Agora vem do banco por produto: cs.aurum_parametros para o
  // Aurum (0158); para o resto, `saldo_a_perseguir` da mesma vw_hm_financeiro que
  // o board lê — pacote da OFERTA DE ENTRADA menos o pago no ciclo, com o cravado
  // tendo precedência. Fica null quando a régua ainda não sabe calcular (aluno da
  // base sem crédito pró-rata, situação `incalculavel`) — a tela mostra "saldo a
  // definir", nunca um número chutado.
  const saldoCheio = produtoCard === "AURUM"
    ? await queryOne<{ valor: string }>(
        `select ((select valor from cs.aurum_parametros where chave='pacote_cheio')
               - (select valor from cs.aurum_parametros where chave='entrada'))::text as valor`,
      )
    : { valor: (financeiro as { saldo_a_perseguir?: string | null } | null)?.saldo_a_perseguir ?? null };

  // Sócios convidados (aba "SÓCIOS T39"). `aluno_id` preenchido = já está na base.
  const socios = await query(
    `select s.id, s.nome, s.email, s.telefone, s.link_facebook,
            s.ativ_searchie, s.ativ_comunidade, s.ativ_grupo, s.aluno_id
       from cs.hm_socios s
      where s.contato_hm_id = $1
      order by s.criado_em`,
    [cardId],
  );

  // Histórico de sócios do titular (0203 + webhook do Respondi, 17/08): quem já
  // foi sócio deste card e quando saiu. CPF de propósito FORA do select — a
  // ficha não mostra documento de sócio arquivado, e mandar o dado sem uso
  // exporia informação pessoal à toa. Só entra quem já foi SUBSTITUÍDO
  // (substituido_em not null) — o vigente já aparece no bloco de sócios acima.
  const historicoSocios = await query(
    `select nome, criado_em, substituido_em
       from cs.vw_hm_socios_historico_titular
      where contato_hm_id = $1
        and substituido_em is not null
      order by criado_em desc`,
    [cardId],
  );

  // Crédito pró-rata: o que o aluno da base já pagou e ainda não usou. Só existe
  // se alguém preencheu os insumos (oferta anterior, data e valor) — sem eles o
  // saldo é o cheio (saldoCheio, acima). Ver cs.fn_hm_prorata (0056).
  const prorata = await queryOne(
    `select dias_usados, dias_restantes, valor_dia, consumido, credito, saldo_a_pagar
       from cs.fn_hm_prorata($1)`,
    [compradorId],
  );

  // 0231: de ONDE veio esse crédito. Quando existe linha congelada, o número da
  // ficha é o MESMO que gerou o link de pagamento enviado ao aluno — e é isso que
  // o comercial precisa poder afirmar ao telefone. Sem esta informação, ele vê um
  // valor e não sabe se pode defendê-lo ou se o sistema recalculou por conta.
  const prorataFonte = await queryOne(
    `select pl.fonte, pl.importado_em, pl.valor_pago, pl.dias_totais, pl.dias_usados,
            pl.valor_dia, pl.consumido, pl.credito, pl.saldo_link
       from cs.hm_prorata_planilha pl
       join public.compradores co on lower(co.email) = pl.email
      where co.id = $1 and pl.credito is not null
      limit 1`,
    [compradorId],
  );

  // Link de saldo sugerido: cada valor de saldo tem sua própria oferta na Hotmart
  // (o desconto do pró-rata vem embutido no valor — 0049). Sabendo o saldo, o
  // sistema escolhe o link certo em vez de o operador procurar numa aba de planilha.
  //
  // ⚠️ A ORDEM IMPORTA. `saldo_a_perseguir` (vw_hm_financeiro) vem primeiro porque é
  // a régua viva: pacote da oferta de entrada − entrada paga − crédito pró-rata, com
  // o cravado tendo precedência. `fn_hm_prorata.saldo_a_pagar` ainda tem o 14700
  // cravado (assume entrada de 300) e por isso é só fallback — antes ele vinha
  // primeiro e mandava o operador para o link errado em quem entrou pela oferta de
  // R$ 697: o Rogério tem saldo 10.399,67 e o pró-rata sozinho diria 10.796,67.
  const alvo = saldoCheio?.valor
    ?? (prorata as { saldo_a_pagar?: string } | null)?.saldo_a_pagar
    ?? "14700";
  // TOLERÂNCIA (16/08, achado do analista de dados): antes este `order by` sem
  // filtro SEMPRE devolvia o vizinho mais próximo, mesmo quando o mais próximo
  // era outra oferta a milhares de reais de distância — medido em produção: até
  // R$487,67 de erro por pessoa em 11 saldos do CSV que não têm oferta própria
  // aqui. `patch({oferta_saldo_codigo})` grava a oferta ERRADA no card e
  // `fn_hm_valores_derivados` monta o pacote com ela — a pessoa aparece quitada
  // com o valor errado. Cada saldo real bate quase exato com sua oferta
  // cravada (arredondamento de centavos); qualquer diferença maior é OUTRA
  // oferta, nunca a mesma com desconto. R$1,00 cobre o arredondamento sem
  // abrir margem para sugerir link de outro valor.
  const TOLERANCIA_LINK_SALDO = "1.00";
  const linksSaldo = await query(
    `select distinct on (recorrente) codigo, valor, recorrente, link
       from cs.hm_ofertas_saldo
      where ativo and valor is not null
        and abs(valor - $1::numeric) <= $2::numeric
      order by recorrente, abs(valor - $1::numeric)`,
    [alvo, TOLERANCIA_LINK_SALDO],
  );

  const timeline = await query(
    `select i.tipo, i.descricao, i.autor, i.criado_em
       from cs.interacoes i
      where i.contato_hm_id = $1
      order by i.criado_em desc
      limit 200`,
    [cardId],
  );

  // Formulários do comprador (Respondi / HT). Mesma tabela cs.formularios.
  const formularios = await query(
    `select tipo, respostas, pontuacao, respondido_em
       from cs.formularios where comprador_id = $1
      order by respondido_em desc nulls last`,
    [compradorId],
  );

  // Saldo do AURUM ETHB SP (0158). Vem de outra fonte que o financeiro do HM: o
  // pró-rata do Aurum é calculado fora do banco (planilha do Victor) e ingerido —
  // por isso é um overlay por DOCUMENTO, não os campos valor_total/valor_pago do
  // card, que pertencem ao pacote de 15k do HM. Null para quem não é do Aurum.
  // `saldo_a_pagar` já vem NULL nas exceções (gratuidade/cancelado/revisar): a tela
  // deve mostrar `rotulo_operador`, nunca cobrar um número que não existe.
  const aurumSaldo = await queryOne(
    `select a.nome, a.credito, a.situacao, a.excecao, a.excecao_motivo, a.obs,
            a.ultima_oferta, a.ultima_compra_em, a.valor_pago as pago_na_compra_base,
            a.pacote_cheio, a.entrada_paga, a.base_saldo, a.saldo_a_pagar, a.rotulo_operador
       from cs.vw_aurum_saldo a
       join public.compradores co
         on regexp_replace(coalesce(co.documento,''), '[^0-9]', '', 'g') = a.documento
      where co.id = $1`,
    [compradorId],
  );

  // A MESMA pessoa nos OUTROS boards (0164). No card do kanban isso é um selo com
  // uma linha; aqui vem estruturado, porque a ficha tem espaço para o que muda a
  // conversa: em que etapa está, com quem, se já pagou e se virou aluno na base.
  // Chaveado pelo CARD (a view é por contato_hm_id) — usar o id já resolvido acima
  // evita repetir a regra do produto em dois lugares.
  const outrosPortais = await query(
    `select o.outro_produto, o.outro_estagio, o.outro_aba, o.outro_apto,
            o.outro_pagamento_em, o.outro_tem_matricula, o.outro_responsavel,
            o.outro_atualizado_em, o.comprador_id
       from cs.vw_card_outros_portais o
      where o.contato_hm_id = $1
      order by o.outro_produto`,
    [(contato as unknown as { contato_hm_id: string }).contato_hm_id],
  );

  // Histórico de marcações (0064). A data vigente está no card; aqui está a
  // trilha — inclusive as marcações que caíram, que é o que revela o aluno que
  // remarca sem parar.
  const agendamentos = await query(
    `select a.tipo, a.quando, a.status, a.motivo, a.autor, a.criado_em, a.encerrado_em
       from cs.hm_agendamentos a
      where a.contato_hm_id = $1
      order by a.criado_em desc`,
    [cardId],
  );

  // O histórico de versões (0097) — a lista que a ficha mostra para ver e
  // recuperar, como na planilha. As mais recentes primeiro; o teto de 30 por card
  // é aplicado na escrita.
  const versoes = await query<{ id: number; resumo: string; autor: string | null; criado_em: string }>(
    `select v.id, v.resumo, v.autor, v.criado_em
       from cs.hm_versoes v
      where v.contato_hm_id = $1
      order by v.criado_em desc, v.id desc`,
    [cardId],
  );

  // HISTÓRICO FINANCEIRO (12/08) — a razão deste card, linha a linha.
  //
  // Por PRODUTO, com o mesmo predicado que a 0196/0197 usa no resto do dinheiro
  // (`cs.fn_hm_pagamento_do_produto`): quem tem card no HM e no Aurum tem duas
  // razões, e misturá-las aqui repetiria exatamente o bug que aquelas migrations
  // fecharam — só que na tela, que é onde o operador acredita.
  //
  // A ordem é do mais recente para o mais antigo porque a pergunta que abre a aba
  // é "qual foi o último pagamento?" — a linha do tempo completa vem logo abaixo.
  const pagamentos = await query(
    `select p.categoria, p.valor, p.pago_em, p.origem, p.transacao,
            p.oferta_codigo, p.metodo_pagamento, p.parcela, p.obs, p.autor
       from cs.hm_pagamentos p
      where p.comprador_id = $1
        and cs.fn_hm_pagamento_do_produto(p.oferta_codigo, $2)
      order by p.pago_em desc, p.parcela desc nulls last`,
    [compradorId, produtoCard],
  );

  return { contato, socios, historicoSocios, prorata, prorataFonte, linksSaldo, timeline, formularios, financeiro, aurumSaldo, pagamentos,
           saldoCheio: saldoCheio?.valor ?? null, outrosPortais, agendamentos, versoes };
}
