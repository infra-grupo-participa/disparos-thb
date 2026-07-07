import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// Edge Function que RECEBE eventos de ENTRADA/SAÍDA do grupo de WhatsApp do HM
// e aplica a tag no card do aluno (igual ao HT): entrou → "No grupo";
// saiu → "Saiu do grupo". Cole a URL desta função no webhook do automatizador
// (Make/Unnichat/bot do grupo). Autentica por segredo opcional (GRUPO_SECRET).
// Casa por e-mail OU últimos 6 dígitos do telefone. Sempre 200 (exceto segredo).

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const GRUPO_SECRET = Deno.env.get("GRUPO_SECRET") ?? Deno.env.get("WEBHOOK_SECRET") ?? "";

function pick(body: Record<string, unknown>, keys: string[]): string {
  for (const k of keys) {
    const v = body[k];
    if (typeof v === "string" && v.trim()) return v.trim();
    if (typeof v === "number") return String(v);
  }
  return "";
}

// Deduz entrou/saiu de vários formatos de payload (member_join, participant.remove,
// "entrou"/"saiu", "join"/"left", etc.).
function resolveAcao(body: Record<string, unknown>): "entrou" | "saiu" | null {
  const raw = pick(body, ["acao", "action", "evento", "event", "tipo", "type", "status"]).toLowerCase();
  if (!raw) return null;
  if (/(sai|saí|left|leav|remov|exit|\bout\b|kick)/.test(raw)) return "saiu";
  if (/(entr|join|add|\bin\b|enter)/.test(raw)) return "entrou";
  return null;
}

serve(async (req) => {
  if (req.method === "GET") return new Response("OK", { status: 200 });
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return new Response("Invalid JSON", { status: 400 });
  }

  // Loga o payload cru (em cs.webhook_log via RPC) pra ajustar o mapeamento ao
  // formato real do Sendflow. Best-effort — nunca quebra o fluxo.
  console.log("[grupo] payload:", JSON.stringify(body));
  if (SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY) {
    try {
      const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
      await sb.rpc("fn_log_webhook", { p_origem: "sendflow-grupo", p_resultado: "received", p_payload: body });
    } catch (_) { /* ignora */ }
  }

  if (GRUPO_SECRET) {
    const url = new URL(req.url);
    const recebido =
      req.headers.get("x-webhook-secret") ||
      url.searchParams.get("secret") ||
      (typeof body.secret === "string" ? (body.secret as string) : null);
    if (recebido !== GRUPO_SECRET) {
      return new Response(JSON.stringify({ ok: false, reason: "invalid_secret" }), {
        status: 401, headers: { "Content-Type": "application/json" },
      });
    }
  }

  // Sendflow aninha os dados em `data` (ex.: data.number, data.groupName) e a
  // ação em `event` (group.updated.members.removed/added). Achata os dois níveis.
  const nested = body.data && typeof body.data === "object" ? (body.data as Record<string, unknown>) : {};
  const flat: Record<string, unknown> = { ...body, ...nested };

  const acao = resolveAcao(flat);
  const email = pick(flat, ["email", "e_mail"]).toLowerCase() || null;
  const telDig = pick(flat, ["number", "telefone", "phone", "whatsapp", "celular"]).replace(/\D/g, "");
  const u6 = telDig.length >= 6 && !/^0+$/.test(telDig) ? telDig.slice(-6) : null;
  const grupo = pick(flat, ["groupName", "grupo", "group", "group_name", "grupo_nome"]) || null;

  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    return new Response(JSON.stringify({ ok: false, reason: "server_misconfigured" }), {
      status: 500, headers: { "Content-Type": "application/json" },
    });
  }
  if (!acao) {
    return new Response(JSON.stringify({ ok: false, reason: "acao_desconhecida" }), {
      status: 200, headers: { "Content-Type": "application/json" },
    });
  }
  if (!email && !u6) {
    return new Response(JSON.stringify({ ok: false, reason: "email_ou_telefone_obrigatorio" }), {
      status: 200, headers: { "Content-Type": "application/json" },
    });
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data, error } = await supabase.rpc("fn_grupo_hm_evento", {
    p_email: email, p_u6: u6, p_acao: acao, p_grupo: grupo,
  });

  if (error) {
    console.error("[grupo] falha na RPC:", error.message);
    return new Response(JSON.stringify({ ok: false, reason: "db_error" }), {
      status: 200, headers: { "Content-Type": "application/json" },
    });
  }

  const matched = data === "entrou" || data === "saiu";
  return new Response(JSON.stringify({ ok: true, matched, acao, resultado: data }), {
    status: 200, headers: { "Content-Type": "application/json" },
  });
});
