import { NextResponse } from "next/server";
import { guard } from "@/lib/guard";
import { query } from "@/lib/db";
import { eventoDe } from "@/lib/services/evento";

export const runtime = "nodejs";

// GET /api/portais — eventos (portais) ativos para o seletor de contexto no topo.
// Retorna também o evento atualmente selecionado (cookie/querystring).
// SÓ sessão, sem gate de portal (de propósito): é por aqui que o usuário
// descobre a que tem acesso — o gate por portal aqui trancaria o seletor.
export async function GET(req: Request) {
  const g = await guard();
  if (!g.ok) return g.res;
  const eventos = await query(
    `select chave, nome, cor from cs.eventos where ativo order by ordem, nome`,
  );
  return NextResponse.json({ ok: true, eventos, atual: eventoDe(req) });
}
