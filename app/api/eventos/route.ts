import { NextResponse } from "next/server";
import { query, queryOne } from "@/lib/db";
import { normalizePhone } from "@/lib/phone";
import { addTagEmLote } from "@/lib/services/contato";
import { logger } from "@/lib/log";

export const runtime = "nodejs";
const log = logger("eventos");

// Webhook de EVENTOS externos (automações do Make): marca o aluno com uma tag
// conforme o evento e, nos formulários, guarda as respostas em cs.formularios.
// Match por telefone (normalizado) ou e-mail no cs.contatos_ht. Idempotente.
type Evento = { tag: string; descricao: (ctx: { grupo?: string }) => string; formulario?: "matricula" | "ficha_hm" };
const EVENTOS: Record<string, Evento> = {
  entrou_grupo: { tag: "No grupo", descricao: (c) => `Entrou no grupo do WhatsApp${c.grupo ? ` (${c.grupo})` : ""}` },
  respondeu_matricula: { tag: "Respondeu qualificação", descricao: () => "Respondeu o formulário de qualificação", formulario: "matricula" },
  respondeu_ficha_hm: { tag: "Respondeu ficha HM", descricao: () => "Respondeu a ficha de interesse HM", formulario: "ficha_hm" },
};

type Body = {
  secret?: string;
  evento?: string;
  telefone?: string;
  number?: string;
  email?: string;
  grupo?: string;
  respostas?: Record<string, unknown>;
  pontuacao?: number | string;
  telefones?: string[];
};

function originOk(req: Request, body: Body): boolean {
  const secret = process.env.EVENTOS_SECRET || process.env.WEBHOOK_SECRET;
  if (!secret) return true; // sem segredo configurado → não bloqueia (dev)
  const recebido = req.headers.get("x-eventos-secret") || new URL(req.url).searchParams.get("secret") || body.secret;
  return recebido === secret;
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
  if (!originOk(req, body)) {
    return NextResponse.json({ ok: false, reason: "invalid_secret" }, { status: 401 });
  }

  const evento = String(body.evento ?? "").trim();
  const cfg = EVENTOS[evento];
  if (!cfg) {
    return NextResponse.json({ ok: false, reason: "evento desconhecido", aceitos: Object.keys(EVENTOS) }, { status: 400 });
  }

  // Modo LOTE: { evento, telefones: [...] } — marca a tag para TODOS numa só query.
  // Casa pelos ÚLTIMOS 6 DÍGITOS (chave estável que o analista usa), robusto
  // contra inconsistências de DDD / 55 / nono dígito nos telefones.
  if (Array.isArray(body.telefones)) {
    const u6 = Array.from(new Set(
      body.telefones.map((t) => String(t ?? "").replace(/\D/g, "")).filter((t) => t.length >= 6).map((t) => t.slice(-6)),
    ));
    if (u6.length === 0) return NextResponse.json({ ok: true, marcados: 0, recebidos: 0 });
    const r = await query<{ id: string }>(
      `update cs.contatos ct
          set tags = array_append(ct.tags, $2), atualizado_em = now()
         from cs.contatos_ht v
        where v.comprador_id = ct.comprador_id
          and right(regexp_replace(coalesce(v.telefone, ''), '[^0-9]', '', 'g'), 6) = any($1::text[])
          and not ($2 = any(ct.tags))
        returning ct.id`,
      [u6, cfg.tag],
    );
    return NextResponse.json({ ok: true, marcados: r.length, recebidos: u6.length });
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
    [contato.comprador_id, cfg.descricao({ grupo: body.grupo })],
  );

  // Formulário: guarda as respostas + pontuação (upsert por comprador+tipo).
  if (cfg.formulario) {
    await query(
      `insert into cs.formularios (comprador_id, tipo, respostas, pontuacao, respondido_em)
       values ($1, $2, $3::jsonb, $4, now())
       on conflict (comprador_id, tipo)
       do update set respostas = excluded.respostas, pontuacao = excluded.pontuacao, respondido_em = now(), atualizado_em = now()`,
      [contato.comprador_id, cfg.formulario, JSON.stringify(body.respostas ?? {}), paraNumero(body.pontuacao)],
    );
  }

  log.info("evento aplicado", { evento, tag: cfg.tag, formulario: cfg.formulario, compradorId: contato.comprador_id });
  return NextResponse.json({ ok: true, matched: true, tag: cfg.tag });
}
