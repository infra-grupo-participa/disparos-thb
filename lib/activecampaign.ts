// Cliente da API ActiveCampaign v3 (só-servidor). Espelho de lib/unnichat.ts
// para o canal de E-MAIL. Contrato: https://developers.activecampaign.com/reference
// Auth: header `Api-Token: <key>`. Base por conta: https://<conta>.api-us1.com
// As respostas vêm com os números como STRING — convertemos na borda.
const TIMEOUT_MS = 20000; // não pendura se o AC ficar lento/instável

// Credencial do canal de e-mail. Quando omitida, cai nas envs globais — espelha
// o fallback do WhatsApp (ver lib/services/canais.ts, provider 'activecampaign').
export type CanalCfg = { baseUrl?: string | null; apiKey?: string | null };

function resolveBase(cfg?: CanalCfg): string {
  const base = cfg?.baseUrl || process.env.ACTIVECAMPAIGN_API_URL;
  if (!base) throw new Error("ActiveCampaign sem base: configure um canal (admin) ou ACTIVECAMPAIGN_API_URL");
  return base.replace(/\/+$/, "");
}

function headers(cfg?: CanalCfg): Record<string, string> {
  const key = cfg?.apiKey || process.env.ACTIVECAMPAIGN_API_TOKEN;
  if (!key) throw new Error("ActiveCampaign sem credencial: configure um canal (admin) ou ACTIVECAMPAIGN_API_TOKEN");
  return { "Content-Type": "application/json", "Api-Token": key };
}

// ===== Casamento campanha → evento =========================================
export type EventoEmail = "HT" | "SEM";

// O AC não traz a lista de destino no objeto da campanha (segmentname vem vazio
// e o list_id só existe via subrecurso), então o sinal de evento é o PADRÃO DE
// NOME — os disparos seguem prefixos em colchete: [HT], [HT20], [HT 21],
// [SEM JUN26]. Decisão de negócio (2026-06-15): "filtrar o máximo, com diversas
// condicionais"; HT é SÓ [HT...] explícito — "ANTIGO HT" (régua de reconquista
// da base antiga, em buckets [B2]/[B3]) NÃO conta como HT. Para adicionar/ajustar
// um evento, edite as condicionais abaixo.
function normaliza(nome: string): string {
  return nome
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "") // remove acentos
    .toUpperCase()
    .trim();
}

export function classificarEventoEmail(nome: string | null | undefined): EventoEmail | null {
  if (!nome) return null;
  const n = normaliza(nome);

  // --- Seminário ---
  if (/^\s*\[\s*SEM\b/.test(n)) return "SEM"; // [SEM JUN26], [SEM ...]
  if (/\bSEMINARIO\b/.test(n)) return "SEM"; // nome menciona "Seminário"

  // --- Holding Total (HT): só [HT...] explícito, NUNCA "ANTIGO HT" ---
  if (/\bANTIGO\s+HT\b/.test(n)) return null; // reconquista da base antiga → fora do HT
  if (/^\s*\[\s*HT\s*\d*\s*\]/.test(n)) return "HT"; // [HT], [HT20], [HT 21], [HT21]
  if (/^\s*\[\s*HT\b/.test(n)) return "HT"; // [HT ...] (qualquer prefixo HT em colchete)
  if (/\bHOLDING\s+TOTAL\b/.test(n)) return "HT"; // nome menciona "Holding Total"

  return null; // não casou com nenhum evento conhecido
}

// ===== Leitura de campanhas (métricas) =====================================
export type CampanhaAC = {
  id: string;
  nome: string;
  tipo: string | null;
  status: string | null;
  enviados: number;
  processados: number;
  aberturas: number;
  aberturasUnicas: number;
  cliques: number;
  cliquesUnicos: number;
  hardbounces: number;
  softbounces: number;
  unsubscribes: number;
  forwards: number;
  replies: number;
  enviadaEm: string | null;
};

const num = (v: unknown): number => {
  const n = typeof v === "string" ? parseInt(v, 10) : typeof v === "number" ? v : NaN;
  return Number.isFinite(n) ? n : 0;
};

function mapCampanha(c: Record<string, unknown>): CampanhaAC {
  return {
    id: String(c.id),
    nome: String(c.name ?? ""),
    tipo: c.type ? String(c.type) : null,
    status: c.statusString ? String(c.statusString) : null,
    enviados: num(c.send_amt),
    processados: num(c.total_amt),
    aberturas: num(c.opens),
    aberturasUnicas: num(c.uniqueopens),
    cliques: num(c.linkclicks),
    cliquesUnicos: num(c.uniquelinkclicks),
    hardbounces: num(c.hardbounces),
    softbounces: num(c.softbounces),
    unsubscribes: num(c.unsubscribes),
    forwards: num(c.forwards),
    replies: num(c.replies),
    enviadaEm: c.sdate ? String(c.sdate) : null,
  };
}

// ===== Disparo (aplicar tag → automação) ===================================
// O envio de e-mail é feito aplicando uma TAG no contato; a automação do AC
// ligada à tag (gatilho 'tagadd') dispara o e-mail. Ver migration 0022.
export type ResultadoAC = { ok: boolean; status: number; erro?: string };

// POST /api/3/contact/sync — cria ou atualiza um contato por e-mail (idempotente)
// e devolve o id no AC. Necessário antes de aplicar a tag.
export async function garantirContato(opts: {
  email: string;
  nome?: string | null;
  cfg?: CanalCfg;
}): Promise<ResultadoAC & { contactId?: string }> {
  const [firstName, ...resto] = (opts.nome || "").trim().split(/\s+/);
  try {
    const res = await fetch(`${resolveBase(opts.cfg)}/api/3/contact/sync`, {
      method: "POST",
      headers: headers(opts.cfg),
      signal: AbortSignal.timeout(TIMEOUT_MS),
      body: JSON.stringify({
        contact: {
          email: opts.email,
          ...(firstName ? { firstName } : {}),
          ...(resto.length ? { lastName: resto.join(" ") } : {}),
        },
      }),
    });
    const txt = await res.text();
    let data: unknown;
    try { data = JSON.parse(txt); } catch { data = txt; }
    const contactId =
      typeof data === "object" && data && "contact" in data
        ? String(((data as { contact?: { id?: unknown } }).contact?.id) ?? "") || undefined
        : undefined;
    return {
      ok: res.ok,
      status: res.status,
      contactId,
      erro: res.ok ? undefined : (typeof data === "object" && data && "message" in data
        ? String((data as { message: unknown }).message)
        : `HTTP ${res.status}`),
    };
  } catch (e) {
    return { ok: false, status: 0, erro: e instanceof Error ? e.message : "erro de rede" };
  }
}

// POST /api/3/contactTags — aplica a tag no contato (aciona a automação).
export async function aplicarTag(opts: {
  contactId: string;
  tagId: string;
  cfg?: CanalCfg;
}): Promise<ResultadoAC> {
  try {
    const res = await fetch(`${resolveBase(opts.cfg)}/api/3/contactTags`, {
      method: "POST",
      headers: headers(opts.cfg),
      signal: AbortSignal.timeout(TIMEOUT_MS),
      body: JSON.stringify({ contactTag: { contact: opts.contactId, tag: opts.tagId } }),
    });
    if (res.ok) return { ok: true, status: res.status };
    const txt = await res.text();
    let msg = `HTTP ${res.status}`;
    try {
      const j = JSON.parse(txt) as { message?: string; errors?: Array<{ title?: string }> };
      msg = j.message || j.errors?.[0]?.title || msg;
    } catch { /* mantém HTTP status */ }
    return { ok: false, status: res.status, erro: msg };
  } catch (e) {
    return { ok: false, status: 0, erro: e instanceof Error ? e.message : "erro de rede" };
  }
}

// ===== Engajamento por contato =============================================
// O objeto de contato do AC já agrega o engajamento da pessoa: sentcnt (e-mails
// recebidos), last_open_date, last_click_date, bounced_hard/soft. Buscamos por
// e-mail (exato) e lemos esses campos — base do espelho "por pessoa do sistema".
export type EngajamentoAC = {
  encontrado: boolean;
  contactId?: string;
  recebidos: number;
  abriuEm: string | null;
  clicouEm: string | null;
  bounceHard: number;
  bounceSoft: number;
};

export async function buscarEngajamentoContato(email: string, cfg?: CanalCfg): Promise<{ ok: boolean; dados?: EngajamentoAC; erro?: string }> {
  try {
    const res = await fetch(`${resolveBase(cfg)}/api/3/contacts?email=${encodeURIComponent(email)}&limit=1`, {
      headers: headers(cfg),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) return { ok: false, erro: `HTTP ${res.status}` };
    const json = (await res.json()) as { contacts?: Record<string, unknown>[] };
    const c = json.contacts?.[0];
    if (!c) return { ok: true, dados: { encontrado: false, recebidos: 0, abriuEm: null, clicouEm: null, bounceHard: 0, bounceSoft: 0 } };
    return {
      ok: true,
      dados: {
        encontrado: true,
        contactId: String(c.id),
        recebidos: num(c.sentcnt),
        abriuEm: c.last_open_date ? String(c.last_open_date) : null,
        clicouEm: c.last_click_date ? String(c.last_click_date) : null,
        bounceHard: num(c.bounced_hard),
        bounceSoft: num(c.bounced_soft),
      },
    };
  } catch (e) {
    return { ok: false, erro: e instanceof Error ? e.message : "erro de rede" };
  }
}

// GET /api/3/tags — lista as tags da conta (para cadastrar um template de
// e-mail apontando para a tag certa). Partial match opcional por nome.
export async function listarTags(opts: {
  busca?: string;
  limit?: number;
  cfg?: CanalCfg;
}): Promise<{ ok: boolean; tags: Array<{ id: string; nome: string }>; erro?: string }> {
  const limit = Math.min(opts.limit ?? 100, 100);
  const qs = new URLSearchParams({ limit: String(limit) });
  if (opts.busca) qs.set("search", opts.busca);
  try {
    const res = await fetch(`${resolveBase(opts.cfg)}/api/3/tags?${qs.toString()}`, {
      headers: headers(opts.cfg),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) return { ok: false, tags: [], erro: `HTTP ${res.status}` };
    const json = (await res.json()) as { tags?: Array<{ id?: unknown; tag?: unknown }> };
    const tags = (json.tags ?? []).map((t) => ({ id: String(t.id), nome: String(t.tag ?? "") }));
    return { ok: true, tags };
  } catch (e) {
    return { ok: false, tags: [], erro: e instanceof Error ? e.message : "erro de rede" };
  }
}

// ===== Cableamento tag → automação (raio-x da automação) ===================
// O envio de e-mail é feito por uma automação do AC com gatilho 'tagadd'. Para
// o sistema dizer ao operador se uma tag REALMENTE envia, lemos as automações e
// seus gatilhos. O gatilho casa a automação à tag pelo NOME da tag (params.tag),
// não pelo id. status: '1' = ativa, '2' = pausada. multientry: '0' = entra só
// uma vez. Pesado (1 chamada de gatilhos por automação) → usar no cron.
export type AutomacaoAC = {
  id: string;
  nome: string;
  status: string | null;   // bruto do AC: '1' ativa | '2' pausada
  ativa: boolean;
  multientry: boolean;
  entrou: number;
  triggerTags: string[];    // NOMES das tags que disparam (gatilho 'tagadd')
};

// GET /api/3/tags/{id} — resolve o NOME de uma tag pelo id (o gatilho casa por
// nome, então precisamos do nome para diagnosticar a tag de um template).
export async function buscarTag(id: string, cfg?: CanalCfg): Promise<{ ok: boolean; nome?: string; erro?: string }> {
  try {
    const res = await fetch(`${resolveBase(cfg)}/api/3/tags/${encodeURIComponent(id)}`, {
      headers: headers(cfg),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) return { ok: false, erro: `HTTP ${res.status}` };
    const json = (await res.json()) as { tag?: { tag?: unknown } };
    return { ok: true, nome: json.tag?.tag != null ? String(json.tag.tag) : undefined };
  } catch (e) {
    return { ok: false, erro: e instanceof Error ? e.message : "erro de rede" };
  }
}

// GET /api/3/automations/{id}/triggers — nomes das tags com gatilho 'tagadd'.
async function gatilhosDeTag(id: string, cfg?: CanalCfg): Promise<string[]> {
  const res = await fetch(`${resolveBase(cfg)}/api/3/automations/${id}/triggers`, {
    headers: headers(cfg),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) return [];
  const json = (await res.json()) as { automationTriggers?: Array<{ type?: string; params?: { tag?: unknown } }> };
  return (json.automationTriggers ?? [])
    .filter((t) => t.type === "tagadd" && t.params?.tag != null)
    .map((t) => String(t.params!.tag));
}

// Varre TODAS as automações da conta e, para cada uma, lê os gatilhos de tag.
// Paginado. Espaça as chamadas (limite ~5 req/s do AC). `delayMs` entre páginas
// e entre cada leitura de gatilho.
export async function listarAutomacoes(cfg?: CanalCfg, delayMs = 120): Promise<{ ok: boolean; automacoes: AutomacaoAC[]; erro?: string }> {
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
  const automacoes: AutomacaoAC[] = [];
  try {
    for (let offset = 0; ; offset += 100) {
      const res = await fetch(`${resolveBase(cfg)}/api/3/automations?limit=100&offset=${offset}`, {
        headers: headers(cfg),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (!res.ok) return { ok: false, automacoes, erro: `HTTP ${res.status}` };
      const json = (await res.json()) as { automations?: Record<string, unknown>[] };
      const pagina = Array.isArray(json.automations) ? json.automations : [];
      for (const a of pagina) {
        const id = String(a.id);
        const triggerTags = await gatilhosDeTag(id, cfg);
        automacoes.push({
          id,
          nome: String(a.name ?? ""),
          status: a.status != null ? String(a.status) : null,
          ativa: String(a.status) === "1",
          multientry: String(a.multientry) !== "0",
          entrou: num(a.entered),
          triggerTags,
        });
        if (delayMs) await sleep(delayMs);
      }
      if (pagina.length < 100) break;
    }
    return { ok: true, automacoes };
  } catch (e) {
    return { ok: false, automacoes, erro: e instanceof Error ? e.message : "erro de rede" };
  }
}

// GET /api/3/campaigns — uma página de campanhas, mais recentes primeiro.
// O AC limita a 100 por página; paginamos via offset no serviço de sync.
export async function listarCampanhas(opts: {
  limit?: number;
  offset?: number;
  cfg?: CanalCfg;
}): Promise<{ ok: boolean; campanhas: CampanhaAC[]; total: number; erro?: string }> {
  const limit = Math.min(opts.limit ?? 100, 100);
  const offset = opts.offset ?? 0;
  const url = `${resolveBase(opts.cfg)}/api/3/campaigns?limit=${limit}&offset=${offset}&orders%5Bsdate%5D=DESC`;
  try {
    const res = await fetch(url, { headers: headers(opts.cfg), signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (!res.ok) {
      return { ok: false, campanhas: [], total: 0, erro: `HTTP ${res.status}` };
    }
    const json = (await res.json()) as { campaigns?: Record<string, unknown>[]; meta?: { total?: string } };
    const arr = Array.isArray(json.campaigns) ? json.campaigns : [];
    return { ok: true, campanhas: arr.map(mapCampanha), total: num(json.meta?.total) };
  } catch (e) {
    return { ok: false, campanhas: [], total: 0, erro: e instanceof Error ? e.message : "erro de rede" };
  }
}
