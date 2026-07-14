import { query } from "@/lib/db";

// A esteira HM inteira, uma linha por aluno, pronta para virar relatório. É a
// mesma leitura do board — mesmos filtros, mesma ordem das colunas e dos cards —
// só que com o que o board não mostra no card (acordo, saldo, checklist), porque
// num relatório o operador quer a linha completa, e não o resumo.

// Cada filtro aceita VÁRIOS valores — dentro do mesmo filtro a leitura é OU
// ("HT ATM ou Ex aluno"), entre filtros é E (canal E responsável). Lista vazia
// ou ausente = sem filtro.
export type FiltrosHm = {
  responsavel?: string[] | null;
  canal?: string[] | null;
  turma?: string[] | null;
  /** Só uma coluna (chave do estágio) — o relatório de uma etapa específica. */
  estagio?: string | null;
};

// Datas: o driver pg entrega Date no servidor (o XLSX as recebe assim), mas a
// mesma linha atravessa o JSON até a tabela e vira string ISO. O tipo cobre os
// dois consumidores — quem formata normaliza com new Date().
export type QuandoHm = string | Date | null;

// A linha da esteira — o contrato entre o SELECT abaixo, o XLSX e a visão em
// tabela. Um campo que não está aqui não existe para nenhum relatório: tabela e
// planilha saem da MESMA função justamente para nunca contarem histórias
// diferentes.
export type LinhaEsteira = {
  comprador_id: string;
  nome: string;
  email: string | null;
  telefone: string | null;
  // ----- onde está (etapa + esteira) -----
  estagio_chave: string;
  estagio_nome: string | null;
  estagio_aba: string | null;
  estagio_ordem: number | null;
  responsavel: string | null;
  // ----- quem é (fato — não se digita) -----
  categoria_entrada: string | null;
  plano: string | null;
  turma: string | null;
  turma_origem: string | null;
  tags: string[];
  // ----- compromissos -----
  reuniao_em: QuandoHm;
  reuniao_resultado: string | null;
  entrevista_em: QuandoHm;
  entrevista_resultado: string | null;
  // ----- acordo do saldo (o que só o operador sabe) -----
  pagamento_meio: string | null;
  pagamento_previsto_em: QuandoHm;
  acordo: string | null;
  oferta_saldo_codigo: string | null;
  link_saldo_enviado_em: QuandoHm;
  // ----- quanto (numeric do Postgres chega como string no driver pg) -----
  // O sinal que abriu o card — data da venda e valor, direto de compras (0068).
  sinal_pago_em: QuandoHm;
  sinal_valor: string | null;
  pagamento_em: QuandoHm;
  pagamento_forma: string | null;
  pagamento_parcelas: number | null;
  apto_ativacao: boolean;
  valor_total: string | null;
  valor_pago: string | null;
  aluno_id: string | null;
  saldo_a_pagar: string | null;
  credito: string | null;
  // ----- ativação -----
  ativ_searchie: boolean;
  ativ_comunidade: boolean;
  ativ_grupo: boolean;
  ativ_pesquisa: boolean;
  grupo_informes: string | null;
  pendencia: string | null;
  // ----- travas -----
  nao_contatar: boolean;
  nao_contatar_motivo: string | null;
  revisar: boolean;
  revisar_motivo: string | null;
  cancelamento_em: QuandoHm;
  cancelamento_motivo: string | null;
  criado_em: QuandoHm;
  observacoes: string | null;
  // ----- derivados (conta, não campo) -----
  socios: number;
  reunioes_remarcadas: number | null;
  entrevistas_remarcadas: number | null;
  nao_comparecimentos: number | null;
  entrou_estagio_em: QuandoHm;
  dias_na_etapa: number | null;
};
export type ColunaHm = { chave: string; nome: string; cor: string; aba: string | null; ordem: number };

export type RelatorioHm = {
  colunas: ColunaHm[];
  linhas: LinhaEsteira[];
  filtros: FiltrosHm;
};

export async function relatorioHm(f: FiltrosHm): Promise<RelatorioHm> {
  const lista = (v?: string[] | null) => (v && v.length ? v : null);
  const p = [lista(f.responsavel), lista(f.canal), lista(f.turma), f.estagio || null];

  const colunas = await query<ColunaHm>(
    `select e.chave, e.nome, e.cor, e.aba, e.ordem
       from cs.estagios e
      where e.ativo and e.evento = 'HM'
        and ($1::text is null or e.chave = $1)
      order by e.ordem`,
    [f.estagio || null],
  );

  // Uma linha por aluno, na ordem em que ele aparece no board (coluna, depois a
  // posição manual dentro dela). `entrou_estagio_em` é a última mudança de etapa —
  // é dela que sai o "há quantos dias esse card está parado aqui".
  const linhas = await query<LinhaEsteira>(
    `select k.comprador_id, k.nome, k.email, k.telefone,
            k.estagio_chave, k.estagio_nome, k.estagio_aba, est.ordem as estagio_ordem,
            k.responsavel, k.categoria_entrada, k.plano, k.turma, k.turma_origem, k.tags,
            k.reuniao_em, k.reuniao_resultado, k.entrevista_em, k.entrevista_resultado,
            k.pagamento_meio, k.pagamento_previsto_em, k.acordo, k.oferta_saldo_codigo, k.link_saldo_enviado_em,
            k.sinal_pago_em, k.sinal_valor,
            k.pagamento_em, k.pagamento_forma, k.pagamento_parcelas, k.apto_ativacao,
            ch.valor_total, ch.valor_pago, ch.aluno_id,
            pr.saldo_a_pagar, pr.credito,
            k.ativ_searchie, k.ativ_comunidade, k.ativ_grupo, k.ativ_pesquisa,
            k.grupo_informes, k.pendencia,
            k.nao_contatar, k.nao_contatar_motivo, k.revisar, k.revisar_motivo,
            k.cancelamento_em, k.cancelamento_motivo,
            k.criado_em, k.observacoes,
            so.qtd as socios,
            rg.reunioes_remarcadas, rg.entrevistas_remarcadas, rg.nao_comparecimentos,
            me.criado_em as entrou_estagio_em,
            case when me.criado_em is not null
                 then extract(day from now() - me.criado_em)::int end as dias_na_etapa
       from cs.contatos_hm_kanban k
       join cs.contatos_hm ch on ch.comprador_id = k.comprador_id
       left join cs.estagios est on est.id = k.estagio_id
       left join lateral cs.fn_hm_prorata(k.comprador_id) pr on true
       left join lateral (
         select count(*)::int as qtd from cs.hm_socios s where s.contato_hm_id = ch.id
       ) so on true
       left join cs.hm_reagendamentos rg on rg.comprador_id = k.comprador_id
       left join lateral (
         select i.criado_em from cs.interacoes i
          where i.contato_hm_id = ch.id and i.tipo = 'mudanca_estagio'
          order by i.criado_em desc limit 1
       ) me on true
      where ($1::text[] is null or k.responsavel = any($1))
        and ($2::text[] is null or k.tags && $2)
        and ($3::text[] is null or k.tags && $3)
        and ($4::text is null or k.estagio_chave = $4)
      order by est.ordem, ch.ordem, k.nome`,
    p,
  );

  return { colunas, linhas, filtros: f };
}
