import { NextResponse } from "next/server";
import { isAuthed } from "@/lib/auth";
import { query, queryOne } from "@/lib/db";
import { eventoDe } from "@/lib/services/evento";

export const runtime = "nodejs";

export async function GET(req: Request) {
  if (!isAuthed()) return NextResponse.json({ ok: false }, { status: 401 });
  // ?canal=email lista só os templates de e-mail; sem o filtro, mantém o
  // comportamento legado (todos do evento — na prática, os de WhatsApp).
  const canal = new URL(req.url).searchParams.get("canal");
  const templates = await query(
    `select t.id, t.nome, t.unnichat_id, t.categoria, t.variaveis, t.preview,
            t.ativo, t.estagio_sugerido_id, t.canal, t.ac_tag_id, e.nome as estagio_sugerido_nome
       from cs.templates t
       left join cs.estagios e on e.id = t.estagio_sugerido_id
      where t.evento = $1 and ($2::text is null or t.canal = $2)
      order by t.ativo desc, t.criado_em desc`,
    [eventoDe(req), canal],
  );
  return NextResponse.json({ ok: true, templates });
}

export async function POST(req: Request) {
  if (!isAuthed()) return NextResponse.json({ ok: false }, { status: 401 });
  const evento = eventoDe(req);
  const b = await req.json().catch(() => ({}));
  const { nome, unnichat_id, categoria, variaveis, preview, estagio_sugerido_id, ativo, ac_tag_id } = b as Record<string, unknown>;
  const canal = b.canal === "email" ? "email" : "whatsapp";

  // E-mail: a "tag do AC" faz o papel do unnichat_id. WhatsApp: exige unnichat_id.
  if (!nome) {
    return NextResponse.json({ ok: false, reason: "nome é obrigatório" }, { status: 400 });
  }
  if (canal === "email" && !ac_tag_id) {
    return NextResponse.json({ ok: false, reason: "template de e-mail exige ac_tag_id (tag do AC)" }, { status: 400 });
  }
  if (canal === "whatsapp" && !unnichat_id) {
    return NextResponse.json({ ok: false, reason: "nome e unnichat_id são obrigatórios" }, { status: 400 });
  }

  const row = await queryOne(
    `insert into cs.templates (nome, unnichat_id, categoria, variaveis, preview, estagio_sugerido_id, ativo, evento, canal, ac_tag_id)
     values ($1,$2,$3,$4,$5,$6,coalesce($7,true),$8,$9,$10)
     returning id`,
    [
      String(nome),
      unnichat_id ? String(unnichat_id) : "",
      categoria ? String(categoria) : null,
      Number.isFinite(Number(variaveis)) ? Number(variaveis) : 0,
      preview ? String(preview) : null,
      estagio_sugerido_id ? Number(estagio_sugerido_id) : null,
      typeof ativo === "boolean" ? ativo : null,
      evento,
      canal,
      ac_tag_id ? String(ac_tag_id) : null,
    ],
  );
  return NextResponse.json({ ok: true, id: (row as { id: string } | null)?.id });
}

export async function PATCH(req: Request) {
  if (!isAuthed()) return NextResponse.json({ ok: false }, { status: 401 });
  const b = await req.json().catch(() => ({}));
  const { id, ativo } = b as Record<string, unknown>;

  if (!id || typeof ativo !== "boolean") {
    return NextResponse.json({ ok: false, reason: "id e ativo (boolean) são obrigatórios" }, { status: 400 });
  }

  const row = await queryOne(
    `update cs.templates set ativo = $2 where id = $1 returning id, ativo`,
    [String(id), ativo],
  );
  if (!row) {
    return NextResponse.json({ ok: false, reason: "template não encontrado" }, { status: 404 });
  }
  return NextResponse.json({ ok: true, template: row });
}
