import { NextResponse } from "next/server";
import { guard } from "@/lib/guard";
import { query, queryOne } from "@/lib/db";
import { getConfig } from "@/lib/services/config";
import { eventoDe } from "@/lib/services/evento";
import { motivoMeta, type SeveridadeMeta } from "@/lib/meta-codigos";

export const runtime = "nodejs";

type Nivel = "ok" | "atencao" | "alerta";
type Acao = "seguir" | "desacelerar" | "parar";
type Recomendacao = { nivel: Nivel; titulo: string; detalhe: string };

type Volume = {
  enviados_24h: number;
  enviados_1h: number;
  enviados_disp24: number;
  falhas_24h: number;
  respondidos_24h: number;
  optout_24h: number;
  optout_7d: number;
  templates_24h: number;
  ultimo_disparo_em: string | null;
};

type Entrega = {
  com_status: number;
  com_status_24h: number;
  entregues: number;
  lidas: number;
  so_enviadas: number;
  falhas_meta_7d: number;
  falhas_meta_24h: number;
};

type CodigoRow = { code: number; qtd: number; ultima: string | null };

// GET /api/disparos/saude — termômetro anti-ban do número. Cruza volume/ritmo
// (dados de envio) com os sinais REAIS de qualidade da Meta (status de entrega +
// códigos de erro sincronizados) para um veredito claro de quando PARAR.
export async function GET(req: Request) {
  // Portal do evento RESOLVIDO (cookie/query) contra a whitelist da conta (0145).
  const g = await guard({ portal: eventoDe(req) });
  if (!g.ok) return g.res;

  // Saúde anti-ban por evento: cada portal tem seu número/canal, então o
  // volume/ritmo/qualidade é avaliado isoladamente (HT não contamina Seminário).
  const evento = eventoDe(req);
  const limiteDia = await getConfig<number>("disparo_limite_diario", 200);
  const limiteHora = await getConfig<number>("disparo_limite_hora", 40);

  const v = (await queryOne<Volume>(
    `with dce as (
       select dc.*, d.iniciado_em as d_iniciado
         from cs.disparo_contatos dc
         join cs.disparos d on d.id = dc.disparo_id and d.evento = $1
     ),
     dc24 as (select * from dce where d_iniciado > now() - interval '24 hours')
     select
       (select count(*) from dce where enviado and enviado_em > now() - interval '24 hours')::int as enviados_24h,
       (select count(*) from dce where enviado and enviado_em > now() - interval '1 hour')::int  as enviados_1h,
       (select count(*) from dc24 where enviado)::int as enviados_disp24,
       (select count(*) from dc24 where not enviado and (erro is not null or erro_contato is not null))::int as falhas_24h,
       (select count(*) from dc24 where respondeu)::int as respondidos_24h,
       (select count(*) from cs.contatos where evento = $1 and opt_out and opt_out_em > now() - interval '24 hours')::int as optout_24h,
       (select count(*) from cs.contatos where evento = $1 and opt_out and opt_out_em > now() - interval '7 days')::int  as optout_7d,
       (select count(distinct template_id) from cs.disparos where evento = $1 and iniciado_em > now() - interval '24 hours')::int as templates_24h,
       (select max(iniciado_em) from cs.disparos where evento = $1) as ultimo_disparo_em`,
    [evento],
  )) ?? {
    enviados_24h: 0, enviados_1h: 0, enviados_disp24: 0, falhas_24h: 0, respondidos_24h: 0,
    optout_24h: 0, optout_7d: 0, templates_24h: 0, ultimo_disparo_em: null,
  };

  // Entrega real (status sincronizado da Meta) nos disparos dos últimos 7 dias.
  const e = (await queryOne<Entrega>(
    `with j as (
       select dc.status_meta, dc.status_em
         from cs.disparo_contatos dc
         join cs.disparos d on d.id = dc.disparo_id
        where d.evento = $1 and d.iniciado_em > now() - interval '7 days' and dc.enviado
     )
     select
       count(*) filter (where status_meta is not null)::int as com_status,
       count(*) filter (where status_meta is not null and status_em > now() - interval '24 hours')::int as com_status_24h,
       count(*) filter (where status_meta in ('delivered','read'))::int as entregues,
       count(*) filter (where status_meta = 'read')::int as lidas,
       count(*) filter (where status_meta = 'sent')::int as so_enviadas,
       count(*) filter (where status_meta = 'failed')::int as falhas_meta_7d,
       count(*) filter (where status_meta = 'failed' and status_em > now() - interval '24 hours')::int as falhas_meta_24h
       from j`,
    [evento],
  )) ?? { com_status: 0, com_status_24h: 0, entregues: 0, lidas: 0, so_enviadas: 0, falhas_meta_7d: 0, falhas_meta_24h: 0 };

  // Códigos de erro da Meta nos últimos 7 dias (motivo da queima).
  const codigosRows = await query<CodigoRow>(
    `select dc.erro_meta_code as code, count(*)::int as qtd, max(dc.status_em) as ultima
       from cs.disparo_contatos dc
       join cs.disparos d on d.id = dc.disparo_id
      where d.evento = $1 and d.iniciado_em > now() - interval '7 days' and dc.erro_meta_code is not null
      group by dc.erro_meta_code
      order by qtd desc`,
    [evento],
  );
  const codigos = codigosRows.map((c) => ({ code: c.code, qtd: c.qtd, ultima: c.ultima, ...motivoMeta(c.code) }));
  const criticosMeta = codigos.filter((c) => c.severidade === "critico");
  const avisosMeta = codigos.filter((c) => c.severidade === "aviso");

  const baseFalha = v.enviados_disp24 + v.falhas_24h;
  const taxaFalha = baseFalha > 0 ? v.falhas_24h / baseFalha : 0;
  const taxaResposta = v.enviados_disp24 > 0 ? v.respondidos_24h / v.enviados_disp24 : null;
  const taxaEntrega = e.com_status > 0 ? e.entregues / e.com_status : null;

  const rec: Recomendacao[] = [];

  // ---- Sinais de qualidade Meta (mais graves) -----------------------------
  for (const c of criticosMeta) {
    rec.push({ nivel: "alerta", titulo: c.rotulo, detalhe: `${c.significado} (${c.qtd}x nos últimos 7 dias). Pare os disparos e deixe o número descansar.` });
  }
  for (const c of avisosMeta) {
    rec.push({ nivel: "atencao", titulo: c.rotulo, detalhe: `${c.significado} (${c.qtd}x nos últimos 7 dias).` });
  }
  if (taxaEntrega !== null && e.com_status >= 10 && taxaEntrega < 0.6) {
    rec.push({ nivel: "alerta", titulo: "Taxa de entrega baixa", detalhe: `Só ${Math.round(taxaEntrega * 100)}% das mensagens com status foram entregues. Entrega baixa é um forte indício de número penalizado pela Meta.` });
  } else if (taxaEntrega !== null && e.com_status >= 10 && taxaEntrega < 0.8) {
    rec.push({ nivel: "atencao", titulo: "Entrega abaixo do ideal", detalhe: `${Math.round(taxaEntrega * 100)}% de entrega. Acompanhe de perto e evite aumentar o volume.` });
  }

  // ---- Volume / ritmo / engajamento ---------------------------------------
  if (v.enviados_24h >= limiteDia) {
    rec.push({ nivel: "alerta", titulo: "Limite diário recomendado atingido", detalhe: `${v.enviados_24h} envios nas últimas 24h (limite sugerido: ${limiteDia}). Pause novos disparos hoje.` });
  } else if (v.enviados_24h >= Math.round(limiteDia * 0.8)) {
    rec.push({ nivel: "atencao", titulo: "Perto do limite diário", detalhe: `${v.enviados_24h} de ${limiteDia} envios sugeridos. Restam ~${limiteDia - v.enviados_24h}.` });
  }
  if (v.enviados_1h >= limiteHora) {
    rec.push({ nivel: "atencao", titulo: "Ritmo alto na última hora", detalhe: `${v.enviados_1h} envios na última hora (sugerido: até ${limiteHora}/h). Espace em lotes menores.` });
  }
  if (taxaFalha >= 0.15) {
    rec.push({ nivel: "alerta", titulo: "Taxa de falha elevada", detalhe: `${Math.round(taxaFalha * 100)}% dos envios falharam nas últimas 24h. Pause e revise a base.` });
  } else if (taxaFalha >= 0.07) {
    rec.push({ nivel: "atencao", titulo: "Falhas acima do normal", detalhe: `${Math.round(taxaFalha * 100)}% de falha nas últimas 24h. Confira números inválidos.` });
  }
  if (v.optout_24h >= 3) {
    rec.push({ nivel: "atencao", titulo: "Vários opt-outs recentes", detalhe: `${v.optout_24h} opt-out(s) em 24h (${v.optout_7d} em 7d). Revise a copy e a segmentação.` });
  }
  if (v.enviados_disp24 >= 20 && taxaResposta !== null && taxaResposta < 0.1) {
    rec.push({ nivel: "atencao", titulo: "Baixo engajamento", detalhe: `Só ${Math.round((taxaResposta ?? 0) * 100)}% responderam. Respostas protegem a reputação do número.` });
  }
  if (v.enviados_24h >= 30 && v.templates_24h <= 1) {
    rec.push({ nivel: "atencao", titulo: "Pouca variação de mensagem", detalhe: `${v.enviados_24h} envios com 1 template. Alterne variações de copy.` });
  }

  if (rec.length === 0) {
    rec.push({ nivel: "ok", titulo: "Operação saudável", detalhe: "Indicadores das últimas 24h dentro do seguro. Mantenha o ritmo gradual e o bom engajamento." });
  }

  const nivelGeral: Nivel = rec.some((r) => r.nivel === "alerta") ? "alerta" : rec.some((r) => r.nivel === "atencao") ? "atencao" : "ok";

  // ---- Veredito de ação: o indicador de "quando parar" --------------------
  const motivoTopo = rec.find((r) => r.nivel === "alerta") ?? rec.find((r) => r.nivel === "atencao") ?? rec[0];
  let acao: Acao = "seguir";
  let acaoTitulo = "Pode disparar";
  let acaoMotivo = "O número está saudável. Siga com o ritmo planejado.";

  const houveAtividade = v.enviados_24h > 0 || e.com_status > 0 || v.enviados_disp24 > 0;
  if (nivelGeral === "alerta") {
    acao = "parar";
    acaoTitulo = "Pare agora";
    acaoMotivo = `${motivoTopo.titulo}. ${criticosMeta.length ? "A Meta já está penalizando o número." : "Pausar agora evita o ban."}`;
  } else if (nivelGeral === "atencao") {
    acao = "desacelerar";
    acaoTitulo = "Desacelere";
    acaoMotivo = `${motivoTopo.titulo}. Reduza o volume e observe antes de continuar.`;
  } else if (houveAtividade) {
    acaoMotivo = "Entrega e ritmo dentro do esperado. Mantenha o aquecimento gradual.";
  } else {
    acaoMotivo = "Sem disparos recentes para avaliar. Comece devagar e acompanhe os indicadores.";
  }

  const boasPraticas = [
    "Aqueça números novos: comece com poucos envios/dia e suba gradualmente ao longo de semanas.",
    "Prefira contatos que já interagiram com a marca — opt-in real reduz bloqueios.",
    "Espace os envios; evite mandar centenas de mensagens em poucos minutos.",
    "Use templates aprovados pela Meta e personalize com o nome do contato.",
    "Inclua sempre uma forma de sair (opt-out) e respeite quem pediu para parar.",
    "Monitore a entrega e desacelere ao primeiro sinal de queda na taxa de entrega.",
  ];

  return NextResponse.json({
    ok: true,
    nivelGeral,
    acao: { tipo: acao, titulo: acaoTitulo, motivo: acaoMotivo },
    metricas: {
      enviados_24h: v.enviados_24h,
      enviados_1h: v.enviados_1h,
      falhas_24h: v.falhas_24h,
      taxa_falha_pct: Math.round(taxaFalha * 100),
      taxa_resposta_pct: taxaResposta === null ? null : Math.round(taxaResposta * 100),
      optout_24h: v.optout_24h,
      optout_7d: v.optout_7d,
      ultimo_disparo_em: v.ultimo_disparo_em,
    },
    entrega: {
      com_status: e.com_status,
      com_status_24h: e.com_status_24h,
      entregues: e.entregues,
      lidas: e.lidas,
      so_enviadas: e.so_enviadas,
      falhas_meta_7d: e.falhas_meta_7d,
      falhas_meta_24h: e.falhas_meta_24h,
      taxa_entrega_pct: taxaEntrega === null ? null : Math.round(taxaEntrega * 100),
      taxa_leitura_pct: e.entregues > 0 ? Math.round((e.lidas / e.entregues) * 100) : null,
    },
    codigosMeta: codigos,
    limites: { dia: limiteDia, hora: limiteHora },
    recomendacoes: rec,
    boasPraticas,
  });
}
