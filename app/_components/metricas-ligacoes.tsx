"use client";

import { useCallback, useEffect, useState } from "react";
import { Card, EmptyState, Spinner, cn } from "@/app/_components/ui";
import { usePortal } from "@/app/_components/use-portal";

type Totais = {
  total: number; feitas: number; recebidas: number; atendidas: number;
  abandonadas: number; recusadas: number; nao_atendidas: number; falhou: number;
  dur_total_seg: number; dur_media_seg: number | null; vinculadas_evento: number; numeros_distintos: number;
};
type Atendente = { atendente: string; total: number; atendidas: number; feitas: number; dur_total_seg: number };
type DiaSerie = { dia: string; total: number; atendidas: number };
type HoraSerie = { hora: number; total: number; atendidas: number };

const taxa = (n: number, d: number) => (d > 0 ? Math.round((n / d) * 100) : 0);
const fmt = (n: number) => n.toLocaleString("pt-BR");
function dur(seg: number | null) {
  if (!seg) return "—";
  const m = Math.floor(seg / 60), s = seg % 60;
  if (m >= 60) return `${Math.floor(m / 60)}h${m % 60}min`;
  return m > 0 ? `${m}min${s ? ` ${s}s` : ""}` : `${s}s`;
}

// Produtividade do comercial nas ligações (Atende Simples), por evento.
// Dados de /api/ligacoes/metricas. Espelha o painel de e-mail.
export function MetricasLigacoes({ desde, ate }: { desde?: string; ate?: string }) {
  const { evento, nome } = usePortal();
  const [totais, setTotais] = useState<Totais | null>(null);
  const [serie, setSerie] = useState<DiaSerie[]>([]);
  const [porHora, setPorHora] = useState<HoraSerie[]>([]);
  const [porAtendente, setPorAtendente] = useState<Atendente[]>([]);
  const [carregando, setCarregando] = useState(true);

  const carregar = useCallback(async () => {
    const params = new URLSearchParams({ evento });
    if (desde) params.set("desde", new Date(`${desde}T00:00:00`).toISOString());
    if (ate) params.set("ate", new Date(`${ate}T23:59:59`).toISOString());
    try {
      const r = await fetch(`/api/ligacoes/metricas?${params.toString()}`);
      const d = await r.json();
      if (d.ok) { setTotais(d.totais); setPorAtendente(d.porAtendente); setSerie(d.serie ?? []); setPorHora(d.porHora ?? []); }
    } catch {
      /* mantém dados anteriores */
    } finally {
      setCarregando(false);
    }
  }, [evento, desde, ate]);

  useEffect(() => { carregar(); }, [carregar]);

  if (carregando) {
    return <div className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white p-4 text-sm text-slate-400 dark:border-slate-800 dark:bg-slate-900"><Spinner /> Carregando ligações…</div>;
  }
  if (!totais || totais.total === 0) {
    return (
      <EmptyState
        title="Nenhuma ligação registrada"
        description="As ligações do Atende Simples aparecem aqui assim que o webhook estiver configurado e as chamadas começarem a chegar."
        icon={
          <svg className="h-9 w-9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.96.36 1.9.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.91.34 1.85.57 2.81.7A2 2 0 0 1 22 16.92Z" />
          </svg>
        }
      />
    );
  }

  const t = totais;
  return (
    <div className="space-y-5">
      <p className="text-xs text-slate-400 dark:text-slate-500">
        Produtividade geral do comercial no período · <span className="font-medium text-slate-500 dark:text-slate-400">{t.vinculadas_evento}</span> de {t.total} vinculadas a alunos do {nome}
      </p>

      {/* KPIs principais */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi titulo="Ligações" valor={`${t.total}`} sub={`${t.feitas} feitas · ${t.recebidas} recebidas`} />
        <Kpi titulo="Atendidas" valor={`${taxa(t.atendidas, t.total)}%`} sub={`${t.atendidas} atendidas`} />
        <Kpi titulo="Tempo falado" valor={dur(t.dur_total_seg)} sub={`média ${dur(t.dur_media_seg)} por atendida`} />
        <Kpi titulo="Números discados" valor={fmt(t.numeros_distintos)} sub={t.numeros_distintos > 0 ? `${(t.total / t.numeros_distintos).toFixed(1)} tentativas/número` : "—"} />
      </div>

      {/* Série por dia — volume + atendidas */}
      {serie.length > 0 && (
        <Card className="p-4">
          <span className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Ligações por dia</span>
          <SerieDia serie={serie} />
        </Card>
      )}

      {/* Melhor horário — atendimento por faixa do dia */}
      {porHora.length > 0 && (
        <Card className="p-4">
          <span className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Melhor horário para ligar <span className="font-normal normal-case text-slate-400">(horário de Brasília · % atendidas)</span></span>
          <MelhorHorario porHora={porHora} />
        </Card>
      )}

      {/* Ranking por atendente */}
      <Card className="overflow-hidden">
        <div className="border-b border-slate-100 px-4 py-3 dark:border-slate-800">
          <span className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Produtividade por atendente</span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500 dark:bg-slate-800/60 dark:text-slate-400">
              <tr>
                <th className="px-4 py-2.5 font-semibold">Atendente</th>
                <th className="px-4 py-2.5 font-semibold">Ligações</th>
                <th className="px-4 py-2.5 font-semibold">Feitas</th>
                <th className="px-4 py-2.5 font-semibold">Atendidas</th>
                <th className="px-4 py-2.5 font-semibold">Tempo</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {porAtendente.map((a) => (
                <tr key={a.atendente} className="transition hover:bg-slate-50/60 dark:hover:bg-slate-800/60">
                  <td className="px-4 py-2.5 font-medium text-slate-800 dark:text-slate-200">{a.atendente}</td>
                  <td className="px-4 py-2.5 tabular-nums text-slate-600 dark:text-slate-300">{a.total}</td>
                  <td className="px-4 py-2.5 tabular-nums text-slate-600 dark:text-slate-300">{a.feitas}</td>
                  <td className="px-4 py-2.5 tabular-nums">
                    <span className="font-semibold text-emerald-600 dark:text-emerald-400">{a.atendidas}</span>
                    <span className="text-slate-400"> · {taxa(a.atendidas, a.total)}%</span>
                  </td>
                  <td className="px-4 py-2.5 tabular-nums text-slate-600 dark:text-slate-300">{dur(a.dur_total_seg)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}

function SerieDia({ serie }: { serie: DiaSerie[] }) {
  const max = Math.max(1, ...serie.map((d) => d.total));
  const fmtDia = (iso: string) => { const [, m, d] = iso.split("-"); return `${d}/${m}`; };
  return (
    <>
      <div className="mt-3 flex items-end gap-1.5 overflow-x-auto pb-1">
        {serie.map((d) => {
          const h = Math.max(4, Math.round((d.total / max) * 84));
          const hAt = d.total > 0 ? Math.round((d.atendidas / d.total) * h) : 0;
          return (
            <div key={d.dia} className="flex shrink-0 flex-col items-center gap-1" title={`${fmtDia(d.dia)} · ${d.total} ligações · ${d.atendidas} atendidas`}>
              <div className="flex w-6 flex-col justify-end rounded-t bg-slate-200 dark:bg-slate-700" style={{ height: h }}>
                <div className="w-full rounded-t bg-violet-500" style={{ height: hAt }} />
              </div>
              <span className="text-[9px] tabular-nums text-slate-400 dark:text-slate-500">{fmtDia(d.dia)}</span>
            </div>
          );
        })}
      </div>
      <div className="mt-1 flex items-center gap-3 text-[11px] text-slate-400 dark:text-slate-500">
        <span className="inline-flex items-center gap-1.5"><span className="h-2 w-2 rounded-sm bg-violet-500" /> atendidas</span>
        <span className="inline-flex items-center gap-1.5"><span className="h-2 w-2 rounded-sm bg-slate-200 dark:bg-slate-700" /> não atendidas</span>
      </div>
    </>
  );
}

function MelhorHorario({ porHora }: { porHora: HoraSerie[] }) {
  const comVolume = porHora.filter((h) => h.total >= 5);
  const melhor = comVolume.length
    ? comVolume.reduce((a, b) => (b.atendidas / b.total > a.atendidas / a.total ? b : a))
    : null;
  const maxTaxa = Math.max(1, ...porHora.map((h) => taxa(h.atendidas, h.total)));
  return (
    <>
      <div className="mt-3 flex items-end gap-1 overflow-x-auto pb-1">
        {porHora.map((h) => {
          const tx = taxa(h.atendidas, h.total);
          const alt = Math.max(4, Math.round((tx / maxTaxa) * 72));
          const ehMelhor = melhor?.hora === h.hora;
          return (
            <div key={h.hora} className="flex shrink-0 flex-col items-center gap-1" title={`${h.hora}h · ${h.total} ligações · ${tx}% atendidas`}>
              <div className={cn("w-6 rounded-t", ehMelhor ? "bg-emerald-500" : "bg-slate-300 dark:bg-slate-600")} style={{ height: alt }} />
              <span className="text-[9px] tabular-nums text-slate-400 dark:text-slate-500">{h.hora}h</span>
            </div>
          );
        })}
      </div>
      {melhor && (
        <p className="mt-1 text-xs text-emerald-600 dark:text-emerald-400">
          Melhor faixa: <strong>{melhor.hora}h</strong> — {taxa(melhor.atendidas, melhor.total)}% atendidas em {melhor.total} ligações.
        </p>
      )}
    </>
  );
}

function Kpi({ titulo, valor, sub }: { titulo: string; valor: string; sub?: string }) {
  return (
    <Card className="p-4">
      <div className="text-xs font-medium uppercase tracking-wide text-slate-400 dark:text-slate-500">{titulo}</div>
      <div className="mt-2 text-2xl font-semibold tabular-nums text-slate-900 dark:text-white">{valor}</div>
      {sub && <div className="mt-1 text-xs text-slate-400 dark:text-slate-500">{sub}</div>}
    </Card>
  );
}
