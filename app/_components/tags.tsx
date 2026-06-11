import { cn } from "@/app/_components/ui";

// Cor da tag por natureza — didático: cada tipo tem sua cor.
//  edição HT## = violeta · grupo = verde · formulário = azul · opt-out = vermelho · demais = cinza
export function tagTone(tag: string): string {
  if (/^HT\d+$/i.test(tag)) return "bg-violet-100 text-violet-700 ring-violet-200 dark:bg-violet-500/15 dark:text-violet-300 dark:ring-violet-500/30";
  if (tag === "No grupo") return "bg-emerald-100 text-emerald-700 ring-emerald-200 dark:bg-emerald-500/15 dark:text-emerald-300 dark:ring-emerald-500/30";
  if (/respondeu/i.test(tag)) return "bg-blue-100 text-blue-700 ring-blue-200 dark:bg-blue-500/15 dark:text-blue-300 dark:ring-blue-500/30";
  if (/opt[\s-]?out/i.test(tag)) return "bg-rose-100 text-rose-700 ring-rose-200 dark:bg-rose-500/15 dark:text-rose-300 dark:ring-rose-500/30";
  return "bg-slate-100 text-slate-600 ring-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:ring-slate-700";
}

export function TagChip({ tag, mini }: { tag: string; mini?: boolean }) {
  return (
    <span className={cn("inline-flex items-center rounded-full font-medium ring-1 ring-inset", mini ? "px-1.5 py-0.5 text-[10px] leading-none" : "px-2.5 py-0.5 text-xs", tagTone(tag))}>
      {tag}
    </span>
  );
}

// Resumo p/ o card do Kanban: mostra algumas tags e revela TODAS ao passar o mouse.
export function TagsResumo({ tags, max = 3 }: { tags: string[] | null | undefined; max?: number }) {
  if (!tags || tags.length === 0) return null;
  const visiveis = tags.slice(0, max);
  const resto = tags.length - visiveis.length;
  return (
    <div className="group/tags relative flex flex-wrap items-center gap-1">
      {visiveis.map((t) => <TagChip key={t} tag={t} mini />)}
      {resto > 0 && (
        <span className="rounded-full bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium leading-none text-slate-500 dark:bg-slate-800 dark:text-slate-400">+{resto}</span>
      )}
      {tags.length > 0 && (
        <div className="pointer-events-none absolute left-0 top-full z-30 mt-1 hidden w-max max-w-[240px] flex-wrap gap-1 rounded-lg border border-slate-200 bg-white p-2 shadow-pop group-hover/tags:flex dark:border-slate-700 dark:bg-slate-900">
          {tags.map((t) => <TagChip key={t} tag={t} mini />)}
        </div>
      )}
    </div>
  );
}
