import { NextResponse } from "next/server";
import { isAuthed } from "@/lib/auth";
import { sincronizarRespostasInboxOnDemand } from "@/lib/services/inbox-sync";
import { eventoDe } from "@/lib/services/evento";

export const runtime = "nodejs";
export const maxDuration = 60;

// POST /api/inbox/sync — o inbox aberto puxa as respostas do Unnichat sozinho.
// Chamado pelo polling do front; a trava de servidor garante que o Unnichat só é
// consultado ~1x a cada 20s por evento, por mais operadores que estejam online.
// Só age nos eventos de ativação (SEM/CNHF) — é onde as respostas entram por
// disparo; HT/HM têm outros fluxos.
const ATIVACAO = new Set(["SEM", "CNHF"]);

export async function POST(req: Request) {
  if (!isAuthed()) return NextResponse.json({ ok: false }, { status: 401 });
  const evento = eventoDe(req);
  if (!ATIVACAO.has(evento)) return NextResponse.json({ ok: true, executou: false, novas: 0 });

  const r = await sincronizarRespostasInboxOnDemand([evento]);
  return NextResponse.json({ ok: true, ...r });
}
