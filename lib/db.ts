import { Pool, type PoolClient } from "pg";

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

// Transação explícita — para o caso raro em que duas escritas precisam nascer juntas ou
// não nascer (numeração de protocolo + a linha que ela numera, lib/protocolo.ts). `query()`
// acima usa o pool direto (uma conexão por chamada, sob o pooler Supavisor em modo
// transação) e não serve para isto: TRANSAÇÃO exige o MESMO client do início ao commit.
// Libera a conexão sempre, inclusive se `fn` lançar.
export async function withTransaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await getPool().connect();
  try {
    await client.query("begin");
    const resultado = await fn(client);
    await client.query("commit");
    return resultado;
  } catch (erro) {
    await client.query("rollback").catch(() => {});
    throw erro;
  } finally {
    client.release();
  }
}
