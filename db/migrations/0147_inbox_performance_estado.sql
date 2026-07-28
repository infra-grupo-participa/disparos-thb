-- =====================================================================
-- 0147_inbox_performance_estado
--
-- Estado de apoio à performance do inbox (par da 0148, que traz os índices).
-- Três peças, todas aditivas e idempotentes:
--
--   1. cs.disparo_contatos.sync_verificado_em — "delta do nosso lado" para o
--      inbox-sync: a API do Unnichat não tem "mensagens desde X", então cada
--      alvo carimba quando foi verificado e só volta à fila quando o intervalo
--      da sua faixa vence (90s se o envio tem <1h; 10min se <24h; 2h além).
--      Sem isto, os MESMOS 40 envios recentes eram reconsultados a cada ~20s
--      (~120 chamadas/min por evento com o inbox aberto).
--
--   2. unnichat_contact_id em cs.contatos e cs.contatos_hm — cache do id do
--      contato na Unnichat. A thread do inbox resolvia esse id A CADA POLL:
--      seq scan em cs.disparo_contatos e, para contato sem disparo, um
--      createContact na API a cada abertura (escrita externa escondida no
--      caminho de leitura). Em cs.contatos o cache é por (comprador, evento)
--      porque o contact id pertence à CONTA do canal, e o canal é por evento.
--
--   3. cs.sync_controle — trava/rate-limit do sync on-demand no BANCO. A trava
--      antiga era variável de módulo (memória do processo): só segura com
--      processo único e persistente; com 2+ instâncias cada uma tem a própria
--      memória e todas consultam o Unnichat. O UPSERT condicional sobre esta
--      tabela é atômico: só uma instância vence a janela de 20s.
--
-- APLICAR ANTES do deploy do código correspondente (inbox-sync.ts referencia
-- sync_verificado_em no SELECT de alvos; as rotas de thread leem o cache).
-- =====================================================================

-- 1) Carimbo de verificação do sync (backoff por idade do envio)
alter table cs.disparo_contatos
  add column if not exists sync_verificado_em timestamptz;
comment on column cs.disparo_contatos.sync_verificado_em is
  'Última consulta deste alvo ao Unnichat pelo inbox-sync. NULL = nunca verificado. Dirige o backoff (lib/services/inbox-sync.ts): envio <1h reverifica a cada 90s, <24h a cada 10min, além a cada 2h.';

-- 2) Cache do contact id da Unnichat (resolvido uma vez, lido a cada poll)
alter table cs.contatos
  add column if not exists unnichat_contact_id text;
comment on column cs.contatos.unnichat_contact_id is
  'Cache do id do contato na Unnichat, por (comprador, evento) — o id pertence à conta do canal do evento. Preenchido pela thread do inbox (disparo mais recente ou createContact). Se o canal do evento trocar de conta Unnichat, limpar a coluna para o cache se refazer.';

alter table cs.contatos_hm
  add column if not exists unnichat_contact_id text;
comment on column cs.contatos_hm.unnichat_contact_id is
  'Cache do id do contato na Unnichat (canal HM). Mesma semântica da coluna em cs.contatos.';

-- 3) Controle de execução de syncs (claim atômico multi-instância)
create table if not exists cs.sync_controle (
  chave       text primary key,          -- ex.: 'inbox:SEM' / 'inbox:HM'
  ultima_exec timestamptz not null default now()
);
comment on table cs.sync_controle is
  'Rate-limit/trava de jobs on-demand entre instâncias. Quem consegue mover ultima_exec para now() (UPSERT com WHERE na janela) executa; os demais pulam. Ver sincronizarRespostasInboxOnDemand.';

-- Mesmo padrão de acesso das demais tabelas do schema (0001/0011).
grant select, insert, update, delete on cs.sync_controle to disparos_app;
alter table cs.sync_controle enable row level security;
drop policy if exists app_all on cs.sync_controle;
create policy app_all on cs.sync_controle to disparos_app using (true) with check (true);
