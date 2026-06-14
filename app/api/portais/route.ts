import { NextResponse } from "next/server";
import { isAuthed } from "@/lib/auth";
import { query } from "@/lib/db";
import { eventoDe } from "@/lib/services/evento";

export const runtime = "nodejs";

// GET /api/portais — eventos (portais) ativos para o seletor de contexto no topo.
// Retorna também o evento atualmente selecionado (cookie/querystring).
export async function GET(req: Request) {
  if (!isAuthed()) return NextResponse.json({ ok: false }, { status: 401 });
  const eventos = await query(
    `select chave, nome, cor from cs.eventos where ativo order by ordem, nome`,
  );
  return NextResponse.json({ ok: true, eventos, atual: eventoDe(req) });
}
