"use client";

import { useEffect, useState } from "react";
import { Spinner, cn } from "@/app/_components/ui";

type Nivel = "ok" | "atencao" | "alerta";
type Acao = "seguir" | "desacelerar" | "parar";
type Severidade = "critico" | "aviso" | "tecnico";
type Recomendacao = { nivel: Nivel; titulo: string; detalhe: string };
type CodigoMeta = { code: number; qtd: number; rotulo: string; significado: string; severidade: Severidade };

type Saude = {
  nivelGeral: Nivel;
  acao: { tipo: Acao; titulo: string; motivo: string };
  metricas: {
    enviados_24h: number; enviados_1h: number; falhas_24h: number;
    taxa_falha_pct: number; taxa_resposta_pct: number | null;
    optout_24h: number; optout_7d: number; ultimo_disparo_em: string | null;
  };
  entrega: {
    com_status: number; com_status_24h: number; entregues: number; lidas: number; so_enviadas: number;
    falhas_meta_7d: number; falhas_meta_24h: number; taxa_entrega_pct: number | null; taxa_leitura_pct: number | null;
  };
  codigosMeta: CodigoMeta[];
  limites: { dia: number; hora: number };
  recomendacoes: Recomendacao[];
  boasPraticas: string[];
};

const ACAO_TOM: Record<Acao, { card: string; icone: string; titulo: string; selo: string; barra: string }> = {
  seguir: {
    card: "border-emerald-200 bg-gradient-to-br from-emerald-50 to-white dark:border-emerald-500/30 dark:from-emerald-500/10 dark:to-slate-900",
    icone: "bg-emerald-100 text-emerald-600 dark:bg-emerald-500/15 dark:text-emerald-400",
    titulo: "text-emerald-800 dark:text-emerald-300", selo: "Pode disparar", barra: "bg-emerald-500",
  },
  desacelerar: {
    card: "border-amber-200 bg-gradient-to-br from-amber-50 to-white dark:border-amber-500/30 dark:from-amber-500/10 dark:to-slate-900",
    icone: "bg-amber-100 text-amber-600 dark:bg-amber-500/15 dark:text-amber-400",
    titulo: "text-amber-800 dark:text-amber-300", selo: "Atenção", barra: "bg-amber-500",
  },
  parar: {
    card: "border-rose-200 bg-gradient-to-br from-rose-50 to-white dark:border-rose-500/30 dark:from-rose-500/10 dark:to-slate-900",
    icone: "bg-rose-100 text-rose-600 dark:bg-rose-500/15 dark:text-rose-400",
    titulo: "text-rose-800 dark:text-rose-300", selo: "Risco de ban", barra: "bg-rose-500",
  },
};

function IconeAcao({ acao }: { acao: Acao }) {
  const d = acao === "seguir"
    ? "M22 11.08V12a10 10 0 1 1-5.93-9.14M22 4 12 14.01l-3-3"
    : acao === "desacelerar"
      ? "M12 9v4M12 17h.01M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"
      : "M12 8v4M12 16h.01M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20z";
  return <svg className="h-6 w-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d={d} /></svg>;
}

const SEV_TOM: Record<Severidade, string> = {
  critico: "bg-rose-50 text-rose-700 ring-rose-200 dark:bg-rose-500/15 dark:text-rose-300 dark:ring-rose-500/30",
  aviso: "bg-amber-50 text-amber-700 ring-amber-200 dark:bg-amber-500/15 dark:text-amber-300 dark:ring-amber-500/30",
  tecnico: "bg-slate-100 text-slate-600 ring-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:ring-slate-700",
};

// Painel "Saúde do disparo" — indicador anti-ban com veredito de ação + sinais
// reais da Meta (entrega + códigos de erro). Reutilizado no modal de disparo e
// no dashboard. Dados de /api/disparos/saude.
export function SaudeDisparo() {
  const [d, setD] = useState<Saude | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [verPraticas, setVerPraticas] = useState(false);

  useEffect(() => {
    fetch("/api/disparos/saude")
      .then((r) => r.json())
      .then((res) => { if (res.ok) setD(res); })
      .catch(() => {})
      .finally(() => setCarregando(false));
  }, []);

  if (carregando) {
    return <div className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white p-4 text-sm text-slate-400 dark:border-slate-800 dark:bg-slate-900"><Spinner /> Avaliando saúde do número…</div>;
  }
  if (!d) return null;

  const m = d.metricas;
  const e = d.entrega;
  const tom = ACAO_TOM[d.acao.tipo];

  return (
    <div className="space-y-3">
      {/* Indicador de ação — o "quando parar" */}
      <div className={cn("flex items-start gap-3 rounded-xl border p-4", tom.card)}>
        <span className={cn("flex h-11 w-11 shrink-0 items-center justify-center rounded-xl", tom.icone)}>
          <IconeAcao acao={d.acao.tipo} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className={cn("text-[11px] font-bold uppercase tracking-wide", tom.titulo)}>{tom.selo}</span>
          </div>
          <p className={cn("text-lg font-semibold leading-tight", tom.titulo)}>{d.acao.titulo}</p>
          <p className="mt-0.5 text-sm text-slate-600 dark:text-slate-300">{d.acao.motivo}</p>
        </div>
      </div>

      {/* Métricas-chave (envio) */}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Metrica label="Envios 24h" valor={`${m.enviados_24h}`} sub={`limite ~${d.limites.dia}`} alerta={m.enviados_24h >= d.limites.dia} />
        <Metrica label="Envios 1h" valor={`${m.enviados_1h}`} sub={`limite ~${d.limites.hora}/h`} alerta={m.enviados_1h >= d.limites.hora} />
        <Metrica label="Falha de envio" valor={`${m.taxa_falha_pct}%`} sub="últimas 24h" alerta={m.taxa_falha_pct >= 15} />
        <Metrica label="Opt-outs 24h" valor={`${m.optout_24h}`} sub={`${m.optout_7d} em 7d`} alerta={m.optout_24h >= 3} />
      </div>

      {/* Entrega real (Meta) */}
      <div className="rounded-xl border border-slate-200 bg-white p-3 dark:border-slate-800 dark:bg-slate-900">
        <div className="mb-2 flex items-center justify-between">
          <span className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Entrega na Meta · 7 dias</span>
          <span className="text-[11px] text-slate-400 dark:text-slate-500">{e.com_status} msg com status</span>
        </div>
        {e.com_status === 0 ? (
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Sem status de entrega ainda. O sistema sincroniza automaticamente; você também pode usar “Atualizar status de entrega” após um disparo.
          </p>
        ) : (
          <div className="grid grid-cols-3 gap-2">
            <Metrica label="Entregues" valor={e.taxa_entrega_pct !== null ? `${e.taxa_entrega_pct}%` : "—"} sub={`${e.entregues}/${e.com_status}`} alerta={e.taxa_entrega_pct !== null && e.taxa_entrega_pct < 60} />
            <Metrica label="Lidas" valor={e.taxa_leitura_pct !== null ? `${e.taxa_leitura_pct}%` : "—"} sub={`${e.lidas} lidas`} />
            <Metrica label="Falhas Meta" valor={`${e.falhas_meta_7d}`} sub={`${e.falhas_meta_24h} em 24h`} alerta={e.falhas_meta_24h > 0} />
          </div>
        )}

        {/* Códigos de erro da Meta (motivo da queima) */}
        {d.codigosMeta.length > 0 && (
          <ul className="mt-2 space-y-1.5 border-t border-slate-100 pt-2 dark:border-slate-800">
            {d.codigosMeta.map((c) => (
              <li key={c.code} className="flex items-start gap-2">
                <span className={cn("mt-0.5 inline-flex shrink-0 items-center rounded-full px-1.5 py-0.5 text-[10px] font-semibold ring-1 ring-inset", SEV_TOM[c.severidade])}>{c.qtd}×</span>
                <div className="min-w-0">
                  <p className="text-xs font-medium text-slate-800 dark:text-slate-100">{c.rotulo} <span className="font-normal text-slate-400">· cód. {c.code}</span></p>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400">{c.significado}</p>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Recomendações */}
      {d.recomendacoes.length > 0 && d.recomendacoes[0].nivel !== "ok" && (
        <ul className="space-y-2">
          {d.recomendacoes.map((r, i) => (
            <li key={i} className="flex gap-2 rounded-lg bg-slate-50 px-3 py-2 dark:bg-slate-800/50">
              <span className={cn("mt-1 h-1.5 w-1.5 shrink-0 rounded-full", r.nivel === "alerta" ? "bg-rose-500" : r.nivel === "atencao" ? "bg-amber-500" : "bg-emerald-500")} />
              <div className="min-w-0">
                <p className="text-sm font-medium text-slate-800 dark:text-slate-100">{r.titulo}</p>
                <p className="text-xs text-slate-500 dark:text-slate-400">{r.detalhe}</p>
              </div>
            </li>
          ))}
        </ul>
      )}

      {/* Boas práticas */}
      <div>
        <button onClick={() => setVerPraticas((v) => !v)} className="flex items-center gap-1 text-xs font-medium text-brand transition hover:underline dark:text-brand-300">
          <svg className={cn("h-3.5 w-3.5 transition-transform", verPraticas && "rotate-90")} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m9 18 6-6-6-6" /></svg>
          Boas práticas para não tomar ban
        </button>
        {verPraticas && (
          <ul className="mt-2 space-y-1.5">
            {d.boasPraticas.map((p, i) => (
              <li key={i} className="flex gap-2 text-xs text-slate-600 dark:text-slate-300">
                <svg className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5" /></svg>
                {p}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function Metrica({ label, valor, sub, alerta }: { label: string; valor: string; sub: string; alerta?: boolean }) {
  return (
    <div className={cn("rounded-lg border p-2.5", alerta ? "border-rose-200 bg-rose-50/60 dark:border-rose-500/30 dark:bg-rose-500/10" : "border-slate-200 bg-slate-50/60 dark:border-slate-800 dark:bg-slate-800/40")}>
      <div className={cn("text-lg font-semibold tabular-nums", alerta ? "text-rose-600 dark:text-rose-300" : "text-slate-900 dark:text-slate-100")}>{valor}</div>
      <div className="text-[11px] font-medium text-slate-500 dark:text-slate-400">{label}</div>
      <div className="text-[10px] text-slate-400 dark:text-slate-500">{sub}</div>
    </div>
  );
}
