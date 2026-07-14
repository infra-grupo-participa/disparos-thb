// Cliente da API Unnichat (só-servidor). Contrato: https://unnichat.com.br/api
// Auth: header Authorization: Bearer <key>. Envelope de resposta: { success, data }.
const DEFAULT_BASE = "https://unnichat.com.br/api";
const TIMEOUT_MS = 20000; // não pendura se a Unnichat ficar lenta/instável

// Credencial do canal de disparo. Quando omitida, cai na env global (o HT
// legado e fluxos que não passam canal continuam funcionando). Ver
// lib/services/canais.ts, que resolve o canal ativo por evento.
export type CanalCfg = { baseUrl?: string | null; apiKey?: string | null };

function resolveBase(cfg?: CanalCfg): string {
  return cfg?.baseUrl || process.env.UNNICHAT_BASE_URL || DEFAULT_BASE;
}

function headers(cfg?: CanalCfg) {
  const key = cfg?.apiKey || process.env.UNNICHAT_API_KEY;
  if (!key) throw new Error("Nenhuma credencial de disparo: configure um canal (admin) ou UNNICHAT_API_KEY");
  return { "Content-Type": "application/json", Authorization: `Bearer ${key}` };
}

export type BodyParam = {
  type: "text" | "contactName" | "contactCustomField" | "contactEmail" | "contactPhone";
  text?: string;
  customFieldName?: string;
};

export type EnvioResultado = {
  ok: boolean;
  status: number;
  data: unknown;
  erro?: string;
};

// POST /meta/templates — envia um template WhatsApp para um número.
export async function sendTemplate(opts: {
  phone: string;
  templateId: string;
  bodyParameters?: BodyParam[];
  cfg?: CanalCfg;
}): Promise<EnvioResultado> {
  try {
    const res = await fetch(`${resolveBase(opts.cfg)}/meta/templates`, {
      method: "POST",
      headers: headers(opts.cfg),
      signal: AbortSignal.timeout(TIMEOUT_MS),
      body: JSON.stringify({
        phone: opts.phone,
        templateId: opts.templateId,
        ...(opts.bodyParameters && opts.bodyParameters.length
          ? { bodyParameters: opts.bodyParameters }
          : {}),
      }),
    });
    const txt = await res.text();
    let data: unknown;
    try { data = JSON.parse(txt); } catch { data = txt; }
    return {
      ok: res.ok,
      status: res.status,
      data,
      erro: res.ok ? undefined : (typeof data === "object" && data && "message" in data
        ? String((data as { message: unknown }).message)
        : `HTTP ${res.status}`),
    };
  } catch (e) {
    return { ok: false, status: 0, data: null, erro: e instanceof Error ? e.message : "erro de rede" };
  }
}

// POST /contact — cria (ou garante) um contato na Unnichat. Idempotente: se o
// telefone já existe, retorna o contato existente (mesmo id). Necessário ANTES
// de disparar, pois o template só pode ser enviado para um contato conhecido.
// Retorna também o contactId (data.id) para consulta de status posterior.
export async function createContact(opts: {
  name: string;
  phone: string;
  email?: string;
  cfg?: CanalCfg;
}): Promise<EnvioResultado & { contactId?: string }> {
  try {
    const res = await fetch(`${resolveBase(opts.cfg)}/contact`, {
      method: "POST",
      headers: headers(opts.cfg),
      signal: AbortSignal.timeout(TIMEOUT_MS),
      body: JSON.stringify({
        name: opts.name || opts.phone,
        phone: opts.phone,
        ...(opts.email ? { email: opts.email } : {}),
      }),
    });
    const txt = await res.text();
    let data: unknown;
    try { data = JSON.parse(txt); } catch { data = txt; }
    const contactId =
      typeof data === "object" && data && "data" in data
        ? String(((data as { data?: { id?: unknown } }).data?.id) ?? "") || undefined
        : undefined;
    return {
      ok: res.ok,
      status: res.status,
      data,
      contactId,
      erro: res.ok ? undefined : (typeof data === "object" && data && "message" in data
        ? String((data as { message: unknown }).message)
        : `HTTP ${res.status}`),
    };
  } catch (e) {
    return { ok: false, status: 0, data: null, erro: e instanceof Error ? e.message : "erro de rede" };
  }
}

// GET /meta/messages/{id} — status de entrega de uma mensagem
// (sent | delivered | read | failed). Em failed, traz o código de erro da Meta
// (ex.: 130472 = "User's number is part of an experiment").
export async function getMessageStatus(messageId: string, cfg?: CanalCfg): Promise<{
  ok: boolean;
  status?: string;
  ref?: string;
  errorCode?: number;
}> {
  try {
    const res = await fetch(`${resolveBase(cfg)}/meta/messages/${encodeURIComponent(messageId)}`, {
      headers: headers(cfg),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) return { ok: false };
    const json = (await res.json()) as { data?: Record<string, unknown> };
    const d = json?.data ?? {};
    const errs = d.errors as Array<{ code?: number }> | undefined;
    const errorCode =
      errs?.[0]?.code ??
      (typeof d.errorCode === "number" ? (d.errorCode as number) : undefined) ??
      (typeof (d.error as { code?: number })?.code === "number" ? (d.error as { code: number }).code : undefined);
    return {
      ok: true,
      status: typeof d.status === "string" ? d.status : undefined,
      ref: typeof d.ref === "string" ? d.ref : undefined,
      errorCode,
    };
  } catch {
    return { ok: false };
  }
}

// GET /contact/{id}/messages — lista as mensagens trocadas com o contato.
// Usado para localizar o id da última mensagem template enviada, quando o
// message id não foi capturado no envio.
export async function getContactMessages(contactId: string, cfg?: CanalCfg): Promise<{
  ok: boolean;
  messages: Array<{ id: string; type: string; text: string; templateId?: string; senderBy?: string; date?: string }>;
}> {
  try {
    const res = await fetch(`${resolveBase(cfg)}/contact/${encodeURIComponent(contactId)}/messages`, { headers: headers(cfg), signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (!res.ok) return { ok: false, messages: [] };
    const json = (await res.json()) as { data?: unknown };
    const arr = Array.isArray(json?.data) ? (json.data as Record<string, unknown>[]) : [];
    return {
      ok: true,
      messages: arr.map((m) => {
        const comps = m.templateComponents as Array<{ type?: string; text?: string }> | undefined;
        const tplText = comps?.find((x) => x.type === "BODY")?.text ?? comps?.[0]?.text ?? "";
        return {
          id: String(m.id),
          type: String(m.type ?? ""),
          text: m.type === "template" ? tplText : String(m.message ?? ""),
          templateId: m.templateId ? String(m.templateId) : undefined,
          senderBy: m.senderBy ? String(m.senderBy) : undefined,
          date: m.date ? String(m.date) : undefined,
        };
      }),
    };
  } catch {
    return { ok: false, messages: [] };
  }
}

// Valida a credencial do canal SEM enviar nada a ninguém: faz uma busca de
// contato (read-only). 401/403 = credencial recusada pela Unnichat; qualquer
// outra resposta indica que a chave foi aceita. Usado no "testar canal".
export async function validarCredencial(cfg?: CanalCfg): Promise<{ ok: boolean; status: number; erro?: string }> {
  try {
    const res = await fetch(`${resolveBase(cfg)}/contact/search`, {
      method: "POST",
      headers: headers(cfg),
      signal: AbortSignal.timeout(TIMEOUT_MS),
      body: JSON.stringify({ phone: "5521999999999" }),
    });
    if (res.status === 401 || res.status === 403) {
      return { ok: false, status: res.status, erro: "Credencial recusada pela Unnichat (401/403)." };
    }
    return { ok: true, status: res.status };
  } catch (e) {
    return { ok: false, status: 0, erro: e instanceof Error ? e.message : "erro de rede" };
  }
}

// POST /contact/search — localiza um contato por telefone. Retorna `data` como
// array; usamos o primeiro. Necessário para a sincronização do histórico de
// conversas (não há listagem em massa de contatos na Unnichat).
export async function searchContactByPhone(phone: string, cfg?: CanalCfg): Promise<{ ok: boolean; contactId?: string }> {
  try {
    const res = await fetch(`${resolveBase(cfg)}/contact/search`, {
      method: "POST",
      headers: headers(cfg),
      signal: AbortSignal.timeout(TIMEOUT_MS),
      body: JSON.stringify({ phone }),
    });
    if (!res.ok) return { ok: false };
    const json = (await res.json()) as { data?: Array<{ id?: unknown }> };
    const arr = Array.isArray(json?.data) ? json.data : [];
    const id = arr[0]?.id ? String(arr[0].id) : undefined;
    return { ok: true, contactId: id };
  } catch {
    return { ok: false };
  }
}

// POST /meta/messages — envia mensagem de texto livre ao contato. Só funciona
// dentro da janela de 24h (a Meta exige uma interação recente do contato);
// fora dela, a API retorna erro de "janela de envio fechada".
export async function sendMessage(opts: { phone: string; text: string; cfg?: CanalCfg }): Promise<EnvioResultado> {
  try {
    const res = await fetch(`${resolveBase(opts.cfg)}/meta/messages`, {
      method: "POST",
      headers: headers(opts.cfg),
      body: JSON.stringify({ phone: opts.phone, messageText: opts.text }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const txt = await res.text();
    let data: unknown;
    try { data = JSON.parse(txt); } catch { data = txt; }
    return {
      ok: res.ok,
      status: res.status,
      data,
      erro: res.ok ? undefined : (typeof data === "object" && data && "message" in data
        ? String((data as { message: unknown }).message)
        : `HTTP ${res.status}`),
    };
  } catch (e) {
    return { ok: false, status: 0, data: null, erro: e instanceof Error ? e.message : "erro de rede" };
  }
}
