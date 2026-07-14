import { NextResponse } from "next/server";
import { retomarTravados } from "@/lib/services/disparo";
import { sincronizarStatusRecentes } from "@/lib/services/disparo-status";
import { sincronizarTagsEdicao } from "@/lib/services/contato";
import { sincronizarLote } from "@/lib/sync-conversas";
import { sincronizarCampanhasEmail, retomarTravadosEmail, sincronizarEngajamentoEmail, sincronizarOptOutEmail } from "@/lib/services/email";
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
  // Retoma o que foi ABANDONADO (heartbeat parado), não o que está demorando.
  // O disparo vivo se defende sozinho: recusa a reivindicação (ver 0074).
  const retomados = await retomarTravados();
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
  // Resiliência do disparo de e-mail: retoma só o que foi ABANDONADO (heartbeat
  // parado). Um disparo vivo recusa a reivindicação — senão sairiam DUAS
  // campanhas no AC e o contato receberia o e-mail duas vezes (ver 0080).
  const emailRetomados = await retomarTravadosEmail().catch((e) => {
    log.error("falha ao retomar disparos de e-mail", e);
    return 0;
  });
  // Descadastro do e-mail vira opt-out AQUI. A campanha direta envia para uma
  // lista técnica descartável, então o "unsubscribe" morreria nela; trazido para
  // cs.contatos.opt_out, ele passa a valer também para o WhatsApp.
  const emailOptOut = await sincronizarOptOutEmail().catch((e) => {
    log.error("falha ao sincronizar descadastros de e-mail", e);
    return { listas: 0, novos: 0 };
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
  log.info("cron executado", { retomados, tags_edicao: tagsEdicao, sync_proc: sync.processados, sync_novas: sync.mensagens_novas, sync_restantes: sync.restantes, status_atualizados: statusEntrega.atualizados, email_sincronizadas: email.sincronizadas, email_casadas: email.casadas, email_retomados: emailRetomados, email_engaj: emailEngaj.verificados, email_optout_novos: emailOptOut.novos, ac_automacoes: automacoes.automacoes });
  return { retomados, tagsEdicao, sync, statusEntrega, email, emailRetomados, emailEngaj, emailOptOut, automacoes };
}

export async function GET(req: Request) {
  if (!autorizado(req)) return NextResponse.json({ ok: false }, { status: 401 });
  return NextResponse.json({ ok: true, ...(await executar()) });
}

export async function POST(req: Request) {
  if (!autorizado(req)) return NextResponse.json({ ok: false }, { status: 401 });
  return NextResponse.json({ ok: true, ...(await executar()) });
}
