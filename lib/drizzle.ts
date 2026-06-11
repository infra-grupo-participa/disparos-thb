import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { getPool } from "@/lib/db";
import * as schema from "@/db/schema";

// Cliente Drizzle reaproveitando o MESMO pool pg (lib/db) — coexiste com as
// queries SQL cruas existentes; a migração para Drizzle é gradual. Lazy para
// não tocar o pool em import-time (build).
let _db: NodePgDatabase<typeof schema> | undefined;

export function getDb(): NodePgDatabase<typeof schema> {
  if (!_db) _db = drizzle(getPool(), { schema });
  return _db;
}
