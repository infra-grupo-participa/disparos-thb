import { pgSchema, uuid, text, integer, smallint, boolean, timestamp } from "drizzle-orm/pg-core";

// Schema tipado do `cs` (espelha as migrations db/migrations/*.sql). Usado pelo
// Drizzle como query builder type-safe sobre o pool pg existente. As migrations
// continuam sendo aplicadas pelo fluxo atual (SQL/MCP) — aqui apenas tipamos.
// Mantenha em sincronia ao alterar tabelas de cs.
export const cs = pgSchema("cs");

export const estagios = cs.table("estagios", {
  id: integer("id").primaryKey(),
  chave: text("chave").notNull(),
  nome: text("nome").notNull(),
  ordem: integer("ordem").notNull(),
  cor: text("cor"),
  isInicial: boolean("is_inicial").notNull(),
  isFinal: boolean("is_final").notNull(),
  ativo: boolean("ativo").notNull(),
});

export const contatos = cs.table("contatos", {
  id: uuid("id").primaryKey().defaultRandom(),
  compradorId: uuid("comprador_id").notNull(),
  estagioId: smallint("estagio_id"),
  responsavel: text("responsavel"),
  observacoes: text("observacoes"),
  proximaAcaoEm: timestamp("proxima_acao_em", { withTimezone: true }),
  proximaAcaoNota: text("proxima_acao_nota"),
  primeiroContatoEm: timestamp("primeiro_contato_em", { withTimezone: true }),
  ultimoContatoEm: timestamp("ultimo_contato_em", { withTimezone: true }),
  ultimaRespostaEm: timestamp("ultima_resposta_em", { withTimezone: true }),
  tags: text("tags").array().notNull(),
  optOut: boolean("opt_out").notNull(),
  optOutEm: timestamp("opt_out_em", { withTimezone: true }),
  inboxStatus: text("inbox_status").notNull(),
  aguardandoDesde: timestamp("aguardando_desde", { withTimezone: true }),
  atualizadoEm: timestamp("atualizado_em", { withTimezone: true }).notNull().defaultNow(),
});

export const interacoes = cs.table("interacoes", {
  id: uuid("id").primaryKey().defaultRandom(),
  contatoId: uuid("contato_id").notNull(),
  tipo: text("tipo").notNull(),
  descricao: text("descricao"),
  disparoId: uuid("disparo_id"),
  estagioAnteriorId: smallint("estagio_anterior_id"),
  estagioNovoId: smallint("estagio_novo_id"),
  autor: text("autor"),
  criadoEm: timestamp("criado_em", { withTimezone: true }).notNull().defaultNow(),
});

export const atendimentos = cs.table("atendimentos", {
  id: uuid("id").primaryKey().defaultRandom(),
  compradorId: uuid("comprador_id"),
  atendente: text("atendente"),
  perguntaEm: timestamp("pergunta_em", { withTimezone: true }),
  respondidoEm: timestamp("respondido_em", { withTimezone: true }).notNull().defaultNow(),
  frtMinutos: integer("frt_minutos"),
});
