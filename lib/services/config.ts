import { query, queryOne } from "@/lib/db";

// Configurações dinâmicas (cs.config): valores fora do hardcode, editáveis sem
// deploy. Cache curto em memória para não bater no banco a cada leitura; o
// default do código é o fallback (config nunca quebra se a chave não existir).
type Entrada = { valor: unknown; em: number };
const cache = new Map<string, Entrada>();
const TTL_MS = 30_000;

export async function getConfig<T>(chave: string, padrao: T): Promise<T> {
  const c = cache.get(chave);
  if (c && Date.now() - c.em < TTL_MS) return c.valor as T;
  const row = await queryOne<{ valor: T }>(`select valor from cs.config where chave = $1`, [chave]);
  const valor = row ? row.valor : padrao;
  cache.set(chave, { valor, em: Date.now() });
  return valor;
}

export async function setConfig(chave: string, valor: unknown): Promise<void> {
  await query(
    `insert into cs.config (chave, valor) values ($1, $2::jsonb)
     on conflict (chave) do update set valor = excluded.valor, atualizado_em = now()`,
    [chave, JSON.stringify(valor)],
  );
  cache.delete(chave);
}

export async function listConfig(): Promise<Record<string, unknown>> {
  const rows = await query<{ chave: string; valor: unknown }>(`select chave, valor from cs.config order by chave`);
  return Object.fromEntries(rows.map((r) => [r.chave, r.valor]));
}
