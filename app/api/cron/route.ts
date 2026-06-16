import { NextResponse } from "next/server";
import { retomarTravados } from "@/lib/services/disparo";
import { sincronizarStatusRecentes } from "@/lib/services/disparo-status";
import { sincronizarTagsEdicao } from "@/lib/services/contato";
import { sincronizarLote } from "@/lib/sync-conversas";
import { sincronizarCampanhasEmail, retomarTravadosEmail, sincronizarEngajamentoEmail } from "@/lib/services/email";
import { sincronizarAutomacoes } from "@/lib/services/ac-automacoes";
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
  // Mantém o status de entrega (Meta) fresco para o painel de saúde do disparo.
  const statusEntrega = await sincronizarStatusRecentes(80).catch((e) => {
    log.error("falha ao sincronizar status de entrega", e);
    return { atualizados: 0, verificados: 0 };
  });
  // Métricas de e-mail (ActiveCampaign): polling das campanhas recentes. Não
  // derruba o cron se o AC estiver indisponível ou sem credencial configurada.
  const email = await sincronizarCampanhasEmail().catch((e) => {
    log.error("falha ao sincronizar campanhas de e-mail", e);
    return { sincronizadas: 0, casadas: 0, varridas: 0, total: 0 };
  });
  // Resiliência do disparo de e-mail: retoma o que ficou travado no meio.
  const emailRetomados = await retomarTravadosEmail(15).catch((e) => {
    log.error("falha ao retomar disparos de e-mail", e);
    return 0;
  });
  // Engajamento de e-mail por pessoa: lote incremental (espelha o status da Meta).
  const emailEngaj = await sincronizarEngajamentoEmail(60).catch((e) => {
    log.error("falha ao sincronizar engajamento de e-mail", e);
    return { verificados: 0, encontrados: 0 };
  });
  // Raio-x da automação: cableamento tag → automação do AC (com guarda de
  // frescor; só varre o AC se o cache estiver velho). Base do bloqueio de
  // disparo "às cegas" e do veredito na escolha do template.
  const automacoes = await sincronizarAutomacoes("HT").catch((e) => {
    log.error("falha ao sincronizar automações do AC", e);
    return { ok: false, automacoes: 0, gatilhos: 0 };
  });
  log.info("cron executado", { retomados, tags_edicao: tagsEdicao, sync_proc: sync.processados, sync_novas: sync.mensagens_novas, sync_restantes: sync.restantes, status_atualizados: statusEntrega.atualizados, email_sincronizadas: email.sincronizadas, email_casadas: email.casadas, email_retomados: emailRetomados, email_engaj: emailEngaj.verificados, ac_automacoes: automacoes.automacoes });
  return { retomados, tagsEdicao, sync, statusEntrega, email, emailRetomados, emailEngaj, automacoes };
}

export async function GET(req: Request) {
  if (!autorizado(req)) return NextResponse.json({ ok: false }, { status: 401 });
  return NextResponse.json({ ok: true, ...(await executar()) });
}

export async function POST(req: Request) {
  if (!autorizado(req)) return NextResponse.json({ ok: false }, { status: 401 });
  return NextResponse.json({ ok: true, ...(await executar()) });
}
