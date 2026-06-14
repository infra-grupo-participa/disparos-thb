import { queryOne } from "@/lib/db";
import type { CanalCfg } from "@/lib/unnichat";

// Canais de disparo (cs.canais_disparo): credencial da API de WhatsApp por
// evento, editável pelo admin sem deploy. Resolve o canal ATIVO do evento e,
// se não houver, cai na env global (UNNICHAT_API_KEY) — o HT legado segue
// funcionando enquanto ninguém cadastrar um canal. Cache curto por evento.
type Entrada = { cfg: CanalCfg; em: number };
const cache = new Map<string, Entrada>();
const TTL_MS = 30_000;

// Retorna a credencial do canal ativo do evento (ou {} → fallback env no client).
export async function getCanal(evento: string, provider = "unnichat"): Promise<CanalCfg> {
  const chave = `${evento}:${provider}`;
  const c = cache.get(chave);
  if (c && Date.now() - c.em < TTL_MS) return c.cfg;

  const row = await queryOne<{ base_url: string | null; api_key: string }>(
    `select base_url, api_key from cs.canais_disparo
      where evento_chave = $1 and provider = $2 and ativo
      limit 1`,
    [evento, provider],
  );
  const cfg: CanalCfg = row ? { baseUrl: row.base_url, apiKey: row.api_key } : {};
  cache.set(chave, { cfg, em: Date.now() });
  return cfg;
}

export function limparCacheCanais(): void {
  cache.clear();
}
