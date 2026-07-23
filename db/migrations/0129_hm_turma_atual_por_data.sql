-- =====================================================================
-- 0129_hm_turma_atual_por_data
--
-- fn_hm_turma_atual() lia um config estático ('hm_turma_atual' = 'T39') —
-- travado. A coluna `turma` do card já virava T40 sozinha por data
-- (fn_hm_turma_por_data, migration 0121), MAS a TAG "Turma Txx" do aluno
-- novo (fn_tag_hm_origem) usa fn_hm_turma_atual → um aluno do T40 receberia
-- tag "Turma T39". Agora deriva por DATA de thb_turmas: antes de 26/07
-- 23:00 UTC → T39; depois → T40. Vira sozinha no corte de domingo 20h BRT,
-- sem ação manual. Fallback: config, depois 'T39'. Não chama
-- fn_hm_turma_por_data (evita recursão — aquela chama esta no fallback).
-- Ver [[HM - Ofertas, tags e janelas de evento]].
-- =====================================================================
create or replace function cs.fn_hm_turma_atual()
 returns text language sql stable security definer
 set search_path to 'cs','public','pg_temp'
as $function$
  select coalesce(
    (select t.codigo from public.thb_turmas t
      where t.tipo='thb' and t.sale_start_at is not null
        and now() >= t.sale_start_at
        and (t.sale_end_at is null or now() < t.sale_end_at)
      order by t.sale_start_at desc limit 1),
    (select valor #>> '{}' from cs.config where chave='hm_turma_atual'),
    'T39');
$function$;
