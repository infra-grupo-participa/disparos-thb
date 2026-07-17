-- =====================================================================
-- 0104_duplicados_ignora_aliasados
--
-- Refina cs.vw_compradores_duplicados (0103): um par já RESOLVIDO por alias
-- (cs.hm_comprador_alias, 0082 — o dinheiro já cai no cadastro canônico) não é
-- mais pendência. O detector deve acender só o que ainda precisa de mão humana,
-- senão o Renato (já unificado) ficaria piscando "duplicado" para sempre.
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
     and regexp_replace(c.telefone, '\D', '', 'g') <> '5511999990000'
     and lower(coalesce(c.email,'')) not like 'teste-%'
)
select a.id                                   as comprador_id,
       a.tel                                  as telefone_norm,
       count(*)                               as outros,
       array_agg(b.email_l order by b.email_l) as outros_emails,
       bool_or(a.doc is not null and b.doc is not null and a.doc =  b.doc) as cpf_confere,
       bool_or(a.doc is not null and b.doc is not null and a.doc <> b.doc) as cpf_diverge
  from base a
  join base b
    on b.tel = a.tel
   and b.email_l <> a.email_l
   -- par já unificado por alias não é mais pendência
   and not exists (
     select 1 from cs.hm_comprador_alias al
      where (al.comprador_id = a.id and al.canonico_id = b.id)
         or (al.comprador_id = b.id and al.canonico_id = a.id)
   )
 group by a.id, a.tel;

comment on view cs.vw_compradores_duplicados is
  'Alerta de possíveis cadastros duplicados AINDA não resolvidos (mesmo telefone, e-mail diferente, sem alias). Só leitura — fundir é humano, via cs.hm_comprador_alias. cpf_confere/cpf_diverge ajudam a julgar.';