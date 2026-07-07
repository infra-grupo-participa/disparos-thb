import { NextResponse } from "next/server";
import { query, queryOne } from "@/lib/db";
import { logger } from "@/lib/log";

export const runtime = "nodejs";
const log = logger("hm-formularios");

// Webhook de recebimento das respostas do RESPONDI (ficha/entrevista do HM).
// Casa o aluno por e-mail OU pelos últimos 6 dígitos do telefone (robusto a
// DDD/55/9) na esteira HM e grava as respostas em cs.formularios (aba
// "Formulários" da ficha). Idempotente (upsert por comprador+tipo). Sempre
// responde 200 (exceto segredo inválido) para o Respondi não retentar.

type Body = Record<string, unknown> & {
  secret?: string;
  tipo?: string;
  formulario?: string;
  email?: string;
  telefone?: string;
  phone?: string;
  whatsapp?: string;
  number?: string;
  respostas?: Record<string, unknown>;
  answers?: Record<string, unknown>;
  pontuacao?: number | string;
  score?: number | string;
};

// Campos de controle que não fazem parte das respostas do formulário.
const CONTROLE = new Set(["secret", "tipo", "formulario", "email", "telefone", "phone", "whatsapp", "number", "respostas", "answers", "pontuacao", "score"]);

function originOk(req: Request, body: Body): boolean {
  const secret = process.env.HM_WEBHOOK_SECRET || process.env.EVENTOS_SECRET || process.env.WEBHOOK_SECRET;
  if (!secret) return true; // sem segredo configurado → não bloqueia (dev)
  const recebido =
    req.headers.get("x-webhook-secret") ||
    new URL(req.url).searchParams.get("secret") ||
    (typeof body.secret === "string" ? body.secret : null);
  return recebido === secret;
}

function slugTipo(v: string | undefined): string {
  const base = String(v ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  if (!base) return "hm_formulario";
  return (base.startsWith("hm_") ? base : `hm_${base}`).slice(0, 40);
}

function paraNumero(v: number | string | undefined): number | null {
  if (v === undefined || v === null || v === "") return null;
  const n = Number(String(v).replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

export async function GET() {
  return new Response("OK", { status: 200 });
}

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as Body;
  const origem = req.headers.get("user-agent") || "respondi";
  if (!originOk(req, body)) {
    return NextResponse.json({ ok: false, reason: "invalid_secret" }, { status: 401 });
  }

  const tipo = slugTipo(body.tipo ?? body.formulario);
  const email = String(body.email ?? "").trim().toLowerCase() || null;
  const telDig = String(body.telefone ?? body.phone ?? body.whatsapp ?? body.number ?? "").replace(/\D/g, "");
  const u6 = telDig.length >= 6 ? telDig.slice(-6) : null;

  // Respostas: usa o objeto explícito ou tudo que não é campo de controle.
  const respostas =
    (body.respostas && typeof body.respostas === "object" && body.respostas) ||
    (body.answers && typeof body.answers === "object" && body.answers) ||
    Object.fromEntries(Object.entries(body).filter(([k]) => !CONTROLE.has(k)));
  const pontuacao = paraNumero(body.pontuacao ?? body.score);

  async function logWebhook(resultado: string) {
    try {
      await query(
        `insert into cs.webhook_log (origem, telefone_raw, telefone_norm, resultado, payload)
         values ($1, $2, $3, $4, $5)`,
        [`respondi/${tipo}`, telDig || null, u6, resultado, JSON.stringify(body ?? null)],
      );
    } catch (e) {
      log.error("falha ao gravar webhook_log", e);
    }
  }

  if (!email && !u6) {
    await logWebhook("sem_identificacao");
    return NextResponse.json({ ok: false, reason: "email ou telefone obrigatório" }, { status: 200 });
  }

  // Casa na esteira HM por e-mail (prioritário) ou últimos 6 dígitos do telefone.
  const aluno = await queryOne<{ comprador_id: string }>(
    `select comprador_id from cs.contatos_hm_kanban
      where ($1::text is not null and lower(email) = $1)
         or ($2::text is not null and right(regexp_replace(coalesce(telefone,''), '[^0-9]', '', 'g'), 6) = $2)
      order by (case when $1::text is not null and lower(email) = $1 then 0 else 1 end)
      limit 1`,
    [email, u6],
  );

  if (!aluno) {
    await logWebhook("aluno_nao_encontrado");
    log.info("respondi sem aluno HM correspondente", { tipo, email, u6 });
    return NextResponse.json({ ok: true, matched: false });
  }

  await query(
    `insert into cs.formularios (comprador_id, tipo, respostas, pontuacao, respondido_em)
     values ($1, $2, $3::jsonb, $4, now())
     on conflict (comprador_id, tipo)
     do update set respostas = excluded.respostas, pontuacao = excluded.pontuacao, respondido_em = now(), atualizado_em = now()`,
    [aluno.comprador_id, tipo, JSON.stringify(respostas ?? {}), pontuacao],
  );

  // Marca na timeline do card HM.
  await query(
    `insert into cs.interacoes (contato_hm_id, tipo, descricao, autor)
     select id, 'sistema', $2, 'respondi' from cs.contatos_hm where comprador_id = $1`,
    [aluno.comprador_id, `Respondeu o formulário (${tipo})`],
  );

  await logWebhook("matched");
  return NextResponse.json({ ok: true, matched: true, tipo });
}
