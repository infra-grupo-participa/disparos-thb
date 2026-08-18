-- 0302_o_check_de_formularios_volta_a_aceitar_hm
--
-- APLICADA EM PRODUCAO EM 18/08/2026.
--
-- ── A regressao ─────────────────────────────────────────────────────────────
-- 0013 criou:     check (tipo in ('matricula','ficha_hm'))
-- 0028 ampliou:   check (... or tipo like 'hm_%')          <- correto
-- 0134 REGREDIU:  check (tipo in ('matricula','ficha_hm','pesquisa'))
--                 o `or tipo like 'hm_%'` sumiu, sem querer.
--
-- Nenhuma migration entre 0134 e 0301 restaurou. Conferido no banco (18/08):
--   CHECK ((tipo = ANY (ARRAY['matricula','ficha_hm','pesquisa'])))
--
-- ── Por que quebra TODO formulario do HM ────────────────────────────────────
-- app/api/hm/formularios/route.ts (slugTipo) SEMPRE prefixa `hm_`:
--     if (!base) return "hm_formulario";
--     return base.startsWith("hm_") ? base : `hm_${base}`;
-- E impossivel a rota gerar um tipo que o CHECK aceite.
--
-- ⚠️ O modo de falha e PIOR que uma recusa limpa: no ramo de socio o insert em
-- cs.formularios e o ULTIMO passo. Quando estoura:
--   1. o socio JA foi gravado em cs.hm_socios
--   2. a timeline JA foi gravada
--   3. o insert falha -> excecao -> HTTP 500
--   4. complementarResultado('socio_ok') nunca roda -> webhook_log preso em 'recebido'
--   5. o Respondi ve 500 e RETENTA, em loop
-- Sucesso real disfarcado de falha, com retry infinito.
--
-- ── Evidencia de que ja estava mordendo ─────────────────────────────────────
-- cs.formularios por tipo (18/08):
--   pesquisa   9.928  ultimo 18/08  <- passa: esta na lista
--   matricula    366  ultimo 16/08  <- passa: esta na lista
--   ficha_hm      67  ultimo 11/06  <- PAROU na epoca da 0134
-- Nada com prefixo hm_ jamais entrou.

alter table cs.formularios drop constraint if exists formularios_tipo_check;

alter table cs.formularios add constraint formularios_tipo_check
  check (tipo in ('matricula','ficha_hm','pesquisa') or tipo like 'hm\_%');

comment on constraint formularios_tipo_check on cs.formularios is
  '0302: restaura o `or tipo like hm_%` que a 0028 tinha criado e a 0134 removeu sem querer. A rota app/api/hm/formularios sempre prefixa hm_ (slugTipo), entao sem esta clausula NENHUM formulario do HM entra — inclusive o de socio, que grava o socio e SO ENTAO estoura, devolvendo 500 para o Respondi retentar em loop.';

do $$
declare v_ok boolean;
begin
  begin
    insert into cs.formularios (comprador_id, tipo, respostas)
    select id, 'hm_socios', '{"_teste":"0302"}'::jsonb from public.compradores limit 1;
    delete from cs.formularios where tipo = 'hm_socios' and respostas ? '_teste';
    v_ok := true;
  exception when check_violation then
    v_ok := false;
  end;

  if not v_ok then
    raise exception '0302: o CHECK ainda recusa tipo hm_socios — a correcao nao pegou.';
  end if;

  raise notice '0302: cs.formularios volta a aceitar tipo hm_%% (testado com insert+delete).';
end $$;
