// Cliente da API Unnichat (só-servidor). Contrato: https://unnichat.com.br/api
// Auth: header Authorization: Bearer <key>.
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
