import { NextResponse } from "next/server";
import { logger } from "@/lib/log";
import { atualizarPorProviderCallId } from "@/lib/services/ligacao";

export const runtime = "nodejs";

const log = logger("ligacoes:callback");

// Webhook do provedor (Nvoip) — completa uma ligação iniciada pelo discador.
// Stub defensivo: aceita os nomes de campo mais comuns e atualiza pelo
// provider_call_id. Ajustar ao payload exato da Nvoip quando a conta existir.
export async function POST(req: Request) {
  const body = await req.json().catch(() => ({} as Record<string, unknown>));
  const b = body as Record<string, unknown>;

  const callId = String(b.uuid ?? b.id ?? b.call_id ?? b.callId ?? b.identificador ?? "");
  if (!callId) {
    log.warn("callback sem identificador de chamada", { body: b });
    return NextResponse.json({ ok: true }); // 200 p/ não gerar retry infinito
  }

  // Mapeia status/resultado do provedor → nosso enum.
  const rawStatus = String(b.status ?? b.situacao ?? "").toLowerCase();
  const resultado =
    /atend|answer|complet/.test(rawStatus) ? "atendeu" :
    /ocup|busy/.test(rawStatus) ? "ocupado" :
    /caixa|voicemail/.test(rawStatus) ? "caixa_postal" :
    /no.?answer|nao.?atend|sem.?resp|fail|falh/.test(rawStatus) ? "nao_atendeu" :
    undefined;

  const dur = Number(b.duracao ?? b.duration ?? b.duracao_segundos ?? b.billsec ?? 0);
  const gravacao = (b.url_gravacao ?? b.gravacao ?? b.recording_url ?? b.record_url) as string | undefined;

  await atualizarPorProviderCallId(callId, {
    status: "concluida",
    ...(resultado ? { resultado } : {}),
    ...(dur > 0 ? { duracaoSeg: Math.round(dur) } : {}),
    ...(gravacao ? { urlGravacao: String(gravacao) } : {}),
  });

  log.info("ligação atualizada via webhook", { callId, resultado, dur });
  return NextResponse.json({ ok: true });
}
