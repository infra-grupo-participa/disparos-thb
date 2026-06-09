// Cliente da API Unnichat (só-servidor). Contrato: https://unnichat.com.br/api
// Auth: header Authorization: Bearer <key>. Envelope de resposta: { success, data }.
const BASE = process.env.UNNICHAT_BASE_URL || "https://unnichat.com.br/api";

function headers() {
  const key = process.env.UNNICHAT_API_KEY;
  if (!key) throw new Error("UNNICHAT_API_KEY não configurada");
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
}): Promise<EnvioResultado> {
  try {
    const res = await fetch(`${BASE}/meta/templates`, {
      method: "POST",
      headers: headers(),
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
}): Promise<EnvioResultado & { contactId?: string }> {
  try {
    const res = await fetch(`${BASE}/contact`, {
      method: "POST",
      headers: headers(),
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
export async function getMessageStatus(messageId: string): Promise<{
  ok: boolean;
  status?: string;
  ref?: string;
  errorCode?: number;
}> {
  try {
    const res = await fetch(`${BASE}/meta/messages/${encodeURIComponent(messageId)}`, { headers: headers() });
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
export async function getContactMessages(contactId: string): Promise<{
  ok: boolean;
  messages: Array<{ id: string; type: string; text: string; templateId?: string; senderBy?: string; date?: string }>;
}> {
  try {
    const res = await fetch(`${BASE}/contact/${encodeURIComponent(contactId)}/messages`, { headers: headers() });
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

// POST /meta/messages — envia mensagem de texto livre ao contato. Só funciona
// dentro da janela de 24h (a Meta exige uma interação recente do contato);
// fora dela, a API retorna erro de "janela de envio fechada".
export async function sendMessage(opts: { phone: string; text: string }): Promise<EnvioResultado> {
  try {
    const res = await fetch(`${BASE}/meta/messages`, {
      method: "POST",
      headers: headers(),
      body: JSON.stringify({ phone: opts.phone, messageText: opts.text }),
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
