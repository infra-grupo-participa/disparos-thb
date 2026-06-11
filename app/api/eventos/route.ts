import { NextResponse } from "next/server";
import { query, queryOne } from "@/lib/db";
import { normalizePhone } from "@/lib/phone";
import { addTagEmLote } from "@/lib/services/contato";
import { logger } from "@/lib/log";

export const runtime = "nodejs";
const log = logger("eventos");

// Webhook de EVENTOS externos (automações do Make): marca o aluno com uma tag
// conforme o evento. Hoje: entrou no grupo do WhatsApp / respondeu o formulário.
// Match por telefone (normalizado) ou e-mail no cs.contatos_ht. Idempotente.
const TAG_POR_EVENTO: Record<string, { tag: string; descricao: (grupo?: string) => string }> = {
  entrou_grupo: { tag: "No grupo", descricao: (g) => `Entrou no grupo do WhatsApp${g ? ` (${g})` : ""}` },
  respondeu_form: { tag: "Respondeu form", descricao: () => "Respondeu o formulário" },
};

type Body = { secret?: string; evento?: string; telefone?: string; number?: string; email?: string; grupo?: string };

function originOk(req: Request, body: Body): boolean {
  const secret = process.env.EVENTOS_SECRET || process.env.WEBHOOK_SECRET;
  if (!secret) return true; // sem segredo configurado → não bloqueia (dev)
  const recebido = req.headers.get("x-eventos-secret") || new URL(req.url).searchParams.get("secret") || body.secret;
  return recebido === secret;
}

export async function GET() {
  return new Response("OK", { status: 200 });
}

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as Body;
  if (!originOk(req, body)) {
    return NextResponse.json({ ok: false, reason: "invalid_secret" }, { status: 401 });
  }

  const evento = String(body.evento ?? "").trim();
  const cfg = TAG_POR_EVENTO[evento];
  if (!cfg) {
    return NextResponse.json({ ok: false, reason: "evento desconhecido", aceitos: Object.keys(TAG_POR_EVENTO) }, { status: 400 });
  }

  const tel = normalizePhone(body.telefone ?? body.number ?? null);
  const email = String(body.email ?? "").trim().toLowerCase() || null;
  if (!tel && !email) {
    return NextResponse.json({ ok: false, reason: "telefone ou email obrigatório" }, { status: 400 });
  }

  // Acha o comprador HT por telefone (normalizado) OU e-mail.
  const contato = await queryOne<{ comprador_id: string }>(
    `select comprador_id from cs.contatos_ht
      where ($1::text is not null and cs.normalizar_telefone(telefone) = $1)
         or ($2::text is not null and lower(email) = $2)
      limit 1`,
    [tel, email],
  );
  if (!contato) {
    log.info("evento sem aluno correspondente", { evento, tel, email });
    return NextResponse.json({ ok: true, matched: false });
  }

  await addTagEmLote([contato.comprador_id], cfg.tag);
  await query(
    `insert into cs.interacoes (contato_id, tipo, descricao, autor)
     select id, 'sistema', $2, 'make' from cs.contatos where comprador_id = $1`,
    [contato.comprador_id, cfg.descricao(body.grupo)],
  );

  log.info("tag aplicada por evento", { evento, tag: cfg.tag, compradorId: contato.comprador_id });
  return NextResponse.json({ ok: true, matched: true, tag: cfg.tag });
}
