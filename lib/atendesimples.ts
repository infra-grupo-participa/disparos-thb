import crypto from "node:crypto";

// Utilitários do Atende Simples (só-servidor). A integração de ligações é por
// WEBHOOK (push): o Atende Simples envia eventos de chamada para nossa rota.
// Doc: https://atendesimples.github.io/api-docs/ — base REST
// https://app.atendesimples.com/api/v1 (a REST exige whitelist de IP e não
// documenta histórico, por isso usamos o webhook como fonte das métricas).

// Assina o corpo: "sha1=" + HMAC-SHA1(secret, corpoCru) em hex minúsculo. A
// chave é usada como STRING literal (o secret do AC é um UUID, não hex).
export function assinarCorpo(corpoCru: string, secret: string): string {
  return "sha1=" + crypto.createHmac("sha1", secret).update(corpoCru, "utf8").digest("hex");
}

// Verifica X-Hub-Signature contra o corpo cru. Tolerante a caixa e à ausência
// do prefixo "sha1=" (compara só o hex). Tempo constante. Sem secret/header → false.
export function verificarAssinatura(corpoCru: string, header: string | null | undefined, secret: string | undefined): boolean {
  if (!secret || !header) return false;
  const norm = (s: string) => s.trim().toLowerCase().replace(/^sha1=/, "");
  const a = norm(header);
  const b = norm(assinarCorpo(corpoCru, secret));
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(new Uint8Array(Buffer.from(a)), new Uint8Array(Buffer.from(b)));
}

// Status cru da chamada no Atende Simples (campo `status` do objeto call).
export type StatusPabx = "newcall" | "in_progress" | "answered" | "handled" | "abandoned" | "missed" | "blocked" | "failed";

// Mapeia o status do AC para o nosso resultado normalizado + o status interno
// de cs.ligacoes (iniciada | concluida | falhou). `resultado` é null enquanto a
// chamada não terminou (newcall/in_progress).
export function mapearResultado(status: string | null | undefined): { resultado: string | null; status: "iniciada" | "concluida" | "falhou" } {
  switch ((status || "").toLowerCase()) {
    case "answered":
    case "handled":
      return { resultado: "atendeu", status: "concluida" };
    case "abandoned":
      return { resultado: "abandonou", status: "concluida" };
    case "missed":
      return { resultado: "nao_atendeu", status: "concluida" };
    case "blocked":
      return { resultado: "recusada", status: "concluida" };
    case "failed":
      return { resultado: "falhou", status: "falhou" };
    case "newcall":
    case "in_progress":
      return { resultado: null, status: "iniciada" };
    default:
      return { resultado: null, status: "iniciada" };
  }
}

// Rótulos PT-BR dos resultados (inclui os novos do Atende Simples).
export const RESULTADO_LABEL: Record<string, string> = {
  atendeu: "Atendeu",
  nao_atendeu: "Não atendeu",
  abandonou: "Abandonada",
  recusada: "Recusada",
  falhou: "Falhou",
  caixa_postal: "Caixa postal",
  ocupado: "Ocupado",
  numero_errado: "Número errado",
};

// Objeto `call` do payload do webhook (campos que usamos; há muitos outros).
export type CallPayload = {
  call_id?: string | number;
  from_number?: string;
  dnis?: string;
  direction?: string; // inbound | outbound
  status?: string;
  started_at?: string;
  billed_duration?: number;
  inbound_duration?: number;
  attendant_name?: string;
  attendant_email?: string;
  audio_url?: string;
};

export type WebhookPayload = {
  event_code?: string;
  call?: CallPayload;
};

// Parser tolerante do corpo do webhook. A Atende Simples permite enviar como
// application/json OU application/x-www-form-urlencoded — aceitamos os dois para
// não falhar a ativação/ping. No urlencoded, o JSON pode vir no campo "payload"
// ou como campos soltos (event_code, call_id...). Nunca lança.
export function parsePayload(corpoCru: string): WebhookPayload {
  if (!corpoCru) return {};
  const t = corpoCru.trim();
  if (t.startsWith("{") || t.startsWith("[")) {
    try { return JSON.parse(t) as WebhookPayload; } catch { /* tenta urlencoded */ }
  }
  try {
    const p = new URLSearchParams(corpoCru);
    const payload = p.get("payload");
    if (payload) { try { return JSON.parse(payload) as WebhookPayload; } catch { /* segue */ } }
    const evento = p.get("event_code") || undefined;
    const callId = p.get("call_id") || p.get("call[call_id]") || undefined;
    if (evento || callId) return { event_code: evento, call: callId ? { call_id: callId } : undefined };
  } catch { /* ignore */ }
  // Última tentativa: JSON mesmo sem começar com { (ex.: BOM/espaços estranhos).
  try { return JSON.parse(corpoCru) as WebhookPayload; } catch { return {}; }
}

// O número do ALUNO depende da direção: em chamada de saída (comercial liga
// para o aluno) o destino é o dnis; em entrada, a origem é o from_number.
export function numeroDoCliente(call: CallPayload): string | null {
  const n = call.direction === "outbound" ? call.dnis : call.from_number;
  return n ? String(n) : (call.from_number ? String(call.from_number) : null);
}
