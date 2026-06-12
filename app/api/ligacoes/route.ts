import { NextResponse } from "next/server";
import { isAuthed } from "@/lib/auth";
import { parseBody, LigacaoRegistrarSchema } from "@/lib/validators";
import { registrarLigacao, listarPorComprador } from "@/lib/services/ligacao";

export const runtime = "nodejs";

// GET /api/ligacoes?comprador_id=... — histórico de ligações do contato.
export async function GET(req: Request) {
  if (!isAuthed()) return NextResponse.json({ ok: false }, { status: 401 });
  const compradorId = new URL(req.url).searchParams.get("comprador_id");
  if (!compradorId) return NextResponse.json({ ok: false, reason: "comprador_id obrigatório" }, { status: 400 });
  const ligacoes = await listarPorComprador(compradorId);
  return NextResponse.json({ ok: true, ligacoes });
}

// POST /api/ligacoes — registra uma ligação (modo manual / tel:).
export async function POST(req: Request) {
  if (!isAuthed()) return NextResponse.json({ ok: false }, { status: 401 });
  const p = await parseBody(req, LigacaoRegistrarSchema);
  if (!p.ok) return p.res;
  const ligacao = await registrarLigacao(p.data);
  return NextResponse.json({ ok: true, ligacao });
}
