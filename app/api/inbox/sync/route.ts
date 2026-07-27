import { NextResponse } from "next/server";
import { isAuthed } from "@/lib/auth";
import { sincronizarRespostasInboxOnDemand } from "@/lib/services/inbox-sync";
import { eventoDe } from "@/lib/services/evento";

export const runtime = "nodejs";
export const maxDuration = 60;

// POST /api/inbox/sync — o inbox aberto puxa as respostas do Unnichat sozinho.
// Chamado pelo polling do front; a trava de servidor garante que o Unnichat só é
// consultado ~1x a cada 20s por evento, por mais operadores que estejam online.
// Age nos eventos que recebem resposta por disparo: SEM/CNHF e agora HM (Fase 2,
// o HM passou a disparar). Só ON-DEMAND (inbox aberto) — o HM NÃO entra no cron
// (EVENTOS_PADRAO) enquanto usar o número compartilhado, para não puxar respostas
// de outro evento no mesmo número. HT segue com outro fluxo.
const ATIVACAO = new Set(["SEM", "CNHF", "HM"]);

export async function POST(req: Request) {
  if (!isAuthed()) return NextResponse.json({ ok: false }, { status: 401 });
  const evento = eventoDe(req);
  if (!ATIVACAO.has(evento)) return NextResponse.json({ ok: true, executou: false, novas: 0 });

  const r = await sincronizarRespostasInboxOnDemand([evento]);
  return NextResponse.json({ ok: true, ...r });
}
