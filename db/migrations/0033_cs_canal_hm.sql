-- =====================================================================
-- 0033_cs_canal_hm
-- Canal de disparo (Unnichat) do portal Holding Masters (evento 'HM'), para
-- habilitar o disparo de WhatsApp no HM reaproveitando o pipeline existente
-- (lib/services/disparo.ts → getCanal('HM')). Usa o mesmo token Unnichat já
-- compartilhado por HT/SEM. O `numero` fica nulo até o número próprio do HM ser
-- informado — sem número, o envio cai na credencial da env global.
-- Idempotente: não recria se já existir um canal HM.
-- =====================================================================
insert into cs.canais_disparo (evento_chave, nome, provider, api_key, numero, ativo)
select 'HM', 'Holding Masters — Unnichat', 'unnichat',
       '0cf28f26-feea-44f1-aedb-9f7c1ade2b16', null, true
where not exists (select 1 from cs.canais_disparo where evento_chave = 'HM');
