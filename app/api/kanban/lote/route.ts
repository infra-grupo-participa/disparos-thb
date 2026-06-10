import { NextResponse } from "next/server";
import { isAuthed } from "@/lib/auth";
import { query } from "@/lib/db";

export const runtime = "nodejs";

// POST /api/kanban/lote — ações em massa sobre a seleção do board.
// body: { compradorIds, addTag?, responsavel? }
export async function POST(req: Request) {
  if (!isAuthed()) return NextResponse.json({ ok: false }, { status: 401 });
  const b = (await req.json().catch(() => ({}))) as { compradorIds?: string[]; addTag?: string; responsavel?: string | null };
  if (!Array.isArray(b.compradorIds) || b.compradorIds.length === 0) {
    return NextResponse.json({ ok: false, reason: "compradorIds obrigatório" }, { status: 400 });
  }

  if (b.addTag && b.addTag.trim()) {
    await query(
      `update cs.contatos set tags = array_append(tags, $2), atualizado_em = now()
        where comprador_id = any($1::uuid[]) and not ($2 = any(tags))`,
      [b.compradorIds, b.addTag.trim()],
    );
  }
  if (b.responsavel !== undefined) {
    await query(
      `update cs.contatos set responsavel = $2, atualizado_em = now() where comprador_id = any($1::uuid[])`,
      [b.compradorIds, b.responsavel || null],
    );
  }

  return NextResponse.json({ ok: true });
}
