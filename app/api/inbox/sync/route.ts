import { NextResponse } from "next/server";
import { guard } from "@/lib/guard";
import { sincronizarRespostasInboxOnDemand } from "@/lib/services/inbox-sync";
import { filaInbox, filaInboxHm } from "@/lib/services/inbox-fila";
import { eventoDe } from "@/lib/services/evento";

export const runtime = "nodejs";
export const maxDuration = 60;

// POST /api/inbox/sync — o inbox aberto puxa as respostas do Unnichat sozinho.
// Chamado pelo polling do front; a trava (memória + cs.sync_controle, 0147)
// garante que o Unnichat só é consultado ~1x a cada 20s por evento, por mais
// operadores/instâncias que existam.
//
// ===== CONTRATO (para o cliente do inbox) ====================================
// POST /api/inbox/sync?evento=<EV>[&fila=1][&status=pendente|resolvido][&disparo=<id>]
//
// Resposta sempre: { ok: true, executou: boolean, novas: number }
//   executou=false quando outro tick/instância já sincronizou nos últimos ~20s
//   (não é erro; a fila devolvida está atualizada do mesmo jeito).
//
// Com `fila=1` a resposta TAMBÉM traz { conversas, pendentes } — exatamente o
// mesmo formato de GET /api/inbox (ou de GET /api/hm/inbox quando evento=HM),
// respeitando os filtros status/disparo. Ou seja: o cliente pode fazer UMA
// chamada por tick (este POST com fila=1) em vez de POST sync + GET fila.
// A fila é montada DEPOIS do sync, então já reflete as respostas recém-puxadas.
// O formato da linha de conversa está documentado em lib/services/inbox-fila.ts.
// ============================================================================
//
// Age nos eventos que recebem resposta por disparo: SEM/CNHF e HM (Fase 2).
// Só ON-DEMAND (inbox aberto) — o HM NÃO entra no cron (EVENTOS_PADRAO)
// enquanto usar o número compartilhado. HT segue outro fluxo (sync pulado,
// mas fila=1 continua funcionando — vira só "me dá a fila").
const ATIVACAO = new Set(["SEM", "CNHF", "HM"]);

export async function POST(req: Request) {
  // Portal do evento RESOLVIDO (cookie/query) contra a whitelist da conta (0145).
  const g = await guard({ portal: eventoDe(req) });
  if (!g.ok) return g.res;
  const evento = eventoDe(req);
  const sp = new URL(req.url).searchParams;

  const r = ATIVACAO.has(evento)
    ? await sincronizarRespostasInboxOnDemand([evento])
    : { executou: false, novas: 0 };

  if (sp.get("fila") !== "1") return NextResponse.json({ ok: true, ...r });

  // Fila já atualizada, no mesmo recorte/formato do GET correspondente.
  const filtro = { status: sp.get("status"), disparoId: sp.get("disparo") };
  const fila = evento === "HM"
    ? await filaInboxHm(g.sessao, filtro)
    : await filaInbox(g.sessao, evento, filtro);
  return NextResponse.json({ ok: true, ...r, ...fila });
}
