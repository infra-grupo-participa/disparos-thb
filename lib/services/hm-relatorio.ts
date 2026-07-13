import { query } from "@/lib/db";

// A esteira HM inteira, uma linha por aluno, pronta para virar relatório. É a
// mesma leitura do board — mesmos filtros, mesma ordem das colunas e dos cards —
// só que com o que o board não mostra no card (acordo, saldo, checklist), porque
// num relatório o operador quer a linha completa, e não o resumo.

export type FiltrosHm = {
  responsavel?: string | null;
  canal?: string | null;
  turma?: string | null;
  /** Só uma coluna (chave do estágio) — o relatório de uma etapa específica. */
  estagio?: string | null;
};

export type LinhaEsteira = Record<string, unknown>;
export type ColunaHm = { chave: string; nome: string; cor: string; aba: string | null; ordem: number };

export type RelatorioHm = {
  colunas: ColunaHm[];
  linhas: LinhaEsteira[];
  filtros: FiltrosHm;
};

export async function relatorioHm(f: FiltrosHm): Promise<RelatorioHm> {
  const p = [f.responsavel || null, f.canal || null, f.turma || null, f.estagio || null];

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
  const linhas = await query(
    `select k.comprador_id, k.nome, k.email, k.telefone,
            k.estagio_chave, k.estagio_nome, k.estagio_aba, est.ordem as estagio_ordem,
            k.responsavel, k.categoria_entrada, k.plano, k.turma, k.turma_origem, k.tags,
            k.reuniao_em, k.reuniao_resultado, k.entrevista_em, k.entrevista_resultado,
            k.pagamento_meio, k.pagamento_previsto_em, k.acordo, k.oferta_saldo_codigo, k.link_saldo_enviado_em,
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
      where ($1::text is null or k.responsavel = $1)
        and ($2::text is null or $2 = any(k.tags))
        and ($3::text is null or $3 = any(k.tags))
        and ($4::text is null or k.estagio_chave = $4)
      order by est.ordem, ch.ordem, k.nome`,
    p,
  );

  return { colunas, linhas, filtros: f };
}
