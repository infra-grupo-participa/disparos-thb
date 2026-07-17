-- =====================================================================
-- 0107_cruzamento_duplicados_multisinal
--
-- CRUZAMENTO CRITERIOSO de cadastros duplicados. A view anterior
-- (cs.vw_compradores_duplicados) casava por telefone; esta cruza TODOS os sinais
-- e classifica a confiança, porque nenhum sinal sozinho basta:
--   • CPF igual NÃO garante mesma pessoa — o time reusou CPF em contas de teste
--     (@advmais) com nomes diferentes (Victor Hugo/Caio/Yasmin).
--   • Telefone igual NÃO garante — cônjuges/sócios dividem o número.
-- Só o CRUZAMENTO (CPF/telefone + nome parecido) separa o dup real do ruído.
--
-- Blocking por telefone, CPF ou local-part do e-mail (senão seria 1.5M de pares).
-- Exclui teste (@advmais, teste-, placeholder) e pares já unificados por alias.
-- Só leitura — decidir e aliasar continua humano.
-- =====================================================================

create or replace view cs.vw_compradores_cruzamento as
with c as (
  select cp.id, cp.criado_em, cp.nome, cp.email,
         lower(btrim(cp.email))                                   as email_l,
         split_part(lower(btrim(cp.email)), '@', 1)               as email_local,
         regexp_replace(coalesce(cp.telefone,''), '\D', '', 'g')  as tel,
         nullif(regexp_replace(coalesce(cp.documento,''), '\D', '', 'g'), '') as doc,
         lower(btrim(coalesce(cp.nome,'')))                       as nome_l
    from public.compradores cp
   where lower(coalesce(cp.email,'')) not like '%@advmais.com' -- contas internas/teste
     and lower(coalesce(cp.email,'')) not like 'teste-%'
),
pares as (  -- candidatos: compartilham ALGUM sinal de bloqueio
  select a.id as a_id, b.id as b_id
    from c a
    join c b on a.id < b.id
   and (
        (length(a.tel) >= 10 and a.tel = b.tel and a.tel <> '5511999990000')
     or (a.doc is not null and a.doc = b.doc)
     or (length(a.email_local) >= 6 and a.email_local = b.email_local)
   )
)
select
  p.a_id, p.b_id,
  a.nome as nome_a, a.email as email_a,
  b.nome as nome_b, b.email as email_b,
  (a.doc is not null and a.doc = b.doc)                    as cpf_igual,
  (length(a.tel) >= 10 and a.tel = b.tel)                 as tel_igual,
  (length(a.email_local) >= 6 and a.email_local = b.email_local) as email_local_igual,
  round(similarity(a.nome_l, b.nome_l)::numeric, 2)        as nome_sim,
  -- A CONFIANÇA cruzada: nenhum sinal sozinho decide.
  case
    when (a.doc is not null and a.doc = b.doc) and similarity(a.nome_l, b.nome_l) >= 0.55 then 'alta'
    when similarity(a.nome_l, b.nome_l) >= 0.80
         and (a.tel = b.tel or (a.doc is not null and a.doc = b.doc) or a.email_local = b.email_local) then 'alta'
    when (length(a.tel) >= 10 and a.tel = b.tel) and similarity(a.nome_l, b.nome_l) >= 0.45 then 'media'
    when (a.doc is not null and a.doc = b.doc) and similarity(a.nome_l, b.nome_l) < 0.55 then 'checar_cpf_nome_diverge'
    when (length(a.tel) >= 10 and a.tel = b.tel) then 'checar_mesmo_telefone'
    else 'baixa'
  end                                                       as confianca
from pares p
join c a on a.id = p.a_id
join c b on b.id = p.b_id
-- fora os pares já unificados por alias (em qualquer direção)
where not exists (
  select 1 from cs.hm_comprador_alias al
   where (al.comprador_id = p.a_id and al.canonico_id = p.b_id)
      or (al.comprador_id = p.b_id and al.canonico_id = p.a_id)
);

grant select on cs.vw_compradores_cruzamento to disparos_app;

comment on view cs.vw_compradores_cruzamento is
  'Cruzamento multi-sinal de cadastros duplicados (CPF + telefone + similaridade de nome + local do e-mail), com nível de confiança. Só leitura; decisão de fundir é humana, via cs.hm_comprador_alias.';
