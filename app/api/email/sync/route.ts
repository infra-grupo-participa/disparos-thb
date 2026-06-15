import { NextResponse } from "next/server";
import { isAuthed } from "@/lib/auth";
import { sincronizarCampanhasEmail } from "@/lib/services/email";
import { logger } from "@/lib/log";

export const runtime = "nodejs";
export const maxDuration = 300;
const log = logger("email-sync");

// POST /api/email/sync — sincroniza as métricas das campanhas do AC sob demanda
// (botão "Atualizar" no painel). Espelha POST /api/disparos/[id]/status. O cron
// já roda o padrão periodicamente; aqui um operador pode forçar uma passada e,
// com ?paginas=N, ampliar o alcance (backfill do histórico). Autenticado.
export async function POST(req: Request) {
  if (!isAuthed()) return NextResponse.json({ ok: false }, { status: 401 });
  const paginasParam = Number(new URL(req.url).searchParams.get("paginas"));
  const paginas = Number.isFinite(paginasParam) && paginasParam > 0 ? Math.min(paginasParam, 20) : undefined;
  try {
    const r = await sincronizarCampanhasEmail(paginas);
    return NextResponse.json({ ok: true, ...r });
  } catch (e) {
    log.error("falha ao sincronizar campanhas de e-mail", e);
    return NextResponse.json({ ok: false, reason: e instanceof Error ? e.message : "erro" }, { status: 500 });
  }
}
