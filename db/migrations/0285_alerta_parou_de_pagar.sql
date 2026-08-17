-- =====================================================================
-- 0285_alerta_parou_de_pagar
--
-- D3 (decisão do Marcio): inadimplência SÓ SINALIZA, nunca move card. O
-- sinal mora em cs.vw_hm_financeiro.inadimplente (0283) — esta migration
-- transforma isso em alerta operacional (cs.hm_alertas), no mesmo padrão de
-- venda_sem_operador (0265): um alerta CRÍTICO por card, auto-resolvido
-- quando a condição sai.
--
-- ⚠️ REPLACE MECÂNICO, NÃO REESCRITA (mesmo padrão 0216/0233/0263/0265): o
-- banco está à frente do repo em cs.fn_hm_health_check — a última reescrita
-- COMPLETA (create or replace) encontrada no repo é a 0208, mas migrations
-- posteriores (0233/0263/0265/0266) já mexeram nela por este MESMO
-- mecanismo de replace textual, então o corpo vigente no banco tem blocos
-- que este arquivo não vê. Reescrever a função por completo apagaria esses
-- blocos. Em vez disso: lê o fonte REAL do banco via pg_get_functiondef,
-- injeta a nova chamada antes do `return query` final, e aborta com
-- `raise exception` se a âncora não casar ou se a chamada já existir — nunca
-- grava uma função incompleta.
--
-- Alerta `parou_de_pagar`: card em 'mensalidade_em_curso', inadimplente
-- (>= 60 dias sem pagar, calculado pela view) e sem cancelamento. Severidade
-- crítica (dinheiro combinado que parou de entrar). Auto-resolve quando a
-- view deixa de marcar o card como inadimplente (pagou, quitou, ou saiu da
-- mensalidade em curso).
-- =====================================================================

begin;

create or replace function cs.fn_hm_alerta_parou_de_pagar()
returns integer
language plpgsql
security definer
set search_path to 'cs', 'public', 'pg_temp'
as $function$
declare v_n integer := 0;
begin
  insert into cs.hm_alertas (tipo, chave, severidade, detalhe)
  select 'parou_de_pagar', f.contato_hm_id::text, 'critico',
         format('%s (%s) está %s dia(s) sem pagar a mensalidade — última parcela em %s.',
                coalesce(f.nome, '(sem nome)'),
                coalesce(f.email, '(sem e-mail)'),
                f.dias_sem_pagar,
                to_char(f.ultimo_pagamento_em, 'DD/MM/YYYY'))
    from cs.vw_hm_financeiro f
    join cs.contatos_hm ch on ch.id = f.contato_hm_id
   where f.inadimplente
     and ch.cancelamento_em is null
     and not exists (
       select 1 from cs.hm_alertas a
        where a.tipo = 'parou_de_pagar' and a.chave = f.contato_hm_id::text and a.resolvido_em is null)
   on conflict do nothing;
  get diagnostics v_n = row_count;

  -- Auto-resolução: a view deixou de marcar inadimplente (pagou, quitou, ou
  -- não está mais em mensalidade_em_curso).
  update cs.hm_alertas a set resolvido_em = now()
   where a.resolvido_em is null and a.tipo = 'parou_de_pagar'
     and not exists (
       select 1 from cs.vw_hm_financeiro f
        where f.contato_hm_id::text = a.chave and f.inadimplente);

  return v_n;
end$function$;

comment on function cs.fn_hm_alerta_parou_de_pagar() is
  '0285: um alerta CRITICO por card com cs.vw_hm_financeiro.inadimplente=true (D3: so sinaliza, nunca move card) e sem cancelamento. Auto-resolve quando a view para de marcar o card como inadimplente. Chamada por cs.fn_hm_health_check.';

grant execute on function cs.fn_hm_alerta_parou_de_pagar() to disparos_app;

-- Acrescenta a chamada ao corpo de cs.fn_hm_health_check por REPLACE
-- MECÂNICO do fonte VIVO (padrão 0216/0233/0263/0265) — ver o cabeçalho.
do $$
declare v_def text; v_novo text;
begin
  select pg_get_functiondef(p.oid) into v_def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'cs' and p.proname = 'fn_hm_health_check';

  if v_def is null then
    raise exception '0285: cs.fn_hm_health_check nao encontrada — abortado antes de mexer em nada';
  end if;

  if v_def like '%fn_hm_alerta_parou_de_pagar%' then
    raise exception '0285: cs.fn_hm_health_check ja chama fn_hm_alerta_parou_de_pagar() — migration ja aplicada, abortado para nao duplicar a chamada';
  end if;

  v_novo := replace(v_def,
    E'\n  return query',
    E'\n  perform cs.fn_hm_alerta_parou_de_pagar();\n\n  return query');

  if v_novo = v_def then
    raise exception '0285: a ancora "return query" nao casou no fonte de cs.fn_hm_health_check — abortado antes de gravar funcao incompleta';
  end if;

  execute v_novo;
end $$;

-- Rede de segurança: a chamada tem de aparecer exatamente 1 vez.
do $$
declare v_def_saude text; v_chamadas int;
begin
  select pg_get_functiondef(p.oid) into v_def_saude
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'cs' and p.proname = 'fn_hm_health_check';

  v_chamadas := (length(v_def_saude) - length(replace(v_def_saude, 'fn_hm_alerta_parou_de_pagar', '')))
                / length('fn_hm_alerta_parou_de_pagar');

  if v_chamadas <> 1 then
    raise exception '0285: cs.fn_hm_health_check deveria chamar fn_hm_alerta_parou_de_pagar() exatamente 1 vez, achei % ocorrencia(s).', v_chamadas;
  end if;

  raise notice '0285: fn_hm_health_check chama fn_hm_alerta_parou_de_pagar() exatamente 1x.';
end $$;

commit;
