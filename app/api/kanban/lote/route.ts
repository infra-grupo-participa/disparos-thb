import { NextResponse } from "next/server";
import { isAuthed } from "@/lib/auth";
import { parseBody, KanbanLoteSchema } from "@/lib/validators";
import { addTagEmLote, setResponsavel } from "@/lib/services/contato";

export const runtime = "nodejs";

// POST /api/kanban/lote — ações em massa sobre a seleção do board.
// body: { compradorIds, addTag?, responsavel? }
export async function POST(req: Request) {
  if (!isAuthed()) return NextResponse.json({ ok: false }, { status: 401 });
  const p = await parseBody(req, KanbanLoteSchema);
  if (!p.ok) return p.res;
  const b = p.data;

  if (b.addTag && b.addTag.trim()) await addTagEmLote(b.compradorIds, b.addTag.trim());
  if (b.responsavel !== undefined) await setResponsavel(b.compradorIds, b.responsavel || null);

  return NextResponse.json({ ok: true });
}
