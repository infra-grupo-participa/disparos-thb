"use client";

import { useCallback, useEffect, useState } from "react";
import { Card, EmptyState, Spinner, cn } from "@/app/_components/ui";
import { usePortal } from "@/app/_components/use-portal";

type LinhaJornada = { sequencia: string; alunos: number; convertidos: number };

const taxa = (n: number, d: number) => (d > 0 ? Math.round((n / d) * 100) : 0);
const fmt = (n: number) => n.toLocaleString("pt-BR");

const COR_CANAL: Record<string, string> = {
  whatsapp: "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300",
  email: "bg-sky-100 text-sky-700 dark:bg-sky-500/15 dark:text-sky-300",
  ligacao: "bg-violet-100 text-violet-700 dark:bg-violet-500/15 dark:text-violet-300",
};
const ROTULO: Record<string, string> = { whatsapp: "WhatsApp", email: "E-mail", ligacao: "Ligação" };

// Jornada 3³: sequências de canais (WhatsApp → E-mail → Ligação, etc.) ranqueadas
// pela taxa de conversão (estágio "ativado"). Mostra qual combinação mais converte.
export function Jornada({ desde, ate }: { desde?: string; ate?: string }) {
  const { evento } = usePortal();
  const [seqs, setSeqs] = useState<LinhaJornada[]>([]);
  const [totais, setTotais] = useState<{ alunos: number; convertidos: number } | null>(null);
  const [carregando, setCarregando] = useState(true);

  const carregar = useCallback(async () => {
    try {
      const r = await fetch(`/api/dashboard/jornada?evento=${evento}`);
      const d = await r.json();
      if (d.ok) { setSeqs(d.sequencias ?? []); setTotais(d.totais ?? null); }
    } catch {
      /* mantém anterior */
    } finally {
      setCarregando(false);
    }
  }, [evento]);

  useEffect(() => { carregar(); }, [carregar]);

  if (carregando) {
    return <div className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white p-4 text-sm text-slate-400 dark:border-slate-800 dark:bg-slate-900"><Spinner /> Reconstruindo jornadas…</div>;
  }
  if (seqs.length === 0) {
    return (
      <EmptyState
        title="Sem jornadas ainda"
        description="As sequências de canais aparecem aqui conforme os alunos recebem ações (WhatsApp, e-mail, ligação) registradas com canal."
      />
    );
  }

  // Ordena por taxa de conversão entre as com volume relevante (>= 5 alunos),
  // mantendo as demais embaixo por volume.
  const relevantes = [...seqs].filter((s) => s.alunos >= 5).sort((a, b) => taxa(b.convertidos, b.alunos) - taxa(a.convertidos, a.alunos));
  const resto = seqs.filter((s) => s.alunos < 5).sort((a, b) => b.alunos - a.alunos);
  const ordenadas = [...relevantes, ...resto];
  const maxTaxa = Math.max(1, ...seqs.map((s) => taxa(s.convertidos, s.alunos)));

  return (
    <div className="space-y-4">
      {totais && (
        <p className="text-xs text-slate-400 dark:text-slate-500">
          Conversão = chegar em <strong className="font-medium text-slate-500 dark:text-slate-400">ativado</strong> · {fmt(totais.convertidos)} de {fmt(totais.alunos)} alunos com ação registrada ({taxa(totais.convertidos, totais.alunos)}%)
        </p>
      )}

      <Card className="overflow-hidden">
        <div className="divide-y divide-slate-100 dark:divide-slate-800">
          {ordenadas.map((s, i) => {
            const tx = taxa(s.convertidos, s.alunos);
            const canais = s.sequencia.split(" → ");
            const relevante = s.alunos >= 5;
            return (
              <div key={s.sequencia + i} className="flex items-center gap-3 px-4 py-3">
                <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5">
                  {canais.map((c, j) => (
                    <span key={j} className="flex items-center gap-1.5">
                      {j > 0 && <span className="text-slate-300 dark:text-slate-600" aria-hidden>→</span>}
                      <span className={cn("rounded-full px-2 py-0.5 text-xs font-medium", COR_CANAL[c] ?? "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300")}>
                        {ROTULO[c] ?? c}
                      </span>
                    </span>
                  ))}
                </div>
                <div className="w-28 shrink-0">
                  <div className="h-1.5 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
                    <div className={cn("h-full rounded-full", relevante ? "bg-brand" : "bg-slate-300 dark:bg-slate-600")} style={{ width: `${Math.max(2, (tx / maxTaxa) * 100)}%` }} />
                  </div>
                </div>
                <div className="w-24 shrink-0 text-right text-sm">
                  <span className={cn("font-semibold tabular-nums", relevante ? "text-brand dark:text-brand-300" : "text-slate-400 dark:text-slate-500")}>{tx}%</span>
                  <span className="ml-1 text-xs text-slate-400 dark:text-slate-500">({s.convertidos}/{s.alunos})</span>
                </div>
              </div>
            );
          })}
        </div>
      </Card>

      <p className="text-[11px] text-slate-400 dark:text-slate-500">
        Sequência = ordem do 1º toque de cada canal por aluno. Combinações com menos de 5 alunos aparecem em cinza (amostra pequena). O e-mail só entra na sequência quando disparado pelo sistema.
      </p>
    </div>
  );
}
