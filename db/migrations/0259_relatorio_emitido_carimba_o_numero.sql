-- 0259_relatorio_emitido_carimba_o_numero.sql
--
-- Todo relatório que sai da máquina (PDF imprimível, aba /relatorio/{protocolo}) tem número
-- — e o conteúdo do PDF é o que fica GRAVADO aqui, não os parâmetros que o geraram. Se
-- guardasse só os parâmetros, reabrir o protocolo de ontem RECALCULARIA os números — e o
-- saldo pró-rata de quem tem crédito móvel muda todo dia (cs.fn_hm_prorata anda com
-- CURRENT_DATE). O PDF apresentado ao Marcio e o mesmo protocolo reaberto na semana
-- seguinte mostrariam valores diferentes, e alguém ia concluir que o sistema erra —
-- exatamente o "não pode ter nenhum dado errado" que o João pediu para eliminar.
-- Relatório emitido é imutável: escreve e lê, nunca reescreve.
--
-- Tamanho estimado (não medido — não há linha nenhuma ainda): ~250 linhas × ~15 campos por
-- emissão, comprimido pelo TOAST do Postgres. Sem poda automática: é prova, não cache.

create table if not exists cs.relatorio_emitido (
  id             bigserial primary key,
  protocolo      text not null unique,      -- 'HM-20260816-0001' — o que vai impresso no rodapé
  tipo           text not null,             -- id do registry (lib/relatorios/registry.ts)
  produto        text,                      -- 'HM' | 'AURUM' | 'ETHB'
  de             date,
  ate            date,
  params         jsonb not null default '{}'::jsonb,
  escopo         text not null check (escopo in ('tudo','equipe','operador')),  -- o recorte de QUEM gerou — decide quem pode reabrir (lib/protocolo.ts)
  emitido_por    text not null,
  emitido_por_id uuid references cs.usuarios(id) on delete set null,
  linhas         int  not null,
  conteudo       jsonb not null,            -- o ResultadoRelatorio INTEIRO (lib/relatorios/tipos.ts)
  emitido_em     timestamptz not null default now(),
  constraint relatorio_emitido_protocolo_formato check (protocolo ~ '^[A-Z]+-[0-9]{8}-[0-9]{4}$')
);
create index if not exists ix_relatorio_tipo on cs.relatorio_emitido (tipo, emitido_em desc);

-- APPEND-ONLY (lição da 0177, ver 0258 para o mesmo texto): a 0001 dá insert/update/delete
-- a disparos_app em toda tabela nova de cs por `alter default privileges`. Sem este revoke,
-- o relatório "imutável" vira uma promessa que qualquer PATCH desmente.
revoke update, delete on cs.relatorio_emitido from disparos_app;
grant  select, insert on cs.relatorio_emitido to disparos_app;

-- Backfill: nenhum — não existe relatório emitido antes desta tabela existir.
-- Volta: drop table cs.relatorio_emitido; (só depois que app/relatorio/[protocolo] parar de ler).
