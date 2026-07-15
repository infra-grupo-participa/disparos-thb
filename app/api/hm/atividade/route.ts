import { NextResponse } from "next/server";
import { isAuthed } from "@/lib/auth";
import { atividadeHm } from "@/lib/services/hm-atividade";

export const runtime = "nodejs";

// GET /api/hm/atividade?de=YYYY-MM-DD&ate=YYYY-MM-DD — o que cada colaborador
// fez na esteira HM no período. Datas opcionais; `ate` é exclusivo (o dia
// seguinte ao último que se quer incluir vem tratado no cliente).
export async function GET(req: Request) {
  if (!isAuthed()) return NextResponse.json({ ok: false }, { status: 401 });
  const sp = new URL(req.url).searchParams;
  const r = await atividadeHm({ de: sp.get("de"), ate: sp.get("ate") });
  return NextResponse.json({ ok: true, ...r });
}
