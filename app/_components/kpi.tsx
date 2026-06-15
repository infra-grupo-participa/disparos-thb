import type { ReactNode } from "react";
import { Card, cn } from "@/app/_components/ui";

// Componentes visuais compartilhados pelos painéis do dashboard, para manter um
// padrão único de KPI e de título de seção entre Visão geral, E-mail, Ligações
// e Campeões.

// Cartão de indicador (número grande + rótulo + subtexto). `alerta` pinta em
// vermelho quando o valor representa um risco.
export function Kpi({ titulo, valor, sub, alerta }: { titulo: string; valor: string; sub?: string; alerta?: boolean }) {
  return (
    <Card className="p-4">
      <div className="text-xs font-medium uppercase tracking-wide text-slate-400 dark:text-slate-500">{titulo}</div>
      <div className={cn("mt-2 text-2xl font-semibold tabular-nums", alerta ? "text-rose-600 dark:text-rose-300" : "text-slate-900 dark:text-white")}>{valor}</div>
      {sub && <div className="mt-1 text-xs text-slate-400 dark:text-slate-500">{sub}</div>}
    </Card>
  );
}

const BARRA: Record<string, string> = {
  brand: "bg-brand/60 dark:bg-brand-400/70",
  emerald: "bg-emerald-500",
  sky: "bg-sky-500",
  violet: "bg-violet-500",
  slate: "bg-slate-300 dark:bg-slate-600",
};

// Título de seção interno aos painéis (barrinha colorida + rótulo em maiúsculas).
export function SecaoTitulo({ children, cor = "brand" }: { children: ReactNode; cor?: keyof typeof BARRA }) {
  return (
    <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
      <span className={cn("h-3.5 w-1 rounded-full", BARRA[cor])} aria-hidden="true" />
      {children}
    </div>
  );
}
