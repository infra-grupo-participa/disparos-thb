"use client";

import { useCallback, useEffect, useState } from "react";
import { Card, EmptyState, Spinner } from "@/app/_components/ui";
import { usePortal } from "@/app/_components/use-portal";

type Totais = {
  total: number; feitas: number; recebidas: number; atendidas: number;
  abandonadas: number; recusadas: number; nao_atendidas: number; falhou: number;
  dur_total_seg: number; dur_media_seg: number | null; vinculadas_evento: number;
};
type Atendente = { atendente: string; total: number; atendidas: number; feitas: number; dur_total_seg: number };

const taxa = (n: number, d: number) => (d > 0 ? Math.round((n / d) * 100) : 0);
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
  const [porAtendente, setPorAtendente] = useState<Atendente[]>([]);
  const [carregando, setCarregando] = useState(true);

  const carregar = useCallback(async () => {
    const params = new URLSearchParams({ evento });
    if (desde) params.set("desde", new Date(`${desde}T00:00:00`).toISOString());
    if (ate) params.set("ate", new Date(`${ate}T23:59:59`).toISOString());
    try {
      const r = await fetch(`/api/ligacoes/metricas?${params.toString()}`);
      const d = await r.json();
      if (d.ok) { setTotais(d.totais); setPorAtendente(d.porAtendente); }
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
        <Kpi titulo="Atendidas" valor={`${taxa(t.atendidas, t.total)}%`} sub={`${t.atendidas} de ${t.total}`} />
        <Kpi titulo="Tempo total" valor={dur(t.dur_total_seg)} sub={`média ${dur(t.dur_media_seg)}`} />
        <Kpi titulo="Sem êxito" valor={`${t.nao_atendidas + t.abandonadas + t.recusadas + t.falhou}`} sub={`${t.nao_atendidas} não atend · ${t.abandonadas} aband · ${t.recusadas} recus`} />
      </div>

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

function Kpi({ titulo, valor, sub }: { titulo: string; valor: string; sub?: string }) {
  return (
    <Card className="p-4">
      <div className="text-xs font-medium uppercase tracking-wide text-slate-400 dark:text-slate-500">{titulo}</div>
      <div className="mt-2 text-2xl font-semibold tabular-nums text-slate-900 dark:text-white">{valor}</div>
      {sub && <div className="mt-1 text-xs text-slate-400 dark:text-slate-500">{sub}</div>}
    </Card>
  );
}
