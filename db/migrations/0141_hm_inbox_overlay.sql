-- =====================================================================
-- 0141_hm_inbox_overlay
--
-- Inbox no overlay HM (Fase 2). cs.contatos_hm ganha as MESMAS colunas de
-- conversa que cs.contatos (0011/0019) já tem, para o inbox HM espelhar o do
-- Seminário (a referência que está "redonda") SEM entrar em cs.contatos_evento
-- (decisão do Marcio: overlay isolado, não colidir comprador_id HT+HM).
--
-- opt_out AUTOMÁTICO (o lead pediu "pare") é coluna NOVA, ao lado de
-- nao_contatar (a trava MANUAL do operador) — os dois coexistem e têm origens
-- distintas. O /api/send HM já checa nao_contatar; passará a checar opt_out
-- também (via cs.contatos_hm, na leitura da fila/elegíveis).
-- Ver [[HM - Feature de equipes e niveis de acesso]].
-- =====================================================================
alter table cs.contatos_hm
  add column if not exists inbox_status       text not null default 'sem_conversa',
  add column if not exists aguardando_desde    timestamptz,
  add column if not exists ultima_resposta_em  timestamptz,
  add column if not exists opt_out             boolean not null default false,
  add column if not exists opt_out_em          timestamptz;

comment on column cs.contatos_hm.inbox_status is
  'Fila do inbox HM: sem_conversa | pendente | resolvido. Espelha cs.contatos.';
comment on column cs.contatos_hm.opt_out is
  'Opt-out AUTOMÁTICO (lead pediu parar). Distinto de nao_contatar (trava manual).';

-- A fila ordena os pendentes no topo por tempo de espera — índice parcial.
create index if not exists cs_contatos_hm_inbox_pendente_idx
  on cs.contatos_hm (aguardando_desde)
  where inbox_status = 'pendente';
