-- =====================================================================
-- 0148_inbox_indices
--
-- Índices do caminho quente do inbox (fila que faz poll a cada ~12s por
-- operador + thread aberta). Levantamento query-a-query em 27/07/2026:
--
--   FILA (lib/services/inbox-fila.ts)
--     - scan de cs.contatos por evento ......... cs_contatos_evento_idx (0019) OK
--     - contador de pendentes por evento ....... FALTAVA (0011 indexa só
--       inbox_status, sem o evento) → índice (1) abaixo
--     - LEFT JOIN LATERAL "última mensagem" em cs.interacoes: o índice da 0001
--       (contato_id, criado_em desc) serve, mas varre TODA a timeline do
--       contato (disparo/sistema/mudança de estágio) até achar resposta/nota
--       — em contato com dezenas de disparos são dezenas de linhas descartadas
--       por conversa, ×200 linhas ×5 polls/min ×operador → índices (2) e (3)
--     - fila HM: 0028 indexa contato_hm_id SEM criado_em → o lateral ordenava
--       sem suporte de índice → coberto pelo (3)
--
--   THREAD (app/api/inbox/[id] e app/api/hm/inbox/[id])
--     - resolverContactId lia cs.disparo_contatos por comprador_id: NENHUM
--       índice começa por comprador_id (o ux_ da 0074 começa por disparo_id)
--       = seq scan A CADA POLL de thread aberta → índice (4). (O cache da
--       0147 corta a maioria dessas leituras; o índice cobre o primeiro hit
--       e os compradores antigos ainda sem cache.)
--
--   SYNC (lib/services/inbox-sync.ts)
--     - alvos: enviado=true, respondeu=false, unnichat_contact_id not null,
--       janela de 21 dias. O parcial da 0001 (telefone, enviado_em) tem as
--       MESMAS condições mas lidera por telefone (inútil aqui) → índice (5)
--
--   MÉTRICAS (app/api/inbox/metricas) — nada a criar:
--     - cs.atendimentos é agregada inteira (frt médio/sla) e por período
--       (cs_atendimentos_resp_idx, 0011, cobre o corte de 14 dias)
--     - join com cs.contatos por comprador_id usa o UNIQUE(comprador_id) da 0001
--     - pendentes/maior espera usam o índice (1) abaixo
--
-- CREATE INDEX CONCURRENTLY: não bloqueia escrita (webhook/disparos seguem
-- rodando durante a criação), MAS não roda dentro de transação — aplicar este
-- arquivo statement a statement, fora de BEGIN/COMMIT (psql simples serve; se
-- o runner embrulhar em transação, remover o CONCURRENTLY: as tabelas cs.*
-- ainda são pequenas o suficiente para o lock rápido ser aceitável).
--
-- NÃO aplicada nesta máquina (sem banco). Aplicar ANTES do deploy do código.
-- =====================================================================

-- (1) Contador de pendentes por evento (fila, métricas, badge). Parcial:
--     pendente é estado transitório — o índice fica minúsculo e o COUNT vira
--     um index-only scan por evento.
create index concurrently if not exists cs_contatos_evento_pendente_idx
  on cs.contatos (evento)
  where inbox_status = 'pendente';

-- (2) Última mensagem da CONVERSA (lateral da fila genérica): só os tipos que
--     a fila considera conversa (resposta do lead / nota do CS) — o planner
--     prova a implicação a partir do OR da query. 1 linha lida por conversa,
--     em vez de varrer a timeline até achar.
create index concurrently if not exists cs_interacoes_ultima_conversa_idx
  on cs.interacoes (contato_id, criado_em desc)
  where tipo in ('resposta', 'nota') and contato_id is not null;

-- (3) Idem para o overlay HM (timeline em contato_hm_id). O índice da 0028 não
--     tem criado_em: o ORDER BY ... LIMIT 1 do lateral não tinha suporte.
create index concurrently if not exists cs_interacoes_ultima_conversa_hm_idx
  on cs.interacoes (contato_hm_id, criado_em desc)
  where tipo in ('resposta', 'nota') and contato_hm_id is not null;

-- (4) Contact id da Unnichat a partir do comprador (thread do inbox, genérico
--     e HM): "disparo mais recente com contact id" vira um index scan de 1
--     linha (comprador → enviado_em desc) em vez de seq scan por poll.
create index concurrently if not exists cs_disparo_contatos_comprador_unnichat_idx
  on cs.disparo_contatos (comprador_id, enviado_em desc)
  where unnichat_contact_id is not null;

-- (5) Alvos do inbox-sync: o parcial casa exatamente o WHERE do job (enviado,
--     sem resposta, com contact id) e a chave dá o range da janela de 21 dias
--     + a ordenação por recência. O filtro novo de backoff (sync_verificado_em,
--     0147) é aplicado por cima — o conjunto já vem estreito do índice.
create index concurrently if not exists cs_disparo_contatos_sync_alvo_idx
  on cs.disparo_contatos (enviado_em desc)
  where enviado and not respondeu and unnichat_contact_id is not null;
