-- =====================================================================
-- 0149_contatos_acordo_e_credito
--
-- Acordo + crédito nos portais GENÉRICOS (HT / SEM / CNHF — cs.contatos).
-- O HM já registra isso desde a 0056 (cs.contatos_hm: acordo,
-- pagamento_previsto_em, credito_*); os genéricos não tinham NADA — o tipo de
-- acordo do cliente e o saldo que ele tem para descontar na oferta viviam em
-- anotação solta. Decisão do Marcio (28/07): registrar estruturado.
--
-- NOMENCLATURA ESPELHADA da 0056 (mesmo vocabulário para a mesma coisa):
--   acordo                text     -- o combinado, em texto ("12x no boleto, a partir do dia 15")
--   pagamento_previsto_em date     -- "pagamento agendado 17/07"
--   credito_oferta        text     -- de onde vem o crédito ("Renovação 2026", compra anterior)
--   credito_compra_em     date     -- quando foi a compra que gerou o crédito
--   credito_valor_pago    numeric  -- quanto ele pagou = saldo a descontar na oferta
--
-- O que da 0056 NÃO entra aqui (não faz sentido fora do HM):
--   - oferta_saldo_codigo / link_saldo_enviado_em: FK ao catálogo de ofertas de
--     saldo do HM (cs.hm_ofertas_saldo) — os genéricos não têm catálogo;
--   - credito_dias_totais: insumo do pró-rata (cs.vw_hm_credito), que consome o
--     crédito por dia de acesso — regra do produto HM. Nos genéricos o crédito
--     não se consome com o tempo: o saldo a descontar É credito_valor_pago.
--
-- ANOTAÇÕES: nada novo — cs.contatos.observacoes + cs.interacoes tipo 'nota'
-- (o PATCH da ficha já grava e o GET já devolve a timeline) resolvem.
--
-- Views curadas: colunas novas ao FINAL de cs.contatos_ht e de CADA braço de
-- cs.contatos_evento (create or replace não reordena — mesma técnica da 0146,
-- corpo idêntico ao da 0146 + as 5 colunas). REPLACE preserva as dependentes
-- (cs.contatos_evento depende de cs.contatos_ht; public.vw_aluno_360 lê
-- contatos_ht por nome de coluna).
--
-- Idempotente e re-executável sem efeito colateral. O código roda SEM esta
-- migration (deploy automático no push): as rotas leem/escrevem os campos
-- novos em queries separadas com try/catch (42703) — padrão da 0147.
-- =====================================================================

-- 1) Colunas em cs.contatos ---------------------------------------------------
alter table cs.contatos add column if not exists acordo                text;
alter table cs.contatos add column if not exists pagamento_previsto_em date;
alter table cs.contatos add column if not exists credito_oferta        text;
alter table cs.contatos add column if not exists credito_compra_em     date;
alter table cs.contatos add column if not exists credito_valor_pago    numeric;

comment on column cs.contatos.acordo                is 'O combinado com o cliente, em texto livre (espelha cs.contatos_hm.acordo, 0056)';
comment on column cs.contatos.pagamento_previsto_em is 'Data prevista do pagamento combinado';
comment on column cs.contatos.credito_oferta        is 'De onde vem o crédito/saldo do cliente (oferta ou compra anterior)';
comment on column cs.contatos.credito_compra_em     is 'Data da compra que gerou o crédito';
comment on column cs.contatos.credito_valor_pago    is 'Valor pago na compra anterior = saldo a descontar na oferta (sem pró-rata: regra de consumo por dia é só do HM)';

-- 2) View cs.contatos_ht: corpo da 0146 + as 5 colunas novas ao FINAL ---------
create or replace view cs.contatos_ht with (security_invoker = false) as
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
  ct.legado_t_primeiro_contato_h, ct.legado_t_ativacao_h,
  -- === Equipes (0146) ===
  ct.responsavel_id,
  ru.equipe_id,
  eq.nome as equipe_nome,
  eq.cor  as equipe_cor,
  eq.tipo as equipe_tipo,
  -- === Acordo e crédito (0149) ===
  ct.acordo,
  ct.pagamento_previsto_em,
  ct.credito_oferta,
  ct.credito_compra_em,
  ct.credito_valor_pago
from ht_compras hc
join public.compradores cmp on cmp.id = hc.comprador_id
left join lateral (
  select e.* from public.ht_editions e
  where hc.ultima_compra_ht between e.sale_start_at and e.sale_end_at
  order by e.edition_number desc limit 1
) ed on true
left join cs.contatos ct on ct.comprador_id = cmp.id
left join cs.estagios est on est.id = ct.estagio_id
left join cs.usuarios ru on ru.id = ct.responsavel_id
left join cs.equipes  eq on eq.id = ru.equipe_id;

-- 3) View cs.contatos_evento: as 5 colunas ao FINAL de cada braço -------------
create or replace view cs.contatos_evento as
  select 'HT'::text as evento, h.comprador_id, h.nome, h.email, h.telefone,
         h.ultima_compra_ht, h.ultimo_produto, h.edition_number, h.edicao,
         h.estagio_id, h.estagio_chave, h.estagio_nome, h.responsavel,
         h.proxima_acao_em, h.proxima_acao_nota, h.ultimo_contato_em, h.ultima_resposta_em,
         h.observacoes, h.edicao_ht, h.primeiro_contato_em,
         h.legado_ativado, h.legado_ativacao_em, h.legado_sla_h, h.legado_no_grupo,
         h.legado_pesquisa, h.legado_ja_ht, h.legado_qtd_ht, h.legado_ja_hm,
         h.legado_e_aluno, h.legado_instrucao, h.legado_t_primeiro_contato_h, h.legado_t_ativacao_h,
         -- === Equipes (0146) ===
         h.responsavel_id, h.equipe_id, h.equipe_nome, h.equipe_cor, h.equipe_tipo,
         -- === Acordo e crédito (0149) ===
         h.acordo, h.pagamento_previsto_em, h.credito_oferta, h.credito_compra_em, h.credito_valor_pago
    from cs.contatos_ht h
  union all
  select 'SEM'::text as evento, cmp.id as comprador_id, cmp.nome, cmp.email, cmp.telefone,
         null::timestamptz as ultima_compra_ht, null::varchar as ultimo_produto,
         null::integer as edition_number, coalesce(ct.edicao_ht, 'SEM')::text as edicao,
         ct.estagio_id, est.chave as estagio_chave, est.nome as estagio_nome, ct.responsavel,
         ct.proxima_acao_em, ct.proxima_acao_nota, ct.ultimo_contato_em, ct.ultima_resposta_em,
         ct.observacoes, ct.edicao_ht, ct.primeiro_contato_em,
         ct.legado_ativado, ct.legado_ativacao_em, ct.legado_sla_h, ct.legado_no_grupo,
         ct.legado_pesquisa, ct.legado_ja_ht, ct.legado_qtd_ht, ct.legado_ja_hm,
         ct.legado_e_aluno, ct.legado_instrucao, ct.legado_t_primeiro_contato_h, ct.legado_t_ativacao_h,
         -- === Equipes (0146) ===
         ct.responsavel_id, ru.equipe_id, eq.nome as equipe_nome, eq.cor as equipe_cor, eq.tipo as equipe_tipo,
         -- === Acordo e crédito (0149) ===
         ct.acordo, ct.pagamento_previsto_em, ct.credito_oferta, ct.credito_compra_em, ct.credito_valor_pago
    from cs.contatos ct
    join public.compradores cmp on cmp.id = ct.comprador_id
    left join cs.estagios est on est.id = ct.estagio_id
    left join cs.usuarios ru on ru.id = ct.responsavel_id
    left join cs.equipes  eq on eq.id = ru.equipe_id
   where ct.evento = 'SEM'
  union all
  select 'CNHF'::text as evento, cmp.id as comprador_id, cmp.nome, cmp.email, cmp.telefone,
         null::timestamptz as ultima_compra_ht, null::varchar as ultimo_produto,
         null::integer as edition_number, coalesce(ct.edicao_ht, 'CNHF')::text as edicao,
         ct.estagio_id, est.chave as estagio_chave, est.nome as estagio_nome, ct.responsavel,
         ct.proxima_acao_em, ct.proxima_acao_nota, ct.ultimo_contato_em, ct.ultima_resposta_em,
         ct.observacoes, ct.edicao_ht, ct.primeiro_contato_em,
         ct.legado_ativado, ct.legado_ativacao_em, ct.legado_sla_h, ct.legado_no_grupo,
         ct.legado_pesquisa, ct.legado_ja_ht, ct.legado_qtd_ht, ct.legado_ja_hm,
         ct.legado_e_aluno, ct.legado_instrucao, ct.legado_t_primeiro_contato_h, ct.legado_t_ativacao_h,
         -- === Equipes (0146) ===
         ct.responsavel_id, ru.equipe_id, eq.nome as equipe_nome, eq.cor as equipe_cor, eq.tipo as equipe_tipo,
         -- === Acordo e crédito (0149) ===
         ct.acordo, ct.pagamento_previsto_em, ct.credito_oferta, ct.credito_compra_em, ct.credito_valor_pago
    from cs.contatos ct
    join public.compradores cmp on cmp.id = ct.comprador_id
    left join cs.estagios est on est.id = ct.estagio_id
    left join cs.usuarios ru on ru.id = ct.responsavel_id
    left join cs.equipes  eq on eq.id = ru.equipe_id
   where ct.evento = 'CNHF';

-- 4) Grants (idempotentes — replace preserva, mas garante em base recriada) ---
grant select on cs.contatos_ht      to disparos_app;
grant select on cs.contatos_evento  to disparos_app;

-- =====================================================================
-- VERIFICAÇÃO PÓS-APLICAÇÃO (rodar à mão — não faz parte da migration):
--
-- -- a) Colunas existem e nascem nulas
-- select evento,
--        count(*)                                        as total,
--        count(acordo)                                   as com_acordo,
--        count(credito_valor_pago)                       as com_credito
--   from cs.contatos group by evento order by evento;
--
-- -- b) View expõe as colunas novas (deve retornar sem erro)
-- select comprador_id, acordo, pagamento_previsto_em,
--        credito_oferta, credito_compra_em, credito_valor_pago
--   from cs.contatos_evento limit 1;
-- =====================================================================
