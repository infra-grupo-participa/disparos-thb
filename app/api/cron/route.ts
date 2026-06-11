import { NextResponse } from "next/server";
import { retomarTravados } from "@/lib/services/disparo";
import { sincronizarTagsEdicao } from "@/lib/services/contato";
import { sincronizarLote } from "@/lib/sync-conversas";
import { logger } from "@/lib/log";

export const runtime = "nodejs";
export const maxDuration = 300;
const log = logger("cron");

// Tarefas agendadas. Chamado por um cron externo (Hostinger cron / cron-job.org)
// batendo neste endpoint com header `x-cron-secret` ou `?secret=` == CRON_SECRET.
// Idempotente: pode rodar quantas vezes quiser.
//   - retoma disparos que ficaram travados (resiliência)
//   - sincroniza um lote de conversas da Unnichat (automação)
function autorizado(req: Request): boolean {
  const segredo = process.env.CRON_SECRET;
  if (!segredo) return false; // sem segredo configurado → não executa
  const recebido = req.headers.get("x-cron-secret") || new URL(req.url).searchParams.get("secret");
  return recebido === segredo;
}

async function executar() {
  const retomados = await retomarTravados(15);
  const tagsEdicao = await sincronizarTagsEdicao();
  const sync = await sincronizarLote(60);
  log.info("cron executado", { retomados, tags_edicao: tagsEdicao, sync_proc: sync.processados, sync_novas: sync.mensagens_novas, sync_restantes: sync.restantes });
  return { retomados, tagsEdicao, sync };
}

export async function GET(req: Request) {
  if (!autorizado(req)) return NextResponse.json({ ok: false }, { status: 401 });
  return NextResponse.json({ ok: true, ...(await executar()) });
}

export async function POST(req: Request) {
  if (!autorizado(req)) return NextResponse.json({ ok: false }, { status: 401 });
  return NextResponse.json({ ok: true, ...(await executar()) });
}
