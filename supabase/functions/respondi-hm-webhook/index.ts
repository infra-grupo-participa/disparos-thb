import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// Edge Function que RECEBE as respostas do formulário do RESPONDI (ficha/
// entrevista do Holding Masters) e grava na aba "Formulários" da ficha HM.
// Cola a URL desta função no webhook do Respondi. Autentica por segredo
// (RESPONDI_SECRET) via header x-webhook-secret, query ?secret= ou body.secret.
// Casa o aluno por e-mail OU pelos últimos 6 dígitos do telefone (robusto a
// DDD/55/9). Idempotente (upsert por comprador+tipo). Sempre 200 (exceto
// segredo inválido) para o Respondi não retentar.

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
// Se nenhum segredo estiver configurado, NÃO bloqueia (facilita o teste inicial).
// Configure RESPONDI_SECRET nos secrets da função para produção.
const RESPONDI_SECRET = Deno.env.get("RESPONDI_SECRET") ?? Deno.env.get("WEBHOOK_SECRET") ?? "";

const CONTROLE = new Set([
  "secret", "tipo", "formulario", "form", "email", "e_mail", "telefone",
  "phone", "whatsapp", "celular", "number", "respostas", "answers", "pontuacao", "score",
]);

function slugTipo(v: unknown): string {
  const base = String(v ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  if (!base) return "hm_formulario";
  return (base.startsWith("hm_") ? base : `hm_${base}`).slice(0, 40);
}

function paraNumero(v: unknown): number | null {
  if (v === undefined || v === null || v === "") return null;
  const n = Number(String(v).replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

function pick(body: Record<string, unknown>, keys: string[]): string {
  for (const k of keys) {
    const val = body[k];
    if (typeof val === "string" && val.trim()) return val.trim();
    if (typeof val === "number") return String(val);
  }
  return "";
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

  // Autenticação por segredo (opcional — se não configurado, libera).
  if (RESPONDI_SECRET) {
    const url = new URL(req.url);
    const recebido =
      req.headers.get("x-webhook-secret") ||
      url.searchParams.get("secret") ||
      (typeof body.secret === "string" ? (body.secret as string) : null);
    if (recebido !== RESPONDI_SECRET) {
      return new Response(JSON.stringify({ ok: false, reason: "invalid_secret" }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      });
    }
  }

  const tipo = slugTipo(body.tipo ?? body.formulario ?? body.form);
  const email = pick(body, ["email", "e_mail"]).toLowerCase() || null;
  const telDig = pick(body, ["telefone", "phone", "whatsapp", "celular", "number"]).replace(/\D/g, "");
  const u6 = telDig.length >= 6 ? telDig.slice(-6) : null;

  const respostasRaw =
    (body.respostas && typeof body.respostas === "object" && body.respostas) ||
    (body.answers && typeof body.answers === "object" && body.answers) ||
    Object.fromEntries(Object.entries(body).filter(([k]) => !CONTROLE.has(k)));
  const pontuacao = paraNumero(body.pontuacao ?? body.score);

  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    console.error("[respondi] SUPABASE_URL/SERVICE_ROLE_KEY ausentes");
    return new Response(JSON.stringify({ ok: false, reason: "server_misconfigured" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
  if (!email && !u6) {
    return new Response(JSON.stringify({ ok: false, reason: "email_ou_telefone_obrigatorio" }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // Casa o aluno + grava em cs.* via RPC SECURITY DEFINER (o schema cs não é
  // exposto no PostgREST; a RPC vive em public e faz o trabalho).
  const { data, error } = await supabase.rpc("fn_respondi_hm_form", {
    p_email: email,
    p_u6: u6,
    p_tipo: tipo,
    p_respostas: respostasRaw ?? {},
    p_pontuacao: pontuacao,
  });

  if (error) {
    console.error("[respondi] falha na RPC:", error.message);
    return new Response(JSON.stringify({ ok: false, reason: "db_error" }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }

  const matched = data === "matched";
  return new Response(JSON.stringify({ ok: true, matched, ...(matched ? { tipo } : {}) }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
});
