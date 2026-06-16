"use client";

import { useCallback, useEffect, useState } from "react";
import { Card, EmptyState, Spinner } from "@/app/_components/ui";
import { SecaoTitulo } from "@/app/_components/kpi";
import { usePortal } from "@/app/_components/use-portal";

type LinhaOperador = {
  operador: string; disparos: number; ligacoes: number; movimentacoes: number; notas: number; total: number;
};

const fmt = (n: number) => n.toLocaleString("pt-BR");

// Painel de produtividade dos operadores: o que cada um fez (refletido no
// histórico dos alunos) — disparos, ligações, movimentações e notas, por evento.
export function Operadores({ desde, ate }: { desde?: string; ate?: string }) {
  const { evento, nome } = usePortal();
  const [linhas, setLinhas] = useState<LinhaOperador[]>([]);
  const [carregando, setCarregando] = useState(true);

  const carregar = useCallback(async () => {
    const params = new URLSearchParams({ evento });
    if (desde) params.set("desde", new Date(`${desde}T00:00:00`).toISOString());
    if (ate) params.set("ate", new Date(`${ate}T23:59:59`).toISOString());
    try {
      const r = await fetch(`/api/operadores?${params.toString()}`);
      const d = await r.json();
      if (d.ok) setLinhas(d.operadores ?? []);
    } catch {
      /* mantém anterior */
    } finally {
      setCarregando(false);
    }
  }, [evento, desde, ate]);

  useEffect(() => { carregar(); }, [carregar]);

  if (carregando) {
    return <div className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white p-4 text-sm text-slate-400 dark:border-slate-800 dark:bg-slate-900"><Spinner /> Carregando operadores…</div>;
  }
  if (linhas.length === 0) {
    return (
      <EmptyState
        title="Sem ações registradas"
        description={`Ações dos operadores (disparos, ligações, movimentações, notas) sobre alunos do ${nome} aparecem aqui no período.`}
        icon={
          <svg className="h-9 w-9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" />
          </svg>
        }
      />
    );
  }

  return (
    <div className="space-y-3">
      <p className="text-xs text-slate-400 dark:text-slate-500">Ações registradas no histórico dos alunos do {nome}, por operador.</p>
      <Card className="overflow-hidden">
        <div className="border-b border-slate-100 px-4 py-3 dark:border-slate-800">
          <SecaoTitulo cor="brand">Produtividade por operador</SecaoTitulo>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500 dark:bg-slate-800/60 dark:text-slate-400">
              <tr>
                <th className="px-4 py-2.5 font-semibold">Operador</th>
                <th className="px-4 py-2.5 font-semibold">Disparos</th>
                <th className="px-4 py-2.5 font-semibold">Ligações</th>
                <th className="px-4 py-2.5 font-semibold">Kanban</th>
                <th className="px-4 py-2.5 font-semibold">Notas</th>
                <th className="px-4 py-2.5 font-semibold">Total</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {linhas.map((o) => (
                <tr key={o.operador} className="transition hover:bg-slate-50/60 dark:hover:bg-slate-800/60">
                  <td className="px-4 py-2.5 font-medium text-slate-800 dark:text-slate-200">{o.operador}</td>
                  <td className="px-4 py-2.5 tabular-nums text-slate-600 dark:text-slate-300">{fmt(o.disparos)}</td>
                  <td className="px-4 py-2.5 tabular-nums text-slate-600 dark:text-slate-300">{fmt(o.ligacoes)}</td>
                  <td className="px-4 py-2.5 tabular-nums text-slate-600 dark:text-slate-300">{fmt(o.movimentacoes)}</td>
                  <td className="px-4 py-2.5 tabular-nums text-slate-600 dark:text-slate-300">{fmt(o.notas)}</td>
                  <td className="px-4 py-2.5 tabular-nums font-semibold text-brand dark:text-brand-300">{fmt(o.total)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
      <p className="text-[11px] text-slate-400 dark:text-slate-500">
        “cs” = ações feitas pelo sistema/sem operador identificado (disparos antigos). Daqui pra frente cada ação registra quem a executou.
      </p>
    </div>
  );
}
