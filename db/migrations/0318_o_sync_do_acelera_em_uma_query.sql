-- 0318_o_sync_do_acelera_em_uma_query
--
-- ── O que quebrou (26/08, 21h, com o carrinho ABERTO) ───────────────────────
-- "Já tem muita gente que comprou e não tem ninguém em Vendido."
-- A planilha tinha 56 compras e 150 checkouts. O board, zero. As 8 últimas
-- execuções do n8n: todas em erro, "canceling statement due to statement
-- timeout".
--
-- A causa foi minha, do 0317: para a planilha virar espelho, o n8n passou a
-- mandar TODAS as linhas (antes só as preenchidas, 2 ou 3). A função continuou
-- com o loop linha a linha — um SELECT com join + um UPDATE para cada — e 399
-- linhas viraram ~800 queries dentro de uma chamada só. O PostgREST corta em 8s
-- (statement_timeout do role), e passou a cortar TODAS as rodadas.
--
-- Fica o aprendizado: mudar quantos itens entram muda a ordem de grandeza do
-- custo. O 0317 foi testado com o efeito certo e com o volume errado.
--
-- ── A correção ──────────────────────────────────────────────────────────────
-- Mesma semântica do 0317 (espelho, trava de integridade, só grava quando muda),
-- em UMA query com JOIN em vez de laço. O trigger continua BEFORE UPDATE, então
-- "comprou → Vendido" e "compra apagada → Lead" seguem valendo.

create or replace function public.fn_acelera_sync_funil(p_linhas jsonb)
returns table (email text, acao text)
language plpgsql
security definer
set search_path to 'cs','public','pg_temp'
as $fn$
declare
  v_recebidas int := jsonb_array_length(coalesce(p_linhas, '[]'::jsonb));
  v_na_base   int;
  v_espelhar  boolean;
  c_ini constant timestamptz := timestamp '2026-08-20 00:00:00' at time zone 'America/Sao_Paulo';
  c_fim constant timestamptz := timestamp '2026-09-30 23:59:59' at time zone 'America/Sao_Paulo';
begin
  select count(*) into v_na_base from cs.contatos where evento = 'ACELERA';
  v_espelhar := v_na_base = 0 or v_recebidas >= (v_na_base * 0.8);

  if not v_espelhar then
    email := '(sistema)';
    acao  := format('limpeza suspensa: vieram %s linhas para %s contatos na base', v_recebidas, v_na_base);
    return next;
    return;
  end if;

  return query
  with entrada as (
    -- distinct on: e-mail repetido na planilha viraria "multiple rows" no update
    select distinct on (lower(trim(x->>'email')))
           lower(trim(x->>'email'))                             as email,
           public.fn_acelera_data_brt(x->>'precheckout_em')      as pre,
           public.fn_acelera_data_brt(x->>'comprou_em')          as com
      from jsonb_array_elements(coalesce(p_linhas, '[]'::jsonb)) x
     where nullif(trim(x->>'email'), '') is not null
  ),
  alvo as (
    select c.id, e.email, e.pre, e.com,
           (e.pre is not null and (e.pre < c_ini or e.pre > c_fim))
        or (e.com is not null and (e.com < c_ini or e.com > c_fim)) as suspeita
      from cs.contatos c
      join public.compradores p on p.id = c.comprador_id
      join entrada e on e.email = lower(p.email)
     where c.evento = 'ACELERA'
  ),
  mudou as (
    update cs.contatos c
       set precheckout_em = a.pre,
           comprou_em     = a.com,
           tags = case
                    when a.suspeita and not ('Data a conferir' = any(c.tags))
                      then array_append(c.tags, 'Data a conferir')
                    when not a.suspeita and ('Data a conferir' = any(c.tags))
                      then array_remove(c.tags, 'Data a conferir')
                    else c.tags
                  end,
           atualizado_em = now()
      from alvo a
     where c.id = a.id
       and (c.precheckout_em is distinct from a.pre or c.comprou_em is distinct from a.com)
    returning a.email, a.pre, a.com, a.suspeita
  )
  select m.email,
         case when m.pre is null and m.com is null then 'limpo'
              when m.suspeita then 'atualizado (data a conferir)'
              else 'atualizado' end
    from mudou m;
end $fn$;

comment on function public.fn_acelera_sync_funil(jsonb) is
  '0318: mesma semântica do 0317 (espelho + trava de 80% + só grava quando muda) numa query só. O laço linha a linha estourava o statement_timeout de 8s quando o n8n passou a mandar as 399 linhas.';

revoke all on function public.fn_acelera_sync_funil(jsonb) from public, anon, authenticated;
grant execute on function public.fn_acelera_sync_funil(jsonb) to service_role;
