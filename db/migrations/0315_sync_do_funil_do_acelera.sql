-- 0315_sync_do_funil_do_acelera
--
-- ── O pedido (Victor, 26/08) ────────────────────────────────────────────────
-- "Não tá funcionando a questão do se preencheu o checkout, se comprou. Marquei
--  o Wilian como teste e não aparece no sistema. Mesmo sem o teste, tem que
--  funcionar."
--
-- Não era bug de tela: o dado estava na planilha e nunca chegava ao banco, porque
-- a sincronização era MANUAL. Esta função é a ponta que faltava para o n8n fazer
-- isso sozinho de X em X minutos.
--
-- ── Por que uma função, e não escrita direta ────────────────────────────────
-- O PostgREST do projeto expõe public, sip, gps, ht, controle, workbook, central
-- e rede — o schema `cs` fica de fora, de propósito: é onde moram os contatos e
-- a operação comercial. Expor `cs` para o n8n poder escrever abriria a base
-- inteira por causa de duas colunas. Uma função SECURITY DEFINER em `public`
-- resolve pelo caminho contrário: o n8n só alcança ESTA porta, que só sabe fazer
-- uma coisa.
--
-- ── O que ela aceita, e só ──────────────────────────────────────────────────
-- Um array [{email, precheckout_em, comprou_em}]. Casa por e-mail, escreve
-- exclusivamente em cs.contatos do evento ACELERA e exclusivamente nessas duas
-- colunas. Não cria contato, não muda dono, não mexe em outro evento.
--
-- Data fora da janela do lançamento vira a tag 'Data a conferir' em vez de ser
-- corrigida no chute — foi o que pegou uma compra datada de 2017 no teste.

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
begin
  for r in select * from jsonb_array_elements(coalesce(p_linhas, '[]'::jsonb)) loop
    v_email  := lower(nullif(trim(r->>'email'), ''));
    continue when v_email is null;

    v_pre    := nullif(trim(coalesce(r->>'precheckout_em','')), '')::timestamptz;
    v_compra := nullif(trim(coalesce(r->>'comprou_em','')), '')::timestamptz;
    continue when v_pre is null and v_compra is null;

    -- o lançamento é de agosto/2026; fora disso o dado veio errado da origem
    v_suspeita := (v_pre    is not null and (v_pre    < '2026-08-20' or v_pre    > '2026-09-30'))
               or (v_compra is not null and (v_compra < '2026-08-20' or v_compra > '2026-09-30'));

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
  '0315: porta única para o n8n gravar pré-checkout e compra do Acelera. Escreve só essas 2 colunas, só no evento ACELERA, e só quando o valor muda. Devolve as linhas que de fato mudaram.';

revoke all on function public.fn_acelera_sync_funil(jsonb) from public, anon, authenticated;
grant execute on function public.fn_acelera_sync_funil(jsonb) to service_role;
