"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Button, Card, Spinner, cn, fieldClass } from "@/app/_components/ui";
import { MarcaPortal } from "@/app/_components/marca";
import { HmVisao } from "@/app/hm/_components/hm-visao";
import { useMe } from "@/app/_components/use-me";

// Registro de atividade por colaborador (A1). Responde "quem fez o quê" na
// esteira HM no período — movimentações, notas, disparos e as demais ações
// assinadas (responsável, tag, pagamento, cadastro). A captura é a timeline; esta
// tela é a leitura agregada por pessoa.

type Colaborador = {
  colaborador: string;
  total: number; movimentacoes: number; notas: number; disparos: number; outras: number;
  cards: number; ultima: string | null;
};

// dd/mm sem hora para o eixo; a hora exata fica no title.
function fmt(v: string | null): string {
  if (!v) return "—";
  const d = new Date(v);
  return isNaN(d.getTime()) ? "—" : d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "2-digit" });
}
function haQuanto(v: string | null): string {
  if (!v) return "";
  const d = new Date(v);
  if (isNaN(d.getTime())) return "";
  const dias = Math.floor((Date.now() - d.getTime()) / 86400000);
  if (dias <= 0) return "hoje";
  if (dias === 1) return "ontem";
  if (dias < 30) return `há ${dias} dias`;
  return "";
}
// AAAA-MM-DD local de N dias atrás — para os inputs de data.
function isoDia(offset = 0): string {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  return d.toISOString().slice(0, 10);
}

export default function HmAtividadePage() {
  const { podeVerTudo } = useMe();
  const [de, setDe] = useState(isoDia(-30));
  const [ate, setAte] = useState(isoDia(0));
  const [linhas, setLinhas] = useState<Colaborador[]>([]);
  const [carregando, setCarregando] = useState(true);

  const carregar = useCallback(async () => {
    setCarregando(true);
    try {
      const p = new URLSearchParams();
      if (de) p.set("de", de);
      // `ate` do input é inclusivo; a API é exclusiva — manda o dia seguinte.
      if (ate) {
        const d = new Date(ate + "T00:00:00");
        d.setDate(d.getDate() + 1);
        p.set("ate", d.toISOString().slice(0, 10));
      }
      const r = await fetch(`/api/hm/atividade?${p.toString()}`);
      const d = await r.json();
      if (d.ok) setLinhas(d.colaboradores);
    } finally {
      setCarregando(false);
    }
  }, [de, ate]);

  useEffect(() => { carregar(); }, [carregar]);

  const totais = useMemo(() => linhas.reduce(
    (a, l) => ({
      total: a.total + l.total, movimentacoes: a.movimentacoes + l.movimentacoes,
      notas: a.notas + l.notas, disparos: a.disparos + l.disparos, outras: a.outras + l.outras,
    }),
    { total: 0, movimentacoes: 0, notas: 0, disparos: 0, outras: 0 },
  ), [linhas]);

  const atalhos: Array<{ label: string; de: number }> = [
    { label: "7 dias", de: -7 }, { label: "30 dias", de: -30 }, { label: "90 dias", de: -90 },
  ];

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="flex items-center gap-2.5">
            <MarcaPortal portal="hm" altura="h-7" comNome={false} />
            <h1 className="text-xl font-semibold tracking-tight text-slate-900 dark:text-slate-100">Atividade · Holding Masters</h1>
          </div>
          <p className="mt-0.5 text-sm text-slate-500 dark:text-slate-400">
            O que cada colaborador fez na esteira — movimentações, notas, disparos e as demais ações assinadas.
          </p>
        </div>
        <HmVisao atual="atividade" filtros={{}} podeConfig={podeVerTudo()} />
      </div>

      {/* Período */}
      <div className="mb-3 flex flex-wrap items-center gap-2 rounded-xl border border-slate-200 bg-white p-2 dark:border-slate-800 dark:bg-slate-900">
        <div className="inline-flex shrink-0 rounded-lg bg-slate-100 p-0.5 dark:bg-slate-800/80">
          {atalhos.map((a) => {
            const ativo = de === isoDia(a.de) && ate === isoDia(0);
            return (
              <button
                key={a.label}
                onClick={() => { setDe(isoDia(a.de)); setAte(isoDia(0)); }}
                className={cn("rounded-md px-3 py-1.5 text-sm font-medium transition",
                  ativo ? "bg-white text-slate-900 shadow-card dark:bg-slate-700 dark:text-slate-100"
                        : "text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200")}
              >
                {a.label}
              </button>
            );
          })}
        </div>
        <label className="flex items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400">
          De <input type="date" value={de} max={ate} onChange={(e) => setDe(e.target.value)} className={cn(fieldClass, "w-auto")} />
        </label>
        <label className="flex items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400">
          Até <input type="date" value={ate} max={isoDia(0)} onChange={(e) => setAte(e.target.value)} className={cn(fieldClass, "w-auto")} />
        </label>
      </div>

      <Card className="overflow-hidden">
        {carregando ? (
          <div className="flex items-center justify-center gap-2 p-10 text-sm text-slate-400"><Spinner /> carregando…</div>
        ) : linhas.length === 0 ? (
          <p className="p-10 text-center text-sm text-slate-400">Nenhuma atividade de colaborador neste período.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-left text-xs uppercase tracking-wide text-slate-400 dark:border-slate-800 dark:text-slate-500">
                  <th className="px-4 py-2.5 font-medium">Colaborador</th>
                  <th className="px-3 py-2.5 text-right font-medium">Total</th>
                  <th className="px-3 py-2.5 text-right font-medium">Movimentações</th>
                  <th className="px-3 py-2.5 text-right font-medium">Notas</th>
                  <th className="px-3 py-2.5 text-right font-medium">Disparos</th>
                  <th className="px-3 py-2.5 text-right font-medium" title="Responsável, tag, pagamento, cadastro…">Outras</th>
                  <th className="px-3 py-2.5 text-right font-medium">Cards</th>
                  <th className="px-4 py-2.5 text-right font-medium">Última</th>
                </tr>
              </thead>
              <tbody>
                {linhas.map((l) => (
                  <tr key={l.colaborador} className="border-b border-slate-100 last:border-0 hover:bg-slate-50 dark:border-slate-800/60 dark:hover:bg-slate-800/40">
                    <td className="px-4 py-2.5 font-medium text-slate-800 dark:text-slate-100">{l.colaborador}</td>
                    <td className="px-3 py-2.5 text-right font-semibold tabular-nums text-slate-900 dark:text-white">{l.total}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-slate-600 dark:text-slate-300">{l.movimentacoes || "—"}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-slate-600 dark:text-slate-300">{l.notas || "—"}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-slate-600 dark:text-slate-300">{l.disparos || "—"}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-slate-600 dark:text-slate-300">{l.outras || "—"}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-slate-500 dark:text-slate-400">{l.cards}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums text-slate-500 dark:text-slate-400" title={l.ultima ?? ""}>
                      {fmt(l.ultima)}{haQuanto(l.ultima) && <span className="ml-1 text-[11px] text-slate-400">· {haQuanto(l.ultima)}</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-slate-200 font-semibold dark:border-slate-700">
                  <td className="px-4 py-2.5 text-slate-700 dark:text-slate-200">{linhas.length} colaborador(es)</td>
                  <td className="px-3 py-2.5 text-right tabular-nums text-slate-900 dark:text-white">{totais.total}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums text-slate-600 dark:text-slate-300">{totais.movimentacoes}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums text-slate-600 dark:text-slate-300">{totais.notas}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums text-slate-600 dark:text-slate-300">{totais.disparos}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums text-slate-600 dark:text-slate-300">{totais.outras}</td>
                  <td className="px-3 py-2.5" />
                  <td className="px-4 py-2.5" />
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
