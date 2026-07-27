"use client";

// Selo colorido da equipe dona de um card (0140) — compartilhado entre board,
// drawer e quem mais precisar diferenciar cards por equipe. Resolve dois furos
// visuais que existiam quando cada tela pintava por conta própria:
//   1. `equipe_cor` nula fazia o selo/borda SUMIREM — o card parecia do pool
//      sem ser. Aqui a cor cai num cinza padrão e o selo continua de pé.
//   2. Texto branco fixo sobre a cor da equipe: a cor vem de um color picker
//      livre — sobre amarelo/branco o rótulo desaparecia. O texto agora é
//      escolhido pela luminância da cor (WCAG), em qualquer tema.

import { cn } from "@/app/_components/ui";

// Equipe sem cor cadastrada: slate-500 — neutro, legível nos dois temas.
export const COR_EQUIPE_PADRAO = "#64748b";

// Rótulo curto da equipe: "Grupo Participa (Pro Max)" → "GP"; "Equipe 2" →
// "EQ2"; nomes livres → as 2 primeiras iniciais. Curto de propósito (o card é
// apertado); o nome inteiro vai no title.
export function abreviaEquipe(nome: string): string {
  const n = nome.toLowerCase();
  if (n.includes("participa") || n.includes("pro max")) return "GP";
  const mEq = nome.match(/equipe\s*(\d+)/i);
  if (mEq) return `EQ${mEq[1]}`;
  return nome.split(/\s+/).slice(0, 2).map((p) => p[0]?.toUpperCase() ?? "").join("") || nome.slice(0, 3).toUpperCase();
}

// Cor de texto legível sobre uma cor arbitrária: compara o contraste WCAG de
// branco e de quase-preto sobre ela e fica com o maior. Cor inválida → branco
// sobre o cinza padrão (nunca quebra a renderização por dado sujo).
export function corTextoSobre(hex: string): string {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return "#ffffff";
  let h = m[1];
  if (h.length === 3) h = h.split("").map((c) => c + c).join("");
  const [r, g, b] = [0, 2, 4]
    .map((i) => parseInt(h.slice(i, i + 2), 16) / 255)
    .map((v) => (v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)));
  const L = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  // Contraste com branco: 1.05/(L+0.05). Com preto: (L+0.05)/0.05.
  return 1.05 / (L + 0.05) >= (L + 0.05) / 0.05 ? "#ffffff" : "#0f172a";
}

export function SeloEquipe({
  nome,
  cor,
  title,
  abreviado = true,
  grande = false,
  className,
}: {
  nome: string;
  cor: string | null | undefined;
  title?: string;
  /** true (padrão) = rótulo curto ("GP", "EQ2") para caber no card do board. */
  abreviado?: boolean;
  /** Tamanho maior para telas com ar (drawer/ficha). */
  grande?: boolean;
  className?: string;
}) {
  const bg = cor || COR_EQUIPE_PADRAO;
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center rounded font-semibold uppercase tracking-wide ring-1 ring-inset ring-black/10 dark:ring-white/20",
        grande ? "px-1.5 py-0.5 text-[10px]" : "px-1 py-px text-[9px]",
        className,
      )}
      style={{ backgroundColor: bg, color: corTextoSobre(bg) }}
      title={title ?? `Equipe: ${nome}`}
    >
      {abreviado ? abreviaEquipe(nome) : nome}
    </span>
  );
}
