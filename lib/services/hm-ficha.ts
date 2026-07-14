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
};

// Retorna null quando o comprador não tem card HM.
export async function fichaHm(compradorId: string): Promise<FichaHm | null> {
  const contato = await queryOne<ContatoHmFicha>(
    `select comprador_id, nome, email, telefone, turma, turma_origem, plano, categoria_entrada,
            estagio_chave, estagio_nome, estagio_aba, responsavel,
            reuniao_em, reuniao_resultado, entrevista_em, entrevista_resultado,
            pagamento_forma, pagamento_parcelas, pagamento_em, apto_ativacao,
            pagamento_meio, pagamento_previsto_em, acordo, oferta_saldo_codigo, link_saldo_enviado_em,
            nao_contatar, nao_contatar_motivo, revisar, revisar_motivo,
            ativ_searchie, ativ_comunidade, ativ_grupo, ativ_pesquisa, grupo_informes, pendencia,
            cancelamento_em, cancelamento_motivo, link_facebook,
            cancelamento_efetivado_em, cancelamento_origem,
            hotmart_cancelado_em, hotmart_cancelamento_evento, hotmart_cancelamento_transacao,
            rev_searchie, rev_comunidade, rev_grupo, rev_pesquisa,
            acessos_revogados_em, acessos_revogados_por, acessos_a_remover, aluno_id,
            tags, observacoes, criado_em
       from cs.contatos_hm_kanban where comprador_id = $1`,
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

  return { contato, socios, prorata, linksSaldo, timeline, formularios, financeiro, agendamentos };
}
