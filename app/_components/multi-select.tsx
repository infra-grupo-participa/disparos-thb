"use client";

import { useEffect, useRef, useState } from "react";
import { cn, fieldCompactClass } from "./ui";

// Filtro de seleção múltipla — o <select multiple> nativo é inusável (ctrl+
// clique, sem resumo, sem grupos), então o campo é um gatilho com popover de
// checkboxes. Dentro do mesmo filtro a leitura é OU ("HT ATM ou Ex aluno");
// entre filtros continua E — quem soma as condições é o servidor.
//
// `grupos` separa as opções em blocos com cabeçalho (ex.: canais fixos × os
// demais); label null = bloco sem cabeçalho (o caso comum de lista única).
export type GrupoOpcoes = { label: string | null; itens: string[] };

type Props = {
  /** Nome do filtro no resumo do gatilho ("Canal", "Responsável"…). */
  rotulo: string;
  grupos: GrupoOpcoes[];
  selecionadas: string[];
  onChange: (v: string[]) => void;
  className?: string;
};

export function MultiSelect({ rotulo, grupos, selecionadas, onChange, className }: Props) {
  const [aberto, setAberto] = useState(false);
  const raiz = useRef<HTMLDivElement>(null);

  // Fecha no clique fora e no Escape — um popover que só fecha reabrindo o
  // gatilho vira armadilha de foco.
  useEffect(() => {
    if (!aberto) return;
    const clique = (e: MouseEvent) => {
      if (!raiz.current?.contains(e.target as Node)) setAberto(false);
    };
    const tecla = (e: KeyboardEvent) => {
      if (e.key === "Escape") setAberto(false);
    };
    document.addEventListener("mousedown", clique);
    document.addEventListener("keydown", tecla);
    return () => {
      document.removeEventListener("mousedown", clique);
      document.removeEventListener("keydown", tecla);
    };
  }, [aberto]);

  function alternar(item: string) {
    onChange(selecionadas.includes(item) ? selecionadas.filter((x) => x !== item) : [...selecionadas, item]);
  }

  // O resumo diz o estado sem abrir: nada → "todos"; um → o próprio nome;
  // vários → a contagem.
  const resumo =
    selecionadas.length === 0 ? `${rotulo}: todos` : selecionadas.length === 1 ? selecionadas[0] : `${rotulo}: ${selecionadas.length}`;

  return (
    <div ref={raiz} className={cn("relative", className)}>
      <button
        type="button"
        onClick={() => setAberto((a) => !a)}
        className={cn(
          fieldCompactClass,
          "flex items-center gap-1.5 text-left",
          selecionadas.length > 0 && "border-brand/50 text-slate-900 dark:border-brand-400/50 dark:text-slate-100",
        )}
        title={selecionadas.length ? selecionadas.join(", ") : rotulo}
      >
        <span className="max-w-[11rem] truncate">{resumo}</span>
        {selecionadas.length > 1 && (
          <span className="rounded-full bg-brand/10 px-1.5 text-[10px] font-semibold tabular-nums text-brand dark:bg-brand-400/15 dark:text-brand-300">
            {selecionadas.length}
          </span>
        )}
        <svg className={cn("h-3.5 w-3.5 shrink-0 text-slate-400 transition", aberto && "rotate-180")} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m6 9 6 6 6-6" /></svg>
      </button>

      {aberto && (
        <div className="absolute left-0 top-full z-30 mt-1 max-h-72 w-max min-w-full overflow-y-auto rounded-lg border border-slate-200 bg-white py-1 shadow-pop dark:border-slate-700 dark:bg-slate-900">
          {grupos.filter((g) => g.itens.length > 0).map((g, gi) => (
            <div key={g.label ?? gi}>
              {g.label && (
                <div className={cn(
                  "px-3 pb-0.5 pt-1.5 text-[10px] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500",
                  gi > 0 && "mt-1 border-t border-slate-100 dark:border-slate-800",
                )}>
                  {g.label}
                </div>
              )}
              {g.itens.map((item) => {
                const marcado = selecionadas.includes(item);
                return (
                  <label
                    key={item}
                    className="flex cursor-pointer items-center gap-2 px-3 py-1.5 text-sm text-slate-700 transition hover:bg-slate-50 dark:text-slate-200 dark:hover:bg-slate-800/60"
                  >
                    <input
                      type="checkbox"
                      checked={marcado}
                      onChange={() => alternar(item)}
                      className="h-3.5 w-3.5 rounded border-slate-300 text-brand focus:ring-brand/30 dark:border-slate-600 dark:bg-slate-800"
                    />
                    <span className="truncate">{item}</span>
                  </label>
                );
              })}
            </div>
          ))}
          {selecionadas.length > 0 && (
            <button
              type="button"
              onClick={() => onChange([])}
              className="mt-1 w-full border-t border-slate-100 px-3 py-1.5 text-left text-xs font-medium text-slate-500 transition hover:bg-slate-50 hover:text-slate-800 dark:border-slate-800 dark:text-slate-400 dark:hover:bg-slate-800/60 dark:hover:text-slate-200"
            >
              Limpar seleção
            </button>
          )}
        </div>
      )}
    </div>
  );
}
