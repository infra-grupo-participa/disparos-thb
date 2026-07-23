-- =====================================================================
-- 0132_hm_report_diario_slack
--
-- Report diário de saúde HM (compras + ativação) direto do banco para o
-- Slack, sem edge function nem dependência do repo v2 (usa pg_net + pg_cron).
--
--   * cs.fn_hm_report_diario()       — monta o texto (mrkdwn) a partir de
--     cs.hm_alertas abertos, agrupado por tipo com a lista de e-mails afetados.
--   * cs.fn_hm_enviar_report_diario()— roda o health-check (alertas frescos),
--     lê o webhook de cs.config (chave hm_slack_webhook_alertas) e posta via
--     net.http_post. Sem webhook configurado → não envia (retorna motivo).
--   * cron hm-report-diario-slack    — 08h BRT (11h UTC) todo dia.
--
-- ATIVAR (quando o canal Slack existir): criar um Incoming Webhook no canal
-- dedicado e gravar a URL:
--   insert into cs.config (chave, valor)
--   values ('hm_slack_webhook_alertas', to_jsonb('https://hooks.slack.com/...'::text))
--   on conflict (chave) do update set valor = excluded.valor;
-- O webhook é sensível — vive só no banco (cs.config), nunca no repo/vault.
-- Ver [[HM - Reconciliacao Hotmart x banco]].
-- =====================================================================

create or replace function cs.fn_hm_report_diario()
 returns text language plpgsql security definer
 set search_path to 'cs','public','pg_temp'
as $function$
declare
  v_txt text; v_criticos int; v_avisos int; v_total int; r record;
  v_hoje text := to_char(now() at time zone 'America/Sao_Paulo','DD/MM');
begin
  select count(*) filter (where severidade='critico'),
         count(*) filter (where severidade='aviso'), count(*)
    into v_criticos, v_avisos, v_total
    from cs.hm_alertas where resolvido_em is null;

  if v_total = 0 then
    return '✅ *Saúde HM — '||v_hoje||'*'||E'\n_Compras e ativação em dia — nenhum problema aberto._';
  end if;

  v_txt := '🩺 *Saúde HM — '||v_hoje||'*'||E'\n_Compras & Ativação_ — '
        || v_total||' aberto(s): '||v_criticos||' 🔴 · '||v_avisos||' 🟡';

  for r in
    select tipo, severidade, count(*) n,
      string_agg(
        coalesce(substring(detalhe from '[[:alnum:]._%+-]+@[[:alnum:]._-]+'),
                 substring(detalhe from 'Oferta ([[:alnum:]]+)'),
                 left(detalhe,30)),
        ', ' order by detectado_em) alvos
      from cs.hm_alertas where resolvido_em is null
     group by tipo, severidade
     order by (severidade='critico') desc, count(*) desc
  loop
    v_txt := v_txt || E'\n\n' || case when r.severidade='critico' then '🔴' else '🟡' end
          || ' *'||r.tipo||'* ('||r.n||') — '
          || case r.tipo
               when 'oferta_orfa' then 'oferta fora do catálogo, pagamento não vira card/razão'
               when 'card_faltando' then 'pagou e não tem card na esteira'
               when 'sem_canal' then 'card sem canal de aquisição (rodar re-sync)'
               when 'duplicado' then 'CPF com 2+ cadastros na Hotmart — conferir alias'
               when 'boleto_preso' then 'boleto parado +10 dias — pagou (atualizar) ou expirou?'
               when 'reembolso_sem_baixa' then 'reembolso/chargeback pode não ter baixado — conferir na Hotmart'
               else 'conferir'
             end
          || E'\n   '||r.alvos;
  end loop;

  return v_txt;
end$function$;

create or replace function cs.fn_hm_enviar_report_diario()
 returns jsonb language plpgsql security definer
 set search_path to 'cs','public','pg_temp'
as $function$
declare v_url text; v_txt text; v_req bigint;
begin
  perform cs.fn_hm_health_check();  -- garante alertas frescos antes de reportar
  select valor #>> '{}' into v_url from cs.config where chave = 'hm_slack_webhook_alertas';
  if v_url is null or v_url = '' then
    return jsonb_build_object('enviado', false, 'motivo', 'webhook nao configurado (cs.config hm_slack_webhook_alertas)');
  end if;
  v_txt := cs.fn_hm_report_diario();
  select net.http_post(
    url := v_url,
    headers := '{"Content-Type":"application/json"}'::jsonb,
    body := jsonb_build_object('text', v_txt)
  ) into v_req;
  return jsonb_build_object('enviado', true, 'request_id', v_req);
end$function$;

-- todo dia 08h BRT (11h UTC). Inerte enquanto o webhook não estiver em cs.config.
select cron.schedule('hm-report-diario-slack', '0 11 * * *', 'select cs.fn_hm_enviar_report_diario();');
