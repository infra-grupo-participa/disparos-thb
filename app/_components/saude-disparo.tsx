"use client";

import { useEffect, useState } from "react";
import { Spinner, cn } from "@/app/_components/ui";

type Nivel = "ok" | "atencao" | "alerta";
type Recomendacao = { nivel: Nivel; titulo: string; detalhe: string };
type Saude = {
  nivelGeral: Nivel;
  metricas: {
    enviados_24h: number; enviados_1h: number; falhas_24h: number;
    taxa_falha_pct: number; taxa_resposta_pct: number | null;
    optout_24h: number; optout_7d: number; experimento_meta_24h: number; ultimo_disparo_em: string | null;
  };
  limites: { dia: number; hora: number };
  recomendacoes: Recomendacao[];
  boasPraticas: string[];
};

const NIVEL_TOM: Record<Nivel, { dot: string; chip: string; rotulo: string }> = {
  ok: { dot: "bg-emerald-500", chip: "bg-emerald-50 text-emerald-700 ring-emerald-200 dark:bg-emerald-500/15 dark:text-emerald-300 dark:ring-emerald-500/30", rotulo: "Saudável" },
  atencao: { dot: "bg-amber-500", chip: "bg-amber-50 text-amber-700 ring-amber-200 dark:bg-amber-500/15 dark:text-amber-300 dark:ring-amber-500/30", rotulo: "Atenção" },
  alerta: { dot: "bg-rose-500", chip: "bg-rose-50 text-rose-700 ring-rose-200 dark:bg-rose-500/15 dark:text-rose-300 dark:ring-rose-500/30", rotulo: "Risco" },
};

function IconeNivel({ nivel }: { nivel: Nivel }) {
  const cor = nivel === "alerta" ? "text-rose-500" : nivel === "atencao" ? "text-amber-500" : "text-emerald-500";
  const d = nivel === "ok"
    ? "M9 12l2 2 4-4M12 21a9 9 0 1 1 0-18 9 9 0 0 1 0 18Z"
    : "M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0zM12 9v4M12 17h.01";
  return <svg className={cn("h-4 w-4 shrink-0", cor)} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d={d} /></svg>;
}

// Painel "Saúde do disparo" — termômetro anti-ban. Reutilizado no modal de
// disparo (defaultAberto) e no dashboard. Busca métricas reais de /api/disparos/saude.
export function SaudeDisparo({ defaultPraticas = false }: { defaultPraticas?: boolean }) {
  const [d, setD] = useState<Saude | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [verPraticas, setVerPraticas] = useState(defaultPraticas);

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
  const tom = NIVEL_TOM[d.nivelGeral];

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
      <div className="flex items-center gap-2">
        <span className="flex items-center gap-2 text-sm font-semibold text-slate-800 dark:text-slate-100">
          <svg className="h-4 w-4 text-brand" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 12h-4l-3 9L9 3l-3 9H2" /></svg>
          Saúde do disparo
        </span>
        <span className={cn("inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-semibold ring-1 ring-inset", tom.chip)}>
          <span className={cn("h-1.5 w-1.5 rounded-full", tom.dot)} />
          {tom.rotulo}
        </span>
      </div>

      {/* Métricas reais (24h / 1h) */}
      <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Metrica label="Envios 24h" valor={`${m.enviados_24h}`} sub={`limite ~${d.limites.dia}`} alerta={m.enviados_24h >= d.limites.dia} />
        <Metrica label="Envios 1h" valor={`${m.enviados_1h}`} sub={`limite ~${d.limites.hora}/h`} alerta={m.enviados_1h >= d.limites.hora} />
        <Metrica label="Taxa de falha" valor={`${m.taxa_falha_pct}%`} sub="últimas 24h" alerta={m.taxa_falha_pct >= 15} />
        <Metrica label="Opt-outs 24h" valor={`${m.optout_24h}`} sub={`${m.optout_7d} em 7d`} alerta={m.optout_24h >= 3} />
      </div>

      {/* Recomendações inteligentes */}
      <ul className="mt-3 space-y-2">
        {d.recomendacoes.map((r, i) => (
          <li key={i} className="flex gap-2 rounded-lg bg-slate-50 px-3 py-2 dark:bg-slate-800/50">
            <IconeNivel nivel={r.nivel} />
            <div className="min-w-0">
              <p className="text-sm font-medium text-slate-800 dark:text-slate-100">{r.titulo}</p>
              <p className="text-xs text-slate-500 dark:text-slate-400">{r.detalhe}</p>
            </div>
          </li>
        ))}
      </ul>

      {/* Boas práticas (checklist) */}
      <button onClick={() => setVerPraticas((v) => !v)} className="mt-3 flex items-center gap-1 text-xs font-medium text-brand transition hover:underline dark:text-brand-300">
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
