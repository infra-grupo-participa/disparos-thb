"use client";

// Sinais derivados do card HM que mais de uma tela precisa ler do MESMO jeito
// (board, tabela e drawer). Cada tela deduzindo "recompra" ou "cancelado" por
// conta própria é o mesmo tipo de furo que os níveis de acesso tinham — a
// regra mora aqui, as telas só exibem.

import { cn } from "@/app/_components/ui";
import { TAGS_ALUNO_ANTIGO } from "@/lib/papeis";
// Reexportado para que as telas leiam UMA lista só (papeis.ts é a fonte, e é a
// mesma que a migration 0213 espelha em SQL). Sem isto o board importaria a
// lista de identidade de dois lugares diferentes — o drift que este arquivo
// existe para evitar.
export { TAGS_ALUNO_ANTIGO };

// ===== Paleta do card (13/08) — UM significado por cor, nas três telas ======
// Pedido do Marcio: "eu estou sentindo muito misturado tudo". Antes rose
// significava cancelado E recompra E não-contatar; âmbar significava conferir
// saldo E crédito sem explicação E parcela atrasada — ninguém decora isso.
// A partir de agora cada cor tem UM job, e só esse job. Mudar a cor de um selo
// sem atualizar esta tabela é o tipo de drift que ela existe para impedir.
//
//   ROSE    — impedimento ativo sobre o que fazer com esta pessoa: card
//             cancelado (não é cliente) ou trava de "não contatar" (não
//             disque). As duas travam uma AÇÃO; nada mais usa rose.
//   ÂMBAR   — o sistema não decide sozinho, um humano precisa olhar: saldo a
//             conferir, crédito pró-rata sem explicação, parcela atrasada,
//             "revisar". É a cor de "pare e confira", nunca de alarme final.
//   ESMERALDA — sinal positivo: dinheiro que entrou/resolveu (quitado, saldo
//             pago) ou gente nova (aluno novo). Nunca aparece ao lado de um
//             selo âmbar/rose do MESMO card — a precedência abaixo garante.
//   ÍNDIGO  — contexto neutro, sem ação pendente: aluno antigo, recompra,
//             parcela dentro do combinado, "esta pessoa também está no outro
//             board". Informativo; não pede nada do operador agora.
//   TEAL    — ação disponível, sem dono: card do pool, livre para assumir.
//   SLATE   — neutro/default: sem operador, card de colega, texto sem estado.
// Sky/violet aparecem só em rótulos de categoria (tag/etapa), fora desta
// tabela — não competem com os estados acima.
export const TOM = {
  bloqueio: "bg-rose-100 text-rose-700 dark:bg-rose-500/15 dark:text-rose-300",
  bloqueioForte: "bg-rose-600 text-white dark:bg-rose-500",
  atencao: "bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300",
  positivo: "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300",
  contexto: "bg-indigo-100 text-indigo-700 dark:bg-indigo-500/15 dark:text-indigo-300",
  neutro: "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300",
} as const;
export type Tom = keyof typeof TOM;

// ===== Estado financeiro dominante do card (13/08) ===========================
// A resposta a "em que pé está o dinheiro dela" — a segunda das três
// perguntas que o card tem de responder batendo o olho (pedido do Marcio,
// 13/08: "os operadores têm que bater o olho e entender a situação de cada
// um"). UM selo por card, nunca dois — antes "conferir saldo" (âmbar) podia
// aparecer ao lado de "Saldo pago" (a mesma cor, dizendo coisas opostas) e de
// "deve R$X", porque cada badge nascia de uma condição independente. A
// precedência agora é EXPLÍCITA — a primeira condição que servir GANHA, e as
// de baixo nem são avaliadas:
//   1. CONFERIR SALDO / crédito sem explicação — o sistema não confia no
//      próprio número; afirmar "quitado" ou "saldo pago" ao lado seria o
//      card se contradizendo.
//   2. QUITADO — reconciliado com o razão, nada mais a cobrar.
//   3. PARCELA ATRASADA — parcelando e o razão não reconciliou pagamento
//      depois do vencimento.
//   4. SALDO PAGO — pagamento do saldo confirmado, ainda não reconciliado.
//   5. PARCELA EM DIA / PARCELANDO — dentro do combinado, ou sem data ainda.
//   6. DEVE R$X — saldo positivo sem nenhum dos anteriores.
//   7. nada — sem saldo, sem parcela: o card não afirma o que não sabe.
export type EstadoFinanceiro = { txt: string; tom: Tom; icon: "ok" | "alerta" | "relogio"; title: string };

export function estadoFinanceiroCard(p: {
  quitado: boolean;
  conferirSaldo: boolean;
  pendenteCredito: boolean;
  creditoObsTexto: string | null;
  aptoAtivacao: boolean;
  /** null = não está parcelando. */
  parcela: { txt: string; title: string; atrasada: boolean } | null;
  /** Já formatado em BRL (ex. "R$ 14.303"), ou null quando o sistema não sabe. */
  saldoTxt: string | null;
  quitadoTitle: string;
}): EstadoFinanceiro | null {
  if (p.conferirSaldo) {
    return {
      txt: "Conferir saldo", tom: "atencao", icon: "alerta",
      title: "Saldo zerado por dupla contagem do crédito pró-rata — não é quitação. O comercial precisa decidir quanto cobrar antes de dar como pago.",
    };
  }
  if (p.pendenteCredito && p.saldoTxt) {
    return {
      txt: `Deve ${p.saldoTxt}`, tom: "atencao", icon: "alerta",
      title: `Ainda falta receber ${p.saldoTxt} · Crédito pró-rata sem explicação registrada`,
    };
  }
  if (p.quitado) return { txt: "Quitado", tom: "positivo", icon: "ok", title: p.quitadoTitle };
  if (p.parcela?.atrasada) return { txt: p.parcela.txt, tom: "atencao", icon: "alerta", title: p.parcela.title };
  if (p.aptoAtivacao) return { txt: "Saldo pago", tom: "positivo", icon: "ok", title: "Pagamento do saldo confirmado" };
  if (p.parcela) return { txt: p.parcela.txt, tom: "contexto", icon: "relogio", title: p.parcela.title };
  if (p.saldoTxt) {
    return {
      txt: `Deve ${p.saldoTxt}`, tom: "neutro", icon: "relogio",
      title: `Ainda falta receber ${p.saldoTxt}` + (p.creditoObsTexto ? ` · Por que o crédito: ${p.creditoObsTexto}` : ""),
    };
  }
  return null;
}

// ===== Precedência do card inteiro (13/08) ===================================
// Não só o financeiro — o CARD tem um estado dominante, e quando ele vale, o
// resto se cala. Ordem (documentada aqui porque é regra, não acidente de
// render; as telas que montam o card leem ISTO antes de decidir o que
// desenhar):
//   1. CANCELADO — não é cliente. Domina TUDO: identidade (aluno novo/antigo),
//      financeiro (deve, quitado, parcela, conferir saldo, crédito pendente) e
//      contexto (recompra, categoria de entrada, "card novo") somem. O que
//      sobra: quem é (nome/avatar/contato), o motivo do cancelamento, tags,
//      operador e "esta pessoa também está no outro board" — o resto mora na
//      ficha, um clique adiante (é contexto, não ação).
//   2. Estado financeiro (ver `estadoFinanceiroCard` acima) — um selo só.
//   3. Identidade (aluno novo/antigo, pool, colega) — eixo independente do
//      financeiro, sempre visível exceto sob a regra 1.

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

// ===== Explicação do crédito pró-rata (13/08) ================================
// O crédito pró-rata (HM: cs.contatos_hm.credito_obs · AURUM: cs.vw_aurum_saldo.obs
// / excecao_motivo) é calculado à mão — quem cobra o aluno depende deste texto
// para justificar o número. Card com crédito > 0 e SEM o motivo preenchido é o
// caso perigoso: o comercial vai cobrar um valor que não sabe explicar. Regra
// única para as três telas (ficha, board, tabela) — decidir em cada uma por
// conta própria é o jeito de uma dizer "pendente" e a outra não.
export function faltaExplicarCredito(credito: number | null | undefined, obs: string | null | undefined): boolean {
  return !!credito && credito > 0 && !obs?.trim();
}

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

// A mesma tag ("Aluno THB"/"Aluno Aurum") aciona DOIS selos hoje: o de
// recompra (acima) E o de aluno antigo (abaixo, via TAGS_ALUNO_ANTIGO — as
// mesmas duas strings). Sem esta função, um card assim mostra "Aluno antigo"
// escancarado E "Recompra (Aluno THB)" escondido no "+N" dizendo o MESMO
// fato duas vezes — exatamente o tipo de mistura que o pedido de 13/08 quer
// cortar. Usar no lugar de `origemRecompra` sempre que `ehAlunoAntigo` também
// for renderizado ao lado: some com o duplicado, mantém "Origem Txx"
// (renovação de turma, fato distinto que o antigo não cobre).
export function origemRecompraDistinta(tags: string[] | null | undefined): string | null {
  const origem = origemRecompra(tags);
  if (!origem) return null;
  return (TAGS_ALUNO_ANTIGO as readonly string[]).includes(origem) ? null : origem;
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

// O selo de recompra — histórico, não alarme (13/08: saiu do rose, que agora é
// só impedimento — cancelado/não-contatar). Índigo: mesma família de "aluno
// antigo", que é o outro selo de contexto/história do card. Informativo puro;
// é por isso que colapsa no "+N" (SelosExtras) e nunca ganha borda própria.
export function SeloRecompra({ origem, className }: { origem: string; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center gap-0.5 rounded bg-indigo-100 px-1.5 py-0.5 text-[10px] font-semibold text-indigo-700 dark:bg-indigo-500/15 dark:text-indigo-300",
        className,
      )}
      title={`Recompra — já era aluno antes de comprar (${origem}). Contexto histórico, sem ação pendente.`}
    >
      {/* Setas em círculo: comprou DE NOVO. */}
      <svg className="h-2.5 w-2.5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M3 12a9 9 0 0 1 15.3-6.4L21 8M21 3v5h-5M21 12a9 9 0 0 1-15.3 6.4L3 16M3 21v-5h5" /></svg>
      Recompra · {origem}
    </span>
  );
}

// O selo do ALUNO ANTIGO (0213, 12/08). Texto VISÍVEL curto de propósito —
// pedido do Marcio em 13/08: "não precisa deixar porra explícita, acesso
// pré-marcar não. Só coloca diferença entre um e outro... tem que ser
// direto." O par (Aluno novo × Aluno antigo) já diz tudo que precisa bater o
// olho: mesma forma, cores opostas, lado a lado. O DETALHE — que os 3 acessos
// vêm pré-marcados pela trigger 0213 e precisam de conferência — continua no
// `title`: é contexto sob demanda (hover/foco), não poluição da primeira
// leitura; sem ele o operador acharia que alguém preencheu o checklist à mão.
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
      Aluno antigo
    </span>
  );
}
