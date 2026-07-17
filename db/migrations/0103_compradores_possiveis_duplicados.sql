-- =====================================================================
-- 0103_compradores_possiveis_duplicados
--
-- O DETECTOR de duplicados. O webhook já não CRIA novos duplicados (funde por
-- CPF), mas os antigos continuam lá — a mesma pessoa em dois cadastros, com o
-- pagamento caindo no que o card não enxerga ("pagou e sumiu", caso Caria).
--
-- Esta view lista, por comprador, os OUTROS cadastros que dividem o mesmo
-- telefone com e-mail diferente — os CANDIDATOS a serem a mesma pessoa. É só
-- ALERTA para um humano decidir, nunca fusão automática: nos dados reais o mesmo
-- telefone às vezes é gente diferente (cônjuges/sócios em holding familiar), por
-- isso a view também diz se o CPF confere ou diverge, para o humano não errar.
--
-- Telefone/e-mail de teste ficam de fora (não são gente).
-- =====================================================================

create or replace view cs.vw_compradores_duplicados as
with base as (
  select c.id,
         lower(btrim(c.email)) as email_l,
         regexp_replace(coalesce(c.telefone,''), '\D', '', 'g') as tel,
         nullif(regexp_replace(coalesce(c.documento,''), '\D', '', 'g'), '') as doc
    from public.compradores c
   where c.telefone is not null
     and length(regexp_replace(c.telefone, '\D', '', 'g')) >= 10
     -- descarta placeholders de teste
     and regexp_replace(c.telefone, '\D', '', 'g') <> '5511999990000'
     and lower(coalesce(c.email,'')) not like 'teste-%'
)
select a.id                                   as comprador_id,
       a.tel                                  as telefone_norm,
       count(*)                               as outros,
       array_agg(b.email_l order by b.email_l) as outros_emails,
       -- o CPF ajuda a decidir: confere = quase certeza da mesma pessoa;
       -- diverge = provável gente diferente dividindo o número.
       bool_or(a.doc is not null and b.doc is not null and a.doc =  b.doc) as cpf_confere,
       bool_or(a.doc is not null and b.doc is not null and a.doc <> b.doc) as cpf_diverge
  from base a
  join base b on b.tel = a.tel and b.email_l <> a.email_l
 group by a.id, a.tel;

comment on view cs.vw_compradores_duplicados is
  'Alerta de possíveis cadastros duplicados (mesmo telefone, e-mail diferente). Só leitura — decisão de fundir é humana. cpf_confere/cpf_diverge ajudam a julgar.';
