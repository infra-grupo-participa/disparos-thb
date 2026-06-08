import { Pool } from "pg";

// Pool único reaproveitado entre hot-reloads do dev (evita esgotar conexões).
// Conecta como role scoped `disparos_app` (GRANT só no schema cs) via pooler
// Supavisor (transaction mode). Server-only — nunca importar no client.
const globalForPg = globalThis as unknown as { _csPool?: Pool };

export function getPool(): Pool {
  if (!globalForPg._csPool) {
    if (!process.env.DATABASE_URL) {
      throw new Error("DATABASE_URL não configurada");
    }
    globalForPg._csPool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: { rejectUnauthorized: false },
      max: 5,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 10_000,
    });
  }
  return globalForPg._csPool;
}

export async function query<T = Record<string, unknown>>(
  text: string,
  params?: unknown[],
): Promise<T[]> {
  const res = await getPool().query(text, params as never[]);
  return res.rows as T[];
}

export async function queryOne<T = Record<string, unknown>>(
  text: string,
  params?: unknown[],
): Promise<T | null> {
  const rows = await query<T>(text, params);
  return rows[0] ?? null;
}
