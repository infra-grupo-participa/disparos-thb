"use client";

import { useState } from "react";
import type React from "react";
import { createPortal } from "react-dom";
import { cn } from "@/app/_components/ui";

// Tags padrão (clicáveis) — evita criar tag nova toda vez ao associar.
export const TAGS_PADRAO = [
  "Aguardando pgto",
  "Recuperado",
  "Interessado HM",
  "Sem retorno",
  "Cliente VIP",
  "Atenção",
];

// Cor da tag por natureza — didático: cada tipo tem sua cor.
export function tagTone(tag: string): string {
  if (tag === "HT ATM") return "bg-orange-100 text-orange-700 ring-orange-200 dark:bg-orange-500/15 dark:text-orange-300 dark:ring-orange-500/30";
  if (tag === "Aurum") return "bg-amber-100 text-amber-800 ring-amber-300 dark:bg-amber-500/15 dark:text-amber-300 dark:ring-amber-500/30";
  if (/^T\d+(\.\d+)?$/i.test(tag)) return "bg-indigo-100 text-indigo-700 ring-indigo-200 dark:bg-indigo-500/15 dark:text-indigo-300 dark:ring-indigo-500/30";
  if (/^A\d+R?$/i.test(tag)) return "bg-yellow-100 text-yellow-700 ring-yellow-200 dark:bg-yellow-500/15 dark:text-yellow-300 dark:ring-yellow-500/30";
  if (/^HT\d+$/i.test(tag)) return "bg-violet-100 text-violet-700 ring-violet-200 dark:bg-violet-500/15 dark:text-violet-300 dark:ring-violet-500/30";
  if (tag === "No grupo") return "bg-emerald-100 text-emerald-700 ring-emerald-200 dark:bg-emerald-500/15 dark:text-emerald-300 dark:ring-emerald-500/30";
  if (/respondeu/i.test(tag)) return "bg-blue-100 text-blue-700 ring-blue-200 dark:bg-blue-500/15 dark:text-blue-300 dark:ring-blue-500/30";
  if (/atenç|sem retorno|aguardando/i.test(tag)) return "bg-amber-100 text-amber-700 ring-amber-200 dark:bg-amber-500/15 dark:text-amber-300 dark:ring-amber-500/30";
  if (/recuperad|vip|interessado/i.test(tag)) return "bg-teal-100 text-teal-700 ring-teal-200 dark:bg-teal-500/15 dark:text-teal-300 dark:ring-teal-500/30";
  if (/opt[\s-]?out/i.test(tag)) return "bg-rose-100 text-rose-700 ring-rose-200 dark:bg-rose-500/15 dark:text-rose-300 dark:ring-rose-500/30";
  return "bg-slate-100 text-slate-600 ring-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:ring-slate-700";
}

// `cor` vem do catálogo (cs.tags, 0067) e vence o regex: a cor é da tag, não
// da tela. Sem catálogo (tag antiga, telas do HT), o tom heurístico segue valendo.
//
// `titulo` (12/08, dicionário de tags): tooltip nativo (atributo `title` do
// HTML) com o que a tag SIGNIFICA — cor sozinha nunca conta a história
// inteira. Prop OPCIONAL e retrocompatível: quem não passar nada mantém o
// comportamento de sempre. Tooltip nativo de propósito — nada de componente
// custom, o browser já resolve foco/teclado/mobile sozinho.
export function TagChip({ tag, mini, cor, titulo }: { tag: string; mini?: boolean; cor?: string | null; titulo?: string | null }) {
  const base = cn("inline-flex items-center rounded-full font-medium", mini ? "px-1.5 py-0.5 text-[10px] leading-none" : "px-2.5 py-0.5 text-xs");
  if (cor) {
    return (
      <span className={base} style={{ backgroundColor: `${cor}1f`, color: cor, boxShadow: `inset 0 0 0 1px ${cor}40` }} title={titulo || undefined}>
        {tag}
      </span>
    );
  }
  return <span className={cn(base, "ring-1 ring-inset", tagTone(tag))} title={titulo || undefined}>{tag}</span>;
}

// Ícone de etiqueta no card (estilo Clint). O popup é renderizado via PORTAL
// no <body> com posição fixa — assim não é cortado pela rolagem das colunas.
export function TagsIcon({
  tags,
  cores,
  descricoes,
}: {
  tags: string[] | null | undefined;
  cores?: Record<string, string | null>;
  /** opcional (12/08) — nome da tag -> descrição do catálogo, vira tooltip nativo em cada chip */
  descricoes?: Record<string, string | null>;
}) {
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  if (!tags || tags.length === 0) return null;
  const abrir = (e: React.MouseEvent) => {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    // Ancora o popup à esquerda do ícone, abrindo para a direita logo abaixo —
    // perto do cursor. Só recua se fosse vazar pela borda direita da janela.
    const x = Math.max(8, Math.min(r.left, window.innerWidth - 218));
    setPos({ x, y: r.bottom + 4 });
  };
  return (
    <span
      className="inline-flex h-5 w-5 cursor-default items-center justify-center rounded text-brand dark:text-brand-300"
      onMouseEnter={abrir}
      onMouseLeave={() => setPos(null)}
    >
      <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M20.59 13.41 13.42 20.58a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z" /><circle cx="7" cy="7" r="0.5" />
      </svg>
      {pos &&
        createPortal(
          <div
            style={{ position: "fixed", left: pos.x, top: pos.y, zIndex: 60, maxWidth: 210 }}
            className="pointer-events-none flex flex-wrap gap-1 rounded-lg border border-slate-200 bg-white p-2 shadow-pop dark:border-slate-700 dark:bg-slate-900"
          >
            {tags.map((t) => <TagChip key={t} tag={t} mini cor={cores?.[t]} titulo={descricoes?.[t]} />)}
          </div>,
          document.body,
        )}
    </span>
  );
}
