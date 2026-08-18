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

// ===== Resultado da reunião comercial (17/08) ================================
// Estados fixos que a planilha usava — vivia duplicado em hm-drawer.tsx E
// tabela/page.tsx (mesmo texto hoje, mas duas fontes que podiam divergir a
// qualquer PR seguinte). Este arquivo já é o lugar único de vocabulário
// compartilhado entre board/tabela/ficha — RESULTADOS entra aqui, as duas
// telas importam.
export const RESULTADOS = ["Aguardando retorno", "Agendada", "Realizada", "Realizada/pago", "Reagendar", "Não respondeu"];

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

// 13/08, segunda passada — o eixo é ADIMPLÊNCIA, não "o que aconteceu com o
// pagamento". Pedido textual do Marcio: "ao invés de 'saldo pago', coloca uma
// lógica: a pessoa está em dia; a pessoa está devendo tanto ou tem parcela
// atrasada. É literalmente jogo rápido — bater o olho e ver: caraca, esse cara
// tá devendo, vou cobrar ele; esse tá em dia, beleza."
//
// "Saldo pago" saiu do vocabulário: dizia o que o SISTEMA registrou, não o que
// o operador precisa decidir. Quem lê o board está perguntando "cobro ou não
// cobro?", e é essa a pergunta que o selo passa a responder.
//
// MEDIDO EM PRODUÇÃO (251 cards ativos do HM) antes de desenhar:
//   27  atrasados — cobrar agora
//  148  devendo SEM data combinada — ninguém marcou quando paga. Era o maior
//       grupo do board e não tinha nome: aparecia como um "deve R$ X" cinza,
//       igual a quem tem tudo combinado. É a fila de trabalho do comercial.
//   12  em dia, dentro do combinado
//   58  quitados
// E a suposição que o dado derrubou: dos 27 atrasados **só 1 está parcelando**.
// O atraso aqui é de UMA data combinada, não de carnê — por isso o selo fala em
// data, e só menciona parcelas quando elas existem de verdade.
//
// A cor é a urgência, e o operador lê sem decorar legenda:
//   rose    atrasado / inadimplente (≥60d) → cobrar agora, decisão do operador
//   âmbar   sem data / conferir / 31-60d sem pagar → falta combinar, ou o
//           número não é confiável, ou está esfriando
//   índigo  em dia / parcelando        → combinado e sendo cumprido (ainda deve)
//   verde   quitado                    → não deve mais nada
// Verde só quando NÃO HÁ o que cobrar — foi por isso que "Saldo pago" saiu do
// verde: a pessoa seguia devendo o resto e o card dizia que estava tudo certo.
//
// INADIMPLÊNCIA (17/08, contrato do backend em app/api/hm/kanban): `dias_sem_pagar`
// e `inadimplente` chegam prontos da view — aqui só se traduz em selo, sem
// recalcular nada. O rose de 60+ dias NUNCA afirma "cancelou" — o Marcio foi
// explícito: inadimplência só sinaliza, quem decide é o operador. O texto diz
// "decida" propositalmente, nunca "cancelado" nem "vai cancelar".
export function estadoFinanceiroCard(p: {
  quitado: boolean;
  conferirSaldo: boolean;
  pendenteCredito: boolean;
  creditoObsTexto: string | null;
  /** `status_parcela` da cs.vw_hm_financeiro (0214) — já reconciliado com a razão. */
  statusParcela?: "quitado" | "em_dia" | "atrasado" | "aguardando" | null;
  /** `pagamento_previsto_em`: a data que a operação combinou com o aluno. */
  previstoEm: string | null;
  parcelasPagas?: number | null;
  parcelasContratadas?: number | null;
  /** Já formatado em BRL (ex. "R$ 14.303"), ou null quando o sistema não sabe. */
  saldoTxt: string | null;
  quitadoTitle: string;
  /** `situacao` da view (0. contrato kanban, 17/08): quando "mensalidade_em_curso",
   *  mostra a próxima cobrança em vez do genérico "em dia". Opcional: undefined
   *  enquanto o backend não mergeou — nesse caso cai no comportamento antigo. */
  situacao?: "quitado" | "mensalidade_em_curso" | "saldo_parado" | "cancelado" | "oferta_enviada" | "incalculavel" | null;
  /** Data (não formatada) da próxima cobrança — só usada quando `situacao` for
   *  `mensalidade_em_curso`. */
  proximaCobrancaEm?: string | null;
  /** Dias sem pagar (backend, 17/08). null/undefined = sistema não sabe — não
   *  vira selo (nunca inventa um "0 dias"). */
  diasSemPagar?: number | null;
  /** >=60 dias — o backend já aplica o corte; aqui só se traduz em selo. */
  inadimplente?: boolean;
}): EstadoFinanceiro | null {
  const fmtData = (iso: string | null | undefined) =>
    iso ? new Date(iso).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" }) : null;
  // Só menciona parcelas quando a pessoa está mesmo num parcelamento — dizer
  // "0 de 12" para quem não pagou nenhuma é ruído, e é a maioria dos casos.
  const parcelas =
    p.parcelasContratadas && p.parcelasContratadas > 1 && (p.parcelasPagas ?? 0) > 0
      ? `${p.parcelasPagas} de ${p.parcelasContratadas} parcelas pagas`
      : null;

  // 1. O sistema não confia no próprio número — afirmar qualquer estado de
  //    adimplência ao lado seria o card se contradizendo.
  if (p.conferirSaldo) {
    return {
      txt: "Conferir saldo", tom: "atencao", icon: "alerta",
      title: "Saldo zerado por dupla contagem do crédito pró-rata — não é quitação. O comercial precisa decidir quanto cobrar antes de dar como pago.",
    };
  }
  // 2. Não deve mais nada — nem quitado nem inadimplente coexistem, e "não
  //    deve mais nada" é o fato mais forte.
  if (p.quitado) return { txt: "Quitado", tom: "positivo", icon: "ok", title: p.quitadoTitle };

  // 3. INADIMPLENTE (≥60 dias sem pagar) — vence qualquer leitura de parcela:
  //    a régua de dias é mais grave que "atrasado numa data combinada". Rose,
  //    mas o texto pede DECISÃO, nunca afirma cancelamento.
  if (p.inadimplente) {
    const dias = p.diasSemPagar ?? null;
    return {
      txt: `Inadimplente${dias != null ? ` · ${dias}d` : ""}`, tom: "bloqueio", icon: "alerta",
      title: `${dias != null ? `${dias} dias` : "Mais de 60 dias"} sem pagar. Não significa que cancelou — o operador precisa decidir o que fazer com este caso.`,
    };
  }
  // 4. ESFRIANDO (31-60 dias sem pagar) — âmbar: ainda não é a régua de
  //    inadimplência, mas já é hora de olhar antes que vire.
  if (p.diasSemPagar != null && p.diasSemPagar >= 31) {
    return {
      txt: `Sem pagar há ${p.diasSemPagar}d`, tom: "atencao", icon: "alerta",
      title: `${p.diasSemPagar} dias sem pagamento registrado. Ainda não é inadimplência (≥60d), mas está esfriando — vale contato.`,
    };
  }

  const quanto = p.saldoTxt ? ` · deve ${p.saldoTxt}` : "";
  const credito = p.creditoObsTexto ? ` · Por que o crédito: ${p.creditoObsTexto}` : "";

  // 5. ATRASADO — a data combinada venceu e a razão não registrou pagamento
  //    depois dela. É o card que o operador tem de pegar hoje.
  if (p.statusParcela === "atrasado") {
    const d = fmtData(p.previstoEm);
    return {
      txt: `Atrasado${quanto}`, tom: "bloqueio", icon: "alerta",
      title: `Combinou pagar${d ? ` em ${d}` : ""} e não pagou${p.saldoTxt ? ` — falta ${p.saldoTxt}` : ""}.`
        + (parcelas ? ` ${parcelas}.` : "") + " Cobrar." + credito,
    };
  }
  // 6. PARCELANDO — `situacao === "mensalidade_em_curso"` (contrato do
  //    backend, 17/08): mostra a PRÓXIMA COBRANÇA no lugar do genérico "em
  //    dia". Resolve os 30 cards que hoje não têm nenhuma data visível.
  //    Índigo — mesma família de "em dia": combinado e sendo cumprido.
  if (p.situacao === "mensalidade_em_curso") {
    const d = fmtData(p.proximaCobrancaEm);
    return {
      txt: `Parcelando${d ? ` · próx. ${d}` : ""}${quanto}`, tom: "contexto", icon: "relogio",
      title: `Mensalidade em curso${d ? ` — próxima cobrança em ${d}` : " — sem próxima cobrança calculada"}.`
        + (parcelas ? ` ${parcelas}.` : "") + credito,
    };
  }
  // 7. EM DIA — tem data combinada e está sendo cumprida. Continua devendo, por
  //    isso não é verde: verde é "não há o que cobrar".
  if (p.statusParcela === "em_dia") {
    const d = fmtData(p.previstoEm);
    return {
      txt: `Em dia${quanto}`, tom: "contexto", icon: "relogio",
      title: `Dentro do combinado${d ? ` (próximo pagamento em ${d})` : ""}.`
        + (parcelas ? ` ${parcelas}.` : "") + credito,
    };
  }
  // 8. DEVE E NINGUÉM COMBINOU NADA — 148 cards hoje. Não é "em dia" (não há
  //    combinado para cumprir) nem atraso (não há prazo vencido): é trabalho
  //    parado esperando o comercial marcar uma data.
  if (p.saldoTxt && !p.previstoEm) {
    return {
      txt: `Sem data · deve ${p.saldoTxt}`, tom: "atencao", icon: "alerta",
      title: `Deve ${p.saldoTxt} e não há data de pagamento combinada. Combinar uma data com o aluno.`
        + (parcelas ? ` ${parcelas}.` : "") + credito,
    };
  }
  // 9. Deve, tem data, e o status ainda não diz atraso nem cumprimento
  //    (`aguardando`: a data combinada ainda não chegou).
  if (p.saldoTxt) {
    const d = fmtData(p.previstoEm);
    return {
      txt: `Em dia${quanto}`, tom: "contexto", icon: "relogio",
      title: `Deve ${p.saldoTxt}${d ? `, com pagamento combinado para ${d}` : ""} — o prazo ainda não venceu.`
        + (parcelas ? ` ${parcelas}.` : "") + credito,
    };
  }
  // 10. Sem saldo conhecido: o card não afirma o que não sabe.
  return null;
}

// ===== Precedência da ficha inteira (13/08, atualizada 17/08) ================
// Não só o financeiro — o CARD tem um estado dominante, e quando ele vale, o
// resto se cala. Ordem (documentada aqui porque é regra, não acidente de
// render; as telas que montam o card leem ISTO antes de decidir o que
// desenhar):
//   1. CANCELADO — não é cliente. Domina TUDO: identidade (aluno novo/antigo),
//      financeiro (deve, quitado, parcela, conferir saldo, crédito pendente),
//      reunião (sem data/vencida) e contexto (recompra, categoria de entrada,
//      "card novo") somem. O que sobra: quem é (nome/avatar/contato), o
//      motivo do cancelamento, tags, operador e "esta pessoa também está no
//      outro board" — o resto mora na ficha, um clique adiante (é contexto,
//      não ação).
//   2. SEM OPERADOR (ver SeloSemOperador) — ninguém é dono, ação urgente é
//      associar um responsável. Vence "reunião em risco": sem dono, cobrar do
//      operador uma decisão de reunião não tem quem a receba.
//   3. REUNIÃO EM RISCO (17/08, ver `estadoReuniaoCard` abaixo) — card em
//      "Reunião Agendada" sem `reuniao_em` OU com a data já vencida. É
//      CÁLCULO DE TELA, nunca escrita: o sistema não afirma que a reunião não
//      aconteceu, só cobra do operador uma decisão (marcar resultado/nova
//      data). Ocupa o MESMO canto que "sem operador"/"novo" — só um selo cabe,
//      e aqui a urgência é maior que "ninguém abriu ainda" (regra 4).
//   4. Estado financeiro (ver `estadoFinanceiroCard` abaixo) — um selo só.
//   5. Identidade (aluno novo/antigo, pool, colega) — eixo independente do
//      financeiro, sempre visível exceto sob a regra 1.
// O selo temporal genérico (`tempoTom`, "parado há Nd" em kanban/page.tsx)
// não compete com a regra 3: onde `estadoReuniaoCard` já diz algo mais
// específico ("pré-marcada como NÃO FEITA"), o genérico perde o sentido de
// alarmar por cima — ele continua existindo (é "tempo na ETAPA", pergunta
// diferente de "a reunião aconteceu?"), só não ganha destaque extra ali.

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
  "Aluno cancelado — só o administrador do Grupo Participa acessa";

// ===== Colunas imutáveis da Hotmart (17/08) ==================================
// Pedido do Marcio: "Boleto gerado, compra aprovada, reclamada, reembolsado -
// Imutáveis (os operadores não podem mexer aqui, tem que ir automático via
// hotmart)". Cinco colunas travadas — bloqueiam ENTRADA e SAÍDA manual — mais
// duas "espelho" (leem o pagamento realizado na Ativação e só REFLETEM aqui).
// A fonte de verdade é `origem_movimento`, que a rota do board já devolve por
// estágio (GET /api/hm/kanban e o relatório, 0290 + 18/08). Esta lista NÃO é
// contrato — é a DEGRADAÇÃO para quando `origem_movimento` não chegar no
// payload (rota antiga em cache do navegador/CDN, resposta stale): o MESMO
// espelho que `ESTAGIOS_CANCELAMENTO_HM` já faz para o cancelamento, hoje
// ampliado para cobrir as 5 chaves. Se o servidor mudar a classificação, mude
// aqui junto — mas o caminho normal é ler `origem_movimento`, não esta lista.
export const ESTAGIOS_HOTMART_HM = ["hm_boleto_gerado", "hm_cancelamento", "hm_reembolsado"] as const;
export const ESTAGIOS_ESPELHO_HM = ["hm_pagamento_parcelado", "hm_pagamento_realizado"] as const;

export type OrigemMovimento = "hotmart" | "derivada" | "operador";

/** A coluna é travada pela Hotmart (entrada E saída bloqueadas para quem não é
 *  master)? Lê `origem_movimento` quando o backend já manda; sem ele, cai na
 *  lista espelhada acima — nunca destrava por ausência de dado. */
export function ehColunaHotmart(chave: string | null | undefined, origemMovimento?: OrigemMovimento | null): boolean {
  if (!chave) return false;
  if (origemMovimento != null) return origemMovimento === "hotmart";
  return (ESTAGIOS_HOTMART_HM as readonly string[]).includes(chave);
}

/** A coluna é espelho (mostra o pagamento realizado na Ativação; mexer aqui
 *  desfaz o pagamento — não é a trava da Hotmart, é o aviso do espelho). */
export function ehColunaEspelho(chave: string | null | undefined, origemMovimento?: OrigemMovimento | null): boolean {
  if (!chave) return false;
  if (origemMovimento != null) return origemMovimento === "derivada";
  return (ESTAGIOS_ESPELHO_HM as readonly string[]).includes(chave);
}

export const TITLE_COLUNA_HOTMART =
  "Esta etapa vem da Hotmart — a ficha entra e sai sozinha, quando o pagamento é confirmado. Não é possível mover à mão.";
export const TITLE_COLUNA_ESPELHO =
  "Espelho da Ativação — esta ficha está na Ativação; aqui só se mostra o pagamento. Para tirá-la da Ativação, abra a ficha.";

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
// Não é texto de tela — é o VALOR da tag gravado no banco. A grafia antiga
// precisa continuar aqui para casar as fichas que ainda não passaram pelo
// backfill do 0216.
export const TAGS_ALUNO_NOVO: readonly string[] = ["Aluno novo", "Lead novo"]; // vocabulario-ok

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

// "SEM OPERADOR" (17/08, pedido do Marcio) ===================================
// Toda venda nova hoje nasce carimbada para a Kelly — o card sempre teve dono,
// então nada sinalizava "falta distribuir" e ela distribuía sem saber que
// precisava. Agora o card de venda nova nasce com `responsavel_id === null`
// de propósito, e este selo é o aviso "GRITANDO na tela" que o pedido pediu —
// vermelho forte (família `bloqueio`, TOM acima), não âmbar: aqui não é "pare
// e confira", é "ninguém é dono disto ainda", o mesmo tipo de impedimento de
// ação que o selo de cancelado usa.
//
// PRECEDÊNCIA com SeloCardNovo (0217): os dois ocupam o MESMO canto absoluto
// (topo direito) e um card recém-nascido sem dono tem as duas condições ao
// mesmo tempo (`visto_em === null` E `responsavel_id === null`). Só cabe UM no
// canto — "sem operador" VENCE "novo": a ação urgente é associar um
// responsável (sem isso o card nem aparece pra quem devia agir); "ninguém
// abriu ainda" é secundário e continua valendo por trás (o title de
// SeloCardNovo não se perde, só o selo visual cede o canto). As telas que
// renderizam os dois devem checar `semOperador` ANTES de `naoVisto` e nunca
// desenhar as duas ao mesmo tempo.
// `posicao`: "absoluto" (default) é o canto do CARD (board) — pointer-events-none,
// só decorativo, disputa o canto com SeloCardNovo (ver precedência acima).
// "inline" é para telas sem canto de card (tabela): mesmo selo, no fluxo normal
// do texto, ao lado do nome — mesmo padrão de SeloRecompra/SeloAlunoAntigo ali.
export function SeloSemOperador({ className, posicao = "absoluto" }: { className?: string; posicao?: "absoluto" | "inline" }) {
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center gap-0.5 rounded-full bg-rose-600 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-white shadow-sm motion-safe:animate-pulse dark:bg-rose-500",
        posicao === "absoluto"
          ? "pointer-events-none absolute -right-1.5 -top-2 z-10 ring-2 ring-white dark:ring-slate-900"
          : "ring-1 ring-rose-700/20 dark:ring-rose-300/20",
        className,
      )}
      title="Associe esse cliente a alguém da sua equipe ou a você mesma."
    >
      <svg className="h-2 w-2 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M12 9v4M12 17h.01" /><path d="M10.3 3.9 2 18a2 2 0 0 0 1.7 3h16.6a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z" /></svg>
      sem operador
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
      title="Venda nova — ninguém da equipe abriu esta ficha ainda. O selo some assim que alguém abrir a ficha."
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

// ===== GPS pendente (18/08, pedido do Marcio) ================================
// "Precisa deixar essa checkbox dentro do card do aluno também" — mas o card já
// tem selos demais (queixa registrada: "eu estou sentindo muito misturado
// tudo", 13/08). Em vez de replicar os 5 checkboxes do checklist aqui, só o
// item que o Marcio pediu vira um selo — e só quando falta: card ativo (some
// sob cancelado, mesma regra dos demais) na aba Ativação com `ativ_gps` ainda
// false. NÃO é clicável: o card inteiro já abre a ficha no clique (onAbrir) e
// um alvo de teclado aninhado dentro de outro role="button" duplicaria o Enter
// e quebraria a navegação — o selo leva o olho, a ficha é onde se marca.
// Âmbar (mesma família de "pare e confira" da tabela de cores acima) porque é
// pendência que pede ação do operador, não histórico neutro (que seria índigo).
export function gpsPendente(estagioAba: string | null, ativGps: boolean | undefined): boolean {
  return estagioAba === "ativacao" && ativGps === false;
}
export function SeloGpsPendente({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center gap-0.5 rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold text-amber-800 dark:bg-amber-500/15 dark:text-amber-300",
        className,
      )}
      title="Falta o acesso ao GPS (programa de implementação) — o único item do checklist de ativação que o sistema nunca pré-marca sozinho. Abra a ficha para marcar."
    >
      <svg className="h-2.5 w-2.5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10" /><path d="M12 8v4M12 16h.01" /></svg>
      GPS pendente
    </span>
  );
}

// ===== Reunião em risco (17/08) ==============================================
// Medido em produção: dos 11 cards em "Reunião Agendada", 3 não têm
// `reuniao_em` e 8 têm data já vencida — hoje NENHUM dos dois mostra qualquer
// sinal (o chip azul só renderiza `if (dataEtapa?.quando)`). Os dois casos são
// a MESMA pergunta não respondida: "essa reunião aconteceu?" — o sistema não
// pode afirmar que não (só o operador sabe), então ele COBRA a decisão em vez
// de assumir um lado.
//
// Decisão do Marcio: **cálculo de tela, ZERO escrita no banco.** Nenhuma das
// duas funções abaixo grava nada — só leem `estagio_chave` + `reuniao_em` e
// devolvem o que mostrar. A ação (marcar resultado, remarcar) continua sendo
// do operador, na ficha.
export function ehReuniaoAgendadaSemData(estagioChave: string | null | undefined, reuniaoEm: string | null | undefined): boolean {
  return estagioChave === "hm_reuniao_agendada" && !reuniaoEm;
}
export function ehReuniaoVencidaNaoTratada(estagioChave: string | null | undefined, reuniaoEm: string | null | undefined): boolean {
  return estagioChave === "hm_reuniao_agendada" && !!reuniaoEm && new Date(reuniaoEm).getTime() < Date.now();
}

export type EstadoReuniao = { txt: string; title: string };

// Irmã de `estadoFinanceiroCard`: mesma forma (função pura, um `EstadoReuniao
// | null`), mesma disciplina de precedência (a primeira condição que servir
// GANHA). As duas nunca competem entre si — ver a precedência do card
// inteiro, acima — mas cada uma decide sozinha o SEU eixo.
export function estadoReuniaoCard(p: { estagioChave: string | null | undefined; reuniaoEm: string | null | undefined }): EstadoReuniao | null {
  // 1. Sem data nenhuma marcada — a pessoa entrou na etapa mas ninguém agendou.
  if (ehReuniaoAgendadaSemData(p.estagioChave, p.reuniaoEm)) {
    return {
      txt: "Sem data marcada",
      title: "Está em \"Reunião Agendada\" e ainda não tem reunião marcada. Marque a data da reunião na ficha.",
    };
  }
  // 2. Data marcada, já passou, e a pessoa continua na mesma etapa — ninguém
  //    registrou o desfecho (realizada, não compareceu, reagendou).
  if (ehReuniaoVencidaNaoTratada(p.estagioChave, p.reuniaoEm)) {
    return {
      txt: "Pré-marcada como NÃO FEITA",
      title: "A data da reunião já passou e ninguém registrou o que aconteceu com ela. O sistema NÃO afirma que a reunião não ocorreu — só está cobrando uma decisão sua: marque o resultado ou remarque na ficha.",
    };
  }
  return null;
}

// "REUNIÃO SEM DATA" (17/08, F1) — mesmo padrão visual de SeloSemOperador:
// rose forte, canto absoluto, `motion-safe:animate-pulse`. Entra na MESMA
// disputa de canto (ver a precedência documentada acima e em SeloSemOperador)
// — as telas devem checar reunião ANTES do financeiro/identidade e nunca
// desenhar mais de um selo no canto ao mesmo tempo.
export function SeloReuniaoSemData({ className, posicao = "absoluto" }: { className?: string; posicao?: "absoluto" | "inline" }) {
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center gap-0.5 rounded-full bg-rose-600 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-white shadow-sm motion-safe:animate-pulse dark:bg-rose-500",
        posicao === "absoluto"
          ? "pointer-events-none absolute -right-1.5 -top-2 z-10 ring-2 ring-white dark:ring-slate-900"
          : "ring-1 ring-rose-700/20 dark:ring-rose-300/20",
        className,
      )}
      title="Reunião sem data marcada — abra a ficha e marque quando ela vai acontecer."
    >
      <svg className="h-2 w-2 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M8 2v4M16 2v4M3.5 9h17M21 8.5V17c0 3-1.5 5-5 5H8c-3.5 0-5-2-5-5V8.5c0-3 1.5-5 5-5h8c3.5 0 5 2 5 5Z" /><path d="M12 9v4M12 17h.01" /></svg>
      sem data
    </span>
  );
}

// "REUNIÃO VENCIDA, NINGUÉM DISSE O QUE ACONTECEU" (17/08, F2). Mesmo peso
// visual de SeloReuniaoSemData (o outro lado do mesmo problema) — texto muda
// para o vocabulário do Marcio: "Pré-marcada como NÃO FEITA". Nunca afirma
// que não aconteceu de fato (isso seria o sistema mentindo) — o `title`
// deixa isso explícito.
export function SeloReuniaoVencida({ className, posicao = "absoluto" }: { className?: string; posicao?: "absoluto" | "inline" }) {
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center gap-0.5 rounded-full bg-rose-600 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-white shadow-sm motion-safe:animate-pulse dark:bg-rose-500",
        posicao === "absoluto"
          ? "pointer-events-none absolute -right-1.5 -top-2 z-10 ring-2 ring-white dark:ring-slate-900"
          : "ring-1 ring-rose-700/20 dark:ring-rose-300/20",
        className,
      )}
      title="Pré-marcada como NÃO FEITA — a data já passou e ninguém registrou o resultado da reunião. O sistema não afirma que ela não aconteceu; marque o resultado ou remarque na ficha."
    >
      <svg className="h-2 w-2 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M8 2v4M16 2v4M3.5 9h17M21 8.5V17c0 3-1.5 5-5 5H8c-3.5 0-5-2-5-5V8.5c0-3 1.5-5 5-5h8c3.5 0 5 2 5 5Z" /><path d="M12 9v4M12 17h.01" /></svg>
      não feita
    </span>
  );
}
