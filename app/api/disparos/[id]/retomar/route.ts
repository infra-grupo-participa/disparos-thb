import { NextResponse } from "next/server";
import { podeDisparar } from "@/lib/auth";
import { guard } from "@/lib/guard";
import { queryOne } from "@/lib/db";
import { logger } from "@/lib/log";
import { retomarDisparo } from "@/lib/services/disparo";
import { eventoDe } from "@/lib/services/evento";

export const runtime = "nodejs";
export const maxDuration = 300;
const log = logger("disparo-retomar");

// POST /api/disparos/[id]/retomar — retomada manual pelo operador. Mesma trava de
// papel do /api/send (só quem pode disparar naquele evento retoma) e confere que
// o disparo pertence ao evento ativo, para não reprocessar campanha de outro
// portal a partir daqui.
export async function POST(req: Request, { params }: { params: { id: string } }) {
  const evento = eventoDe(req);
  // Portal do evento resolvido contra a whitelist da conta (0145).
  const g = await guard({ portal: evento });
  if (!g.ok) return g.res;
  const sessao = g.sessao;
  if (!podeDisparar(sessao.papel, evento)) {
    return NextResponse.json({ ok: false, reason: "sem_permissao_disparo" }, { status: 403 });
  }

  const dono = await queryOne<{ evento: string }>(
    `select evento from cs.disparos where id = $1`,
    [params.id],
  );
  if (!dono) return NextResponse.json({ ok: false, reason: "não encontrado" }, { status: 404 });
  if (dono.evento !== evento) {
    return NextResponse.json({ ok: false, reason: "disparo de outro evento" }, { status: 403 });
  }

  const r = await retomarDisparo(params.id);
  if (!r.ok) return NextResponse.json({ ok: false, reason: r.motivo }, { status: 409 });

  log.info("retomada manual", { disparoId: params.id, operador: sessao.nome, pendentes: r.pendentes });
  return NextResponse.json({ ok: true, pendentes: r.pendentes });
}
