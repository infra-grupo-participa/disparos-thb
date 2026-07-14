-- =====================================================================
-- 0074_disparo_sem_duplicata
-- Três defeitos do disparo de WhatsApp que só aparecem em produção:
--
-- 1) ENVIO DUPLICADO. retomarTravados() elege os disparos por
--    `iniciado_em < now() - 15min`, que não diz nada sobre o processo estar
--    vivo. Um disparo grande e SAUDÁVEL passa dos 15 min (350ms por mensagem),
--    então o cron o "retoma" enquanto o loop original ainda envia — dois loops
--    no mesmo disparo, e a janela entre o `select enviado = false` e o
--    `update enviado = true` vira mensagem repetida para o contato.
--    `processando_em` é o HEARTBEAT: quem processa renova a cada contato, e o
--    cron só assume o que parou de bater. Sinal certo de "o processo morreu".
--
-- 2) O mesmo contato entrando duas vezes na mesma campanha. Nada impedia.
--
-- 3) Template com 2+ variáveis. O código monta SEMPRE um único bodyParameter,
--    a Meta rejeita por contagem e o erro aparece tarde, como falha de envio.
--    `variaveis_map` diz de onde sai cada uma, em ordem (ex.: ["primeiro_nome",
--    "edicao"]). Sem o map, o serviço recusa o disparo em vez de enviar torto.
-- =====================================================================

-- 1) Heartbeat de quem está processando o disparo -----------------------
alter table cs.disparos add column if not exists processando_em timestamptz;

comment on column cs.disparos.processando_em is
  'Heartbeat do processo que está enviando. Renovado a cada contato. Cron só retoma quando este relógio para de bater (ver lib/services/disparo.ts).';

-- Índice do cron: acha os batimentos parados sem varrer a tabela.
create index if not exists ix_disparos_processando
  on cs.disparos (processando_em) where status = 'em_andamento';

-- Usado pelo painel de saúde e pela contagem de limite diário/hora.
create index if not exists ix_disparos_evento_iniciado
  on cs.disparos (evento, iniciado_em desc);

-- 2) Um contato, uma linha por campanha ---------------------------------
-- Limpa duplicatas herdadas antes de criar a trava. Sobrevive a linha mais
-- avançada — a enviada ganha da não-enviada (false < true no Postgres), e o
-- empate se resolve pelo id, só para ser determinístico. Descartar a enviada
-- apagaria o registro de que a pessoa recebeu a mensagem.
delete from cs.disparo_contatos dc
 using cs.disparo_contatos manter
 where dc.disparo_id = manter.disparo_id
   and dc.comprador_id = manter.comprador_id
   and dc.comprador_id is not null
   and dc.id <> manter.id
   and (manter.enviado, manter.id) > (dc.enviado, dc.id);

create unique index if not exists ux_disparo_contatos_disparo_comprador
  on cs.disparo_contatos (disparo_id, comprador_id) where comprador_id is not null;

-- Consulta do cron de status (disparo-status.ts): filtra por enviado +
-- status_meta e ordena por status_em. Hoje faz seq scan.
create index if not exists ix_disparo_contatos_status_meta
  on cs.disparo_contatos (status_meta, status_em) where enviado;

-- 3) De onde sai cada variável do template -------------------------------
alter table cs.templates add column if not exists variaveis_map jsonb;

comment on column cs.templates.variaveis_map is
  'Ordem das variáveis do template: ["primeiro_nome","nome","edicao","evento"]. Tamanho tem de bater com `variaveis`. Nulo só é aceito quando variaveis <= 1 (assume primeiro_nome).';

-- Templates de 1 variável que já rodam: o comportamento sempre foi o primeiro
-- nome. Deixa explícito, para o código ter um só caminho.
update cs.templates
   set variaveis_map = '["primeiro_nome"]'::jsonb
 where variaveis = 1 and variaveis_map is null;
