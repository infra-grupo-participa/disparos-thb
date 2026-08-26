-- 0317_a_planilha_do_acelera_vira_espelho
--
-- ── O pedido (Victor, 26/08) ────────────────────────────────────────────────
-- "Tem gente marcada que comprou há X dias, preencheu a aplicação há X minutos.
--  Eu tinha colocado de teste. Já tem muitas horas que eu tirei o teste e ainda
--  está marcando. Preciso que isso seja mais dinâmico."
--
-- Não era frequência: o job já roda de 2 em 2 minutos. Era o 0315/0316 SÓ
-- GRAVANDO e nunca apagando — decisão que eu tomei para uma venda real não sumir
-- por uma célula mexida sem querer, e que na prática deixou 3 registros de teste
-- fantasmas no board por horas, um deles parado em Vendido.
--
-- Agora a planilha é ESPELHO: célula vazia deixa de significar "não tenho
-- informação" e passa a significar "não aconteceu".
--
-- ── A trava, que é o que torna isso seguro ──────────────────────────────────
-- Uma sincronização que apaga é perigosa de um jeito que uma que só grava não é:
-- se o Sheets devolver a leitura vazia ou pela metade (rate limit, timeout, aba
-- renomeada), a rodada seguinte limparia a venda de todo mundo em 2 minutos.
--
-- Então a limpeza só é autorizada quando a leitura chega ÍNTEGRA: a função
-- compara quantas linhas recebeu com quantos contatos do ACELERA existem na
-- base. Abaixo de 80%, ela grava o que veio e NÃO apaga nada — e devolve a linha
-- 'limpeza suspensa' para o erro aparecer em vez de silenciar.
--
-- ── Voltar de Vendido (opção A, escolhida pelo Victor) ──────────────────────
-- Compra apagada traz o card de volta para Lead, espelhando o 0309 (compra
-- marcada leva para Vendido). Só reage à VIRADA de data para nulo, nunca a um
-- update qualquer — senão editar a tag de alguém mexeria no card dele.

create or replace function public.fn_acelera_sync_funil(p_linhas jsonb)
returns table (email text, acao text)
language plpgsql
security definer
set search_path to 'cs','public','pg_temp'
as $fn$
declare
  r            jsonb;
  v_email      text;
  v_pre        timestamptz;
  v_compra     timestamptz;
  v_tem_pre    boolean;
  v_tem_compra boolean;
  v_suspeita   boolean;
  v_id         uuid;
  v_recebidas  int := jsonb_array_length(coalesce(p_linhas, '[]'::jsonb));
  v_na_base    int;
  v_espelhar   boolean;

  c_ini constant timestamptz := timestamp '2026-08-20 00:00:00' at time zone 'America/Sao_Paulo';
  c_fim constant timestamptz := timestamp '2026-09-30 23:59:59' at time zone 'America/Sao_Paulo';
begin
  select count(*) into v_na_base from cs.contatos where evento = 'ACELERA';
  -- leitura íntegra? só então a célula vazia tem autoridade para apagar
  v_espelhar := v_na_base = 0 or v_recebidas >= (v_na_base * 0.8);

  if not v_espelhar then
    email := '(sistema)';
    acao  := format('limpeza suspensa: vieram %s linhas para %s contatos na base', v_recebidas, v_na_base);
    return next;
  end if;

  for r in select * from jsonb_array_elements(coalesce(p_linhas, '[]'::jsonb)) loop
    v_email := lower(nullif(trim(r->>'email'), ''));
    continue when v_email is null;

    v_pre    := public.fn_acelera_data_brt(r->>'precheckout_em');
    v_compra := public.fn_acelera_data_brt(r->>'comprou_em');

    -- com espelho ligado, ausência é informação: significa "não aconteceu".
    -- sem espelho, ausência volta a ser silêncio e a coluna fica como está.
    v_tem_pre    := v_espelhar or v_pre    is not null;
    v_tem_compra := v_espelhar or v_compra is not null;
    continue when not v_tem_pre and not v_tem_compra;

    v_suspeita := (v_pre    is not null and (v_pre    < c_ini or v_pre    > c_fim))
               or (v_compra is not null and (v_compra < c_ini or v_compra > c_fim));

    select c.id into v_id
      from cs.contatos c
      join public.compradores p on p.id = c.comprador_id
     where c.evento = 'ACELERA' and lower(p.email) = v_email
     limit 1;
    continue when v_id is null;

    update cs.contatos c
       set precheckout_em = case when v_tem_pre    then v_pre    else c.precheckout_em end,
           comprou_em     = case when v_tem_compra then v_compra else c.comprou_em     end,
           tags = case
                    when v_suspeita and not ('Data a conferir' = any(c.tags))
                      then array_append(c.tags, 'Data a conferir')
                    -- data saiu: a tag de conferência sai junto, senão fica órfã
                    when not v_suspeita and ('Data a conferir' = any(c.tags))
                      then array_remove(c.tags, 'Data a conferir')
                    else c.tags
                  end,
           atualizado_em = now()
     where c.id = v_id
       -- só escreve quando MUDA: sem isto, cada rodada tocaria as 299 linhas e o
       -- atualizado_em viraria "agora" para todo mundo, embaralhando a ordem do
       -- board a cada 2 minutos.
       and (c.precheckout_em is distinct from (case when v_tem_pre    then v_pre    else c.precheckout_em end)
         or c.comprou_em     is distinct from (case when v_tem_compra then v_compra else c.comprou_em     end));

    if found then
      email := v_email;
      acao  := case
                 when v_pre is null and v_compra is null then 'limpo'
                 when v_suspeita then 'atualizado (data a conferir)'
                 else 'atualizado'
               end;
      return next;
    end if;
  end loop;
end $fn$;

comment on function public.fn_acelera_sync_funil(jsonb) is
  '0317: a planilha do Acelera é espelho. Célula vazia limpa a coluna, mas só quando a leitura chega íntegra (>=80% dos contatos do evento) — leitura truncada grava e não apaga.';

revoke all on function public.fn_acelera_sync_funil(jsonb) from public, anon, authenticated;
grant execute on function public.fn_acelera_sync_funil(jsonb) to service_role;

-- ── Compra apagada → volta para Lead ────────────────────────────────────────
create or replace function cs.fn_acelera_compra_apagada_volta_para_lead()
returns trigger
language plpgsql
security definer
set search_path to 'cs','public','pg_temp'
as $fn$
declare v_lead int; v_vendido int;
begin
  if new.evento <> 'ACELERA' then return new; end if;
  -- só a VIRADA de data para nulo, espelhando o 0309
  if new.comprou_em is not null or old.comprou_em is null then return new; end if;

  select id into v_vendido from cs.estagios where chave = 'acel_vendido';
  select id into v_lead    from cs.estagios where chave = 'acel_lead';
  -- se o card não está em Vendido, alguém já o moveu para outro lugar: não mexer
  if v_lead is not null and new.estagio_id is not distinct from v_vendido then
    new.estagio_id := v_lead;
  end if;
  return new;
end $fn$;

drop trigger if exists trg_acelera_compra_apagada on cs.contatos;
create trigger trg_acelera_compra_apagada
  before update of comprou_em on cs.contatos
  for each row execute function cs.fn_acelera_compra_apagada_volta_para_lead();

comment on function cs.fn_acelera_compra_apagada_volta_para_lead() is
  '0317: compra apagada na planilha traz o card do Acelera de volta para Lead, mas só se ele ainda estiver em Vendido — se alguém já moveu para outro estágio, o trabalho da pessoa manda.';
