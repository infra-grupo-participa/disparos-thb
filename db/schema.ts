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
  evento: text("evento").notNull(),
});

export const contatos = cs.table("contatos", {
  id: uuid("id").primaryKey().defaultRandom(),
  compradorId: uuid("comprador_id").notNull(),
  estagioId: smallint("estagio_id"),
  responsavel: text("responsavel"),
  // 0146: dono por id (o texto acima é DERIVADO dele por trigger — id vence).
  responsavelId: uuid("responsavel_id"),
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
  evento: text("evento").notNull(),
  atualizadoEm: timestamp("atualizado_em", { withTimezone: true }).notNull().defaultNow(),
});

export const interacoes = cs.table("interacoes", {
  id: uuid("id").primaryKey().defaultRandom(),
  contatoId: uuid("contato_id"),
  contatoHmId: uuid("contato_hm_id"),
  tipo: text("tipo").notNull(),
  // Por onde o toque aconteceu (0026). É o que alimenta o ritmo por canal na
  // Visão Executiva e na Jornada — gravar sem isto joga o toque no balde "outro".
  canal: text("canal"),
  descricao: text("descricao"),
  disparoId: uuid("disparo_id"),
  estagioAnteriorId: smallint("estagio_anterior_id"),
  estagioNovoId: smallint("estagio_novo_id"),
  autor: text("autor"),
  criadoEm: timestamp("criado_em", { withTimezone: true }).notNull().defaultNow(),
});

// Atendimentos do operador (ligação, WhatsApp, presencial). O nome da tabela é
// histórico — nasceu só para telefone (0014) e ganhou o resto depois (0081).
// As colunas do PABX abaixo são do Atende Simples, que saiu: ninguém escreve
// mais nelas, mas o histórico já coletado continua lá e conta nos painéis.
export const ligacoes = cs.table("ligacoes", {
  id: uuid("id").primaryKey().defaultRandom(),
  compradorId: uuid("comprador_id"), // 0024 removeu o NOT NULL
  canal: text("canal").notNull(),    // 0081: ligacao | whatsapp | presencial | outro
  operador: text("operador"),
  telefone: text("telefone").notNull(),
  resultado: text("resultado"),
  duracaoSeg: integer("duracao_seg"),
  anotacao: text("anotacao"),
  retornoEm: timestamp("retorno_em", { withTimezone: true }),
  urlGravacao: text("url_gravacao"),
  provider: text("provider").notNull(),
  providerCallId: text("provider_call_id"),
  status: text("status").notNull(),
  // ----- histórico do discador (Atende Simples, 0024/0025) -----
  direction: text("direction"),
  attendantEmail: text("attendant_email"),
  fromNumber: text("from_number"),
  dnis: text("dnis"),
  billedDuration: integer("billed_duration"),
  statusPabx: text("status_pabx"),
  evento: text("evento"),
  iniciadaEm: timestamp("iniciada_em", { withTimezone: true }),
  criadoEm: timestamp("criado_em", { withTimezone: true }).notNull().defaultNow(),
  atualizadoEm: timestamp("atualizado_em", { withTimezone: true }).notNull().defaultNow(),
});

export const usuarios = cs.table("usuarios", {
  id: uuid("id").primaryKey().defaultRandom(),
  nome: text("nome").notNull(),
  email: text("email").notNull(),
  senhaHash: text("senha_hash").notNull(),
  papel: text("papel").notNull(),
  ativo: boolean("ativo").notNull(),
  criadoEm: timestamp("criado_em", { withTimezone: true }).notNull().defaultNow(),
  atualizadoEm: timestamp("atualizado_em", { withTimezone: true }).notNull().defaultNow(),
});

export const eventos = cs.table("eventos", {
  id: uuid("id").primaryKey().defaultRandom(),
  chave: text("chave").notNull(),
  nome: text("nome").notNull(),
  cor: text("cor"),
  ativo: boolean("ativo").notNull(),
  ordem: integer("ordem").notNull(),
  criadoEm: timestamp("criado_em", { withTimezone: true }).notNull().defaultNow(),
});

export const canaisDisparo = cs.table("canais_disparo", {
  id: uuid("id").primaryKey().defaultRandom(),
  eventoChave: text("evento_chave").notNull(),
  nome: text("nome").notNull(),
  provider: text("provider").notNull(),
  baseUrl: text("base_url"),
  apiKey: text("api_key").notNull(),
  numero: text("numero"),
  ativo: boolean("ativo").notNull(),
  criadoEm: timestamp("criado_em", { withTimezone: true }).notNull().defaultNow(),
  atualizadoEm: timestamp("atualizado_em", { withTimezone: true }).notNull().defaultNow(),
});

export const atendimentos = cs.table("atendimentos", {
  id: uuid("id").primaryKey().defaultRandom(),
  compradorId: uuid("comprador_id"),
  atendente: text("atendente"),
  perguntaEm: timestamp("pergunta_em", { withTimezone: true }),
  respondidoEm: timestamp("respondido_em", { withTimezone: true }).notNull().defaultNow(),
  frtMinutos: integer("frt_minutos"),
});
