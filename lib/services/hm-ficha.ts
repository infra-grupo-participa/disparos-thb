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
  /** Todas as marcações de reunião/entrevista — inclusive as que foram remarcadas. */
  agendamentos: Record<string, unknown>[];
  /** O histórico de versões da ficha (0097) — como a planilha: ver e recuperar. */
  versoes: { id: number; resumo: string; autor: string | null; criado_em: string }[];
};

// Retorna null quando o comprador não tem card HM.
export async function fichaHm(compradorId: string): Promise<FichaHm | null> {
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
            k.tags, k.observacoes, k.criado_em
       from cs.contatos_hm_kanban k
       join cs.contatos_hm ch on ch.comprador_id = k.comprador_id
      where k.comprador_id = $1`,
    [compradorId],
  );
  if (!contato) return null;

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
  const alvo = (prorata as { saldo_a_pagar?: string } | null)?.saldo_a_pagar ?? "14700";
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
            s.sugestao_valor_total, s.hotmart_bruto
       from cs.contatos_hm ch,
            lateral cs.fn_hm_sugestao_financeira(ch.comprador_id) s
      where ch.comprador_id = $1`,
    [compradorId],
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

  return { contato, socios, prorata, linksSaldo, timeline, formularios, financeiro, agendamentos, versoes };
}
