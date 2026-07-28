import { NextResponse } from "next/server";
import { guard } from "@/lib/guard";
import { filaInbox } from "@/lib/services/inbox-fila";
import { eventoDe } from "@/lib/services/evento";

export const runtime = "nodejs";

// GET /api/inbox — fila de conversas do evento ativo: leads que já responderam.
// Pendentes sobem ao topo, com quem espera há MAIS tempo primeiro (fila de SLA);
// ?status filtra a fila; ?disparo lista quem recebeu aquele disparo.
//
// A montagem da fila (colunas, ordenação, recorte de escopo) vive em
// lib/services/inbox-fila.ts — compartilhada com POST /api/inbox/sync, que
// devolve a fila junto do sync (?fila=1) para o cliente fazer UMA chamada por
// tick. O contrato da linha de conversa está documentado lá.
export async function GET(req: Request) {
  // Portal do evento RESOLVIDO (cookie/query) contra a whitelist da conta (0145).
  const g = await guard({ portal: eventoDe(req) });
  if (!g.ok) return g.res;
  const sp = new URL(req.url).searchParams;
  const evento = eventoDe(req);

  const { conversas, pendentes } = await filaInbox(g.sessao, evento, {
    status: sp.get("status"),      // pendente | resolvido
    disparoId: sp.get("disparo"),  // ver só os contatos de um disparo
  });
  return NextResponse.json({ ok: true, conversas, pendentes });
}
