-- =====================================================================
-- 0003_cs_contatos_ht_view_legado
-- Recria a view cs.contatos_ht para:
--  (a) expor edicao_ht + as métricas legado_* (overlay importado da planilha);
--  (b) normalizar a edição derivada para o formato canônico 'HT'||edition_number
--      (compatível com o badge da UI) — o overlay edicao_ht tem prioridade.
-- Aplicada em produção via admin (Supabase). Mantida aqui para versionamento.
-- =====================================================================
drop view if exists cs.contatos_ht;
create view cs.contatos_ht with (security_invoker = false) as
with ht_compras as (
  select c.comprador_id,
         max(c.data_aprovacao) as ultima_compra_ht,
         (array_agg(c.produto_nome order by c.data_aprovacao desc nulls last))[1] as ultimo_produto
  from public.compras c
  where c.produto_id in ('1560865','2414291')
    and c.status in ('APPROVED','COMPLETE','COMPLETED')
  group by c.comprador_id
)
select
  cmp.id as comprador_id, cmp.nome, cmp.email, cmp.telefone,
  hc.ultima_compra_ht, hc.ultimo_produto,
  ed.edition_number,
  coalesce(ct.edicao_ht,
           case when ed.edition_number is not null then 'HT'||ed.edition_number end) as edicao,
  ct.estagio_id, est.chave as estagio_chave, est.nome as estagio_nome,
  ct.responsavel, ct.proxima_acao_em, ct.proxima_acao_nota,
  ct.ultimo_contato_em, ct.ultima_resposta_em, ct.observacoes,
  ct.edicao_ht,
  ct.primeiro_contato_em,
  ct.legado_ativado, ct.legado_ativacao_em, ct.legado_sla_h,
  ct.legado_no_grupo, ct.legado_pesquisa, ct.legado_ja_ht, ct.legado_qtd_ht,
  ct.legado_ja_hm, ct.legado_e_aluno, ct.legado_instrucao,
  ct.legado_t_primeiro_contato_h, ct.legado_t_ativacao_h
from ht_compras hc
join public.compradores cmp on cmp.id = hc.comprador_id
left join lateral (
  select e.* from public.ht_editions e
  where hc.ultima_compra_ht between e.sale_start_at and e.sale_end_at
  order by e.edition_number desc limit 1
) ed on true
left join cs.contatos ct on ct.comprador_id = cmp.id
left join cs.estagios est on est.id = ct.estagio_id;
