// =========================================================================
// FUNDAÇÃO VISUAL (13/08) — o que faltava para o sistema parecer UM sistema
// =========================================================================
// Pedido do Marcio: "quero um redesign completo, organizado, padronizado —
// mas seja CRITERIOSO: o pessoal já está habituado a mexer no sistema."
//
// O diagnóstico não é que as telas estejam feias: é que `ui.tsx` tinha OITO
// primitivos para CINQUENTA E TRÊS telas. Tudo que faltava, cada tela inventou
// por conta própria. Medido antes de escrever uma linha:
//
//   12 telas com o próprio selo   (span rounded + text-[10px], cada uma a sua)
//   15 telas com o próprio <thead>
//   13 telas com a própria caixa de aviso
//
// É daí que vem o "não é padronizado" — não de falta de capricho em cada tela,
// mas de não existir a peça para reusar. Este arquivo é ADITIVO: nenhum
// componente existente mudou. A adoção é tela a tela, e nada que o operador já
// sabe usar muda de lugar de uma vez.
//
// Referência (2026, dashboards operacionais): densidade é virtude — quem
// trabalha o dia todo prefere ver mais por tela a rolar. Por isso nada aqui
// "areja" o que existe. O que se padroniza é o SIGNIFICADO (cor, peso, ordem),
// não o espaçamento.
import type { ReactNode } from "react";
import { cn } from "@/app/_components/ui";

// ---- TOM: a cor tem um significado só, em todo o sistema -----------------
// Promovido de app/hm/_components/card-sinais.tsx, onde nasceu servindo só o
// HM. É o que a referência de 2026 chama de "consistent color meaning": se
// âmbar quer dizer "confira" no board, não pode querer dizer outra coisa no
// admin. Antes desta tabela, rose era cancelado E recompra E não-contatar;
// âmbar era conferir-saldo E crédito-sem-explicação E parcela atrasada.
export const TOM = {
  /** Impedimento: não dá para seguir (cancelado, bloqueado, sem acesso). */
  bloqueio: "bg-rose-100 text-rose-700 dark:bg-rose-500/15 dark:text-rose-300",
  /** O mesmo, quando precisa gritar (o card cancelado no board). */
  bloqueioForte: "bg-rose-600 text-white dark:bg-rose-500",
  /** Pare e confira: falta combinar, o número não é confiável, o prazo venceu. */
  atencao: "bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300",
  /** Positivo: não há o que cobrar, está feito. */
  positivo: "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300",
  /** Contexto neutro: informa, não pede ação. */
  contexto: "bg-indigo-100 text-indigo-700 dark:bg-indigo-500/15 dark:text-indigo-300",
  /** Ação disponível: pode pegar, pode assumir. */
  acao: "bg-teal-100 text-teal-700 dark:bg-teal-500/15 dark:text-teal-300",
  /** Sem carga semântica. */
  neutro: "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300",
} as const;
export type Tom = keyof typeof TOM;

// ---- Selo ---------------------------------------------------------------
// O badge que 12 telas reescreveram. Mantém a MEDIDA que já estava em uso
// (text-[10px], px-1.5 py-0.5) de propósito: padronizar não é mudar o tamanho
// do que o operador já lê todo dia.
export function Selo({
  children, tom = "neutro", icone, title, className,
}: {
  children: ReactNode; tom?: Tom; icone?: ReactNode; title?: string; className?: string;
}) {
  return (
    <span
      title={title}
      className={cn(
        "inline-flex shrink-0 items-center gap-0.5 rounded px-1.5 py-0.5 text-[10px] font-semibold",
        TOM[tom], className,
      )}
    >
      {icone}
      {children}
    </span>
  );
}

// ---- Stat: um número que se lê batendo o olho ---------------------------
// Número sozinho não informa — precisa do rótulo e, quando existir, da
// comparação. `valor` é ReactNode para caber "—" ou "não calculado": o sistema
// nunca inventa zero quando não sabe.
const TEXTO_DO_TOM: Record<Tom, string> = {
  bloqueio: "text-rose-700 dark:text-rose-300",
  bloqueioForte: "text-rose-700 dark:text-rose-300",
  atencao: "text-amber-700 dark:text-amber-300",
  positivo: "text-emerald-700 dark:text-emerald-300",
  contexto: "text-indigo-700 dark:text-indigo-300",
  acao: "text-teal-700 dark:text-teal-300",
  neutro: "text-slate-900 dark:text-slate-100",
};

export function Stat({
  rotulo, valor, auxiliar, tom = "neutro", title, className,
}: {
  rotulo: ReactNode; valor: ReactNode; auxiliar?: ReactNode; tom?: Tom; title?: string; className?: string;
}) {
  return (
    <div title={title} className={cn("rounded-lg border border-slate-200 px-3 py-2 dark:border-slate-800", className)}>
      <p className="text-[11px] text-slate-400 dark:text-slate-500">{rotulo}</p>
      <p className={cn("mt-0.5 text-lg font-semibold leading-tight tabular-nums", TEXTO_DO_TOM[tom])}>{valor}</p>
      {auxiliar && <p className="mt-0.5 text-[11px] text-slate-500 dark:text-slate-400">{auxiliar}</p>}
    </div>
  );
}

// ---- SectionTitle -------------------------------------------------------
// O rótulo de bloco que a ficha e o admin repetem à mão em dezenas de lugares
// ("ACORDO DO SALDO", "HISTÓRICO FINANCEIRO"…). `acao` é o canto direito, onde
// mora o botão do bloco (ver todos, ocultar).
export function SectionTitle({ children, acao, className }: { children: ReactNode; acao?: ReactNode; className?: string }) {
  return (
    <div className={cn("mb-2 flex items-center justify-between gap-2", className)}>
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">{children}</p>
      {acao}
    </div>
  );
}

// ---- Callout: a caixa de aviso que 13 telas reinventaram ----------------
// Diferente do EmptyState (que é ausência de conteúdo): isto é uma mensagem
// SOBRE o conteúdo. Sempre título curto + explicação — a regra que o Marcio
// pediu para as notificações vale para todo aviso do sistema: "bater o olho e
// entender a ação, não ficar pensando".
const BORDA_DO_TOM: Record<Tom, string> = {
  bloqueio: "border-rose-200 bg-rose-50 dark:border-rose-500/30 dark:bg-rose-500/10",
  bloqueioForte: "border-rose-300 bg-rose-50 dark:border-rose-500/40 dark:bg-rose-500/10",
  atencao: "border-amber-200 bg-amber-50 dark:border-amber-500/30 dark:bg-amber-500/10",
  positivo: "border-emerald-200 bg-emerald-50 dark:border-emerald-500/30 dark:bg-emerald-500/10",
  contexto: "border-indigo-200 bg-indigo-50 dark:border-indigo-500/30 dark:bg-indigo-500/10",
  acao: "border-teal-200 bg-teal-50 dark:border-teal-500/30 dark:bg-teal-500/10",
  neutro: "border-slate-200 bg-slate-50 dark:border-slate-800 dark:bg-slate-800/40",
};

export function Callout({
  titulo, children, tom = "atencao", icone, acao, className,
}: {
  titulo?: ReactNode; children: ReactNode; tom?: Tom; icone?: ReactNode; acao?: ReactNode; className?: string;
}) {
  return (
    <div className={cn("rounded-lg border px-2.5 py-2", BORDA_DO_TOM[tom], className)}>
      <div className="flex items-start gap-2">
        {icone && <span className={cn("mt-0.5 shrink-0", TEXTO_DO_TOM[tom])}>{icone}</span>}
        <div className="min-w-0 flex-1">
          {titulo && <p className="text-[12px] font-semibold text-slate-800 dark:text-slate-100">{titulo}</p>}
          <div className="text-[11px] leading-relaxed text-slate-600 dark:text-slate-300">{children}</div>
        </div>
        {acao && <div className="shrink-0">{acao}</div>}
      </div>
    </div>
  );
}

// ---- Tabela: um cabeçalho só, em vez de 15 ------------------------------
// Classes, não componente: as 15 tabelas do sistema têm colunas, ordenação e
// células muito diferentes, e envolvê-las num componente forçaria reescrever
// todas. Trocar a CLASSE é adoção de uma linha por tabela — e é o cabeçalho
// desalinhado que faz duas telas parecerem de sistemas diferentes.
export const theadClass =
  "border-b border-slate-200 text-left text-xs uppercase tracking-wide text-slate-400 dark:border-slate-800 dark:text-slate-500";
export const thClass = "px-3 py-2 font-medium";
/** Coluna de dinheiro/número: alinhada à direita e tabular. A referência de
 *  2026 é explícita — é o que mantém a lista legível na rolagem vertical. */
export const thNumClass = "px-3 py-2 text-right font-medium";
export const tdClass = "px-3 py-2.5";
export const tdNumClass = "px-3 py-2.5 text-right tabular-nums";

// ---- Atualizado ---------------------------------------------------------
// "Data freshness transparency" (referência de 2026): quem opera precisa saber
// se está olhando o de agora ou o de uma hora atrás. Some quando não há data —
// nunca inventa "agora".
export function Atualizado({ em, className }: { em?: string | Date | null; className?: string }) {
  if (!em) return null;
  const d = em instanceof Date ? em : new Date(em);
  if (isNaN(d.getTime())) return null;
  return (
    <span className={cn("text-[11px] text-slate-400 dark:text-slate-500", className)} title={d.toLocaleString("pt-BR")}>
      atualizado {d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}
    </span>
  );
}
