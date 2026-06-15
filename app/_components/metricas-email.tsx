"use client";

import { useCallback, useEffect, useState } from "react";
import { Button, Card, EmptyState, Spinner, cn } from "@/app/_components/ui";
import { Kpi, SecaoTitulo } from "@/app/_components/kpi";
import { usePortal } from "@/app/_components/use-portal";

type Nivel = "ok" | "atencao" | "alerta";
type Acao = "seguir" | "desacelerar" | "parar";
type Recomendacao = { nivel: Nivel; titulo: string; detalhe: string };

type Saude = {
  nivelGeral: Nivel;
  acao: { tipo: Acao; titulo: string; motivo: string };
  metricas: {
    campanhas_30d: number; enviados_30d: number; processados_30d: number;
    taxa_abertura_pct: number | null; taxa_clique_pct: number | null;
    taxa_bounce_pct: number | null; taxa_hardbounce_pct: number | null; taxa_unsub_pct: number | null;
    ultima_em: string | null;
  };
  recomendacoes: Recomendacao[];
  boasPraticas: string[];
};

type Kpis = {
  campanhas: number; enviados: number; aberturas_unicas: number;
  cliques_unicos: number; bounces: number; unsubscribes: number; ultima_em: string | null;
};
type Nossos = {
  contatos: number; no_ac: number; receberam: number; abriram: number; clicaram: number; com_bounce: number;
};
type Campanha = {
  id: string; nome: string; tipo: string | null; status: string | null;
  enviados: number; processados: number; aberturas_unicas: number; cliques_unicos: number;
  hardbounces: number; softbounces: number; unsubscribes: number; enviada_em: string | null;
};

const ACAO_TOM: Record<Acao, { card: string; icone: string; titulo: string; selo: string }> = {
  seguir: {
    card: "border-emerald-200 bg-gradient-to-br from-emerald-50 to-white dark:border-emerald-500/30 dark:from-emerald-500/10 dark:to-slate-900",
    icone: "bg-emerald-100 text-emerald-600 dark:bg-emerald-500/15 dark:text-emerald-400",
    titulo: "text-emerald-800 dark:text-emerald-300", selo: "Pode enviar",
  },
  desacelerar: {
    card: "border-amber-200 bg-gradient-to-br from-amber-50 to-white dark:border-amber-500/30 dark:from-amber-500/10 dark:to-slate-900",
    icone: "bg-amber-100 text-amber-600 dark:bg-amber-500/15 dark:text-amber-400",
    titulo: "text-amber-800 dark:text-amber-300", selo: "Atenção",
  },
  parar: {
    card: "border-rose-200 bg-gradient-to-br from-rose-50 to-white dark:border-rose-500/30 dark:from-rose-500/10 dark:to-slate-900",
    icone: "bg-rose-100 text-rose-600 dark:bg-rose-500/15 dark:text-rose-400",
    titulo: "text-rose-800 dark:text-rose-300", selo: "Risco de reputação",
  },
};

function fmtData(iso: string | null) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "2-digit" });
}
const taxa = (n: number, d: number) => (d > 0 ? Math.round((n / d) * 100) : 0);

// Painel de métricas de e-mail (ActiveCampaign) do portal. Espelha o bloco de
// disparos do WhatsApp: KPIs + saúde de reputação + lista de campanhas.
// Dados de /api/email/metricas e /api/email/saude; sync sob demanda em /api/email/sync.
export function MetricasEmail({ desde, ate }: { desde?: string; ate?: string }) {
  const { evento } = usePortal();
  const [kpis, setKpis] = useState<Kpis | null>(null);
  const [nossos, setNossos] = useState<Nossos | null>(null);
  const [campanhas, setCampanhas] = useState<Campanha[]>([]);
  const [saude, setSaude] = useState<Saude | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [sincronizando, setSincronizando] = useState(false);

  const carregar = useCallback(async () => {
    const params = new URLSearchParams({ evento });
    if (desde) params.set("desde", new Date(`${desde}T00:00:00`).toISOString());
    if (ate) params.set("ate", new Date(`${ate}T23:59:59`).toISOString());
    try {
      const [m, s] = await Promise.all([
        fetch(`/api/email/metricas?${params.toString()}`).then((r) => r.json()),
        fetch(`/api/email/saude?evento=${evento}`).then((r) => r.json()),
      ]);
      if (m.ok) { setKpis(m.kpis); setCampanhas(m.campanhas); setNossos(m.nossos ?? null); }
      if (s.ok) setSaude(s);
    } catch {
      /* mantém os dados anteriores */
    } finally {
      setCarregando(false);
    }
  }, [evento, desde, ate]);

  useEffect(() => { carregar(); }, [carregar]);

  async function sincronizar() {
    setSincronizando(true);
    try {
      await fetch("/api/email/sync", { method: "POST" });
      await carregar();
    } finally {
      setSincronizando(false);
    }
  }

  if (carregando) {
    return <div className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white p-4 text-sm text-slate-400 dark:border-slate-800 dark:bg-slate-900"><Spinner /> Carregando métricas de e-mail…</div>;
  }

  const m = saude?.metricas;
  const tom = saude ? ACAO_TOM[saude.acao.tipo] : null;
  const k = kpis;
  const semDados = (k?.campanhas ?? 0) === 0;

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs text-slate-400 dark:text-slate-500">
          {k?.ultima_em ? `Última campanha em ${fmtData(k.ultima_em)}` : "Sincronizado do ActiveCampaign"}
        </p>
        <Button variant="secondary" size="sm" onClick={sincronizar} disabled={sincronizando}>
          {sincronizando ? <Spinner /> : (
            <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M3 12a9 9 0 0 1 15-6.7L21 8M21 3v5h-5M21 12a9 9 0 0 1-15 6.7L3 16M3 21v-5h5" />
            </svg>
          )}
          Atualizar do AC
        </Button>
      </div>

      {semDados ? (
        <EmptyState
          title="Nenhuma campanha de e-mail ainda"
          description="As campanhas do ActiveCampaign deste portal aparecem aqui após a sincronização. Clique em “Atualizar do AC”."
          icon={
            <svg className="h-9 w-9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <rect x="2" y="4" width="20" height="16" rx="2" /><path d="m22 7-10 5L2 7" />
            </svg>
          }
        />
      ) : (
        <>
          {/* Engajamento DOS NOSSOS CONTATOS (pessoas do sistema, por evento) */}
          {nossos && (
            <div>
              <SecaoTitulo cor="brand">
                Nossos contatos · {evento}
                <span className="ml-1 font-normal normal-case text-slate-400 dark:text-slate-500">{nossos.no_ac}/{nossos.contatos} no AC</span>
              </SecaoTitulo>
              <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                <Kpi titulo="Receberam" valor={`${taxa(nossos.receberam, nossos.contatos)}%`} sub={`${nossos.receberam.toLocaleString("pt-BR")} de ${nossos.contatos.toLocaleString("pt-BR")}`} />
                <Kpi titulo="Abriram" valor={`${taxa(nossos.abriram, nossos.receberam)}%`} sub={`${nossos.abriram.toLocaleString("pt-BR")} (de quem recebeu)`} />
                <Kpi titulo="Clicaram" valor={`${taxa(nossos.clicaram, nossos.abriram)}%`} sub={`${nossos.clicaram.toLocaleString("pt-BR")} (de quem abriu)`} />
                <Kpi titulo="Com bounce" valor={nossos.com_bounce.toLocaleString("pt-BR")} sub="hard bounce" alerta={nossos.com_bounce > 0} />
              </div>
            </div>
          )}

          {/* KPIs da CAMPANHA (totais do AC — base inteira, contexto) */}
          <div>
            <SecaoTitulo cor="slate">Campanhas no AC · totais</SecaoTitulo>
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              <Kpi titulo="Campanhas" valor={`${k!.campanhas}`} />
              <Kpi titulo="Enviados" valor={k!.enviados.toLocaleString("pt-BR")} />
              <Kpi titulo="Abertura" valor={`${taxa(k!.aberturas_unicas, k!.enviados)}%`} sub={`${k!.aberturas_unicas.toLocaleString("pt-BR")} únicas`} />
              <Kpi titulo="Cliques" valor={`${taxa(k!.cliques_unicos, k!.aberturas_unicas)}%`} sub={`${k!.cliques_unicos.toLocaleString("pt-BR")} (sobre aberturas)`} />
            </div>
          </div>

          {/* Saúde de reputação */}
          {saude && tom && m && (
            <div className="space-y-3">
              <div className={cn("flex items-start gap-3 rounded-xl border p-4", tom.card)}>
                <span className={cn("flex h-11 w-11 shrink-0 items-center justify-center rounded-xl", tom.icone)}>
                  <svg className="h-6 w-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="2" y="4" width="20" height="16" rx="2" /><path d="m22 7-10 5L2 7" />
                  </svg>
                </span>
                <div className="min-w-0 flex-1">
                  <span className={cn("text-[11px] font-bold uppercase tracking-wide", tom.titulo)}>{tom.selo}</span>
                  <p className={cn("text-lg font-semibold leading-tight", tom.titulo)}>{saude.acao.titulo}</p>
                  <p className="mt-0.5 text-sm text-slate-600 dark:text-slate-300">{saude.acao.motivo}</p>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                <Metrica label="Bounces" valor={m.taxa_bounce_pct !== null ? `${m.taxa_bounce_pct}%` : "—"} sub={`hard ${m.taxa_hardbounce_pct ?? 0}%`} alerta={(m.taxa_hardbounce_pct ?? 0) >= 5} />
                <Metrica label="Descadastros" valor={m.taxa_unsub_pct !== null ? `${m.taxa_unsub_pct}%` : "—"} sub="30 dias" alerta={(m.taxa_unsub_pct ?? 0) >= 1} />
                <Metrica label="Abertura" valor={m.taxa_abertura_pct !== null ? `${m.taxa_abertura_pct}%` : "—"} sub="30 dias" alerta={m.taxa_abertura_pct !== null && m.taxa_abertura_pct < 8} />
                <Metrica label="Enviados 30d" valor={m.enviados_30d.toLocaleString("pt-BR")} sub={`${m.campanhas_30d} campanha(s)`} />
              </div>

              {saude.recomendacoes.length > 0 && saude.recomendacoes[0].nivel !== "ok" && (
                <ul className="space-y-2">
                  {saude.recomendacoes.map((r, i) => (
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
            </div>
          )}

          {/* Lista de campanhas */}
          <Card className="overflow-hidden">
            <ul className="divide-y divide-slate-100 dark:divide-slate-800">
              {campanhas.map((c) => (
                <li key={c.id} className="flex flex-wrap items-center gap-x-3 gap-y-1.5 px-4 py-3 text-sm transition hover:bg-slate-50/70 dark:hover:bg-slate-800/40">
                  <span className="w-16 shrink-0 text-xs tabular-nums text-slate-500 dark:text-slate-400">{fmtData(c.enviada_em)}</span>
                  <span className="min-w-0 flex-1 truncate font-medium text-slate-700 dark:text-slate-200" title={c.nome}>{c.nome}</span>
                  <span className="text-xs tabular-nums text-slate-500 dark:text-slate-400">
                    <span className="font-semibold text-slate-700 dark:text-slate-200">{c.enviados.toLocaleString("pt-BR")}</span> env. ·{" "}
                    <span className="font-semibold text-emerald-600 dark:text-emerald-400">{taxa(c.aberturas_unicas, c.enviados)}%</span> abert. ·{" "}
                    <span className="font-semibold text-brand dark:text-brand-300">{taxa(c.cliques_unicos, c.aberturas_unicas)}%</span> cliq.
                    {(c.hardbounces + c.softbounces) > 0 && <> · <span className="text-rose-500">{c.hardbounces + c.softbounces} bnc</span></>}
                  </span>
                </li>
              ))}
            </ul>
          </Card>
        </>
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
