import { NextResponse } from "next/server";
import { guard } from "@/lib/guard";
import { eventoDe } from "@/lib/services/evento";
import { sincronizarLote } from "@/lib/sync-conversas";

export const runtime = "nodejs";
export const maxDuration = 300;

// Sincroniza um lote do histórico de conversas da Unnichat. O front chama em
// laço (?limite=) até `restantes = 0`. Lógica em lib/sync-conversas.ts.
export async function POST(req: Request) {
  // Portal do evento RESOLVIDO (cookie/query) contra a whitelist da conta (0145).
  const g = await guard({ portal: eventoDe(req) });
  if (!g.ok) return g.res;
  const limite = Number(new URL(req.url).searchParams.get("limite")) || 60;
  const resultado = await sincronizarLote(limite);
  return NextResponse.json({ ok: true, ...resultado });
}
