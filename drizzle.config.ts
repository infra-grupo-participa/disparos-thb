import { defineConfig } from "drizzle-kit";

// Config do drizzle-kit para INTROSPECT/diff do schema `cs` (ferramenta de
// apoio: `drizzle-kit pull` para conferir o schema TS contra o banco).
// As migrations continuam aplicadas pelo fluxo atual (SQL/MCP), não por
// `drizzle-kit migrate`, por causa do role scoped (disparos_app sem DDL).
export default defineConfig({
  schema: "./db/schema.ts",
  out: "./db/drizzle",
  dialect: "postgresql",
  dbCredentials: { url: process.env.DATABASE_URL ?? "" },
  schemaFilter: ["cs"],
});
