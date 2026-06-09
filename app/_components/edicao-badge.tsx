// Badge visual de edição do HT (HT21..HT27), cor distinta por edição.
// Usado na lista de Contatos e no detalhe do contato.

const CORES: Record<string, string> = {
  HT21: "bg-slate-100 text-slate-700 ring-slate-300",
  HT22: "bg-blue-100 text-blue-700 ring-blue-300",
  HT23: "bg-emerald-100 text-emerald-700 ring-emerald-300",
  HT24: "bg-amber-100 text-amber-800 ring-amber-300",
  HT25: "bg-violet-100 text-violet-700 ring-violet-300",
  HT26: "bg-rose-100 text-rose-700 ring-rose-300",
  HT27: "bg-cyan-100 text-cyan-700 ring-cyan-300",
};

export function EdicaoBadge({ edicao, className = "" }: { edicao: string | null; className?: string }) {
  if (!edicao) return <span className="text-slate-300">—</span>;
  const cor = CORES[edicao] || "bg-slate-100 text-slate-600 ring-slate-300";
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold ring-1 ring-inset ${cor} ${className}`}>
      {edicao}
    </span>
  );
}
