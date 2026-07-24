import { NextResponse } from "next/server";
import { getSessao, podeDisparar } from "@/lib/auth";
import { query, queryOne } from "@/lib/db";
import { logger } from "@/lib/log";
import { retomarDisparo } from "@/lib/services/disparo";
import { eventoDe } from "@/lib/services/evento";

export const runtime = "nodejs";
export const maxDuration = 300;
const log = logger("disparo-reenviar");

// POST /api/disparos/[id]/reenviar-caidos — reenvia SÓ o que não chegou: os que
// nunca saíram (fila do disparo travado) + os que a Meta recusou (status_meta
// 'failed'). NÃO toca em quem foi 'sent'/'delivered'/'read' — reenviar para quem
// já recebeu geraria mensagem duplicada. Reseta os 'failed' para a fila e retoma
// o disparo pelo motor normal (mesmo template, guarda anti-ban, idempotente).
export async function POST(req: Request, { params }: { params: { id: string } }) {
  const sessao = await getSessao();
  if (!sessao) return NextResponse.json({ ok: false }, { status: 401 });
  const evento = eventoDe(req);
  if (!podeDisparar(sessao.papel, evento)) {
    return NextResponse.json({ ok: false, reason: "sem_permissao_disparo" }, { status: 403 });
  }

  const dono = await queryOne<{ evento: string }>(`select evento from cs.disparos where id = $1`, [params.id]);
  if (!dono) return NextResponse.json({ ok: false, reason: "não encontrado" }, { status: 404 });
  if (dono.evento !== evento) return NextResponse.json({ ok: false, reason: "disparo de outro evento" }, { status: 403 });

  // Devolve os que a Meta recusou para a fila (enviado=false), limpando o status
  // e o erro para uma nova tentativa limpa.
  const resetados = await query<{ id: string }>(
    `update cs.disparo_contatos
        set enviado = false, enviado_em = null, status_meta = null, erro_meta_code = null, erro = null
      where disparo_id = $1 and enviado = true and status_meta = 'failed'
      returning id`,
    [params.id],
  );

  const r = await retomarDisparo(params.id);
  if (!r.ok) {
    return NextResponse.json({ ok: false, reason: r.motivo }, { status: 409 });
  }

  log.info("reenvio dos que não chegaram", { disparoId: params.id, operador: sessao.nome, falhas_resetadas: resetados.length, na_fila: r.pendentes });
  return NextResponse.json({ ok: true, reenviando: r.pendentes, falhas_resetadas: resetados.length });
}
