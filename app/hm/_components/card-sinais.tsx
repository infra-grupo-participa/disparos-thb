"use client";

// Sinais derivados do card HM que mais de uma tela precisa ler do MESMO jeito
// (board, tabela e drawer). Cada tela deduzindo "recompra" ou "cancelado" por
// conta própria é o mesmo tipo de furo que os níveis de acesso tinham — a
// regra mora aqui, as telas só exibem.

import { cn } from "@/app/_components/ui";

// ===== Cancelamento (27/07) ==================================================
// Espelho CLIENTE de lib/services/hm.ts (HM_ESTAGIOS_CANCELAMENTO) — não dá
// para importar de lá (módulo server-only, puxa lib/db). Se as chaves mudarem
// no serviço, mudar AQUI junto.
// Card em "Reclamada"/"Reembolsado" é acessível SÓ ao master: o backend já
// devolve 403 `cancelamento_so_admin_gp` no GET da ficha, export, sócios e
// inbox — aqui a UI deixa de convidar ao clique.
export const ESTAGIOS_CANCELAMENTO_HM = ["hm_cancelamento", "hm_reembolsado"] as const;

export function ehEstagioCancelamento(chave: string | null | undefined): boolean {
  return !!chave && (ESTAGIOS_CANCELAMENTO_HM as readonly string[]).includes(chave);
}

export const TITLE_CARD_CANCELADO =
  "Card cancelado — só o administrador do Grupo Participa acessa";

// ===== Recompra (pedido do Marcio, 27/07 — "por ora") ========================
// Quem JÁ ERA ALUNO antes de comprar o HM. A identificação vem das tags:
//   • "Origem Txx" — a turma de onde a pessoa veio (renovação), OU
//   • "Aluno THB" / "Aluno Aurum" — era aluno de outro produto.
// "Turma T39" NÃO conta: todo mundo a ganha ao pagar; não diz nada sobre o
// passado. Devolve o rótulo curto do porquê ("T29", "Aluno THB") ou null.
export function origemRecompra(tags: string[] | null | undefined): string | null {
  if (!tags?.length) return null;
  const origem = tags.find((t) => t.startsWith("Origem "));
  if (origem) return origem.slice("Origem ".length).trim() || origem;
  return tags.find((t) => t === "Aluno THB" || t === "Aluno Aurum") ?? null;
}

// O selo vermelho de recompra — o MESMO nas três telas, para a marca ser
// inequívoca. Vermelho (rose) porque foi o pedido; o selo carrega o texto para
// nunca se confundir com os outros usos de rose (não contatar, cancelado).
export function SeloRecompra({ origem, className }: { origem: string; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center gap-0.5 rounded bg-rose-100 px-1.5 py-0.5 text-[10px] font-semibold text-rose-700 dark:bg-rose-500/15 dark:text-rose-300",
        className,
      )}
      title={`Recompra — já era aluno antes de comprar (${origem}). Marcação provisória pedida em 27/07.`}
    >
      {/* Setas em círculo: comprou DE NOVO. */}
      <svg className="h-2.5 w-2.5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M3 12a9 9 0 0 1 15.3-6.4L21 8M21 3v5h-5M21 12a9 9 0 0 1-15.3 6.4L3 16M3 21v-5h5" /></svg>
      Recompra · {origem}
    </span>
  );
}
