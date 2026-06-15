import { NextResponse } from "next/server";
import { isAuthed } from "@/lib/auth";
import { sincronizarCampanhasEmail } from "@/lib/services/email";
import { getCanal } from "@/lib/services/canais";
import { listarCampanhas } from "@/lib/activecampaign";
import { logger } from "@/lib/log";

export const runtime = "nodejs";
export const maxDuration = 300;
const log = logger("email-sync");

// GET /api/email/sync — diagnóstico do setup do ActiveCampaign (não expõe os
// valores, só se estão presentes). Confirma, antes de tentar o sync, se as envs
// chegaram ao runtime. Um canal em cs.canais_disparo (provider activecampaign)
// também serve como credencial — por isso pode funcionar mesmo sem as envs.
export async function GET() {
  if (!isAuthed()) return NextResponse.json({ ok: false }, { status: 401 });
  const url_configurada = Boolean(process.env.ACTIVECAMPAIGN_API_URL);
  const token_configurado = Boolean(process.env.ACTIVECAMPAIGN_API_TOKEN);

  // Testa a CONEXÃO real (não só a env): puxa 1 campanha. conexao_ok=false com
  // erro = token inválido OU bloqueio de IP do servidor na conta do AC.
  let conexao_ok: boolean | null = null;
  let total_campanhas: number | null = null;
  let erro: string | undefined;
  if (url_configurada && token_configurado) {
    try {
      const canal = await getCanal("HT", "activecampaign");
      const r = await listarCampanhas({ limit: 1, cfg: canal });
      conexao_ok = r.ok;
      total_campanhas = r.ok ? r.total : null;
      if (!r.ok) erro = r.erro;
    } catch (e) {
      conexao_ok = false;
      erro = e instanceof Error ? e.message : "erro ao conectar no AC";
    }
  }

  return NextResponse.json({
    ok: true, url_configurada, token_configurado, conexao_ok, total_campanhas,
    ...(erro ? { erro } : {}),
  });
}

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
