-- 0316_a_data_do_funil_do_acelera_e_horario_de_brasilia
--
-- ── O pedido (Victor, 26/08) ────────────────────────────────────────────────
-- "A Flávia tá marcando que preencheu tem 4h, mas não tem 50 minutos que ela
--  preencheu, acho que tá puxando de forma errada."
--
-- Estava. Erro de exatamente 3 horas, e a conta fecha: a célula da planilha diz
-- 15:09:36, o card dizia 12:09:36.
--
-- ── Onde o fuso se perdia ───────────────────────────────────────────────────
-- A planilha está em America/Sao_Paulo, então o serial do Sheets (46260.6316…)
-- e o texto dd/mm/aaaa hh:mm:ss são AMBOS horário de Brasília. O n8n traduzia
-- isso certo, para a string '2026-08-26 15:09:36' — sem fuso, porque é o que a
-- célula sabe.
--
-- O 0315 então fazia `'2026-08-26 15:09:36'::timestamptz`, e um texto sem fuso
-- é interpretado no TimeZone da SESSÃO. A sessão do PostgREST é UTC. Resultado:
-- 15:09 virava 15:09 UTC, que é 12:09 em Brasília, e o card, que conta a partir
-- de agora, anunciava 4 horas de espera para quem tinha preenchido fazia 48
-- minutos. Silencioso: nenhum erro, nenhuma linha rejeitada, só o dado 3 horas
-- no passado.
--
-- Isso é o oposto do que o card serve para fazer. Ele existe para o vendedor
-- ligar para quem acabou de abrir o checkout e não concluiu — com 3 horas de
-- atraso o lead quente já parece frio e sai da fila de prioridade.
--
-- ── A correção ──────────────────────────────────────────────────────────────
-- Texto sem fuso passa a ser lido explicitamente como horário de Brasília, e não
-- ao sabor do TimeZone de quem chamou. Texto QUE JÁ TRAZ fuso (terminado em Z ou
-- em ±hh:mm) é respeitado como veio — assim a função aceita as duas convenções
-- e nunca soma o deslocamento duas vezes.
--
-- A janela do lançamento também passa a ser comparada em Brasília, pelo mesmo
-- motivo: '2026-08-20' solto era meia-noite UTC, ou seja, 21h do dia 19 aqui.

-- A tradução de texto para instante, num lugar só. Fora daqui ninguém decide
-- fuso: nem a sessão do PostgREST, nem quem chamar a função amanhã.
create or replace function public.fn_acelera_data_brt(p_txt text)
returns timestamptz
language sql
immutable
as $d$
  select case
    when nullif(trim(coalesce(p_txt,'')), '') is null then null
    -- já veio com fuso ('...Z' ou '...-03:00'): respeita como está
    when trim(p_txt) ~ '(Z|[+-][0-9]{2}:?[0-9]{2})$' then trim(p_txt)::timestamptz
    -- sem fuso: é o que a célula da planilha diz, e a planilha é Brasília
    else trim(p_txt)::timestamp at time zone 'America/Sao_Paulo'
  end
$d$;

comment on function public.fn_acelera_data_brt(text) is
  '0316: texto de data da planilha do Acelera vira instante. Sem fuso = horário de Brasília.';

create or replace function public.fn_acelera_sync_funil(p_linhas jsonb)
returns table (email text, acao text)
language plpgsql
security definer
set search_path to 'cs','public','pg_temp'
as $fn$
declare
  r          jsonb;
  v_email    text;
  v_pre      timestamptz;
  v_compra   timestamptz;
  v_suspeita boolean;
  v_id       uuid;

  -- a janela do lançamento, ancorada no fuso em que a operação acontece
  c_ini constant timestamptz := timestamp '2026-08-20 00:00:00' at time zone 'America/Sao_Paulo';
  c_fim constant timestamptz := timestamp '2026-09-30 23:59:59' at time zone 'America/Sao_Paulo';
begin
  for r in select * from jsonb_array_elements(coalesce(p_linhas, '[]'::jsonb)) loop
    v_email  := lower(nullif(trim(r->>'email'), ''));
    continue when v_email is null;

    v_pre    := public.fn_acelera_data_brt(r->>'precheckout_em');
    v_compra := public.fn_acelera_data_brt(r->>'comprou_em');
    continue when v_pre is null and v_compra is null;

    -- o lançamento é de agosto/2026; fora disso o dado veio errado da origem
    v_suspeita := (v_pre    is not null and (v_pre    < c_ini or v_pre    > c_fim))
               or (v_compra is not null and (v_compra < c_ini or v_compra > c_fim));

    select c.id into v_id
      from cs.contatos c
      join public.compradores p on p.id = c.comprador_id
     where c.evento = 'ACELERA' and lower(p.email) = v_email
     limit 1;
    continue when v_id is null;

    update cs.contatos c
       set precheckout_em = coalesce(v_pre, c.precheckout_em),
           comprou_em     = coalesce(v_compra, c.comprou_em),
           tags = case when v_suspeita and not ('Data a conferir' = any(c.tags))
                       then array_append(c.tags, 'Data a conferir') else c.tags end,
           atualizado_em = now()
     where c.id = v_id
       -- só escreve quando MUDA: sem isto, cada rodada tocaria as 299 linhas e
       -- o atualizado_em viraria "agora" para todo mundo, embaralhando a ordem
       -- do board (que ordena por atualizado_em) a cada 2 minutos.
       and (c.precheckout_em is distinct from coalesce(v_pre, c.precheckout_em)
            or c.comprou_em is distinct from coalesce(v_compra, c.comprou_em));

    if found then
      email := v_email; acao := case when v_suspeita then 'atualizado (data a conferir)' else 'atualizado' end;
      return next;
    end if;
  end loop;
end $fn$;

comment on function public.fn_acelera_sync_funil(jsonb) is
  '0316: porta única para o n8n gravar pré-checkout e compra do Acelera. Data sem fuso é lida como horário de Brasília. Escreve só essas 2 colunas, só no evento ACELERA, e só quando o valor muda.';

revoke all on function public.fn_acelera_sync_funil(jsonb) from public, anon, authenticated;
grant execute on function public.fn_acelera_sync_funil(jsonb) to service_role;
