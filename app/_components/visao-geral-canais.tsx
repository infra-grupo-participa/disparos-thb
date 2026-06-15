"use client";

import { useCallback, useEffect, useState } from "react";
import { Card, Spinner, cn } from "@/app/_components/ui";
import { usePortal } from "@/app/_components/use-portal";

type Resumo = {
  whatsapp: { enviados: number; respondidos: number };
  email: { enviados: number; aberturas: number };
  ligacoes: { total: number; feitas: number; atendidas: number };
};

const taxa = (n: number, d: number) => (d > 0 ? Math.round((n / d) * 100) : 0);
const fmt = (n: number) => n.toLocaleString("pt-BR");

// Visão geral comparativa dos 3 canais de ação (volume + resultado + proporção).
// Cada canal tem cor própria; a barra mostra a proporção de volume entre eles.
// Dados de /api/dashboard/canais. Só dados reais.
export function VisaoGeralCanais({ desde, ate, edicao }: { desde?: string; ate?: string; edicao?: string }) {
  const { evento } = usePortal();
  const [d, setD] = useState<Resumo | null>(null);
  const [carregando, setCarregando] = useState(true);

  const carregar = useCallback(async () => {
    const params = new URLSearchParams({ evento });
    if (desde) params.set("desde", new Date(`${desde}T00:00:00`).toISOString());
    if (ate) params.set("ate", new Date(`${ate}T23:59:59`).toISOString());
    if (edicao) params.set("edicao", edicao);
    try {
      const r = await fetch(`/api/dashboard/canais?${params.toString()}`);
      const j = await r.json();
      if (j.ok) setD(j);
    } catch {
      /* mantém anterior */
    } finally {
      setCarregando(false);
    }
  }, [evento, desde, ate, edicao]);

  useEffect(() => { carregar(); }, [carregar]);

  if (carregando) {
    return <div className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white p-4 text-sm text-slate-400 dark:border-slate-800 dark:bg-slate-900"><Spinner /> Carregando visão geral…</div>;
  }
  if (!d) return null;

  const volWa = d.whatsapp.enviados;
  const volEm = d.email.enviados;
  const volLi = d.ligacoes.total;
  const totalVol = volWa + volEm + volLi;
  const pct = (v: number) => (totalVol > 0 ? Math.round((v / totalVol) * 100) : 0);

  const canais = [
    {
      chave: "wa", nome: "WhatsApp", fonte: "Unnichat", cor: "emerald",
      volume: volWa, volLabel: "enviados",
      resultado: `${taxa(d.whatsapp.respondidos, d.whatsapp.enviados)}%`, resLabel: "respondidos",
      detalhe: `${fmt(d.whatsapp.respondidos)} respostas`,
    },
    {
      chave: "em", nome: "E-mail", fonte: "ActiveCampaign", cor: "sky",
      volume: volEm, volLabel: "enviados",
      resultado: `${taxa(d.email.aberturas, d.email.enviados)}%`, resLabel: "abertura",
      detalhe: `${fmt(d.email.aberturas)} aberturas únicas`,
    },
    {
      chave: "li", nome: "Ligações", fonte: "Atende Simples", cor: "violet",
      volume: volLi, volLabel: "chamadas",
      resultado: `${taxa(d.ligacoes.atendidas, d.ligacoes.total)}%`, resLabel: "atendidas",
      detalhe: `${fmt(d.ligacoes.feitas)} feitas · ${fmt(d.ligacoes.atendidas)} atendidas`,
    },
  ] as const;

  const COR: Record<string, { dot: string; bar: string; ring: string; txt: string }> = {
    emerald: { dot: "bg-emerald-500", bar: "bg-emerald-500", ring: "ring-emerald-200 dark:ring-emerald-500/30", txt: "text-emerald-700 dark:text-emerald-300" },
    sky: { dot: "bg-sky-500", bar: "bg-sky-500", ring: "ring-sky-200 dark:ring-sky-500/30", txt: "text-sky-700 dark:text-sky-300" },
    violet: { dot: "bg-violet-500", bar: "bg-violet-500", ring: "ring-violet-200 dark:ring-violet-500/30", txt: "text-violet-700 dark:text-violet-300" },
  };

  return (
    <div className="space-y-4">
      {/* Cards por canal */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        {canais.map((c) => {
          const cor = COR[c.cor];
          return (
            <Card key={c.chave} className="p-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className={cn("h-2.5 w-2.5 rounded-full", cor.dot)} aria-hidden="true" />
                  <span className="text-sm font-semibold text-slate-800 dark:text-slate-100">{c.nome}</span>
                </div>
                <span className="text-[10px] uppercase tracking-wide text-slate-400 dark:text-slate-500">{c.fonte}</span>
              </div>
              <div className="mt-3 flex items-baseline gap-2">
                <span className="text-3xl font-semibold tabular-nums text-slate-900 dark:text-white">{fmt(c.volume)}</span>
                <span className="text-xs text-slate-400 dark:text-slate-500">{c.volLabel} · {pct(c.volume)}% do total</span>
              </div>
              <div className="mt-2 flex items-center justify-between border-t border-slate-100 pt-2 text-sm dark:border-slate-800">
                <span className="text-slate-500 dark:text-slate-400">{c.resLabel}</span>
                <span className={cn("rounded-full px-2 py-0.5 text-xs font-semibold ring-1 ring-inset", cor.ring, cor.txt)}>{c.resultado}</span>
              </div>
              <p className="mt-1.5 text-[11px] text-slate-400 dark:text-slate-500">{c.detalhe}</p>
            </Card>
          );
        })}
      </div>

      {/* Barra de proporção de volume entre os canais */}
      <Card className="p-4">
        <div className="mb-2 flex items-center justify-between">
          <span className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Proporção das ações</span>
          <span className="text-[11px] text-slate-400 dark:text-slate-500">{fmt(totalVol)} ações no período</span>
        </div>
        {totalVol === 0 ? (
          <p className="text-sm text-slate-400 dark:text-slate-500">Sem ações registradas no período.</p>
        ) : (
          <>
            <div className="flex h-3 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
              <div className="bg-emerald-500" style={{ width: `${pct(volWa)}%` }} title={`WhatsApp ${pct(volWa)}%`} />
              <div className="bg-sky-500" style={{ width: `${pct(volEm)}%` }} title={`E-mail ${pct(volEm)}%`} />
              <div className="bg-violet-500" style={{ width: `${pct(volLi)}%` }} title={`Ligações ${pct(volLi)}%`} />
            </div>
            <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-slate-500 dark:text-slate-400">
              <span className="inline-flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-emerald-500" /> WhatsApp {pct(volWa)}%</span>
              <span className="inline-flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-sky-500" /> E-mail {pct(volEm)}%</span>
              <span className="inline-flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-violet-500" /> Ligações {pct(volLi)}%</span>
            </div>
          </>
        )}
      </Card>
    </div>
  );
}
