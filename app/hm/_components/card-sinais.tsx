"use client";

// Sinais derivados do card HM que mais de uma tela precisa ler do MESMO jeito
// (board, tabela e drawer). Cada tela deduzindo "recompra" ou "cancelado" por
// conta própria é o mesmo tipo de furo que os níveis de acesso tinham — a
// regra mora aqui, as telas só exibem.

import { cn } from "@/app/_components/ui";
import { TAGS_ALUNO_ANTIGO } from "@/lib/papeis";

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
//
// 12/08 (0213): este predicado ERA binário — misturava "veio de outra turma"
// (Origem Txx) com "já foi aluno THB/Aurum" (TAGS_ALUNO_ANTIGO) no MESMO selo
// rose. As duas coisas viraram sinais distintos: aluno antigo agora dispara a
// AUTO-MARCAÇÃO dos 3 acessos (trigger 0213) — ver `ehAlunoAntigo` abaixo —
// e precisa de um selo PRÓPRIO que explique isso, senão o operador acha que
// alguém marcou o checklist à mão. `origemRecompra` continua igual (mesmo
// comportamento, mesmo selo) para não quebrar as telas que já o consomem.
export function origemRecompra(tags: string[] | null | undefined): string | null {
  if (!tags?.length) return null;
  const origem = tags.find((t) => t.startsWith("Origem "));
  if (origem) return origem.slice("Origem ".length).trim() || origem;
  return tags.find((t) => t === "Aluno THB" || t === "Aluno Aurum") ?? null;
}

// ===== Aluno antigo (0213, 12/08) ============================================
// Quem JÁ FOI aluno THB/Aurum antes de reentrar pela Ativação — dispara a
// auto-marcação dos acessos (a trigger cs.fn_hm_dono_por_aba/0213 marca os 3
// itens do checklist sozinha ao entrar na aba ativação). Usa a MESMA lista que
// a migration 0213 espelha em SQL (`TAGS_ALUNO_ANTIGO`, lib/papeis.ts) — NÃO
// redeclarar aqui: duas listas que podem divergir é o próprio tipo de drift
// que lib/papeis.ts existe para evitar (ver o comentário lá).
export function ehAlunoAntigo(tags: string[] | null | undefined): boolean {
  if (!tags?.length) return false;
  return tags.some((t) => (TAGS_ALUNO_ANTIGO as readonly string[]).includes(t));
}

// ===== Aluno novo (0216, 12/08) ==============================================
// O outro lado do mesmo par. A tag chamava "Lead novo" até a 0216 — o Marcio
// trocou porque quem está neste board JÁ COMPROU o sinal; "lead" era vocabulário
// do funil anterior vazando para dentro da esteira.
//
// Lê as DUAS grafias pelo mesmo motivo que cs.vw_hm_financeiro lê: a tela do
// operador não pode ficar muda por causa de um card que escapou do backfill.
export const TAGS_ALUNO_NOVO: readonly string[] = ["Aluno novo", "Lead novo"];

export function ehAlunoNovo(tags: string[] | null | undefined): boolean {
  if (!tags?.length) return false;
  return tags.some((t) => TAGS_ALUNO_NOVO.includes(t));
}

// Pedido do Marcio (12/08): "eu preciso que esteja ESCANCARADO isso, a
// diferença entre aluno novo e aluno antigo". Por isso os dois selos saíram do
// "+N" (SelosExtras) e são renderizados sempre, lado a lado, com a mesma forma
// e cores opostas: esmeralda = primeira vez, índigo = já era da casa.
export function SeloAlunoNovo({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center gap-0.5 rounded bg-emerald-100 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300",
        className,
      )}
      title="Aluno novo — primeira compra, nunca foi aluno THB nem Aurum. Nenhum acesso é pré-marcado: o checklist de ativação começa zerado e tudo precisa ser liberado."
    >
      {/* Estrela: chegou agora. Contrasta com o crachá do aluno antigo. */}
      <svg className="h-2.5 w-2.5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="m12 3 2.7 5.5 6.1.9-4.4 4.3 1 6.1-5.4-2.9-5.4 2.9 1-6.1L3.2 9.4l6.1-.9L12 3Z" /></svg>
      Aluno novo
    </span>
  );
}

// "Ninguém abriu esse card ainda" (0217). Fica ABSOLUTO no canto superior
// direito do card — o pedido foi literalmente "uma tagzinha no topo superior
// direito" — e some na primeira abertura. O pulso respeita `motion-safe`: quem
// pediu menos animação no sistema operacional vê o selo parado, não some com ele.
export function SeloCardNovo({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        "pointer-events-none absolute -right-1.5 -top-2 z-10 inline-flex shrink-0 items-center gap-0.5",
        "rounded-full bg-indigo-600 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-white",
        "shadow-sm ring-2 ring-white motion-safe:animate-pulse dark:bg-indigo-500 dark:ring-slate-900",
        className,
      )}
      title="Venda nova — ninguém da equipe abriu este card ainda. O selo some assim que alguém abrir a ficha."
    >
      <svg className="h-2 w-2 shrink-0" viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="12" r="6" /></svg>
      novo
    </span>
  );
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

// O selo do ALUNO ANTIGO (0213, 12/08) — distinto do de recompra, de propósito:
// o texto diz explicitamente que os acessos foram PRÉ-MARCADOS pelo sistema
// (trigger, não gente). Reusar o SeloRecompra com outro texto faria o operador
// achar que alguém preencheu o checklist à mão; a cor (indigo) também não pode
// se confundir com o rose de recompra nem com os outros usos de rose no board
// (não contatar, cancelado) — comunicar por texto, não só por cor.
export function SeloAlunoAntigo({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center gap-0.5 rounded bg-indigo-100 px-1.5 py-0.5 text-[10px] font-semibold text-indigo-700 dark:bg-indigo-500/15 dark:text-indigo-300",
        className,
      )}
      title="Aluno antigo — já foi aluno THB/Aurum antes. Os 3 acessos do checklist de ativação foram pré-marcados automaticamente pelo sistema ao entrar na Ativação (0213); confira antes de liberar."
    >
      {/* Selo/crachá: já É credenciado, não está entrando pela primeira vez. */}
      <svg className="h-2.5 w-2.5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2 3 6v6c0 5 4 8 9 10 5-2 9-5 9-10V6l-9-4Z" /><path d="m9 12 2 2 4-4" /></svg>
      Aluno antigo — acessos pré-marcados
    </span>
  );
}
