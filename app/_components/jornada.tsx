"use client";

import { useCallback, useEffect, useState } from "react";
import { Card, EmptyState, Spinner, cn } from "@/app/_components/ui";
import { usePortal } from "@/app/_components/use-portal";

type Par = { c1: string; c2: string; alunos: number; convertidos: number };

const CANAIS = ["whatsapp", "email", "ligacao"] as const;
const ROTULO: Record<string, string> = { whatsapp: "WhatsApp", email: "E-mail", ligacao: "Ligação" };
const taxa = (n: number, d: number) => (d > 0 ? Math.round((n / d) * 100) : 0);
const fmt = (n: number) => n.toLocaleString("pt-BR");

// Cor da célula por intensidade de conversão (verde mais forte = converte mais).
function tomCelula(tx: number, alunos: number): string {
  if (alunos === 0) return "bg-slate-50 text-slate-300 dark:bg-slate-800/40 dark:text-slate-600";
  if (alunos < 5) return "bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400";
  if (tx >= 30) return "bg-emerald-500 text-white";
  if (tx >= 20) return "bg-emerald-400/80 text-white";
  if (tx >= 10) return "bg-emerald-200 text-emerald-900 dark:bg-emerald-500/30 dark:text-emerald-100";
  return "bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300";
}

// Jornada 3³: matriz 3×3 (1º contato × 2º contato) × taxa de conversão. Mostra
// qual combinação de canais mais leva o aluno a "ativado".
export function Jornada({ desde, ate }: { desde?: string; ate?: string }) {
  const { evento } = usePortal();
  const [pares, setPares] = useState<Par[]>([]);
  const [totais, setTotais] = useState<{ alunos: number; convertidos: number } | null>(null);
  const [carregando, setCarregando] = useState(true);

  const carregar = useCallback(async () => {
    try {
      const r = await fetch(`/api/dashboard/jornada?evento=${evento}`);
      const d = await r.json();
      if (d.ok) { setPares(d.pares ?? []); setTotais(d.totais ?? null); }
    } catch {
      /* mantém anterior */
    } finally {
      setCarregando(false);
    }
  }, [evento]);

  useEffect(() => { carregar(); }, [carregar]);

  if (carregando) {
    return <div className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white p-4 text-sm text-slate-400 dark:border-slate-800 dark:bg-slate-900"><Spinner /> Montando a matriz de jornadas…</div>;
  }
  if (pares.length === 0) {
    return (
      <EmptyState
        title="Sem jornadas com 2+ contatos ainda"
        description="A matriz aparece conforme os alunos recebem ao menos 2 ações (WhatsApp, e-mail ou ligação) registradas com canal."
      />
    );
  }

  const get = (c1: string, c2: string) => pares.find((p) => p.c1 === c1 && p.c2 === c2);
  // Melhor combinação (com volume relevante).
  const relevantes = pares.filter((p) => p.alunos >= 5);
  const melhor = relevantes.length
    ? relevantes.reduce((a, b) => (taxa(b.convertidos, b.alunos) > taxa(a.convertidos, a.alunos) ? b : a))
    : null;

  return (
    <div className="space-y-4">
      {totais && (
        <p className="text-xs text-slate-400 dark:text-slate-500">
          Conversão = chegar em <strong className="font-medium text-slate-500 dark:text-slate-400">ativado</strong>. Cada célula: % dos alunos que começaram por um canal e tiveram o 2º contato por outro.
        </p>
      )}

      <Card className="overflow-x-auto p-4">
        <table className="w-full min-w-[28rem] border-separate" style={{ borderSpacing: 6 }}>
          <thead>
            <tr>
              <th className="text-left text-[11px] font-medium uppercase tracking-wide text-slate-400 dark:text-slate-500">
                1º contato ↓ / 2º →
              </th>
              {CANAIS.map((c) => (
                <th key={c} className="text-center text-xs font-semibold text-slate-600 dark:text-slate-300">{ROTULO[c]}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {CANAIS.map((c1) => (
              <tr key={c1}>
                <td className="pr-2 text-xs font-semibold text-slate-600 dark:text-slate-300">{ROTULO[c1]}</td>
                {CANAIS.map((c2) => {
                  const p = get(c1, c2);
                  const alunos = p?.alunos ?? 0;
                  const conv = p?.convertidos ?? 0;
                  const tx = taxa(conv, alunos);
                  const ehMelhor = melhor && melhor.c1 === c1 && melhor.c2 === c2;
                  return (
                    <td key={c2} className="p-0">
                      <div
                        title={`${ROTULO[c1]} → ${ROTULO[c2]} · ${alunos} alunos · ${conv} convertidos`}
                        className={cn(
                          "flex h-16 flex-col items-center justify-center rounded-lg ring-1 ring-inset ring-black/5 dark:ring-white/5",
                          tomCelula(tx, alunos),
                          ehMelhor && "outline outline-2 outline-brand",
                        )}
                      >
                        <span className="text-base font-bold tabular-nums">{alunos > 0 ? `${tx}%` : "—"}</span>
                        <span className="text-[10px] opacity-80">{alunos > 0 ? `${conv}/${alunos}` : "sem dados"}</span>
                      </div>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      {melhor && (
        <p className="text-sm text-emerald-700 dark:text-emerald-300">
          🏆 Combinação que mais converte: <strong>{ROTULO[melhor.c1]} → {ROTULO[melhor.c2]}</strong> — {taxa(melhor.convertidos, melhor.alunos)}% ({melhor.convertidos}/{melhor.alunos}).
        </p>
      )}
      <p className="text-[11px] text-slate-400 dark:text-slate-500">
        Linhas = canal do 1º contato; colunas = canal do 2º contato. Células com menos de 5 alunos ficam em cinza (amostra pequena). O e-mail entra quando disparado pelo sistema.
      </p>
    </div>
  );
}
