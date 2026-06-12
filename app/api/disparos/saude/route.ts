import { NextResponse } from "next/server";
import { isAuthed } from "@/lib/auth";
import { queryOne } from "@/lib/db";
import { getConfig } from "@/lib/services/config";

export const runtime = "nodejs";

type Nivel = "ok" | "atencao" | "alerta";
type Recomendacao = { nivel: Nivel; titulo: string; detalhe: string };

type Metricas = {
  enviados_24h: number;
  enviados_1h: number;
  enviados_disp24: number;
  falhas_24h: number;
  respondidos_24h: number;
  bloqueios_meta_24h: number;
  experimento_meta_24h: number;
  optout_24h: number;
  optout_7d: number;
  templates_24h: number;
  ultimo_disparo_em: string | null;
};

// GET /api/disparos/saude — termômetro anti-ban do número de disparo. Baseado em
// dados reais (envios, falhas, opt-outs, qualidade Meta) das últimas 24h/1h,
// cruzados com limites de boas práticas WhatsApp. Gera recomendações acionáveis
// para o operador evitar queimar o número / tomar ban da Meta.
export async function GET() {
  if (!isAuthed()) return NextResponse.json({ ok: false }, { status: 401 });

  // Limites de referência (ajustáveis sem deploy via cs.config). Defaults
  // conservadores para um número em aquecimento.
  const limiteDia = await getConfig<number>("disparo_limite_diario", 200);
  const limiteHora = await getConfig<number>("disparo_limite_hora", 40);

  const m = (await queryOne<Metricas>(
    `with dc24 as (
       select dc.* from cs.disparo_contatos dc
       join cs.disparos d on d.id = dc.disparo_id
      where d.iniciado_em > now() - interval '24 hours'
     )
     select
       (select count(*) from cs.disparo_contatos where enviado and enviado_em > now() - interval '24 hours')::int as enviados_24h,
       (select count(*) from cs.disparo_contatos where enviado and enviado_em > now() - interval '1 hour')::int  as enviados_1h,
       (select count(*) from dc24 where enviado)::int as enviados_disp24,
       (select count(*) from dc24 where not enviado and (erro is not null or erro_contato is not null))::int as falhas_24h,
       (select count(*) from dc24 where respondeu)::int as respondidos_24h,
       (select count(*) from cs.disparo_contatos where status_meta = 'failed' and status_em > now() - interval '24 hours')::int as bloqueios_meta_24h,
       (select count(*) from cs.disparo_contatos where erro_meta_code = 130472 and status_em > now() - interval '24 hours')::int as experimento_meta_24h,
       (select count(*) from cs.contatos where opt_out and opt_out_em > now() - interval '24 hours')::int as optout_24h,
       (select count(*) from cs.contatos where opt_out and opt_out_em > now() - interval '7 days')::int  as optout_7d,
       (select count(distinct template_id) from cs.disparos where iniciado_em > now() - interval '24 hours')::int as templates_24h,
       (select max(iniciado_em) from cs.disparos) as ultimo_disparo_em`,
  )) ?? {
    enviados_24h: 0, enviados_1h: 0, enviados_disp24: 0, falhas_24h: 0, respondidos_24h: 0,
    bloqueios_meta_24h: 0, experimento_meta_24h: 0, optout_24h: 0, optout_7d: 0, templates_24h: 0, ultimo_disparo_em: null,
  };

  const baseFalha = m.enviados_disp24 + m.falhas_24h;
  const taxaFalha = baseFalha > 0 ? m.falhas_24h / baseFalha : 0;
  const taxaResposta = m.enviados_disp24 > 0 ? m.respondidos_24h / m.enviados_disp24 : null;

  const rec: Recomendacao[] = [];

  // 1) Qualidade Meta — sinal mais grave (número sob revisão/experimento).
  if (m.experimento_meta_24h > 0) {
    rec.push({
      nivel: "alerta",
      titulo: "Número em experimento da Meta",
      detalhe: `${m.experimento_meta_24h} envio(s) caíram em "experimento" (código 130472). A Meta está avaliando a qualidade do número. Reduza drasticamente o volume por 24–48h e priorize conversas com resposta.`,
    });
  }
  if (m.bloqueios_meta_24h > 0) {
    rec.push({
      nivel: "atencao",
      titulo: "Falhas de entrega da Meta",
      detalhe: `${m.bloqueios_meta_24h} mensagem(ns) com status "failed" nas últimas 24h. Verifique a qualidade do número no Gerenciador da Meta antes de continuar.`,
    });
  }

  // 2) Volume diário vs. limite recomendado.
  if (m.enviados_24h >= limiteDia) {
    rec.push({
      nivel: "alerta",
      titulo: "Limite diário recomendado atingido",
      detalhe: `${m.enviados_24h} envios nas últimas 24h (limite sugerido: ${limiteDia}). Pause novos disparos hoje para não exceder o tier do número.`,
    });
  } else if (m.enviados_24h >= Math.round(limiteDia * 0.8)) {
    rec.push({
      nivel: "atencao",
      titulo: "Perto do limite diário",
      detalhe: `${m.enviados_24h} de ${limiteDia} envios sugeridos nas últimas 24h. Restam ~${limiteDia - m.enviados_24h}. Vá com calma no resto do dia.`,
    });
  }

  // 3) Ritmo na última hora (rajadas chamam atenção dos filtros antispam).
  if (m.enviados_1h >= limiteHora) {
    rec.push({
      nivel: "atencao",
      titulo: "Ritmo alto na última hora",
      detalhe: `${m.enviados_1h} envios na última hora (sugerido: até ${limiteHora}/h). Espace os disparos em lotes menores ao longo do dia — evite rajadas.`,
    });
  }

  // 4) Taxa de falha — número pode estar com problema/lista suja.
  if (taxaFalha >= 0.15) {
    rec.push({
      nivel: "alerta",
      titulo: "Taxa de falha elevada",
      detalhe: `${Math.round(taxaFalha * 100)}% dos envios das últimas 24h falharam. Pode indicar números inválidos na lista ou queda de qualidade. Pause e revise a base.`,
    });
  } else if (taxaFalha >= 0.07) {
    rec.push({
      nivel: "atencao",
      titulo: "Falhas acima do normal",
      detalhe: `${Math.round(taxaFalha * 100)}% de falha nas últimas 24h. Confira se há números inválidos na seleção.`,
    });
  }

  // 5) Opt-outs — bloqueios do destinatário pesam muito na qualidade.
  if (m.optout_24h >= 3) {
    rec.push({
      nivel: "atencao",
      titulo: "Vários opt-outs recentes",
      detalhe: `${m.optout_24h} contato(s) marcaram opt-out nas últimas 24h (${m.optout_7d} em 7 dias). Bloqueios sinalizam spam à Meta — revise a copy e segmente melhor quem recebe.`,
    });
  }

  // 6) Engajamento — respostas baixas com volume aumentam risco de spam.
  if (m.enviados_disp24 >= 20 && taxaResposta !== null && taxaResposta < 0.1) {
    rec.push({
      nivel: "atencao",
      titulo: "Baixo engajamento",
      detalhe: `Só ${Math.round((taxaResposta ?? 0) * 100)}% responderam aos disparos recentes. Mensagens que geram resposta protegem a reputação do número — capriche na abordagem e no CTA.`,
    });
  }

  // 7) Variação de mensagem — texto idêntico em massa parece robô.
  if (m.enviados_24h >= 30 && m.templates_24h <= 1) {
    rec.push({
      nivel: "atencao",
      titulo: "Pouca variação de mensagem",
      detalhe: `${m.enviados_24h} envios com apenas ${m.templates_24h} template. Alterne entre variações de copy para parecer mais humano e reduzir filtros antispam.`,
    });
  }

  if (rec.length === 0) {
    rec.push({
      nivel: "ok",
      titulo: "Operação saudável",
      detalhe: "Os indicadores das últimas 24h estão dentro dos parâmetros seguros. Mantenha o ritmo gradual e o bom engajamento.",
    });
  }

  const nivelGeral: Nivel = rec.some((r) => r.nivel === "alerta")
    ? "alerta"
    : rec.some((r) => r.nivel === "atencao")
      ? "atencao"
      : "ok";

  // Boas práticas fixas — lembretes para não queimar o número.
  const boasPraticas = [
    "Aqueça números novos: comece com poucos envios/dia e suba gradualmente ao longo de semanas.",
    "Prefira contatos que já interagiram com a marca — opt-in real reduz bloqueios.",
    "Espace os envios; evite mandar centenas de mensagens em poucos minutos.",
    "Use templates aprovados pela Meta e personalize com o nome do contato.",
    "Inclua sempre uma forma de sair (opt-out) e respeite quem pediu para parar.",
    "Evite links encurtados suspeitos e conteúdo idêntico em massa.",
    "Monitore a qualidade do número no Gerenciador da Meta e desacelere ao primeiro sinal de queda.",
  ];

  return NextResponse.json({
    ok: true,
    nivelGeral,
    metricas: {
      enviados_24h: m.enviados_24h,
      enviados_1h: m.enviados_1h,
      falhas_24h: m.falhas_24h,
      taxa_falha_pct: Math.round(taxaFalha * 100),
      taxa_resposta_pct: taxaResposta === null ? null : Math.round(taxaResposta * 100),
      optout_24h: m.optout_24h,
      optout_7d: m.optout_7d,
      experimento_meta_24h: m.experimento_meta_24h,
      ultimo_disparo_em: m.ultimo_disparo_em,
    },
    limites: { dia: limiteDia, hora: limiteHora },
    recomendacoes: rec,
    boasPraticas,
  });
}
