import { NextResponse } from "next/server";
import { isAuthed } from "@/lib/auth";
import { sincronizarLote } from "@/lib/sync-conversas";

export const runtime = "nodejs";
export const maxDuration = 300;

// Sincroniza um lote do histórico de conversas da Unnichat. O front chama em
// laço (?limite=) até `restantes = 0`. Lógica em lib/sync-conversas.ts.
export async function POST(req: Request) {
  if (!isAuthed()) return NextResponse.json({ ok: false }, { status: 401 });
  const limite = Number(new URL(req.url).searchParams.get("limite")) || 60;
  const resultado = await sincronizarLote(limite);
  return NextResponse.json({ ok: true, ...resultado });
}
