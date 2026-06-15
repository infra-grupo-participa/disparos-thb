-- =====================================================================
-- 0024_cs_ligacoes_atendesimples
-- Atende Simples passa a ser o PROVEDOR de ligações (substitui o plano do
-- Nvoip). Em vez de uma tabela nova, ampliamos cs.ligacoes — ela já nasceu
-- "desacoplada do discador" (provider + provider_call_id + webhook). Assim o
-- histórico do contato, o CardLigacoes e as métricas de produtividade saem de
-- uma fonte só, e o registro manual (modo tel:) segue convivendo.
--
-- As chamadas chegam pelo webhook do Atende Simples (call.newcall →
-- call.finished). Cada chamada é UMA linha, idempotente por provider_call_id
-- (vários eventos atualizam a mesma linha via upsert). Nem toda chamada casa
-- com um aluno (inbound de número desconhecido), por isso comprador_id passa a
-- ser opcional; quando casa (por telefone), espelha na timeline do contato.
-- =====================================================================

-- Chamadas do PABX podem não casar com um comprador do sistema.
alter table cs.ligacoes alter column comprador_id drop not null;

-- Campos do Atende Simples (produtividade do comercial + rastreio da chamada).
alter table cs.ligacoes add column if not exists direction       text;     -- inbound | outbound
alter table cs.ligacoes add column if not exists attendant_email text;     -- atendente (e-mail)
alter table cs.ligacoes add column if not exists from_number     text;     -- origem (ANI)
alter table cs.ligacoes add column if not exists dnis            text;     -- destino (DNIS)
alter table cs.ligacoes add column if not exists billed_duration integer;  -- duração tarifada (seg)
alter table cs.ligacoes add column if not exists status_pabx     text;     -- status cru do AC (answered/abandoned/missed/blocked/failed/...)
alter table cs.ligacoes add column if not exists evento          text;     -- evento do aluno casado (HT/SEM), p/ filtrar por portal

-- Os enums (resultado/status) cresceram com o Atende Simples (abandonou,
-- recusada, falhou…). A validação passa a ser no app (lib/atendesimples.ts);
-- removemos os CHECK antigos para não barrar os novos valores. Idempotente.
do $$
declare c text;
begin
  for c in
    select conname from pg_constraint
     where conrelid = 'cs.ligacoes'::regclass and contype = 'c'
  loop
    execute format('alter table cs.ligacoes drop constraint %I', c);
  end loop;
end $$;

-- Idempotência do webhook: uma linha por chamada do provedor.
create unique index if not exists ligacoes_provider_call_uidx
  on cs.ligacoes (provider, provider_call_id) where provider_call_id is not null;

-- Leitura das métricas de produtividade (por evento / por atendente).
create index if not exists ix_ligacoes_evento on cs.ligacoes (evento, criado_em desc);
create index if not exists ix_ligacoes_atendente on cs.ligacoes (attendant_email);
