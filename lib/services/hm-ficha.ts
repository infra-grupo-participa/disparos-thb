import { query, queryOne } from "@/lib/db";

// A ficha completa de um aluno HM, em um só lugar. A tela (GET /api/hm/contato/[id])
// e a exportação em XLSX leem daqui — se as duas montassem a ficha por conta
// própria, a planilha exportada logo diria uma coisa e o drawer outra.

export type ContatoHmFicha = Record<string, unknown> & { nome?: string | null };

export type FichaHm = {
  contato: ContatoHmFicha;
  socios: Record<string, unknown>[];
  prorata: Record<string, unknown> | null;
  linksSaldo: Record<string, unknown>[];
  timeline: Record<string, unknown>[];
  formularios: Record<string, unknown>[];
  financeiro: Record<string, unknown> | null;
  /** Saldo do Aurum ETHB SP (0158) — overlay por documento. Null se não for do Aurum. */
  aurumSaldo: Record<string, unknown> | null;
  /** Saldo cheio do BOARD, em reais (10/08): 59.000 no Aurum, 14.700 no HM. */
  saldoCheio: string | null;
  /** A mesma pessoa nos OUTROS boards (0164) — vazio se ela só existe neste. */
  outrosPortais: Record<string, unknown>[];
  /** Todas as marcações de reunião/entrevista — inclusive as que foram remarcadas. */
  agendamentos: Record<string, unknown>[];
  /** O histórico de versões da ficha (0097) — como a planilha: ver e recuperar. */
  versoes: { id: number; resumo: string; autor: string | null; criado_em: string }[];
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
            k.reuniao_em, k.reuniao_resultado, k.reuniao_gravacao_url,
            k.entrevista_em, k.entrevista_resultado, k.entrevista_gravacao_url,
            k.pagamento_forma, k.pagamento_parcelas, k.pagamento_em, k.apto_ativacao,
            k.pagamento_meio, k.pagamento_previsto_em, k.acordo, k.oferta_saldo_codigo, k.link_saldo_enviado_em,
            k.nao_contatar, k.nao_contatar_motivo, k.revisar, k.revisar_motivo,
            k.ativ_searchie, k.ativ_comunidade, k.ativ_grupo, k.ativ_pesquisa, k.grupo_informes, k.pendencia,
            k.cancelamento_em, k.cancelamento_motivo, k.cancelamento_valor, k.link_facebook,
            k.cancelamento_efetivado_em, k.cancelamento_origem,
            k.hotmart_cancelado_em, k.hotmart_cancelamento_evento, k.hotmart_cancelamento_transacao,
            k.hotmart_status, k.hotmart_status_em, k.canal_aquisicao,
            k.rev_searchie, k.rev_comunidade, k.rev_grupo, k.rev_pesquisa,
            k.acessos_revogados_em, k.acessos_revogados_por, k.acessos_a_remover, k.aluno_id,
            k.tags, k.observacoes, k.criado_em, ch.produto, ch.id as contato_hm_id
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

  // SALDO CHEIO DO BOARD (10/08). Era 14.700 fixo no front — número do HM, que o
  // card do AURUM exibia errado (lá o pacote é 60.000 com 1.000 de entrada, logo
  // 59.000 de saldo). Agora vem do banco por produto: cs.aurum_parametros para o
  // Aurum (0158), e a regra histórica do HM (15.000 − sinal de 300) para o resto.
  const produtoCard = (contato as unknown as { produto?: string | null }).produto ?? "HM";
  const saldoCheio = produtoCard === "AURUM"
    ? await queryOne<{ valor: string }>(
        `select ((select valor from cs.aurum_parametros where chave='pacote_cheio')
               - (select valor from cs.aurum_parametros where chave='entrada'))::text as valor`,
      )
    : { valor: "14700" };

  // Sócios convidados (aba "SÓCIOS T39"). `aluno_id` preenchido = já está na base.
  const socios = await query(
    `select s.id, s.nome, s.email, s.telefone, s.link_facebook,
            s.ativ_searchie, s.ativ_comunidade, s.ativ_grupo, s.aluno_id
       from cs.hm_socios s
       join cs.contatos_hm ch on ch.id = s.contato_hm_id
      where ch.comprador_id = $1
      order by s.criado_em`,
    [compradorId],
  );

  // Crédito pró-rata: o que o aluno da base já pagou e ainda não usou. Só existe
  // se alguém preencheu os insumos (oferta anterior, data e valor) — sem eles o
  // saldo é o cheio (14.700). Ver cs.fn_hm_prorata (0056).
  const prorata = await queryOne(
    `select dias_usados, dias_restantes, valor_dia, consumido, credito, saldo_a_pagar
       from cs.fn_hm_prorata($1)`,
    [compradorId],
  );

  // Link de saldo sugerido: cada valor de saldo tem sua própria oferta na Hotmart
  // (o desconto do pró-rata vem embutido no valor — 0049). Sabendo o saldo, o
  // sistema escolhe o link certo em vez de o operador procurar numa aba de planilha.
  const alvo = (prorata as { saldo_a_pagar?: string } | null)?.saldo_a_pagar ?? saldoCheio?.valor ?? "14700";
  const linksSaldo = await query(
    `select distinct on (recorrente) codigo, valor, recorrente, link
       from cs.hm_ofertas_saldo
      where ativo and valor is not null
      order by recorrente, abs(valor - $1::numeric)`,
    [alvo],
  );

  const timeline = await query(
    `select i.tipo, i.descricao, i.autor, i.criado_em
       from cs.interacoes i
       join cs.contatos_hm ch on ch.id = i.contato_hm_id
      where ch.comprador_id = $1
      order by i.criado_em desc
      limit 200`,
    [compradorId],
  );

  // Formulários do comprador (Respondi / HT). Mesma tabela cs.formularios.
  const formularios = await query(
    `select tipo, respostas, pontuacao, respondido_em
       from cs.formularios where comprador_id = $1
      order by respondido_em desc nulls last`,
    [compradorId],
  );

  // Bloco financeiro: o que já foi registrado + a sugestão para o formulário de
  // pagamento. A sugestão vem de cs.fn_hm_sugestao_financeira porque o papel do
  // app não lê public.compras / hm_product_catalog (RLS sem grant).
  const financeiro = await queryOne(
    `select ch.valor_total, ch.valor_pago, ch.aluno_id, ch.categoria_entrada,
            ch.saldo_a_pagar_manual, ch.saldo_a_pagar_manual_por, ch.saldo_a_pagar_manual_em,
            s.sugestao_valor_total, s.hotmart_bruto,
            -- situacao (0165): o drawer precisa distinguir "não deve" de "ainda não
            -- dá para calcular" (aluno da base sem crédito do analista) — nesse caso
            -- exibir o saldo cheio faria o operador cobrar a mais.
            fin.situacao
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
       join cs.contatos_hm ch on ch.id = a.contato_hm_id
      where ch.comprador_id = $1
      order by a.criado_em desc`,
    [compradorId],
  );

  // O histórico de versões (0097) — a lista que a ficha mostra para ver e
  // recuperar, como na planilha. As mais recentes primeiro; o teto de 30 por card
  // é aplicado na escrita.
  const versoes = await query<{ id: number; resumo: string; autor: string | null; criado_em: string }>(
    `select v.id, v.resumo, v.autor, v.criado_em
       from cs.hm_versoes v join cs.contatos_hm ch on ch.id = v.contato_hm_id
      where ch.comprador_id = $1
      order by v.criado_em desc, v.id desc`,
    [compradorId],
  );

  return { contato, socios, prorata, linksSaldo, timeline, formularios, financeiro, aurumSaldo,
           saldoCheio: saldoCheio?.valor ?? null, outrosPortais, agendamentos, versoes };
}
