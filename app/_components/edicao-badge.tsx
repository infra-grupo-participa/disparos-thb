// Badge visual de edição do HT (HT21..HT27), cor distinta por edição.
// Fonte ÚNICA da paleta de edições — usado na lista de Leads, no detalhe do
// lead, no histórico de Disparos e no card do Kanban. Não redefina essas cores
// em tela nenhuma.

const CORES: Record<string, string> = {
  HT21: "bg-slate-100 text-slate-700 ring-slate-300 dark:bg-slate-800 dark:text-slate-300 dark:ring-slate-600",
  HT22: "bg-blue-100 text-blue-700 ring-blue-300 dark:bg-blue-500/15 dark:text-blue-300 dark:ring-blue-500/40",
  HT23: "bg-emerald-100 text-emerald-700 ring-emerald-300 dark:bg-emerald-500/15 dark:text-emerald-300 dark:ring-emerald-500/40",
  HT24: "bg-amber-100 text-amber-800 ring-amber-300 dark:bg-amber-500/15 dark:text-amber-300 dark:ring-amber-500/40",
  HT25: "bg-violet-100 text-violet-700 ring-violet-300 dark:bg-violet-500/15 dark:text-violet-300 dark:ring-violet-500/40",
  HT26: "bg-rose-100 text-rose-700 ring-rose-300 dark:bg-rose-500/15 dark:text-rose-300 dark:ring-rose-500/40",
  HT27: "bg-cyan-100 text-cyan-700 ring-cyan-300 dark:bg-cyan-500/15 dark:text-cyan-300 dark:ring-cyan-500/40",
};

export function EdicaoBadge({ edicao, className = "" }: { edicao: string | null; className?: string }) {
  if (!edicao) return <span className="text-slate-300 dark:text-slate-600">—</span>;
  const cor = CORES[edicao] || "bg-slate-100 text-slate-600 ring-slate-300 dark:bg-slate-800 dark:text-slate-300 dark:ring-slate-600";
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold ring-1 ring-inset ${cor} ${className}`}>
      {edicao}
    </span>
  );
}
