"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Card, Spinner, cn } from "@/app/_components/ui";
import { SecaoTitulo } from "@/app/_components/kpi";
import { usePortal } from "@/app/_components/use-portal";

type Kpis = {
  leads: number; ativados: number; taxa_ativacao: number;
  engajados: number; taxa_engajamento: number;
  tocados: number; cobertura: number; tempo_ativacao_h: number | null;
};
type Etapa = { chave: string; nome: string; ordem: number; cor: string | null; qtd: number };
type RitmoDia = { dia: string; canal: string; qtd: number };
type Alerta = { tom: "alerta" | "sugestao"; titulo: string; descricao: string };
type Dados = { alvo: string; kpis: Kpis; funil: Etapa[]; ritmo: RitmoDia[]; alertas: Alerta[] };

const fmt = (n: number) => n.toLocaleString("pt-BR");

// Cores por canal — mesmo código de cor do resto do dashboard.
const CANAL = {
  whatsapp: { nome: "WhatsApp", bar: "bg-emerald-500", dot: "bg-emerald-500" },
  email: { nome: "E-mail", bar: "bg-sky-500", dot: "bg-sky-500" },
  ligacao: { nome: "Ligação", bar: "bg-violet-500", dot: "bg-violet-500" },
  outro: { nome: "Outro", bar: "bg-slate-300 dark:bg-slate-600", dot: "bg-slate-300 dark:bg-slate-600" },
} as const;
const CANAL_ORDEM = ["whatsapp", "email", "ligacao", "outro"] as const;

// Visão Executiva: a tela "como vai o evento?". Funil de ativação no centro,
// KPIs de topo, ritmo por canal e alertas acionáveis. Dados de
// /api/dashboard/executivo. Para o portal HT o North Star é 'ativado'.
export function VisaoExecutiva({ desde, ate, edicao }: { desde?: string; ate?: string; edicao?: string }) {
  const { evento, ehHT } = usePortal();
  const [d, setD] = useState<Dados | null>(null);
  const [carregando, setCarregando] = useState(true);

  const carregar = useCallback(async () => {
    const params = new URLSearchParams({ evento });
    if (desde) params.set("desde", new Date(`${desde}T00:00:00`).toISOString());
    if (ate) params.set("ate", new Date(`${ate}T23:59:59`).toISOString());
    if (edicao) params.set("edicao", edicao);
    if (!ehHT) params.set("alvo", "sem_grupo");
    try {
      const r = await fetch(`/api/dashboard/executivo?${params.toString()}`);
      const j = await r.json();
      if (j.ok) setD(j);
    } catch {
      /* mantém anterior */
    } finally {
      setCarregando(false);
    }
  }, [evento, ehHT, desde, ate, edicao]);

  useEffect(() => { carregar(); }, [carregar]);

  if (carregando) {
    return <div className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white p-4 text-sm text-slate-400 dark:border-slate-800 dark:bg-slate-900"><Spinner /> Carregando visão executiva…</div>;
  }
  if (!d) return null;

  const { kpis } = d;
  const tempo = kpis.tempo_ativacao_h;
  const tempoLabel = tempo == null ? "—" : tempo >= 48 ? `${Math.round(tempo / 24)} d` : `${tempo} h`;

  return (
    <div className="space-y-6">
      {/* KPIs de topo — Ativados é o North Star, em destaque. */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
        <KpiExec titulo="Leads no evento" valor={fmt(kpis.leads)} sub="na base (com filtro)" />
        <KpiExec titulo="Ativados" valor={fmt(kpis.ativados)} sub={`${kpis.taxa_ativacao}% dos leads`} barra={kpis.taxa_ativacao} estrela />
        <KpiExec titulo="Engajaram" valor={`${kpis.taxa_engajamento}%`} sub={`${fmt(kpis.engajados)} responderam`} barra={kpis.taxa_engajamento} />
        <KpiExec titulo="Cobertura" valor={`${kpis.cobertura}%`} sub={`${fmt(kpis.tocados)} de ${fmt(kpis.leads)} tocados`} barra={kpis.cobertura} alerta={kpis.cobertura < 60} />
        <KpiExec titulo="Tempo p/ ativar" valor={tempoLabel} sub={tempo == null ? "sem histórico" : "média"} />
      </div>

      {/* Funil de ativação — o coração da tela. */}
      <Card className="p-5">
        <div className="mb-3 flex items-center justify-between">
          <SecaoTitulo cor="brand">Funil de ativação</SecaoTitulo>
          <span className="text-[11px] text-slate-400 dark:text-slate-500">cada etapa = quem chegou nela ou adiante</span>
        </div>
        <Funil etapas={d.funil} alvo={d.alvo} />
      </Card>

      {/* Ritmo + Alertas lado a lado em telas largas. */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <Card className="p-5 lg:col-span-2">
          <div className="mb-3 flex items-center justify-between">
            <SecaoTitulo cor="brand">Ritmo · ações por dia</SecaoTitulo>
            <Legenda />
          </div>
          <Ritmo ritmo={d.ritmo} />
        </Card>
        <div className="space-y-3">
          <SecaoTitulo cor="brand">Onde agir agora</SecaoTitulo>
          {d.alertas.length === 0 ? (
            <Card className="border-emerald-200 bg-emerald-50/40 p-4 text-sm text-emerald-700 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-300">
              Sem gargalos graves no momento. Funil fluindo.
            </Card>
          ) : (
            d.alertas.map((a, i) => <AlertaCard key={i} a={a} />)
          )}
        </div>
      </div>
    </div>
  );
}

function KpiExec({ titulo, valor, sub, barra, estrela, alerta }: {
  titulo: string; valor: string; sub?: string; barra?: number; estrela?: boolean; alerta?: boolean;
}) {
  return (
    <Card className={cn("p-4", estrela && "border-brand/30 bg-gradient-to-br from-brand/5 to-white dark:border-brand-400/30 dark:from-brand-400/10 dark:to-slate-900")}>
      <div className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-slate-400 dark:text-slate-500">
        {estrela && (
          <svg className="h-3.5 w-3.5 text-brand dark:text-brand-300" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
            <path d="M12 2 15 9l7 .5-5.3 4.6L18.5 21 12 17l-6.5 4 1.8-6.9L2 9.5 9 9z" />
          </svg>
        )}
        {titulo}
      </div>
      <div className={cn("mt-2 text-2xl font-semibold tabular-nums", alerta ? "text-rose-600 dark:text-rose-300" : estrela ? "text-brand dark:text-brand-300" : "text-slate-900 dark:text-white")}>{valor}</div>
      {barra != null && (
        <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
          <div className={cn("h-full rounded-full", alerta ? "bg-rose-500" : estrela ? "bg-brand dark:bg-brand-400" : "bg-slate-400 dark:bg-slate-500")} style={{ width: `${Math.max(2, Math.min(100, barra))}%` }} />
        </div>
      )}
      {sub && <div className="mt-1.5 text-xs text-slate-400 dark:text-slate-500">{sub}</div>}
    </Card>
  );
}

function Funil({ etapas, alvo }: { etapas: Etapa[]; alvo: string }) {
  if (etapas.length === 0 || etapas[0].qtd === 0) {
    return <p className="text-sm text-slate-400 dark:text-slate-500">Sem contatos no funil ainda.</p>;
  }
  const topo = etapas[0].qtd;
  return (
    <div className="space-y-1.5">
      {etapas.map((e, i) => {
        const larg = topo > 0 ? Math.round((e.qtd / topo) * 100) : 0;
        const ant = i > 0 ? etapas[i - 1].qtd : null;
        const drop = ant != null && ant > 0 ? Math.round(((ant - e.qtd) / ant) * 100) : null;
        const ehAlvo = e.chave === alvo;
        return (
          <div key={e.chave}>
            {drop != null && drop > 0 && (
              <div className="flex items-center gap-1 pl-1 text-[10px] text-slate-400 dark:text-slate-500">
                <svg className="h-2.5 w-2.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M12 5v14M19 12l-7 7-7-7" /></svg>
                −{drop}%
              </div>
            )}
            <div className={cn("group relative flex items-center gap-3 rounded-lg px-3 py-2.5 transition", ehAlvo ? "bg-brand/5 ring-1 ring-inset ring-brand/30 dark:bg-brand-400/10 dark:ring-brand-400/30" : "hover:bg-slate-50 dark:hover:bg-slate-800/50")}>
              <div className="flex w-40 shrink-0 items-center gap-2">
                <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: e.cor || "#94a3b8" }} aria-hidden="true" />
                <span className={cn("truncate text-sm", ehAlvo ? "font-semibold text-brand dark:text-brand-300" : "font-medium text-slate-700 dark:text-slate-200")}>{e.nome}</span>
                {ehAlvo && <span className="rounded bg-brand/10 px-1 text-[9px] font-bold uppercase text-brand dark:bg-brand-400/15 dark:text-brand-300">meta</span>}
              </div>
              <div className="relative h-7 flex-1 overflow-hidden rounded-md bg-slate-100 dark:bg-slate-800">
                <div className="h-full rounded-md transition-all" style={{ width: `${Math.max(1.5, larg)}%`, backgroundColor: (e.cor || "#94a3b8") + (ehAlvo ? "" : "cc") }} />
              </div>
              <div className="flex w-24 shrink-0 items-baseline justify-end gap-1.5 tabular-nums">
                <span className="text-sm font-semibold text-slate-800 dark:text-slate-100">{fmt(e.qtd)}</span>
                <span className="text-xs text-slate-400 dark:text-slate-500">{larg}%</span>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function Legenda() {
  return (
    <div className="flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-slate-500 dark:text-slate-400">
      {(["whatsapp", "email", "ligacao"] as const).map((c) => (
        <span key={c} className="inline-flex items-center gap-1.5"><span className={cn("h-2 w-2 rounded-full", CANAL[c].dot)} /> {CANAL[c].nome}</span>
      ))}
    </div>
  );
}

function Ritmo({ ritmo }: { ritmo: RitmoDia[] }) {
  const dias = useMemo(() => {
    const m = new Map<string, Record<string, number>>();
    for (const r of ritmo) {
      const linha = m.get(r.dia) || {};
      linha[r.canal] = (linha[r.canal] || 0) + r.qtd;
      m.set(r.dia, linha);
    }
    return [...m.entries()].map(([dia, canais]) => ({
      dia,
      canais,
      total: Object.values(canais).reduce((a, b) => a + b, 0),
    }));
  }, [ritmo]);

  if (dias.length === 0) {
    return <p className="text-sm text-slate-400 dark:text-slate-500">Sem ações registradas no período.</p>;
  }
  const maxTotal = Math.max(...dias.map((d) => d.total), 1);
  // Em janelas longas, rotula só ~10 colunas para não poluir o eixo.
  const passo = Math.ceil(dias.length / 10);

  return (
    <div className="flex h-44 items-end gap-1">
      {dias.map((d, i) => (
        <div key={d.dia} className="group flex flex-1 flex-col items-center gap-1" title={`${rotuloData(d.dia)} · ${fmt(d.total)} ações`}>
          <div className="flex w-full flex-col-reverse items-stretch" style={{ height: `${Math.max(2, (d.total / maxTotal) * 100)}%` }}>
            {CANAL_ORDEM.map((c) => {
              const v = d.canais[c] || 0;
              if (v === 0) return null;
              return <div key={c} className={cn("w-full", CANAL[c].bar)} style={{ flexGrow: v }} title={`${CANAL[c].nome}: ${fmt(v)}`} />;
            })}
          </div>
          <span className="h-3 text-[9px] tabular-nums text-slate-400 dark:text-slate-500">{i % passo === 0 ? rotuloData(d.dia) : ""}</span>
        </div>
      ))}
    </div>
  );
}

function rotuloData(iso: string) {
  const [, m, dd] = iso.split("-");
  return `${dd}/${m}`;
}

function AlertaCard({ a }: { a: Alerta }) {
  const alerta = a.tom === "alerta";
  return (
    <Card className={cn("p-4", alerta ? "border-rose-200 bg-rose-50/50 dark:border-rose-500/30 dark:bg-rose-500/10" : "border-brand/20 bg-brand/5 dark:border-brand-400/25 dark:bg-brand-400/10")}>
      <p className={cn("text-sm font-semibold", alerta ? "text-rose-800 dark:text-rose-200" : "text-slate-800 dark:text-slate-100")}>{a.titulo}</p>
      <p className="mt-1 text-xs text-slate-600 dark:text-slate-300">{a.descricao}</p>
    </Card>
  );
}
