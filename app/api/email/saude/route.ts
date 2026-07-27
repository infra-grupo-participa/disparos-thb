import { NextResponse } from "next/server";
import { guard } from "@/lib/guard";
import { queryOne } from "@/lib/db";
import { eventoDe } from "@/lib/services/evento";

export const runtime = "nodejs";

// GET /api/email/saude — termômetro de reputação do e-mail (AC), espelho do
// anti-ban da Meta no WhatsApp. Em e-mail, os sinais de reputação são taxa de
// bounce (sobretudo hard bounce), taxa de descadastro e engajamento (abertura/
// clique). Veredito claro de seguir / desacelerar / parar, por evento.
type Nivel = "ok" | "atencao" | "alerta";
type Acao = "seguir" | "desacelerar" | "parar";
type Recomendacao = { nivel: Nivel; titulo: string; detalhe: string };

type Agg = {
  campanhas: number;
  enviados: number;
  processados: number;
  aberturas_unicas: number;
  cliques_unicos: number;
  hardbounces: number;
  softbounces: number;
  unsubscribes: number;
  ultima_em: string | null;
};

const pct = (n: number, d: number): number | null => (d > 0 ? Math.round((n / d) * 1000) / 10 : null);

export async function GET(req: Request) {
  // Portal do evento RESOLVIDO (cookie/query) contra a whitelist da conta (0145).
  const g = await guard({ portal: eventoDe(req) });
  if (!g.ok) return g.res;

  const evento = eventoDe(req);

  // Janela de 30 dias — campanhas de e-mail são bem menos frequentes que o
  // disparo diário de WhatsApp, então uma janela maior dá base estatística.
  const a = (await queryOne<Agg>(
    `select
       count(*)::int as campanhas,
       coalesce(sum(enviados), 0)::int as enviados,
       coalesce(sum(processados), 0)::int as processados,
       coalesce(sum(aberturas_unicas), 0)::int as aberturas_unicas,
       coalesce(sum(cliques_unicos), 0)::int as cliques_unicos,
       coalesce(sum(hardbounces), 0)::int as hardbounces,
       coalesce(sum(softbounces), 0)::int as softbounces,
       coalesce(sum(unsubscribes), 0)::int as unsubscribes,
       max(enviada_em) as ultima_em
     from cs.campanhas_email
     where evento = $1 and enviada_em > now() - interval '30 days'`,
    [evento],
  )) ?? {
    campanhas: 0, enviados: 0, processados: 0, aberturas_unicas: 0, cliques_unicos: 0,
    hardbounces: 0, softbounces: 0, unsubscribes: 0, ultima_em: null,
  };

  const base = a.processados || a.enviados; // total real processado é o melhor denominador
  const taxaHard = pct(a.hardbounces, base);
  const taxaBounceTotal = pct(a.hardbounces + a.softbounces, base);
  const taxaUnsub = pct(a.unsubscribes, base);
  const taxaAbertura = pct(a.aberturas_unicas, base);
  const taxaClique = pct(a.cliques_unicos, a.aberturas_unicas); // CTR sobre quem abriu

  const rec: Recomendacao[] = [];
  const temVolume = base >= 200; // só avalia reputação com volume mínimo

  // ---- Bounce: o sinal mais grave para reputação de remetente ----
  if (taxaHard !== null && temVolume && taxaHard >= 5) {
    rec.push({ nivel: "alerta", titulo: "Hard bounce alto", detalhe: `${taxaHard}% de hard bounces nos últimos 30 dias. Acima de 5% queima a reputação do domínio — pare e higienize a lista antes de novos envios.` });
  } else if (taxaHard !== null && temVolume && taxaHard >= 2) {
    rec.push({ nivel: "atencao", titulo: "Hard bounce acima do ideal", detalhe: `${taxaHard}% de hard bounces. O ideal é abaixo de 2% — limpe endereços inválidos.` });
  }
  if (taxaBounceTotal !== null && temVolume && taxaBounceTotal >= 10) {
    rec.push({ nivel: "atencao", titulo: "Bounces totais elevados", detalhe: `${taxaBounceTotal}% de bounces (hard + soft). Revise a qualidade da base.` });
  }

  // ---- Descadastro (unsubscribe) ----
  if (taxaUnsub !== null && temVolume && taxaUnsub >= 1) {
    rec.push({ nivel: "alerta", titulo: "Descadastros altos", detalhe: `${taxaUnsub}% de descadastros. Acima de 1% indica conteúdo/segmentação ruins — revise antes de continuar.` });
  } else if (taxaUnsub !== null && temVolume && taxaUnsub >= 0.5) {
    rec.push({ nivel: "atencao", titulo: "Descadastros acima do normal", detalhe: `${taxaUnsub}% de descadastros (ideal < 0,5%). Ajuste a copy e a frequência.` });
  }

  // ---- Engajamento (abertura) — reputação cai com baixo engajamento ----
  if (taxaAbertura !== null && temVolume && taxaAbertura < 8) {
    rec.push({ nivel: "atencao", titulo: "Baixa taxa de abertura", detalhe: `Só ${taxaAbertura}% abriram. Provedores penalizam remetentes com baixo engajamento — melhore assunto e segmentação.` });
  }

  if (rec.length === 0) {
    rec.push({ nivel: "ok", titulo: a.campanhas === 0 ? "Sem campanhas recentes" : "Reputação saudável", detalhe: a.campanhas === 0 ? "Nenhuma campanha de e-mail nos últimos 30 dias para avaliar." : "Bounce, descadastro e engajamento dentro do seguro. Mantenha o ritmo." });
  }

  const nivelGeral: Nivel = rec.some((r) => r.nivel === "alerta") ? "alerta" : rec.some((r) => r.nivel === "atencao") ? "atencao" : "ok";

  const motivoTopo = rec.find((r) => r.nivel === "alerta") ?? rec.find((r) => r.nivel === "atencao") ?? rec[0];
  let acao: Acao = "seguir";
  let acaoTitulo = "Pode enviar";
  let acaoMotivo = "Reputação de e-mail saudável. Siga com o ritmo planejado.";
  if (nivelGeral === "alerta") {
    acao = "parar";
    acaoTitulo = "Pare agora";
    acaoMotivo = `${motivoTopo.titulo}. Enviar mais agora arrisca cair em spam e penalizar o domínio.`;
  } else if (nivelGeral === "atencao") {
    acao = "desacelerar";
    acaoTitulo = "Desacelere";
    acaoMotivo = `${motivoTopo.titulo}. Reduza o volume e revise a base antes de continuar.`;
  } else if (a.campanhas === 0) {
    acaoMotivo = "Sem campanhas recentes para avaliar. Ao enviar, comece por contatos engajados.";
  }

  const boasPraticas = [
    "Higienize a lista com frequência: remova endereços que dão hard bounce.",
    "Priorize contatos engajados — bases frias derrubam a taxa de entrega.",
    "Mantenha um link de descadastro visível; é melhor o opt-out do que a marcação de spam.",
    "Aqueça domínios/remetentes novos subindo o volume gradualmente.",
    "Teste assunto e remetente; abertura baixa sinaliza reputação em queda.",
    "Evite picos de volume atípicos — provedores leem isso como comportamento de spam.",
  ];

  return NextResponse.json({
    ok: true,
    nivelGeral,
    acao: { tipo: acao, titulo: acaoTitulo, motivo: acaoMotivo },
    metricas: {
      campanhas_30d: a.campanhas,
      enviados_30d: a.enviados,
      processados_30d: a.processados,
      taxa_abertura_pct: taxaAbertura,
      taxa_clique_pct: taxaClique,
      taxa_bounce_pct: taxaBounceTotal,
      taxa_hardbounce_pct: taxaHard,
      taxa_unsub_pct: taxaUnsub,
      ultima_em: a.ultima_em,
    },
    recomendacoes: rec,
    boasPraticas,
  });
}
