"use client";

import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { Button, cn, EmptyState, fieldClass, fieldCompactClass, Spinner } from "@/app/_components/ui";
import { Avatar } from "@/app/_components/avatar";
import { Reveal } from "@/app/_components/anim";
import { TagChip } from "@/app/_components/tags";
import { TagPicker, type TagOpcao } from "@/app/hm/_components/tag-picker";
import { HmDrawer } from "@/app/hm/_components/hm-drawer";
import { HmCadastroModal } from "@/app/hm/_components/hm-cadastro";
import { HmVisao } from "@/app/hm/_components/hm-visao";
import { canaisFixosDo, gruposCanal, HmCanaisFixos, type ProdutoBoard } from "@/app/hm/_components/hm-canais";
import { MultiSelect } from "@/app/_components/multi-select";
import { ContatoDoNome } from "@/app/_components/copiavel";
import { DisparoModal } from "@/app/_components/disparo";
import { useMe, msgErroPermissao } from "@/app/_components/use-me";
import { useFetchHm } from "@/app/hm/_components/api-produto";
import { useProdutoHm } from "@/app/hm/_components/use-produto";
import { MarcaPortal } from "@/app/_components/marca";
import { ehEstagioCancelamento, origemRecompraDistinta, SeloRecompra, ehAlunoAntigo, SeloAlunoAntigo, SeloSemOperador, TITLE_CARD_CANCELADO, faltaExplicarCredito } from "@/app/hm/_components/card-sinais";
import { SeloEquipe } from "@/app/hm/_components/selo-equipe";
import type { LinhaEsteira, QuandoHm } from "@/lib/services/hm-relatorio";
import { casaBusca } from "@/lib/busca";

// A visão em tabela da esteira HM — a terceira leitura da mesma esteira (o board
// responde "onde cada um está"; aqui a pergunta é "o que está acontecendo com
// todos ao mesmo tempo"). As linhas saem de /api/hm/tabela, que reusa a MESMA
// função do XLSX (relatorioHm) — tabela e planilha nunca contam histórias
// diferentes. Toda escrita passa pelos MESMOS caminhos do board: o PATCH da
// ficha (que roteia etapa para moverEstagioHm e datas para agendarHm) e o lote
// que itera os serviços. A tabela não tem verdade própria.

type Estagio = { chave: string; nome: string; cor: string; aba: string | null; ordem: number };
type FalhaLote = { compradorId: string; nome: string; motivo: string; faltando?: string[] };
type VisaoId = "comercial" | "ativacao" | "agenda" | "financeiro" | "tudo";

const VISOES: { id: VisaoId; label: string }[] = [
  { id: "comercial", label: "Comercial" },
  { id: "ativacao", label: "Ativação" },
  { id: "agenda", label: "Agenda" },
  { id: "financeiro", label: "Financeiro" },
  { id: "tudo", label: "Tudo" },
];

// Os mesmos rótulos e valores da ficha (hm-drawer) — a tabela não inventa vocabulário.
const MEIOS: { v: string; label: string }[] = [
  { v: "avista", label: "À vista" },
  { v: "pix", label: "Pix" },
  { v: "boleto", label: "Boleto parcelado" },
  { v: "cartao", label: "Cartão" },
  { v: "cartao_recorrente", label: "Cartão recorrente" },
];
const RESULTADOS = ["Aguardando retorno", "Agendada", "Realizada", "Realizada/pago", "Reagendar", "Não respondeu"];

// A "Origem" da linha exibe SÓ os 5 eventos fixados (decisão de 14/07 — Imersão
// POA, HT26 etc. ficam de fora). A tag continua no card (o popup de tags e a
// coluna Tags mostram tudo); aqui é a leitura de negócio, não o inventário.
// Recebe o produto (10/08): a lista de canais é POR BOARD — no Aurum, "Origem" só
// pode mostrar canal do Aurum, nunca HT29/HT ATM (que são do HM).
const canalDe = (tags: string[], produto?: ProdutoBoard | null) => {
  const fixos = canaisFixosDo(produto);
  return tags.filter((t) => fixos.includes(t));
};

// O checklist com as MESMAS palavras do board (lib/services/hm) — quando a trava
// recusar a entrada em "Ativação Realizada", o que falta se lê igual nas duas telas.
const CHECKLIST = [
  { campo: "ativ_searchie", curto: "Searchie", label: "Acesso ao Searchie/Óbvio" },
  { campo: "ativ_comunidade", curto: "Comunidade", label: "Acesso à comunidade THB" },
  { campo: "ativ_grupo", curto: "Grupo", label: "Grupo de informes" },
  { campo: "ativ_pesquisa", curto: "Pesquisa", label: "Pesquisa" },
] as const;

// ---------------------------------------------------------------- formatação
function num(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const x = typeof v === "string" ? Number(v) : (v as number);
  return Number.isFinite(x) ? x : null;
}
function brl(v: number): string {
  return v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}
// O quanto esta pessoa ainda deve. `saldo_a_perseguir` (vw_hm_financeiro) é o que
// vale: pacote − TUDO o que já foi pago, inclusive as mensalidades. O saldo da
// fn_hm_prorata é outra coisa — "quanto seria o saldo cheio hoje" — e ignora o que
// a pessoa já pagou; usá-lo aqui cobraria de novo quem está pagando em dia.
// Null = o sistema não sabe (não é zero).
function saldoDe(l: LinhaEsteira): number | null {
  return num(l.saldo_a_perseguir) ?? num(l.saldo_a_pagar);
}
function dt(v: QuandoHm): Date | null {
  if (!v) return null;
  const d = new Date(v);
  return isNaN(d.getTime()) ? null : d;
}
function fmtDataHora(v: QuandoHm): string {
  const d = dt(v);
  return d ? d.toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", year: "2-digit", hour: "2-digit", minute: "2-digit" }) : "—";
}
function fmtData(v: QuandoHm): string {
  const d = dt(v);
  return d ? d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "2-digit" }) : "—";
}

// Reembolso, chargeback e protesto acabam todos em "aluno sem acesso", mas para
// o financeiro são coisas MUITO diferentes: um é devolução combinada, o outro é
// o cliente contestando na operadora. A coluna diz qual foi.
const EVENTO_HOTMART: Record<string, string> = {
  PURCHASE_REFUNDED: "Reembolso confirmado na Hotmart",
  PURCHASE_CHARGEBACK: "Chargeback — o cliente contestou na operadora do cartão",
  PURCHASE_PROTEST: "Compra protestada na Hotmart",
  PURCHASE_CANCELED: "Compra cancelada na Hotmart",
  SUBSCRIPTION_CANCELLATION: "Assinatura cancelada na Hotmart",
};
const EVENTO_CURTO: Record<string, string> = {
  PURCHASE_REFUNDED: "Reembolso",
  PURCHASE_CHARGEBACK: "Chargeback",
  PURCHASE_PROTEST: "Protesto",
  PURCHASE_CANCELED: "Cancelada",
  SUBSCRIPTION_CANCELLATION: "Assinatura",
};

// A situação da compra HM na Hotmart (0094) — o FATO, ao lado da nossa leitura.
// `ok` verde = dinheiro dentro; os demais são graus de problema.
const STATUS_HOTMART: Record<string, { label: string; tom: "ok" | "espera" | "ruim" }> = {
  APPROVED: { label: "Aprovada", tom: "ok" },
  COMPLETE: { label: "Concluída", tom: "ok" },
  COMPLETED: { label: "Concluída", tom: "ok" },
  PRINTED_BILLET: { label: "Boleto impresso", tom: "espera" },
  BILLET_PRINTED: { label: "Boleto impresso", tom: "espera" },
  WAITING_PAYMENT: { label: "Aguardando pagamento", tom: "espera" },
  EXPIRED: { label: "Expirada", tom: "ruim" },
  REFUNDED: { label: "Reembolsada", tom: "ruim" },
  CHARGEBACK: { label: "Chargeback", tom: "ruim" },
  PROTESTED: { label: "Protestada", tom: "ruim" },
  CANCELED: { label: "Cancelada", tom: "ruim" },
};
const TOM_STATUS: Record<"ok" | "espera" | "ruim", string> = {
  ok: "text-emerald-600 dark:text-emerald-400",
  espera: "text-amber-600 dark:text-amber-400",
  ruim: "font-semibold text-rose-600 dark:text-rose-400",
};
// "há 2h", "ontem", "há 5 dias" — quem olha a fila quer saber se é recente, não a
// data exata (essa fica no title).
function haQuanto(d: Date): string {
  const min = Math.floor((Date.now() - d.getTime()) / 60000);
  if (min < 1) return "agora";
  if (min < 60) return `há ${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `há ${h}h`;
  const dias = Math.floor(h / 24);
  if (dias === 1) return "ontem";
  if (dias < 30) return `há ${dias} dias`;
  return d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "2-digit" });
}
function toLocalInput(v: QuandoHm): string {
  const d = dt(v);
  if (!d) return "";
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}
function toDateInput(v: QuandoHm): string {
  const d = dt(v);
  if (!d) return "";
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
function fromLocalInput(v: string): string | null {
  if (!v) return null;
  const d = new Date(v);
  return isNaN(d.getTime()) ? null : d.toISOString();
}
function feitosChecklist(l: LinhaEsteira): number {
  return [l.ativ_searchie, l.ativ_comunidade, l.ativ_grupo, l.ativ_pesquisa].filter(Boolean).length;
}
// Tom do "dias parados" — os mesmos degraus do card do board (3 e 7 dias).
function diasTom(dias: number | null): string {
  if (dias === null) return "text-slate-400 dark:text-slate-500";
  if (dias >= 7) return "text-rose-500 dark:text-rose-400";
  if (dias >= 3) return "text-amber-500 dark:text-amber-400";
  return "text-slate-500 dark:text-slate-400";
}

// ------------------------------------------------------------------- lentes
// Uma etapa é onde a pessoa está; uma LENTE é o que está errado com ela — os
// estados que o board não tem como expressar (não existe coluna "recebeu o link
// e sumiu"). Operam sobre as linhas já carregadas; contagem zero é informação.
type Lente = { id: string; grupo: string; label: string; destaque?: boolean; test: (l: LinhaEsteira, hoje0: number) => boolean };

const LENTES: Lente[] = [
  {
    id: "link_nao_pagou", grupo: "Cobrança do saldo", label: "Link enviado e não pagou",
    test: (l) => !!l.link_saldo_enviado_em && !l.pagamento_em,
  },
  {
    // 0214: "vencida" segue `status_parcela` (reconciliado com cs.hm_pagamentos),
    // não a data crua — sem isto a lente listava quem já tinha pago depois da
    // previsão (medido em produção 12/08: 45% dos vencidos eram falso positivo).
    // Fallback: sem `status_parcela` (rota antiga em cache), cai na leitura anterior.
    id: "previsao_vencida", grupo: "Cobrança do saldo", label: "Previsão vencida",
    test: (l, hoje0) => l.status_parcela === undefined
      ? (() => { const d = dt(l.pagamento_previsto_em); return !!d && d.getTime() < hoje0 && !l.pagamento_em; })()
      : l.status_parcela === "atrasado",
  },
  {
    // "Passou da reunião": está na etapa pós-reunião do Comercial (ou o resultado
    // já diz "Realizada") e ninguém escreveu o combinado — o acordo é o que
    // separa cobrança de esquecimento.
    id: "sem_acordo", grupo: "Cobrança do saldo", label: "Sem acordo",
    test: (l) => (l.estagio_aba ?? "comercial") === "comercial" && l.estagio_chave !== "hm_cancelamento"
      && (l.estagio_chave === "hm_reuniao_finalizada" || /^realizada/i.test(l.reuniao_resultado ?? "")) && !l.acordo,
  },
  {
    // O FURO que escorre dinheiro: já passou da reunião (ou está na Ativação),
    // ainda deve, e ninguém combinou NADA — sem acordo, sem previsão e sem link de
    // saldo enviado. É o saldo sem plano de cobrança. Exclui quem já parcela (tem
    // plano) e quem foi cancelado. O sistema acende isto sozinho, para o comercial
    // não deixar a venda fechada virar dinheiro perdido.
    id: "devendo_sem_plano", grupo: "Cobrança do saldo", label: "Fechou, deve e sem plano", destaque: true,
    test: (l) => !l.quitado && !l.cancelamento_efetivado_em
      && l.situacao_financeira !== "mensalidade_em_curso"
      && (saldoDe(l) ?? 1) > 0
      && !l.acordo && !l.pagamento_previsto_em && !l.link_saldo_enviado_em
      && (l.estagio_aba === "ativacao" || l.estagio_chave === "hm_reuniao_finalizada" || l.estagio_chave === "hm_pagamento_realizado"),
  },
  {
    id: "checklist_metade", grupo: "Ativação incompleta", label: "Checklist pela metade",
    test: (l) => l.estagio_aba === "ativacao" && feitosChecklist(l) >= 1 && feitosChecklist(l) <= 3,
  },
  {
    id: "sem_grupo", grupo: "Ativação incompleta", label: "Sem grupo de informes",
    test: (l) => l.estagio_aba === "ativacao" && (!l.ativ_grupo || !l.grupo_informes),
  },
  {
    id: "com_pendencia", grupo: "Ativação incompleta", label: "Com pendência escrita",
    test: (l) => !!l.pendencia,
  },
  {
    id: "parado_7d", grupo: "Abandono / enrolação", label: "Parado há +7 dias",
    test: (l) => (l.dias_na_etapa ?? 0) >= 7,
  },
  {
    id: "remarcou_2x", grupo: "Abandono / enrolação", label: "Remarcou 2+ vezes",
    test: (l) => (num(l.reunioes_remarcadas) ?? 0) + (num(l.entrevistas_remarcadas) ?? 0) >= 2,
  },
  {
    id: "nao_compareceu", grupo: "Abandono / enrolação", label: "Não compareceu",
    test: (l) => (num(l.nao_comparecimentos) ?? 0) > 0,
  },
  {
    // A fila de quem saiu e continua dentro de tudo. O reembolso volta sozinho;
    // o acesso, não — alguém tem de tirar a pessoa do Searchie, da comunidade e
    // do grupo. Enquanto faltar um item, a linha fica aqui.
    id: "acessos_a_remover", grupo: "Cancelamento", label: "Cancelou e ainda tem acesso", destaque: true,
    test: (l) => !!l.cancelamento_efetivado_em && !l.acessos_revogados_em,
  },
  {
    // Pediu e ninguém confirmou nem descartou: ou o reembolso saiu (e a base não
    // sabe), ou a pessoa desistiu (e o card mente). Um pedido pendurado é uma
    // decisão que ninguém tomou.
    id: "cancelamento_em_aberto", grupo: "Cancelamento", label: "Pedido sem desfecho",
    test: (l) => !!l.cancelamento_em && !l.cancelamento_efetivado_em,
  },
  {
    // Marcamos como cancelado, mas a Hotmart nunca confirmou. Ou o reembolso não
    // saiu (e o dinheiro ainda é nosso), ou alguém marcou errado (e tiramos o
    // acesso de um aluno que continua pagando). Os dois casos custam caro.
    id: "cancelado_sem_hotmart", grupo: "Cancelamento", label: "Cancelado sem confirmação da Hotmart", destaque: true,
    test: (l) => !!l.cancelamento_efetivado_em && !l.hotmart_cancelado_em,
  },
  {
    // O contrário: a Hotmart devolveu o dinheiro e o card não sabe. Não deveria
    // acontecer (o webhook faz o caminho inteiro), mas se acontecer é grave — o
    // aluno segue com acesso a um curso que ele não pagou mais.
    id: "hotmart_cancelou_e_card_nao_sabe", grupo: "Cancelamento", label: "Hotmart cancelou e a ficha não registrou",
    test: (l) => !!l.hotmart_cancelado_em && !l.cancelamento_efetivado_em,
  },
  {
    id: "sem_responsavel", grupo: "Higiene", label: "Sem operador",
    test: (l) => !l.responsavel,
  },
  {
    id: "travas", grupo: "Higiene", label: "REVISAR / NÃO CONTATAR",
    test: (l) => l.revisar || l.nao_contatar,
  },
  {
    // A lente mais importante da lista: pagou e não existe na base mestre — o
    // GPS nunca vai criar o acesso dessa pessoa.
    id: "pagou_sem_base", grupo: "Higiene", label: "Pagou e não está na base THB", destaque: true,
    test: (l) => l.apto_ativacao && !l.aluno_id,
  },
  {
    // AUTO-AUDITORIA do pagamento: o card está marcado como pago (apto) mas NÃO
    // qualifica pela regra (0098/0100) — sinal-só, sem saldo pago nem parcelamento.
    // Foi exatamente o furo do Décio. Deve dar zero; se acender, é erro de operador
    // a corrigir na hora, e o sistema não deixa passar em silêncio.
    id: "apto_sem_qualificar", grupo: "Higiene", label: "Marcado pago sem qualificar", destaque: true,
    test: (l) => l.apto_ativacao && !l.pode_finalizar,
  },
  {
    // "Pagou e sumiu": existe OUTRO cadastro com o mesmo telefone e e-mail
    // diferente — a mesma pessoa em dois lugares, com o pagamento podendo cair no
    // cadastro que este card não vê (caso Caria). O webhook já não cria novos
    // (funde por CPF); esta lente pega os antigos para um humano fundir. cpf
    // conferindo = quase certeza; senão, checar (às vezes é sócio/cônjuge no mesmo
    // telefone). Os e-mails do par aparecem no aviso da linha.
    id: "possivel_duplicado", grupo: "Higiene", label: "Possível cadastro duplicado", destaque: true,
    test: (l) => l.possivel_duplicado,
  },
  {
    // Deve o saldo e o sistema não sabe quanto. O lead novo saiu desta lente (o
    // saldo dele é dedutível: 14.700 − o que pagou); sobrou o aluno da base sem os
    // insumos do crédito — e esse dado não existe em planilha nenhuma, alguém
    // precisa buscar a compra antiga dele na Hotmart. Sem isso ele não entra na
    // soma do rodapé e some de toda cobrança: é lacuna, não zero.
    id: "sem_saldo", grupo: "Higiene", label: "Sem saldo calculável", destaque: true,
    test: (l) => !l.quitado && !l.apto_ativacao && saldoDe(l) === null,
  },
  {
    // O crédito pró-rata encolhe todo dia: quanto mais demora a oferta sair, mais
    // o aluno deve — e mais provável que ele reclame do valor que combinamos.
    id: "saldo_parado", grupo: "Cobrança do saldo", label: "Deve e nenhuma oferta foi enviada",
    test: (l) => !l.quitado && !l.apto_ativacao && !l.link_saldo_enviado_em && (saldoDe(l) ?? 0) > 0,
  },
];

// ---------------------------------------------------- células de edição inline
// Estilo "célula de grade": invisível até o hover/focus — a tabela é leitura em
// primeiro lugar, edição quando precisa. Todos param a propagação do clique
// (o clique na LINHA abre a ficha; o clique na célula é da célula).
const celInput =
  "w-full min-w-0 rounded-md border border-transparent bg-transparent px-1.5 py-1 text-xs text-slate-700 outline-none transition placeholder:text-slate-300 hover:border-slate-300 focus:border-brand focus:bg-white focus:ring-1 focus:ring-brand/20 disabled:opacity-50 dark:text-slate-200 dark:placeholder:text-slate-600 dark:hover:border-slate-600 dark:focus:border-brand-400 dark:focus:bg-slate-900";
const celSelect = cn(celInput, "cursor-pointer appearance-none pr-4");
const celCheck =
  "h-3.5 w-3.5 rounded border-slate-300 text-brand focus:ring-brand disabled:opacity-50 dark:border-slate-600";

function CelTexto({ valor, onSave, placeholder, disabled }: {
  valor: string | null; onSave: (v: string | null) => void; placeholder?: string; disabled?: boolean;
}) {
  return (
    <input
      key={valor ?? ""}
      defaultValue={valor ?? ""}
      placeholder={placeholder ?? "—"}
      disabled={disabled}
      title={valor ?? undefined}
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
      onBlur={(e) => { const v = e.target.value.trim(); if (v !== (valor ?? "")) onSave(v || null); }}
      className={celInput}
    />
  );
}

// -------------------------------------------------------------------- colunas
// Contrato de cada coluna (§4 da spec): derivada (nunca editável — é fato ou é
// conta; sem valor, mostra "—"), editável (passa pelo PATCH da ficha) ou ação
// (pagamento/cancelamento NÃO são células — o botão da linha abre a ficha).
// Os rótulos são os MESMOS do XLSX (lib/export/hm-esteira-xlsx).
type Col = {
  id: string;
  label: string;
  dir?: boolean; // alinha à direita (números/dinheiro)
  edit?: boolean; // o <td> engole o clique (não abre a ficha)
  // Congela a coluna à esquerda no scroll horizontal. Com 40 colunas na visão
  // "Tudo", perder o nome de vista transforma a linha num amontoado de números
  // sem dono — e é aí que alguém cobra a pessoa errada.
  fixa?: boolean;
  sortVal: (l: LinhaEsteira) => number | string | null;
  render: (l: LinhaEsteira) => ReactNode;
};

// ---------------------------------------------------------- pagamentos "não lidos"
// A régua do "novo": um pagamento é novo até alguém ABRIR a ficha da pessoa — como
// uma conversa não lida. Guardado por navegador (localStorage), porque é atenção do
// operador, não estado do negócio: o banco não tem nada a ver com o que a Jusy já viu.
const VISTOS_KEY = "hm:pagamentos-vistos";
const JANELA_ESTREIA_MS = 72 * 60 * 60 * 1000; // 3 dias

function lerVistos(): Record<string, string> {
  if (typeof window === "undefined") return {};
  try {
    return JSON.parse(window.localStorage.getItem(VISTOS_KEY) ?? "{}") as Record<string, string>;
  } catch {
    return {};   // localStorage corrompido não pode derrubar a tabela
  }
}

const PRESETS: Record<VisaoId, string[]> = {
  // "credito" antes de "saldo" (13/08, pedido do Marcio): o comercial explica o
  // pró-rata pelo que lê aqui — o crédito tem de estar na MESMA linha de onde
  // ele lê "quanto ela deve", não só dentro da ficha.
  comercial: ["nome", "telefone", "etapa", "esteira", "dias", "responsavel", "equipe", "entrada", "acordo", "meio", "previsao", "link", "credito", "saldo"],
  ativacao: ["nome", "etapa", "esteira", "dias", "responsavel", "equipe", "checklist", "grupo_informes", "pendencia", "entrevista", "na_base", "socios"],
  agenda: ["nome", "responsavel", "equipe", "reuniao", "reuniao_resultado", "reunioes_remarcadas", "entrevista", "entrevista_resultado", "entrevistas_remarcadas", "no_shows"],
  // A visão da Jusy/Isabela: a história financeira em linha — sinal → o que já
  // entrou → o crédito (e o porquê) → parcelas → o que falta → cancelamento
  // (ordem decidida em 14/07; "credito" entrou em 13/08 pelo mesmo motivo do
  // preset "comercial" acima).
  financeiro: ["nome", "origem", "sinal_pago_em", "recebido", "credito", "parcelas", "saldo", "situacao_hotmart", "ultimo_pagamento", "forma_obs", "cancelado", "hotmart_cancelado", "cancelamento_em"],
  // A auditoria: as colunas do XLSX, na mesma ordem (+ a Turma atual, editável).
  tudo: ["nome", "telefone", "email", "etapa", "esteira", "dias", "responsavel", "equipe", "entrada", "turma_origem", "turma",
    "reuniao", "reuniao_resultado", "reunioes_remarcadas", "entrevista", "entrevista_resultado", "entrevistas_remarcadas",
    "no_shows", "sinal_pago_em", "sinal_valor", "meio", "previsao", "acordo", "link", "saldo", "credito", "valor_total", "recebido", "parcelas", "ultimo_pagamento", "pagamento_em",
    "apto", "ativ_searchie", "ativ_comunidade", "ativ_grupo", "ativ_pesquisa", "pendencia", "nao_contatar", "revisar",
    "socios", "cancelado", "situacao_hotmart", "hotmart_cancelado", "cancelamento_em", "cancelamento_motivo", "na_base", "tags"],
};

// --------------------------------------------------------------------- página
export default function HmTabelaPage() {
  const fetchHm = useFetchHm(); // esteira multi-produto (0155)
  const { produto, portal, nome: nomePortal } = useProdutoHm(); // board atual: recorta os canais (10/08) e dá a marca do cabeçalho
  const { me, podeDisparar: podeDisparaFn, podeVerTudo, podeDistribuir, ehMaster, ehCardDeColega } = useMe();
  const podeDisparar = podeDisparaFn("HM");
  // Linha em Reclamada/Reembolsado é SÓ do master (o backend devolve 403 no GET
  // da ficha e no PATCH) — para os demais a linha fica visível, mas não abre nem
  // edita. Enquanto a sessão carrega, nasce bloqueada (na dúvida, fecha).
  const linhaBloqueada = (l: LinhaEsteira) => ehEstagioCancelamento(l.estagio_chave) && !ehMaster();
  // Linha de COLEGA (28/07): o operador VÊ os cards da equipe, mas só AGE no que
  // é dele ou está no pool — a ficha abre em leitura (o drawer cuida) e as
  // células/lote não escrevem (a API recusa com 403 `card_de_outro_operador`).
  // A regra é o escopoAcao de lib/papeis (via useMe.ehCardDeColega).
  // Evento "HM" (P6, 12/08): faltava aqui — o board (kanban/page.tsx) já passava
  // "HM" e liberava o arrasto da equipe principal na Ativação, mas a TABELA
  // chamava sem evento e a MESMA linha virava somente-leitura. Divergência
  // desde 03/08, que ficaria mais visível com os 9 cards da Kelly entrando na
  // esteira compartilhada. `produto`: mesma tela serve HM/Aurum/ETHB.
  const linhaColega = (l: LinhaEsteira) => ehCardDeColega(l, "HM", produto);
  // Aba "Equipes" do alternador: master (gere) e gestor (vê a própria equipe).
  const [linhas, setLinhas] = useState<LinhaEsteira[]>([]);
  const [estagios, setEstagios] = useState<Estagio[]>([]);
  const [responsaveis, setResponsaveis] = useState<string[]>([]);
  const [canais, setCanais] = useState<string[]>([]);
  const [canaisQtd, setCanaisQtd] = useState<Record<string, number>>({});
  const [catalogoTags, setCatalogoTags] = useState<TagOpcao[]>([]);
  const [turmas, setTurmas] = useState<string[]>([]);
  // Cada filtro aceita VÁRIOS valores (OU dentro do filtro, E entre filtros).
  const [filtroResp, setFiltroResp] = useState<string[]>([]);
  const [filtroCanal, setFiltroCanal] = useState<string[]>([]);
  const [filtroTurma, setFiltroTurma] = useState<string[]>([]);
  const [filtrosProntos, setFiltrosProntos] = useState(false);
  const [busca, setBusca] = useState("");
  const [visao, setVisao] = useState<VisaoId>("comercial");
  const [lente, setLente] = useState<string | null>(null);
  // A faixa de conferências abre resumida (só o que pede ação) — ver o bloco de
  // render mais abaixo. Fica no estado, não na URL: é preferência de leitura do
  // momento, não filtro que precise sobreviver a um compartilhamento de link.
  const [verTodasLentes, setVerTodasLentes] = useState(false);
  const [sort, setSort] = useState<{ id: string; dir: 1 | -1 } | null>(null);
  const [carregando, setCarregando] = useState(true);
  // Antes uma falha de carga (rede caída, servidor fora) deixava a tabela
  // simplesmente VAZIA — cabeçalho e filtros de pé, zero linhas, nenhuma
  // explicação. O operador não tinha como saber se era rede ou se a esteira
  // realmente não tinha ninguém.
  const [erro, setErro] = useState<string | null>(null);
  const [salvando, setSalvando] = useState<string | null>(null);
  const [marcados, setMarcados] = useState<Set<string>>(new Set());
  const [selecionado, setSelecionado] = useState<string | null>(null);
  const [cadastrando, setCadastrando] = useState(false);
  // Pagamentos já vistos: comprador_id → data do último pagamento que o operador
  // conferiu. Só é lido no cliente (localStorage não existe no servidor).
  const [vistos, setVistos] = useState<Record<string, string>>({});
  useEffect(() => { setVistos(lerVistos()); }, []);

  // "Esta pessoa pagou e ninguém viu ainda." Null quando não há nada de novo.
  //
  // Olha o ABATIMENTO, não qualquer pagamento: o sinal de R$300 é a entrada de todo
  // lead novo, e avisar sobre ele encheria o topo com 40 pessoas que só chegaram —
  // um alerta que grita por bobagem é um alerta que ninguém lê. Aqui só sobe quem
  // derrubou dívida: mensalidade, saldo à vista, compra cheia.
  //
  // Na PRIMEIRA vez que alguém abre a tabela não há histórico de leitura. Marcar
  // tudo como novo seria ruído; fingir que nada aconteceu esconderia a parcela que
  // caiu hoje de manhã. O meio-termo: sem registro, conta o que entrou em 3 dias.
  const pagouAgora = useCallback((l: LinhaEsteira): { quando: Date; valor: string | null } | null => {
    const d = dt(l.ultimo_abatimento_em);
    if (!d) return null;
    const visto = vistos[l.comprador_id];
    const novo = visto
      ? d.getTime() > new Date(visto).getTime()
      : Date.now() - d.getTime() < JANELA_ESTREIA_MS;
    return novo ? { quando: d, valor: l.ultimo_abatimento_valor } : null;
  }, [vistos]);

  // Abrir a ficha dá baixa no aviso — é o gesto que diz "eu vi".
  const marcarVisto = useCallback((compradorId: string) => {
    const l = linhas.find((x) => x.comprador_id === compradorId);
    const quando = dt(l?.ultimo_abatimento_em ?? null);
    if (!quando) return;
    setVistos((antes) => {
      const novo = { ...antes, [compradorId]: quando.toISOString() };
      try { window.localStorage.setItem(VISTOS_KEY, JSON.stringify(novo)); } catch { /* quota cheia não derruba a tela */ }
      return novo;
    });
  }, [linhas]);

  const abrirFicha = useCallback((compradorId: string) => {
    // Linha cancelada + não-master: não abre (nem pelo clique na linha, nem pelo
    // botão "Ficha", nem pela seleção — todos passam por aqui). O backend já
    // devolve 403; a UI não oferece a porta trancada.
    const l = linhas.find((x) => x.comprador_id === compradorId);
    if (l && ehEstagioCancelamento(l.estagio_chave) && !ehMaster()) return;
    setSelecionado(compradorId);
    marcarVisto(compradorId);
  }, [marcarVisto, linhas, ehMaster]);
  const [dispararLote, setDispararLote] = useState(false);
  const [aplicandoLote, setAplicandoLote] = useState(false);
  const [resultadoLote, setResultadoLote] = useState<{ pedido: string; total: number; aplicados: number; falhas: FalhaLote[] } | null>(null);
  // Remarcação pendente de motivo (invariante nº 4): trocar uma data que já
  // existia é um FATO da operação — o popover pede o porquê antes de gravar.
  const [remarcar, setRemarcar] = useState<{
    compradorId: string; nome: string; tipo: "reuniao" | "entrevista";
    anterior: QuandoHm; novo: string | null; vezes: number;
  } | null>(null);
  const [motivoRemarcar, setMotivoRemarcar] = useState("");
  // Cancelar o popover precisa devolver a célula à data que VALE (o input é não
  // controlado — sem remontar, ele ficaria exibindo uma data que nunca gravou).
  const [nonceData, setNonceData] = useState(0);
  const fecharRemarcar = useCallback(() => { setRemarcar(null); setNonceData((n) => n + 1); }, []);

  // Filtros chegam pela URL (é assim que o alternador Kanban ⇄ Tabela preserva o
  // contexto) e voltam para ela a cada mudança.
  useEffect(() => {
    const sp = new URLSearchParams(window.location.search);
    // Abre SEM filtro (mostra todo mundo); a régua e os dropdowns seguem à mão
    // para recortar. Nada some por padrão. Um ?canal=X na URL (vindo do kanban)
    // ainda é respeitado, para o alternador Kanban ⇄ Tabela preservar o recorte.
    setFiltroResp(sp.getAll("responsavel"));
    setFiltroCanal(sp.getAll("canal"));
    setFiltroTurma(sp.getAll("turma"));
    setFiltrosProntos(true);
  }, []);
  useEffect(() => {
    if (!filtrosProntos) return;
    const params = new URLSearchParams();
    for (const v of filtroResp) params.append("responsavel", v);
    for (const v of filtroCanal) params.append("canal", v);
    for (const v of filtroTurma) params.append("turma", v);
    const qs = params.toString();
    window.history.replaceState(null, "", qs ? `?${qs}` : window.location.pathname);
  }, [filtroResp, filtroCanal, filtroTurma, filtrosProntos]);

  // Multi-valor = parâmetro repetido (?canal=A&canal=B), lido com getAll.
  const paramsFiltro = new URLSearchParams();
  for (const v of filtroResp) paramsFiltro.append("responsavel", v);
  for (const v of filtroCanal) paramsFiltro.append("canal", v);
  for (const v of filtroTurma) paramsFiltro.append("turma", v);
  // O produto tem de ir explícito porque os exports são <a href> — não passam pelo
  // useFetchHm(), que é quem anexa ?produto= nos fetch. Sem isto, o botão de export
  // no board do Aurum baixava a esteira do HM.
  if (produto !== "HM") paramsFiltro.set("produto", produto);

  // responsavel/canal/turma vão ao SERVIDOR — a mesma query do board e do XLSX.
  // Lentes e busca ficam no cliente, sobre as linhas já carregadas (~130).
  const carregar = useCallback(async (silencioso = false) => {
    if (!silencioso) setCarregando(true);
    try {
      const params = new URLSearchParams();
      for (const v of filtroResp) params.append("responsavel", v);
      for (const v of filtroCanal) params.append("canal", v);
      for (const v of filtroTurma) params.append("turma", v);
      const r = await fetchHm(`/api/hm/tabela?${params.toString()}`);
      // O corpo pode não ser JSON (ex.: página de erro do servidor num 500) —
      // sem este try, isso caía direto no catch e a tela dizia "sem conexão"
      // para uma falha que não tem nada a ver com a rede do operador.
      const d = await r.json().catch(() => null);
      if (d?.ok) {
        setErro(null);
        setLinhas(d.linhas);
        setEstagios(d.estagios);
        if (Array.isArray(d.responsaveis)) setResponsaveis(d.responsaveis);
        if (Array.isArray(d.canais)) setCanais(d.canais);
        if (Array.isArray(d.turmas)) setTurmas(d.turmas);
        if (d.canaisQtd) setCanaisQtd(d.canaisQtd);
      } else if (r.ok) {
        setErro(msgErroPermissao(d?.reason) ?? "Não foi possível carregar a Jornada. Tente de novo.");
      } else {
        setErro(msgErroPermissao(d?.reason) ?? `O servidor não conseguiu responder agora (erro ${r.status}). Tente de novo em instantes.`);
      }
    } catch {
      setErro("Sem conexão com o servidor. Verifique a rede e tente de novo.");
    } finally {
      setCarregando(false);
    }
  }, [filtroResp, filtroCanal, filtroTurma, fetchHm]);
  useEffect(() => { if (filtrosProntos) carregar(); }, [carregar, filtrosProntos]);
  // O catálogo de tags (cores + opções do picker). Recarrega junto com o lote —
  // uma tag criada no picker precisa aparecer na lista logo em seguida.
  const carregarTags = useCallback(async () => {
    const d = await fetch("/api/hm/tags").then((r) => r.json()).catch(() => null);
    if (d?.ok) setCatalogoTags(d.tags);
  }, []);
  useEffect(() => { carregarTags(); }, [carregarTags]);
  // cor_efetiva (0206) = a cor que se DESENHA (override da tag ou herdada da
  // categoria); cai para `cor` se a API ainda não trouxer o campo novo.
  const coresTags = useMemo(() => Object.fromEntries(catalogoTags.map((t) => [t.nome, t.cor_efetiva ?? t.cor])), [catalogoTags]);
  // A cor diz a FAMÍLIA da tag; a descrição diz o que ela significa. Sem isto o
  // operador vê o chip colorido e continua sem saber o que a tag quer dizer —
  // que era a queixa original. O catálogo já traz `descricao`, só não era usado.
  const descricoesTags = useMemo(() => Object.fromEntries(catalogoTags.map((t) => [t.nome, t.descricao])), [catalogoTags]);

  // ------------------------------------------------------------- escrita (1 linha)
  // Único ponto de escrita unitária: o MESMO PATCH da ficha. Etapa vira
  // moverEstagioHm, data de reunião/entrevista vira agendarHm — a tabela nunca
  // escreve por fora dos serviços.
  const patch = useCallback(async (compradorId: string, nome: string, payload: Record<string, unknown>) => {
    // Linha cancelada + não-master: TODA célula editável desemboca aqui — barrar
    // no ponto único evita depender de cada render desabilitar o próprio input.
    // O backend recusaria de qualquer forma; aqui o motivo aparece na hora.
    const linha = linhas.find((x) => x.comprador_id === compradorId);
    if (linha && ehEstagioCancelamento(linha.estagio_chave) && !ehMaster()) {
      window.alert(msgErroPermissao("cancelamento_so_admin_gp"));
      return;
    }
    // Linha de colega: mesma barreira no ponto único — o motivo aparece na hora.
    // Evento "HM" (P6, 12/08): mesmo bug de linhaColega acima — sem o evento, o
    // patch da célula recusava por conta própria um card que o board já deixava
    // arrastar (a API confirmaria, mas o alerta disparava antes, sem necessidade).
    if (linha && ehCardDeColega(linha, "HM", produto)) {
      window.alert(msgErroPermissao("card_de_outro_operador"));
      return;
    }
    setSalvando(compradorId);
    try {
      const r = await fetch(`/api/hm/contato/${compradorId}?produto=${produto}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!r.ok) {
        const d = await r.json().catch(() => ({}));
        // A trava do checklist vale igual na tabela: o servidor diz O QUE falta,
        // com as mesmas palavras do board — não um erro genérico.
        if (d?.reason === "checklist_incompleto") {
          window.alert(
            `${nome} ainda não pode entrar em "Ativação Realizada".\n\n` +
              `Falta: ${(d.faltando ?? []).join(", ")}.\n\n` +
              "Marque os itens do checklist na própria linha ou na ficha.",
          );
        } else {
          // 403 de permissão (destino fora da equipe, atribuição travada…):
          // mostra o motivo em vez de a célula só voltar sozinha.
          const msg = msgErroPermissao(d?.reason);
          if (msg) window.alert(msg);
        }
      }
    } finally {
      setSalvando(null);
      await carregar(true);
    }
  // `produto` nas deps: o PATCH manda ?produto=, e sem a dep a closure guardaria o
  // board anterior ao trocar de portal (0187).
  }, [carregar, linhas, ehMaster, ehCardDeColega, produto]);

  // Os mesmos avisos do board ao cruzar de esteira: entrar na Ativação é dizer
  // "pagou" (provisiona o aluno na base THB); voltar ao Comercial desfaz a marca.
  const moverEtapa = useCallback(async (l: LinhaEsteira, chave: string) => {
    const destino = estagios.find((e) => e.chave === chave);
    if (!destino || chave === l.estagio_chave) return;
    const abaAtual = l.estagio_aba ?? "comercial";
    const abaDestino = destino.aba ?? "comercial";
    if (abaAtual === "ativacao" && abaDestino === "comercial" && chave !== "hm_cancelamento" && l.apto_ativacao) {
      const ok = window.confirm(
        `${l.nome} já quitou o saldo e está em "${l.estagio_nome ?? "Ativação"}".\n\n` +
          `Movê-lo para "${destino.nome}" desfaz o pagamento e tira o card da esteira de Ativação. Continuar?`,
      );
      if (!ok) return;
    }
    if (abaAtual === "comercial" && abaDestino === "ativacao" && !l.apto_ativacao) {
      const ok = window.confirm(
        `Mover ${l.nome} para "${destino.nome}" o coloca na esteira de Ativação.\n\n` +
          "Isso marca o saldo como pago e cria o aluno na base THB. Continuar?",
      );
      if (!ok) return;
    }
    await patch(l.comprador_id, l.nome, { estagio_chave: chave });
  }, [estagios, patch]);

  // Data de reunião/entrevista: se JÁ havia data e a nova difere (ou está sendo
  // desmarcada), o popover pede o motivo — sobrescrever calado apagaria o sinal
  // que separa o lead morno do que está enrolando.
  const editarData = useCallback((l: LinhaEsteira, tipo: "reuniao" | "entrevista", valorInput: string) => {
    const atual = tipo === "reuniao" ? l.reuniao_em : l.entrevista_em;
    const novo = fromLocalInput(valorInput);
    const col = tipo === "reuniao" ? "reuniao_em" : "entrevista_em";
    if (!atual) {
      if (novo) patch(l.comprador_id, l.nome, { [col]: novo });
      return;
    }
    const mesma = novo && dt(atual)?.getTime() === new Date(novo).getTime();
    if (mesma) return;
    const vezes = num(tipo === "reuniao" ? l.reunioes_remarcadas : l.entrevistas_remarcadas) ?? 0;
    setMotivoRemarcar("");
    setRemarcar({ compradorId: l.comprador_id, nome: l.nome, tipo, anterior: atual, novo, vezes });
  }, [patch]);

  // Trava (NÃO CONTATAR / REVISAR): marcar pede o motivo — a trava sem o porquê
  // não serve a quem vai ligar.
  const toggleTrava = useCallback((l: LinhaEsteira, campo: "nao_contatar" | "revisar", marcado: boolean) => {
    if (!marcado) {
      patch(l.comprador_id, l.nome, { [campo]: false });
      return;
    }
    const motivo = window.prompt(
      campo === "nao_contatar" ? `Por que NÃO contatar ${l.nome}?` : `O que precisa ser revisado em ${l.nome}?`,
    );
    if (motivo === null) return;
    patch(l.comprador_id, l.nome, { [campo]: true, [`${campo}_motivo`]: motivo.trim() || null });
  }, [patch]);

  // ------------------------------------------------------------- escrita (lote)
  // O endpoint itera os serviços um a um (nunca UPDATE em massa) e devolve quem
  // não passou — a tela mostra as falhas nominalmente.
  const lote = useCallback(async (payload: Record<string, unknown>, pedido: string) => {
    const ids = Array.from(marcados);
    if (ids.length === 0) return;
    setAplicandoLote(true);
    setResultadoLote(null);
    try {
      // 0187: o lote é MONO-PRODUTO no servidor — sem ?produto= ele agiria sobre o
      // card do HM mesmo com o board do Aurum aberto. `fetch` cru não passa pelo
      // useFetchHm, então o parâmetro vai explícito.
      const r = await fetch(`/api/hm/lote?produto=${produto}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ compradorIds: ids, ...payload }),
      });
      const d = await r.json().catch(() => ({}));
      if (d?.ok) setResultadoLote({ pedido, total: ids.length, aplicados: d.aplicados ?? 0, falhas: d.falhas ?? [] });
    } finally {
      setAplicandoLote(false);
      await carregar(true);
      carregarTags();
    }
  // `produto` entra nas deps porque o lote agora manda ?produto= — sem ele, trocar de
  // board deixaria a closure com o produto antigo e o lote agiria no board errado.
  }, [marcados, carregar, carregarTags, produto]);

  const loteMover = useCallback((chave: string) => {
    const destino = estagios.find((e) => e.chave === chave);
    if (!destino) return;
    const dos = linhas.filter((l) => marcados.has(l.comprador_id));
    const abaDestino = destino.aba ?? "comercial";
    if (abaDestino === "ativacao") {
      const semPagto = dos.filter((l) => !l.apto_ativacao).length;
      if (semPagto > 0) {
        const ok = window.confirm(
          `Mover ${dos.length} aluno(s) para "${destino.nome}" os coloca na Ativação.\n\n` +
            `${semPagto} deles ainda não têm pagamento confirmado — o movimento marca o saldo como pago e cria o aluno na base THB. Continuar?`,
        );
        if (!ok) return;
      }
    } else if (chave !== "hm_cancelamento") {
      const pagos = dos.filter((l) => l.apto_ativacao && (l.estagio_aba ?? "comercial") === "ativacao").length;
      if (pagos > 0) {
        const ok = window.confirm(
          `${pagos} dos ${dos.length} selecionados já quitaram o saldo.\n\n` +
            `Movê-los para "${destino.nome}" desfaz o pagamento e os tira da esteira de Ativação. Continuar?`,
        );
        if (!ok) return;
      }
    }
    lote({ estagio_chave: chave }, `mover para "${destino.nome}"`);
  }, [estagios, linhas, marcados, lote]);

  // ----------------------------------------------------------------- leitura
  const hoje0 = useMemo(() => { const d = new Date(); d.setHours(0, 0, 0, 0); return d.getTime(); }, []);

  // Busca livre: acento não conta ("joao" acha "João"), telefone casa por
  // dígitos (dá para colar o número como aparece na tela) e nome composto casa
  // em qualquer ordem. Regras em lib/busca.ts.
  const q = busca.trim();
  const base = useMemo(
    () => (q
      ? linhas.filter((l) => casaBusca(q, { texto: [l.nome, l.email], numero: [l.telefone] }))
      : linhas),
    [linhas, q],
  );
  const contagemLente = useMemo(() => {
    const m = new Map<string, number>();
    for (const le of LENTES) m.set(le.id, base.filter((l) => le.test(l, hoje0)).length);
    return m;
  }, [base, hoje0]);

  // ---------------------------------------------------------------- colunas
  // Definidas aqui para fechar sobre patch/estagios/etc. (as linhas são ~130 —
  // recriar o registro por render é barato e mantém tudo num lugar só).
  const COLS: Record<string, Col> = {
    nome: {
      id: "nome", label: "Nome", fixa: true,
      sortVal: (l) => l.nome.toLowerCase(),
      render: (l) => {
        const novo = pagouAgora(l);
        // `Distinta` (13/08): mesma dedup do board — quando a origem é "Aluno
        // THB"/"Aluno Aurum", o selo de aluno antigo abaixo já diz o mesmo
        // fato; mostrar os dois é a mesma informação duas vezes.
        const recompra = origemRecompraDistinta(l.tags);
        const alunoAntigo = ehAlunoAntigo(l.tags);
        return (
          <div className="flex min-w-0 max-w-[16rem] flex-col">
            <div className="flex min-w-0 items-center gap-1.5">
              {/* Cadeado: linha cancelada, só o master abre/edita (o title da
                  linha explica; o clique não abre a ficha). */}
              {linhaBloqueada(l) && (
                <span className="shrink-0 text-rose-500 dark:text-rose-400" title={TITLE_CARD_CANCELADO}>
                  <svg className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" /></svg>
                </span>
              )}
              {/* Olho discreto: linha de COLEGA — abre em leitura (contexto, não
                  bloqueio); a coluna Operador já diz de quem é. */}
              {linhaColega(l) && (
                <span className="shrink-0 text-slate-400 dark:text-slate-500" title={`Card de ${l.responsavel ?? "outro operador"} — abre em leitura; quem age é o dono ou o gestor`}>
                  <svg className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z" /><circle cx="12" cy="12" r="3" /></svg>
                </span>
              )}
              {/* O ponto verde é o "não lido": some quando alguém abre a ficha. */}
              {novo && (
                <span className="relative flex h-2 w-2 shrink-0" title={`Pagou ${brl(num(novo.valor) ?? 0)} ${haQuanto(novo.quando)} — clique para abrir e dar baixa no aviso`}>
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
                  <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
                </span>
              )}
              <span className={cn("truncate", novo ? "font-bold text-slate-900 dark:text-white" : "font-semibold text-slate-800 dark:text-slate-100")}>{l.nome}</span>
              {l.nao_contatar && <span className="h-2 w-2 shrink-0 rounded-full bg-rose-500" title={`Não contatar${l.nao_contatar_motivo ? ` — ${l.nao_contatar_motivo}` : ""}`} />}
              {l.revisar && <span className="h-2 w-2 shrink-0 rounded-full bg-amber-500" title={`Revisar${l.revisar_motivo ? ` — ${l.revisar_motivo}` : ""}`} />}
              {l.possivel_duplicado && (
                <span
                  className="h-2 w-2 shrink-0 rounded-full bg-violet-500"
                  title={`Possível cadastro duplicado (mesmo telefone)${l.duplicado_cpf_confere ? " — CPF confere, quase certeza" : " — CPF não confere, checar antes de fundir"}\nOutro(s) e-mail(s): ${l.duplicado_emails.join(", ")}`}
                />
              )}
            </div>
            {/* Telefone e e-mail andam junto com o nome: é o que o operador vai
                usar em seguida, e copiar não pode custar abrir a ficha. */}
            <ContatoDoNome telefone={l.telefone} email={l.email} />
            {/* Recompra (27/07) e aluno antigo (0213): os MESMOS selos do board,
                na coluna fixa — visíveis em qualquer visão e scroll horizontal.
                SEM OPERADOR (17/08) vem primeiro — é o selo de maior urgência
                (mesma precedência do board, card-sinais.tsx). */}
            {l.responsavel_id === null && !linhaBloqueada(l) && (
              <SeloSemOperador posicao="inline" className="mt-0.5 self-start" />
            )}
            {recompra && <SeloRecompra origem={recompra} className="mt-0.5 self-start" />}
            {alunoAntigo && <SeloAlunoAntigo className="mt-0.5 self-start" />}
          </div>
        );
      },
    },
    telefone: { id: "telefone", label: "Telefone", sortVal: (l) => l.telefone, render: (l) => <span className="tabular-nums">{l.telefone ?? "—"}</span> },
    email: { id: "email", label: "E-mail", sortVal: (l) => l.email, render: (l) => <span className="block max-w-[14rem] truncate" title={l.email ?? undefined}>{l.email ?? "—"}</span> },
    etapa: {
      id: "etapa", label: "Etapa", edit: true,
      sortVal: (l) => l.estagio_ordem,
      render: (l) => (
        <select
          value={l.estagio_chave}
          disabled={salvando === l.comprador_id}
          onClick={(e) => e.stopPropagation()}
          onChange={(e) => moverEtapa(l, e.target.value)}
          className={cn(celSelect, "min-w-[10rem]")}
          title="Trocar a etapa (mesma regra da Jornada — inclusive a trava do checklist)"
        >
          {estagios.map((s) => (
            <option key={s.chave} value={s.chave}>{(s.aba ?? "comercial") === "ativacao" ? "Ativação · " : "Comercial · "}{s.nome}</option>
          ))}
        </select>
      ),
    },
    // Na tabela não existe espelho: quem pagou é UMA linha, e esta coluna diz em
    // qual esteira ela está de verdade.
    esteira: {
      id: "esteira", label: "Esteira",
      sortVal: (l) => (l.estagio_aba === "ativacao" ? 1 : 0),
      render: (l) => (
        <span className={cn(
          "inline-flex rounded px-1.5 py-0.5 text-[10px] font-semibold",
          l.estagio_aba === "ativacao"
            ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300"
            : "bg-sky-100 text-sky-700 dark:bg-sky-500/15 dark:text-sky-300",
        )}>
          {l.estagio_aba === "ativacao" ? "Ativação" : "Comercial"}
        </span>
      ),
    },
    dias: {
      id: "dias", label: "Dias na etapa", dir: true,
      sortVal: (l) => l.dias_na_etapa,
      render: (l) => <span className={cn("tabular-nums font-medium", diasTom(l.dias_na_etapa))}>{l.dias_na_etapa ?? "—"}</span>,
    },
    responsavel: {
      id: "responsavel", label: "Operador", edit: true,
      sortVal: (l) => l.responsavel?.toLowerCase() ?? null,
      // MASTER/GESTOR: seletor (a lista `responsaveis` já vem recortada do
      // servidor — gestor só vê a própria equipe). OPERADOR: sem seletor —
      // leitura do dono, e o botão "Assumir" só em linha do POOL (sem dono).
      render: (l) => podeDistribuir() ? (
        <div className="flex min-w-[9rem] items-center gap-1.5">
          {l.responsavel && <Avatar nome={l.responsavel} className="h-5 w-5 shrink-0 text-[9px]" />}
          <select
            value={l.responsavel ?? ""}
            disabled={salvando === l.comprador_id}
            onClick={(e) => e.stopPropagation()}
            onChange={(e) => patch(l.comprador_id, l.nome, { responsavel: e.target.value || null })}
            className={celSelect}
          >
            <option value="">—</option>
            {l.responsavel && !responsaveis.includes(l.responsavel) && <option value={l.responsavel}>{l.responsavel}</option>}
            {responsaveis.map((r) => <option key={r} value={r}>{r}</option>)}
          </select>
        </div>
      ) : (
        <div className="flex min-w-[9rem] items-center gap-1.5">
          {l.responsavel ? (
            <>
              <Avatar nome={l.responsavel} className="h-5 w-5 shrink-0 text-[9px]" />
              <span className="truncate text-slate-700 dark:text-slate-200">{l.responsavel}</span>
            </>
          ) : me?.id ? (
            // "Associar a mim" (17/08, pedido do Marcio): 1 clique, sem abrir a
            // ficha. Rose quando é de fato SEM OPERADOR (`responsavel_id` null,
            // mesma condição do SeloSemOperador) — teal (cor de pool) nos demais
            // casos em que só o texto está vazio.
            <button
              type="button"
              disabled={salvando === l.comprador_id}
              aria-busy={salvando === l.comprador_id}
              onClick={(e) => { e.stopPropagation(); patch(l.comprador_id, l.nome, { responsavel_id: me.id }); }}
              className={cn(
                "inline-flex items-center gap-1 rounded-md border border-dashed px-2 py-0.5 text-[11px] font-medium transition disabled:opacity-50 focus:outline-none focus-visible:ring-2",
                l.responsavel_id === null
                  ? "border-rose-400 text-rose-700 hover:bg-rose-50 focus-visible:ring-rose-500 dark:border-rose-500/50 dark:text-rose-300 dark:hover:bg-rose-500/10"
                  : "border-teal-400 text-teal-700 hover:bg-teal-50 focus-visible:ring-teal-500 dark:border-teal-500/50 dark:text-teal-300 dark:hover:bg-teal-500/10",
              )}
              title="Associe esse cliente a alguém da sua equipe ou a você mesma. Clique para assumir."
            >
              <svg className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M19 8v6M22 11h-6" /></svg>
              Associar a mim
            </button>
          ) : (
            <span className="text-slate-400">—</span>
          )}
        </div>
      ),
    },
    // A equipe dona do card (0140) — o MESMO vocabulário do board: SeloEquipe
    // resolve cor nula (cinza padrão, o selo não some) e o contraste do texto
    // (WCAG sobre a cor livre do picker). Pool de verdade (sem equipe E sem
    // dono) ganha o selo tracejado do board — "livre" é um estado deliberado,
    // não célula vazia. Com dono mas sem equipe (legado), aí sim "—".
    equipe: {
      id: "equipe", label: "Equipe",
      sortVal: (l) => l.equipe_nome?.toLowerCase() ?? null,
      render: (l) => {
        const temEquipe = !!(l.equipe_id || l.equipe_nome);
        if (temEquipe) {
          return (
            <SeloEquipe
              nome={l.equipe_nome ?? "Equipe"}
              cor={l.equipe_cor}
              abreviado={false}
              title={`Equipe: ${l.equipe_nome ?? "—"}${l.responsavel_id ? "" : " (canal roteado — sem dono ainda)"}`}
            />
          );
        }
        if (!l.responsavel_id) {
          return (
            <span
              className="inline-flex items-center gap-0.5 rounded border border-dashed border-teal-400 px-1.5 py-0.5 text-[10px] font-semibold text-teal-700 dark:border-teal-500/50 dark:text-teal-300"
              title="Sem dono e sem equipe. Abra a ficha e clique em “Atribuir a mim” para assumir."
            >
              <svg className="h-2.5 w-2.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M19 8v6M22 11h-6" /></svg>
              Pool · livre
            </span>
          );
        }
        return <span className="text-slate-300 dark:text-slate-600">—</span>;
      },
    },
    entrada: {
      id: "entrada", label: "Entrada",
      sortVal: (l) => l.categoria_entrada,
      render: (l) => l.categoria_entrada === "sinal"
        ? <span className="inline-flex rounded bg-sky-100 px-1.5 py-0.5 text-[10px] font-semibold text-sky-700 dark:bg-sky-500/15 dark:text-sky-300">Sinal</span>
        : l.categoria_entrada === "compra_cheia"
          ? <span className="inline-flex rounded bg-emerald-100 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300">Compra cheia</span>
          : <span>{l.categoria_entrada ?? "—"}</span>,
    },
    turma_origem: { id: "turma_origem", label: "Turma de origem", sortVal: (l) => l.turma_origem, render: (l) => <span>{l.turma_origem ?? "—"}</span> },
    turma: {
      id: "turma", label: "Turma", edit: true,
      sortVal: (l) => l.turma,
      render: (l) => (
        // Trocar a turma troca a tag junto (o PATCH já faz) — por isso é select,
        // não texto livre: as opções são as turmas que existem nas linhas.
        <select
          value={l.turma ?? ""}
          disabled={salvando === l.comprador_id}
          onClick={(e) => e.stopPropagation()}
          onChange={(e) => { if (e.target.value) patch(l.comprador_id, l.nome, { turma: e.target.value }); }}
          className={cn(celSelect, "min-w-[4.5rem]")}
        >
          {!l.turma && <option value="">—</option>}
          {Array.from(new Set([l.turma, ...linhas.map((x) => x.turma)].filter((t): t is string => !!t))).sort().map((t) => (
            <option key={t} value={t}>{t}</option>
          ))}
        </select>
      ),
    },
    reuniao: {
      id: "reuniao", label: "Reunião", edit: true,
      sortVal: (l) => dt(l.reuniao_em)?.getTime() ?? null,
      render: (l) => (
        <input
          key={`${nonceData}:${String(l.reuniao_em ?? "")}`}
          type="datetime-local"
          defaultValue={toLocalInput(l.reuniao_em)}
          disabled={salvando === l.comprador_id}
          onClick={(e) => e.stopPropagation()}
          onBlur={(e) => editarData(l, "reuniao", e.target.value)}
          className={cn(celInput, "min-w-[10.5rem] tabular-nums")}
          title={l.reuniao_em ? "Trocar a data pede o motivo — é uma remarcação, e o histórico fica guardado" : "Agendar a reunião"}
        />
      ),
    },
    reuniao_resultado: {
      id: "reuniao_resultado", label: "Resultado da reunião", edit: true,
      sortVal: (l) => l.reuniao_resultado,
      render: (l) => (
        <select
          value={l.reuniao_resultado ?? ""}
          disabled={salvando === l.comprador_id}
          onClick={(e) => e.stopPropagation()}
          onChange={(e) => patch(l.comprador_id, l.nome, { reuniao_resultado: e.target.value || null })}
          className={cn(celSelect, "min-w-[8rem]")}
        >
          <option value="">—</option>
          {RESULTADOS.map((r) => <option key={r} value={r}>{r}</option>)}
        </select>
      ),
    },
    reunioes_remarcadas: {
      id: "reunioes_remarcadas", label: "Reuniões remarcadas", dir: true,
      sortVal: (l) => num(l.reunioes_remarcadas) ?? 0,
      render: (l) => <NumAlerta v={num(l.reunioes_remarcadas) ?? 0} limite={2} />,
    },
    entrevista: {
      id: "entrevista", label: "Entrevista", edit: true,
      sortVal: (l) => dt(l.entrevista_em)?.getTime() ?? null,
      render: (l) => (
        <input
          key={`${nonceData}:${String(l.entrevista_em ?? "")}`}
          type="datetime-local"
          defaultValue={toLocalInput(l.entrevista_em)}
          disabled={salvando === l.comprador_id}
          onClick={(e) => e.stopPropagation()}
          onBlur={(e) => editarData(l, "entrevista", e.target.value)}
          className={cn(celInput, "min-w-[10.5rem] tabular-nums")}
          title={l.entrevista_em ? "Trocar a data pede o motivo — é uma remarcação, e o histórico fica guardado" : "Agendar a entrevista"}
        />
      ),
    },
    entrevista_resultado: {
      id: "entrevista_resultado", label: "Resultado da entrevista", edit: true,
      sortVal: (l) => l.entrevista_resultado,
      render: (l) => (
        <select
          value={l.entrevista_resultado ?? ""}
          disabled={salvando === l.comprador_id}
          onClick={(e) => e.stopPropagation()}
          onChange={(e) => patch(l.comprador_id, l.nome, { entrevista_resultado: e.target.value || null })}
          className={cn(celSelect, "min-w-[8rem]")}
        >
          <option value="">—</option>
          {l.entrevista_resultado && !RESULTADOS.includes(l.entrevista_resultado) && <option value={l.entrevista_resultado}>{l.entrevista_resultado}</option>}
          {RESULTADOS.map((r) => <option key={r} value={r}>{r}</option>)}
        </select>
      ),
    },
    entrevistas_remarcadas: {
      id: "entrevistas_remarcadas", label: "Entrevistas remarcadas", dir: true,
      sortVal: (l) => num(l.entrevistas_remarcadas) ?? 0,
      render: (l) => <NumAlerta v={num(l.entrevistas_remarcadas) ?? 0} limite={2} />,
    },
    no_shows: {
      id: "no_shows", label: "Não compareceu (vezes)", dir: true,
      sortVal: (l) => num(l.nao_comparecimentos) ?? 0,
      render: (l) => <NumAlerta v={num(l.nao_comparecimentos) ?? 0} limite={1} />,
    },
    meio: {
      id: "meio", label: "Meio de pagamento", edit: true,
      sortVal: (l) => l.pagamento_meio,
      render: (l) => (
        <select
          value={l.pagamento_meio ?? ""}
          disabled={salvando === l.comprador_id}
          onClick={(e) => e.stopPropagation()}
          onChange={(e) => patch(l.comprador_id, l.nome, { pagamento_meio: e.target.value || null })}
          className={cn(celSelect, "min-w-[8rem]")}
        >
          <option value="">— a combinar —</option>
          {MEIOS.map((m) => <option key={m.v} value={m.v}>{m.label}</option>)}
        </select>
      ),
    },
    previsao: {
      id: "previsao", label: "Previsão de pagamento", edit: true,
      sortVal: (l) => dt(l.pagamento_previsto_em)?.getTime() ?? null,
      render: (l) => {
        const dPrev = dt(l.pagamento_previsto_em);
        // 0214: vermelho só quando `status_parcela` (cs.vw_hm_financeiro) diz
        // "atrasado" — reconciliado com cs.hm_pagamentos, não a data crua. Sem
        // isto, a coluna pintava vermelho quem já tinha pago depois da data
        // combinada (medido em produção 12/08: 21 de 47 vencidas eram falso
        // positivo). FALLBACK: `status_parcela` undefined (rota antiga em
        // cache) cai na leitura anterior — só a data — para nunca quebrar.
        const vencida = l.status_parcela === undefined
          ? (!!dPrev && dPrev.getTime() < hoje0 && !l.pagamento_em)
          : l.status_parcela === "atrasado";
        const pagouDepois = l.status_parcela === "em_dia" && !!dPrev && dPrev.getTime() < hoje0;
        return (
          <input
            key={String(l.pagamento_previsto_em ?? "")}
            type="date"
            defaultValue={toDateInput(l.pagamento_previsto_em)}
            disabled={salvando === l.comprador_id}
            onClick={(e) => e.stopPropagation()}
            onBlur={(e) => { if (e.target.value !== toDateInput(l.pagamento_previsto_em)) patch(l.comprador_id, l.nome, { pagamento_previsto_em: e.target.value || null }); }}
            // Âmbar, não rose (13/08): parcela atrasada é "pare e confira", não
            // "cancelado" — a MESMA paleta do board (card-sinais.tsx), onde rose
            // ficou só para cancelamento e "não contatar".
            className={cn(celInput, "min-w-[7.5rem] tabular-nums", vencida && "text-amber-600 dark:text-amber-400")}
            title={vencida
              ? "Previsão vencida e nenhum pagamento caiu depois — atraso real"
              : pagouDepois
                ? "Venceu, mas caiu pagamento depois da data — não está atrasada"
                : undefined}
          />
        );
      },
    },
    acordo: {
      id: "acordo", label: "Acordo", edit: true,
      sortVal: (l) => l.acordo,
      render: (l) => (
        <div className="min-w-[12rem] max-w-[18rem]">
          <CelTexto valor={l.acordo} placeholder="12x no boleto…" disabled={salvando === l.comprador_id} onSave={(v) => patch(l.comprador_id, l.nome, { acordo: v })} />
        </div>
      ),
    },
    link: {
      id: "link", label: "Link do saldo enviado em", edit: true,
      sortVal: (l) => dt(l.link_saldo_enviado_em)?.getTime() ?? null,
      render: (l) => (
        // Marcar carimba a HORA (não um booleano) — é a data que permite cobrar
        // quem recebeu o link e não pagou.
        <label className="flex cursor-pointer items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
          <input
            type="checkbox"
            checked={!!l.link_saldo_enviado_em}
            disabled={salvando === l.comprador_id}
            onChange={(e) => patch(l.comprador_id, l.nome, { link_saldo_enviado: e.target.checked })}
            className={celCheck}
          />
          <span className="whitespace-nowrap tabular-nums text-slate-500 dark:text-slate-400">
            {l.link_saldo_enviado_em ? fmtDataHora(l.link_saldo_enviado_em) : "—"}
          </span>
        </label>
      ),
    },
    saldo: {
      id: "saldo", label: "Saldo a pagar", dir: true,
      sortVal: (l) => (l.quitado || l.apto_ativacao ? null : saldoDe(l)),
      render: (l) => {
        // Mesma distinção do board (card-sinais.tsx, `estadoFinanceiroCard`):
        // "quitado" é reconciliado com o razão; "saldo pago" é a confirmação
        // do pagamento do saldo, ainda não reconciliada. Antes as duas caíam
        // no mesmo rótulo "quitado" aqui — a tabela dizia uma coisa, o board
        // dizia outra para o MESMO card.
        if (l.quitado) {
          return <span className="text-[11px] font-medium text-emerald-600 dark:text-emerald-400" title={l.pagamento_em ? `Quitado em ${fmtDataHora(l.pagamento_em)}` : "Saldo quitado"}>quitado</span>;
        }
        if (l.apto_ativacao) {
          return <span className="text-[11px] font-medium text-emerald-600 dark:text-emerald-400" title="Pagamento do saldo confirmado, ainda não reconciliado com o razão">saldo pago</span>;
        }
        const s = saldoDe(l);
        if (s !== null) {
          // Cravado = o pacote foi fechado com a pessoa. Pela régua = o sistema
          // deduziu (lead novo: 14.700; aluno da base: 14.700 − crédito de hoje) e
          // o número ENCOLHE a cada dia, porque o crédito é consumido. Marcar a
          // diferença evita tratar uma dedução como um acordo.
          const cravado = num(l.valor_total) !== null;
          return (
            <span
              className={`whitespace-nowrap font-semibold tabular-nums ${cravado ? "text-slate-800 dark:text-slate-100" : "cursor-help text-slate-600 dark:text-slate-300"}`}
              title={cravado
                ? "Saldo do pacote fechado com esta pessoa, menos tudo o que ela já pagou."
                : "Saldo pela régua (ninguém fechou um pacote ainda): 15.000 − crédito pró-rata − o que já foi pago. Muda a cada dia, porque o crédito é consumido."}
            >
              {brl(s)}
              {!cravado && <span className="ml-0.5 align-super text-[9px] font-normal text-slate-400">~</span>}
            </span>
          );
        }
        // Devendo e o sistema não sabe quanto: falta o insumo do crédito e ele não
        // existe em lugar nenhum. Um "—" mudo se leria como zero — e zero é
        // exatamente o que esta pessoa NÃO deve.
        return (
          <span
            className="cursor-help font-medium text-amber-600 underline decoration-dotted underline-offset-2 dark:text-amber-400"
            title="Sem saldo calculável — falta o crédito pró-rata deste aluno (valor pago e data da compra anterior, na ficha). Ele DEVE; o sistema é que não sabe quanto."
          >
            —
          </span>
        );
      },
    },
    // Quanto do pacote JÁ ENTROU. A barra existe porque "R$ 3.449,97" não diz nada
    // sozinho: o que a operação quer saber é se está no começo ou quase lá.
    recebido: {
      id: "recebido", label: "Já pago", dir: true,
      // 16/08: passou a mostrar `pago_no_ciclo`, não `valor_pago`. `valor_pago` é o razão
      // INTEIRO da pessoa — inclui o que ela pagou no programa anterior, que já está
      // representado no crédito pró-rata que reduz o pacote dela. Mostrar os dois juntos
      // conta o mesmo dinheiro duas vezes: 5 cards do HM apareciam com R$ 26.600,02 a mais,
      // o pior deles com R$ 12.000,02 de diferença. Quando há diferença, o valor antigo vai
      // no título — some do número, não do histórico.
      sortVal: (l) => num(l.pago_no_ciclo) ?? num(l.valor_pago),
      render: (l) => {
        const pago = num(l.pago_no_ciclo) ?? num(l.valor_pago) ?? 0;
        const totalRazao = num(l.valor_pago) ?? 0;
        const anterior = totalRazao - pago;
        const pct = num(l.pago_pct);
        return (
          <div className="flex min-w-[7.5rem] flex-col items-end gap-0.5">
            <span
              className="whitespace-nowrap font-semibold tabular-nums text-emerald-700 dark:text-emerald-400"
              title={anterior > 1
                ? `Pago neste programa: ${brl(pago)}. Esta pessoa também pagou ${brl(anterior)} no ciclo anterior — aquele valor virou crédito pró-rata e já está descontado do pacote dela, por isso não é somado aqui.`
                : undefined}
            >
              {brl(pago)}
            </span>
            {anterior > 1 && (
              <span className="whitespace-nowrap text-[10px] text-slate-400 dark:text-slate-500">
                + {brl(anterior)} no ciclo anterior
              </span>
            )}
            {pct !== null && (
              <span className="flex w-full items-center justify-end gap-1">
                <span className="h-1 w-12 overflow-hidden rounded-full bg-slate-200 dark:bg-slate-700">
                  <span
                    className="block h-full rounded-full bg-emerald-500 dark:bg-emerald-400"
                    style={{ width: `${Math.min(Math.max(pct, 0), 100)}%` }}
                  />
                </span>
                <span className="w-9 text-right text-[10px] tabular-nums text-slate-400">{pct}%</span>
              </span>
            )}
          </div>
        );
      },
    },
    // "3 de 12". As pagas são fato (contagem no razão); as contratadas são o que a
    // pessoa assinou. A diferença entre as duas é a inadimplência — por isso os dois
    // números aparecem juntos, e não só o total.
    parcelas: {
      id: "parcelas", label: "Parcelas", dir: true,
      sortVal: (l) => l.parcelas_pagas ?? null,
      render: (l) => {
        const pagas = l.parcelas_pagas ?? 0;
        const total = l.parcelas_contratadas;
        if (!pagas && !total) return <span className="text-slate-300 dark:text-slate-600">—</span>;
        const parcela = num(l.valor_parcela);
        return (
          <span
            className="whitespace-nowrap tabular-nums"
            title={parcela ? `Mensalidade de ${brl(parcela)}${total ? ` · ${total}x contratadas` : ""}` : undefined}
          >
            <strong className="text-slate-800 dark:text-slate-100">{pagas}</strong>
            <span className="text-slate-400">/{total ?? "?"}</span>
            {parcela !== null && (
              <span className="ml-1 text-[10px] text-slate-400">{brl(parcela)}</span>
            )}
          </span>
        );
      },
    },
    // Quando caiu o último real. É esta coluna que ordena a tela por padrão.
    ultimo_pagamento: {
      id: "ultimo_pagamento", label: "Último pagamento", dir: true,
      sortVal: (l) => dt(l.ultimo_pagamento_em)?.getTime() ?? null,
      render: (l) => {
        const d = dt(l.ultimo_pagamento_em);
        if (!d) return <span className="text-slate-300 dark:text-slate-600">—</span>;
        return (
          <span className="whitespace-nowrap tabular-nums text-slate-600 dark:text-slate-300" title={fmtDataHora(l.ultimo_pagamento_em)}>
            {haQuanto(d)}
          </span>
        );
      },
    },
    // Crédito pró-rata + o PORQUÊ (13/08, pedido do Marcio: "o comercial vai
    // explicar o motivo do pró-rata com base nessa observação"). HM e AURUM têm
    // fontes diferentes do mesmo par (valor, motivo) — unificado aqui em vez de
    // a tabela mostrar só o número do HM e ficar muda no board do Aurum.
    // Sem empilhar coluna nova: o motivo vive no tooltip da MESMA célula, e o
    // ícone de alerta substitui o de "tem nota" quando falta preencher — quem
    // tem crédito e não tem explicação é a pendência que o Marcio pediu para
    // contar (ver o memo da 0-conta em disparos-brain).
    credito: {
      id: "credito", label: "Crédito pró-rata", dir: true,
      sortVal: (l) => (produto === "AURUM" ? num(l.aurum_credito) : num(l.credito)),
      render: (l) => {
        const valor = produto === "AURUM" ? num(l.aurum_credito) : num(l.credito);
        const obs = produto === "AURUM" ? (l.aurum_excecao ? l.aurum_excecao_motivo : l.aurum_obs) : l.credito_obs;
        const pendente = faltaExplicarCredito(valor, obs);
        return (
          <span
            className={cn("inline-flex items-center gap-1 whitespace-nowrap tabular-nums", pendente && "font-medium text-amber-700 dark:text-amber-300")}
            title={obs ? `Por que este crédito: ${obs}` : pendente ? "Crédito sem explicação registrada — confira antes de cobrar." : undefined}
          >
            {valor === null ? <span className="text-slate-300 dark:text-slate-600">—</span> : brl(valor)}
            {pendente ? (
              <svg className="h-3 w-3 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M12 8v4m0 4h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z" /></svg>
            ) : obs ? (
              <svg className="h-3 w-3 shrink-0 text-slate-400 dark:text-slate-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2Z" /></svg>
            ) : null}
          </span>
        );
      },
    },
    valor_total: { id: "valor_total", label: "Valor total", dir: true, sortVal: (l) => num(l.valor_total), render: (l) => <Dinheiro v={num(l.valor_total)} /> },
    valor_pago: { id: "valor_pago", label: "Valor pago", dir: true, sortVal: (l) => num(l.valor_pago), render: (l) => <Dinheiro v={num(l.valor_pago)} /> },
    // A situação da compra HM NA HOTMART — o fato do dinheiro, ao lado da nossa
    // `saldo`/`situacao` derivada. Aprovada/Concluída = entrou; Reembolsada/
    // Protestada/Expirada = alguém precisa olhar. Vincula ao que consta na Hotmart.
    situacao_hotmart: {
      id: "situacao_hotmart", label: "Situação Hotmart",
      sortVal: (l) => l.hotmart_status ?? null,
      render: (l) => {
        if (!l.hotmart_status) return <span>—</span>;
        const s = STATUS_HOTMART[l.hotmart_status] ?? { label: l.hotmart_status, tom: "espera" as const };
        return (
          <span className={cn("whitespace-nowrap", TOM_STATUS[s.tom])} title={`Status na Hotmart da compra HM${l.hotmart_status_em ? ` — ${fmtData(l.hotmart_status_em)}` : ""}`}>
            {s.label}
          </span>
        );
      },
    },
    // ----- a história financeira em linha (visão da Jusy/Isabela) -----
    // Origem = as tags de canal do card (sem turma e sem público): de onde a
    // venda veio. É fato derivado — quem muda canal é tag, não célula.
    origem: {
      id: "origem", label: "Origem",
      sortVal: (l) => canalDe(l.tags, produto)[0] ?? null,
      render: (l) => {
        const cs = canalDe(l.tags, produto);
        return cs.length
          ? <span className="flex max-w-[16rem] flex-wrap gap-1">{cs.map((t) => <TagChip key={t} tag={t} mini cor={coresTags[t]} titulo={descricoesTags[t]} />)}</span>
          : <span>—</span>;
      },
    },
    sinal_pago_em: {
      id: "sinal_pago_em", label: "Sinal pago em",
      sortVal: (l) => dt(l.sinal_pago_em)?.getTime() ?? null,
      render: (l) => <span className="whitespace-nowrap tabular-nums">{fmtDataHora(l.sinal_pago_em)}</span>,
    },
    sinal_valor: {
      id: "sinal_valor", label: "Valor do sinal", dir: true,
      sortVal: (l) => num(l.sinal_valor),
      render: (l) => <Dinheiro v={num(l.sinal_valor)} />,
    },
    // Forma de pagamento do SALDO + a obs da Jusy (o campo acordo) na mesma
    // célula: o combinado inteiro num olhar, sem caçar em duas colunas.
    forma_obs: {
      id: "forma_obs", label: "Forma de pagamento",
      sortVal: (l) => l.pagamento_meio ?? l.acordo,
      render: (l) => {
        const m = MEIOS.find((x) => x.v === l.pagamento_meio)?.label;
        if (!m && !l.acordo) return <span>—</span>;
        return (
          <div className="max-w-[16rem]">
            {m && <span>{m}</span>}
            {l.acordo && <p className={cn("truncate text-[11px] text-slate-400 dark:text-slate-500", !m && "text-[13px] text-slate-600 dark:text-slate-300")} title={l.acordo}>{l.acordo}</p>}
          </div>
        );
      },
    },
    // "Cancelou?" tem três respostas, não duas: ninguém pediu, pediu (e ainda
    // pode voltar atrás), ou cancelou de fato — e neste último caso o que importa
    // operacionalmente é se o acesso já foi tirado.
    cancelado: {
      id: "cancelado", label: "Cancelou?",
      sortVal: (l) => (l.cancelamento_efetivado_em ? 2 : l.cancelamento_em || l.estagio_chave === "hm_cancelamento" ? 1 : 0),
      render: (l) => {
        if (l.cancelamento_efetivado_em) {
          return l.acessos_revogados_em
            ? <span className="whitespace-nowrap font-medium text-slate-500 dark:text-slate-400">Cancelado · acessos removidos</span>
            : <span className="whitespace-nowrap font-semibold text-rose-600 dark:text-rose-400">Cancelado · remover acessos</span>;
        }
        if (l.cancelamento_em || l.estagio_chave === "hm_cancelamento") {
          return <span className="whitespace-nowrap font-medium text-amber-600 dark:text-amber-400">Pediu</span>;
        }
        return <span>—</span>;
      },
    },
    // O cancelamento pelos olhos da HOTMART — o fato, não a nossa leitura dele.
    // Confirmar à mão é um palpite ("o reembolso deve ter saído"); esta coluna
    // diz se o dinheiro voltou de verdade. Quando as duas discordam, alguém
    // precisa olhar: ou o reembolso ainda não saiu, ou marcamos errado.
    hotmart_cancelado: {
      id: "hotmart_cancelado", label: "Cancelou na Hotmart?",
      sortVal: (l) => dt(l.hotmart_cancelado_em)?.getTime() ?? null,
      render: (l) => {
        if (l.hotmart_cancelado_em) {
          return (
            <span
              className="whitespace-nowrap font-semibold text-rose-600 dark:text-rose-400"
              title={`${EVENTO_HOTMART[l.hotmart_cancelamento_evento ?? ""] ?? l.hotmart_cancelamento_evento ?? "Cancelado"}${l.hotmart_cancelamento_transacao ? ` · transação ${l.hotmart_cancelamento_transacao}` : " · assinatura"}`}
            >
              {EVENTO_CURTO[l.hotmart_cancelamento_evento ?? ""] ?? "Cancelado"} · {fmtData(l.hotmart_cancelado_em)}
            </span>
          );
        }
        // Nós marcamos como cancelado e a Hotmart nunca confirmou. É a linha que
        // o financeiro precisa ver.
        if (l.cancelamento_efetivado_em) {
          return (
            <span
              className="whitespace-nowrap font-medium text-amber-600 dark:text-amber-400"
              title="Confirmamos o cancelamento aqui, mas a Hotmart nunca avisou que o reembolso saiu. Ou ainda não saiu, ou alguém marcou por engano aqui."
            >
              ⚠ sem confirmação
            </span>
          );
        }
        return <span>—</span>;
      },
    },
    pagamento_em: {
      id: "pagamento_em", label: "Saldo pago em",
      sortVal: (l) => dt(l.pagamento_em)?.getTime() ?? null,
      render: (l) => <span className="whitespace-nowrap tabular-nums">{fmtDataHora(l.pagamento_em)}</span>,
    },
    forma: {
      id: "forma", label: "Forma de pagamento",
      sortVal: (l) => l.pagamento_forma,
      render: (l) => <span>{l.pagamento_forma === "avista" ? "À vista" : l.pagamento_forma === "parcelado" ? `Parcelado${l.pagamento_parcelas ? ` ${l.pagamento_parcelas}x` : ""}` : "—"}</span>,
    },
    apto: {
      id: "apto", label: "Apto à ativação",
      sortVal: (l) => (l.apto_ativacao ? 1 : 0),
      render: (l) => <SimNao v={l.apto_ativacao} />,
    },
    checklist: {
      id: "checklist", label: "Checklist", edit: true,
      sortVal: (l) => feitosChecklist(l),
      render: (l) => (
        <div className="flex items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
          <span className={cn(
            "rounded-full px-1.5 py-0.5 text-[10px] font-semibold tabular-nums",
            feitosChecklist(l) === 4
              ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300"
              : "bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400",
          )}>{feitosChecklist(l)}/4</span>
          {CHECKLIST.map((item) => (
            <label key={item.campo} className="flex cursor-pointer items-center gap-0.5" title={item.label}>
              <input
                type="checkbox"
                checked={!!l[item.campo]}
                disabled={salvando === l.comprador_id}
                onChange={(e) => patch(l.comprador_id, l.nome, { [item.campo]: e.target.checked })}
                className={celCheck}
              />
              <span className="text-[10px] text-slate-400 dark:text-slate-500">{item.curto}</span>
            </label>
          ))}
        </div>
      ),
    },
    ativ_searchie: { id: "ativ_searchie", label: "Searchie", edit: true, sortVal: (l) => (l.ativ_searchie ? 1 : 0), render: (l) => <ChecklistUm l={l} campo="ativ_searchie" salvando={salvando} patch={patch} /> },
    ativ_comunidade: { id: "ativ_comunidade", label: "Comunidade", edit: true, sortVal: (l) => (l.ativ_comunidade ? 1 : 0), render: (l) => <ChecklistUm l={l} campo="ativ_comunidade" salvando={salvando} patch={patch} /> },
    ativ_grupo: { id: "ativ_grupo", label: "Grupo", edit: true, sortVal: (l) => (l.ativ_grupo ? 1 : 0), render: (l) => <ChecklistUm l={l} campo="ativ_grupo" salvando={salvando} patch={patch} /> },
    ativ_pesquisa: { id: "ativ_pesquisa", label: "Pesquisa", edit: true, sortVal: (l) => (l.ativ_pesquisa ? 1 : 0), render: (l) => <ChecklistUm l={l} campo="ativ_pesquisa" salvando={salvando} patch={patch} /> },
    grupo_informes: {
      id: "grupo_informes", label: "Grupo de informes", edit: true,
      sortVal: (l) => l.grupo_informes,
      render: (l) => (
        <div className="min-w-[6rem] max-w-[8rem]">
          <CelTexto valor={l.grupo_informes} placeholder="THB #27" disabled={salvando === l.comprador_id} onSave={(v) => patch(l.comprador_id, l.nome, { grupo_informes: v })} />
        </div>
      ),
    },
    pendencia: {
      id: "pendencia", label: "Pendência", edit: true,
      sortVal: (l) => l.pendencia,
      render: (l) => (
        <div className="min-w-[10rem] max-w-[16rem]">
          <CelTexto valor={l.pendencia} disabled={salvando === l.comprador_id} onSave={(v) => patch(l.comprador_id, l.nome, { pendencia: v })} />
        </div>
      ),
    },
    nao_contatar: {
      id: "nao_contatar", label: "Não contatar", edit: true,
      sortVal: (l) => (l.nao_contatar ? 1 : 0),
      render: (l) => (
        <label className="flex cursor-pointer items-center gap-1.5" title={l.nao_contatar_motivo ?? undefined} onClick={(e) => e.stopPropagation()}>
          <input type="checkbox" checked={l.nao_contatar} disabled={salvando === l.comprador_id} onChange={(e) => toggleTrava(l, "nao_contatar", e.target.checked)} className={celCheck} />
          {l.nao_contatar_motivo && <span className="max-w-[8rem] truncate text-[10px] text-rose-600 dark:text-rose-400">{l.nao_contatar_motivo}</span>}
        </label>
      ),
    },
    revisar: {
      id: "revisar", label: "Revisar", edit: true,
      sortVal: (l) => (l.revisar ? 1 : 0),
      render: (l) => (
        <label className="flex cursor-pointer items-center gap-1.5" title={l.revisar_motivo ?? undefined} onClick={(e) => e.stopPropagation()}>
          <input type="checkbox" checked={l.revisar} disabled={salvando === l.comprador_id} onChange={(e) => toggleTrava(l, "revisar", e.target.checked)} className={celCheck} />
          {l.revisar_motivo && <span className="max-w-[8rem] truncate text-[10px] text-amber-600 dark:text-amber-400">{l.revisar_motivo}</span>}
        </label>
      ),
    },
    socios: { id: "socios", label: "Sócios", dir: true, sortVal: (l) => l.socios, render: (l) => <span className="tabular-nums">{l.socios || "—"}</span> },
    cancelamento_em: {
      id: "cancelamento_em", label: "Cancelamento",
      sortVal: (l) => dt(l.cancelamento_em)?.getTime() ?? null,
      render: (l) => <span className="whitespace-nowrap tabular-nums">{fmtDataHora(l.cancelamento_em)}</span>,
    },
    cancelamento_motivo: {
      id: "cancelamento_motivo", label: "Motivo do cancelamento",
      sortVal: (l) => l.cancelamento_motivo,
      render: (l) => <span className="block max-w-[14rem] truncate" title={l.cancelamento_motivo ?? undefined}>{l.cancelamento_motivo ?? "—"}</span>,
    },
    na_base: {
      id: "na_base", label: "Na base THB",
      sortVal: (l) => (l.aluno_id ? 1 : 0),
      render: (l) => l.apto_ativacao && !l.aluno_id
        // Pagou e não existe na base mestre: o GPS nunca vai criar o acesso —
        // é o furo que esta coluna existe para denunciar.
        ? <span className="inline-flex rounded bg-rose-100 px-1.5 py-0.5 text-[10px] font-semibold text-rose-700 dark:bg-rose-500/15 dark:text-rose-300" title="Pagou e não está na base THB — registre o pagamento pela ficha para provisionar">Não — pagou!</span>
        : <SimNao v={!!l.aluno_id} />,
    },
    tags: {
      id: "tags", label: "Tags",
      sortVal: (l) => l.tags.join(", "),
      render: (l) => (
        <div className="flex max-w-[16rem] flex-wrap gap-1">
          {l.tags.length ? l.tags.map((t) => <TagChip key={t} tag={t} mini cor={coresTags[t]} titulo={descricoesTags[t]} />) : "—"}
        </div>
      ),
    },
  };
  const COLS_ORDEM = new Map(Object.values(COLS).map((c) => [c.id, c]));
  const colunas = PRESETS[visao].map((id) => COLS[id]).filter(Boolean);

  // Lente ativa + sort — no CLIENTE, sobre o que já veio do servidor. O sort é
  // da TELA: reordena a leitura e nunca escreve cs.contatos_hm.ordem (a fila da
  // coluna é o gesto manual do board; quem clica no cabeçalho só está olhando).
  const lenteAtiva = lente ? LENTES.find((le) => le.id === lente) : null;
  const filtradas = lenteAtiva ? base.filter((l) => lenteAtiva.test(l, hoje0)) : base;
  const colSort = sort ? COLS_ORDEM.get(sort.id) : null;
  const ordenadas = colSort && sort
    ? [...filtradas].sort((a, b) => {
        const va = colSort.sortVal(a);
        const vb = colSort.sortVal(b);
        if (va === null && vb === null) return 0;
        if (va === null) return 1;
        if (vb === null) return -1;
        if (typeof va === "number" && typeof vb === "number") return (va - vb) * sort.dir;
        return String(va).localeCompare(String(vb), "pt-BR") * sort.dir;
      })
    : filtradas;

  // Dinheiro que entrou e ninguém viu vai para o TOPO — o mais recente primeiro,
  // como uma conversa nova. Só quando o operador não pediu uma ordem sua: quem
  // clicou no cabeçalho quer aquela ordem, e o sistema não discute.
  const naoVistos = ordenadas
    .map((l) => ({ l, novo: pagouAgora(l) }))
    .filter((x) => x.novo)
    .sort((a, b) => b.novo!.quando.getTime() - a.novo!.quando.getTime())
    .map((x) => x.l);
  const idsNovos = new Set(naoVistos.map((l) => l.comprador_id));
  const visiveis = sort ? ordenadas : [...naoVistos, ...ordenadas.filter((l) => !idsNovos.has(l.comprador_id))];

  // ----------------------------------------------------------------- rodapé
  // A leitura que o board nunca deu: o card sabe o saldo de UM; a tabela soma o
  // de todos. "A receber" é só de quem ainda deve — saldo de quem quitou é história.
  //
  // A soma agora cobre os dois públicos (vw_hm_financeiro, 0078): o lead novo tem
  // saldo dedutível (15.000 − o que pagou) e entrava como null antes, sumindo da
  // conta. Continua PARCIAL para o aluno da base sem os insumos do crédito — e
  // esse não dá para deduzir: depende da compra antiga dele, que não está no banco
  // nem em planilha. Somar zero ali esconderia quem deve dentro de um total que
  // parece completo, então a soma declara a própria cobertura e a lente "Sem saldo
  // calculável" mostra quem ficou de fora.
  const devendo = visiveis.filter((l) => !l.quitado && !l.apto_ativacao);
  const comSaldo = devendo.filter((l) => saldoDe(l) !== null);
  const semSaldo = devendo.length - comSaldo.length;
  const totSaldo = comSaldo.reduce((acc, l) => acc + (saldoDe(l) ?? 0), 0);
  const semResp = visiveis.filter((l) => !l.responsavel).length;
  const comLink = visiveis.filter((l) => !!l.link_saldo_enviado_em).length;
  const diasArr = visiveis.map((l) => l.dias_na_etapa).filter((x): x is number => x !== null && x !== undefined);
  const mediaDias = diasArr.length ? Math.round(diasArr.reduce((a, b) => a + b, 0) / diasArr.length) : 0;

  // Linha cancelada (não-master) e linha de COLEGA ficam fora da seleção em
  // massa: o lote inteiro falharia nelas (403) e a seleção é um caminho
  // indireto de mexer num card em que a pessoa não pode agir.
  const selecionaveis = visiveis.filter((l) => !linhaBloqueada(l) && !linhaColega(l));
  const todosMarcados = selecionaveis.length > 0 && selecionaveis.every((l) => marcados.has(l.comprador_id));
  const gruposLente = Array.from(new Set(LENTES.map((le) => le.grupo)));
  // O que pede ação AGORA: lente de destaque com gente dentro. Se não há nenhuma,
  // o resumo mostra as demais que têm alguém (até 6) — faixa curta de qualquer jeito.
  const lentesUrgentes = LENTES.filter((le) => le.destaque && (contagemLente.get(le.id) ?? 0) > 0);
  const lentesVisiveis = (lentesUrgentes.length > 0
    ? lentesUrgentes
    : LENTES.filter((le) => (contagemLente.get(le.id) ?? 0) > 0).slice(0, 6)
  ).concat(lente && !LENTES.filter((le) => le.destaque && (contagemLente.get(le.id) ?? 0) > 0).some((le) => le.id === lente)
    ? LENTES.filter((le) => le.id === lente)
    : []);

  return (
    <div>
      {/* Cabeçalho — identidade, volume e o alternador de leitura. */}
      <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="flex items-center gap-2.5">
            <MarcaPortal portal={portal} altura="h-7" comNome={false} />
            <h1 className="text-xl font-semibold tracking-tight text-slate-900 dark:text-slate-100">Jornada · {nomePortal}</h1>
          </div>
          <p className="mt-0.5 text-sm text-slate-500 dark:text-slate-400">
            {linhas.length} {linhas.length === 1 ? "aluno" : "alunos"} — a Jornada em linhas: ordene, filtre, edite na célula e aja em lote.
          </p>
        </div>
        {/* flex-wrap (11/08): sem ele, "+ Cadastrar" + abas + os dois botões de
            .xlsx somavam 819px e empurravam a PÁGINA 423px para fora no celular
            — a tabela inteira rolava de lado e o topo saía da tela. Medido no
            Chromium a 412px. */}
        <div className="flex w-full min-w-0 flex-wrap items-center gap-2 sm:w-auto">
          {/* Cadastrar à mão — só o master (admin do GP). Card é reflexo da Hotmart;
              colaborador não cria card à mão (30/07). */}
          {ehMaster() && (
            <Button variant="secondary" size="sm" className="alvo-toque" onClick={() => setCadastrando(true)}>+ Cadastrar</Button>
          )}
          <HmVisao atual="tabela" filtros={{ responsavel: filtroResp, canal: filtroCanal, turma: filtroTurma }} />
          {/* O XLSX é o mesmo relatório desta tela — mesmos filtros, mesma função.
              O servidor recorta por equipe: para quem não é master, o rótulo não
              promete a esteira inteira. */}
          <a
            href={`/api/hm/kanban/export?${paramsFiltro.toString()}`}
            title={podeVerTudo()
              ? "Baixar o relatório da Jornada inteira (resumo + uma aba por etapa)"
              : "Baixar o relatório da SUA visão da Jornada (quem está sem dono + os alunos que você vê), resumo + uma aba por etapa"}
          >
            <Button variant="secondary" size="sm" className="alvo-toque">Jornada .xlsx</Button>
          </a>
          {/* O financeiro em planilha própria: a visão "Financeiro" desta tela cabe
              numa tabela, mas a conciliação não — ela precisa do razão de pagamentos
              e do confronto com a Hotmart. Sai com os mesmos filtros. */}
          <a
            href={`/api/hm/financeiro/export?${paramsFiltro.toString()}`}
            title={podeVerTudo()
              ? "Baixar o financeiro (resumo, carteira, a receber, pagamentos e cancelamentos)"
              : "Baixar o financeiro da SUA visão da Jornada (resumo, carteira, a receber, pagamentos e cancelamentos dos alunos que você vê)"}
          >
            <Button variant={visao === "financeiro" ? "primary" : "secondary"} size="sm">Financeiro .xlsx</Button>
          </a>
        </div>
      </div>

      {/* Barra de controle: visões + busca + filtros (estes vão ao servidor). */}
      <div className="mb-2 flex flex-wrap items-center gap-2 rounded-xl border border-slate-200 bg-white p-2 dark:border-slate-800 dark:bg-slate-900">
        {/* 11/08: as cinco lentes somam 402px — no celular era o que ainda
            empurrava a página para fora. Rolam sozinhas, como as abas. */}
        <div className="rolagem-oculta -mx-1 min-w-0 max-w-full flex-1 overflow-x-auto px-1 sm:flex-none">
        <div className="inline-flex shrink-0 rounded-lg bg-slate-100 p-0.5 dark:bg-slate-800/80">
          {VISOES.map((v) => (
            <button
              key={v.id}
              onClick={() => setVisao(v.id)}
              className={cn(
                "alvo-toque rounded-md px-3 py-1.5 text-sm font-medium transition",
                visao === v.id
                  ? "bg-white text-slate-900 shadow-card dark:bg-slate-700 dark:text-slate-100"
                  : "text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200",
              )}
            >
              {v.label}
            </button>
          ))}
        </div>
        </div>

        <span className="mx-1 hidden h-6 w-px bg-slate-200 dark:bg-slate-700 sm:block" />

        <div className="relative w-52 min-w-[9rem]">
          <svg className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8" /><path d="m21 21-4.3-4.3" /></svg>
          <input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar aluno…" className={cn(fieldClass, "alvo-toque pl-8")} />
        </div>

        {responsaveis.length > 0 && (
          <MultiSelect rotulo="Operador" grupos={[{ label: null, itens: responsaveis }]} selecionadas={filtroResp} onChange={setFiltroResp} />
        )}
        {canais.length > 0 && (
          <MultiSelect rotulo="Canal" grupos={gruposCanal(canais, produto)} selecionadas={filtroCanal} onChange={setFiltroCanal} />
        )}
        {turmas.length > 0 && (
          <MultiSelect rotulo="Turma" grupos={[{ label: null, itens: turmas }]} selecionadas={filtroTurma} onChange={setFiltroTurma} />
        )}
        {(filtroResp.length > 0 || filtroCanal.length > 0 || filtroTurma.length > 0 || busca || lente) && (
          <button
            onClick={() => { setFiltroResp([]); setFiltroCanal([]); setFiltroTurma([]); setBusca(""); setLente(null); }}
            className="shrink-0 rounded-md px-2 py-1.5 text-xs font-medium text-slate-500 transition hover:bg-slate-100 hover:text-slate-800 dark:text-slate-400 dark:hover:bg-slate-800"
          >
            Limpar filtros
          </button>
        )}
      </div>

      {/* A régua dos canais fixos — total de vendas por canal; clicar soma/tira
          o canal do filtro (o mesmo do dropdown, que segue para o resto). */}
      <HmCanaisFixos
        contagem={canaisQtd}
        ativos={filtroCanal}
        onToggle={(c) => setFiltroCanal((prev) => (prev.includes(c) ? prev.filter((x) => x !== c) : [...prev, c]))}
        produto={produto}
      />

      {/* Lentes: o que está ERRADO com as pessoas, não onde elas estão.
          11/08: eram ~20 atalhos empilhados em quatro linhas — uma parede que o
          operador varria com o olho sem saber por onde começar. Agora aparecem
          por padrão só as que PEDEM AÇÃO (as de destaque com gente dentro); o
          resto fica atrás de "ver todas". Nada sumiu, mudou a ordem de chegada:
          primeiro o que está pegando fogo, depois o inventário completo. */}
      <div className="mb-3 flex flex-wrap items-baseline gap-x-1 gap-y-1 px-1 text-[11px] leading-5">
        {!verTodasLentes && (
          <span className="mr-0.5 font-medium text-slate-400 dark:text-slate-500">
            {lentesUrgentes.length > 0 ? "precisa de ação:" : "conferências:"}
          </span>
        )}
        {(verTodasLentes ? gruposLente : [null]).map((grupo, gi) => (
          <Fragment key={grupo ?? "resumo"}>
            {verTodasLentes && gi > 0 && <span className="mx-1.5 hidden h-3 w-px self-center bg-slate-200 dark:bg-slate-700 sm:block" />}
            {verTodasLentes && grupo && <span className="mr-0.5 font-medium text-slate-400 dark:text-slate-500">{grupo.toLowerCase()}:</span>}
            {(verTodasLentes ? LENTES.filter((le) => le.grupo === grupo) : lentesVisiveis).map((le) => {
              const n = contagemLente.get(le.id) ?? 0;
              const ativa = lente === le.id;
              return (
                <button
                  key={le.id}
                  onClick={() => setLente(ativa ? null : le.id)}
                  title={`${le.label} — ${n} pessoa(s); clique para filtrar a tabela`}
                  className={cn(
                    "alvo-toque inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 font-medium transition",
                    ativa
                      ? "bg-brand/10 text-brand dark:bg-brand-400/15 dark:text-brand-300"
                      : le.destaque && n > 0
                        ? "text-rose-600 hover:bg-rose-50 dark:text-rose-400 dark:hover:bg-rose-500/10"
                        : n > 0
                          ? "text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
                          : "text-slate-400 hover:bg-slate-100 dark:text-slate-500 dark:hover:bg-slate-800",
                  )}
                >
                  {le.label}
                  <span className={cn("tabular-nums", n === 0 ? "text-slate-300 dark:text-slate-600" : ativa ? "" : "text-slate-400 dark:text-slate-500")}>{n}</span>
                </button>
              );
            })}
          </Fragment>
        ))}
        <button
          onClick={() => setVerTodasLentes((v) => !v)}
          className="alvo-toque ml-1 inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 font-medium text-slate-500 underline decoration-dotted underline-offset-2 transition hover:bg-slate-100 hover:text-slate-800 dark:text-slate-400 dark:hover:bg-slate-800"
        >
          {verTodasLentes ? "ver menos" : `ver todas as conferências (${LENTES.length})`}
        </button>
      </div>

      {/* Dinheiro que entrou e ninguém viu. Fica no topo até alguém abrir a ficha —
          uma parcela que cai e passa despercebida é cobrança feita em cima de quem
          já pagou. */}
      {naoVistos.length > 0 && (
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-200">
          <p className="flex flex-wrap items-center gap-2">
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
            </span>
            <strong>{naoVistos.length} pagamento(s) novo(s)</strong>
            <span className="tabular-nums">
              · {brl(naoVistos.reduce((acc, l) => acc + (num(l.ultimo_abatimento_valor) ?? 0), 0))} que entraram
            </span>
            <span className="hidden text-emerald-700/70 sm:inline dark:text-emerald-300/70">
              — no topo da lista; abrir a ficha dá baixa no aviso
            </span>
          </p>
          <button
            onClick={() => {
              const novo = { ...vistos };
              for (const l of naoVistos) {
                const q = dt(l.ultimo_abatimento_em);
                if (q) novo[l.comprador_id] = q.toISOString();
              }
              setVistos(novo);
              try { window.localStorage.setItem(VISTOS_KEY, JSON.stringify(novo)); } catch { /* quota */ }
            }}
            className="rounded-md border border-emerald-300 px-2 py-1 text-xs font-medium transition hover:bg-emerald-100 dark:border-emerald-500/40 dark:hover:bg-emerald-500/20"
          >
            Marcar todos como vistos
          </button>
        </div>
      )}

      {/* Resultado do último lote — as falhas aparecem NOMINALMENTE ("3 de 20 não
          entraram: falta a pesquisa"), nunca um erro genérico. */}
      {resultadoLote && (
        <div className={cn(
          "mb-3 rounded-xl border p-3 text-sm",
          resultadoLote.falhas.length
            ? "border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200"
            : "border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-300",
        )}>
          <div className="flex items-start justify-between gap-2">
            <p>
              <strong>{resultadoLote.aplicados} de {resultadoLote.total}</strong> aplicaram &quot;{resultadoLote.pedido}&quot;.
              {resultadoLote.falhas.length > 0 && <> {resultadoLote.falhas.length} não passaram:</>}
            </p>
            <button onClick={() => setResultadoLote(null)} className="rounded p-0.5 opacity-60 transition hover:opacity-100" title="Fechar">
              <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M18 6 6 18M6 6l12 12" /></svg>
            </button>
          </div>
          {resultadoLote.falhas.length > 0 && (
            <ul className="mt-1 list-inside list-disc space-y-0.5 text-xs">
              {resultadoLote.falhas.map((f) => (
                <li key={f.compradorId}>
                  <span className="font-semibold">{f.nome}</span> — {f.motivo}
                  {f.faltando && f.faltando.length > 0 && <> (falta: {f.faltando.join(", ")})</>}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {/* Recarga falhou COM linhas na tela: a tabela pode estar desatualizada
          em relação ao banco — avisa em vez de ficar calada. */}
      {erro && linhas.length > 0 && (
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-300" role="alert">
          <span>{erro} A tabela pode estar desatualizada.</span>
          <button onClick={() => carregar()} className="shrink-0 font-medium underline-offset-2 hover:underline">Recarregar</button>
        </div>
      )}

      {carregando && linhas.length === 0 ? (
        <div className="flex items-center justify-center gap-3 py-20 text-slate-400 dark:text-slate-500">
          <Spinner className="h-6 w-6" /> <span className="text-sm">Carregando a Jornada…</span>
        </div>
      ) : erro && linhas.length === 0 ? (
        // Falhou e não há NADA na tela: sem isto a tabela parecia vazia de
        // verdade — o operador não sabia se era rede ou se os leads sumiram.
        <EmptyState
          icon={
            <svg className="h-9 w-9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0Z" />
              <path d="M12 9v4M12 17h.01" />
            </svg>
          }
          title="Não foi possível carregar a Jornada"
          description={erro}
          action={<Button variant="secondary" onClick={() => carregar()}>Tentar de novo</Button>}
        />
      ) : (
        <Reveal>
          <div className="js-reveal overflow-hidden rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
            <div className="max-h-[68vh] overflow-auto">
              <table className="w-full min-w-max border-separate border-spacing-0 text-xs">
                <thead>
                  <tr>
                    {/* Canto superior-esquerdo: fixo nos DOIS eixos, e por isso com z
                        maior que o resto do cabeçalho — senão as colunas roladas passam
                        por cima dele. */}
                    <th className="sticky left-0 top-0 z-20 w-8 border-b border-slate-200 bg-slate-50 px-2 py-2 dark:border-slate-700 dark:bg-slate-800">
                      <input
                        type="checkbox"
                        checked={todosMarcados}
                        onChange={() => {
                          const ids = selecionaveis.map((l) => l.comprador_id);
                          setMarcados(todosMarcados ? new Set() : new Set(ids));
                        }}
                        title={todosMarcados ? "Limpar seleção" : `Selecionar os ${selecionaveis.length} visíveis`}
                        className={celCheck}
                      />
                    </th>
                    {colunas.map((c) => {
                      const ordenada = sort?.id === c.id;
                      return (
                        <th
                          key={c.id}
                          onClick={() => setSort(ordenada && sort ? (sort.dir === 1 ? { id: c.id, dir: -1 } : null) : { id: c.id, dir: 1 })}
                          title={`Ordenar por "${c.label}" (só a leitura — não mexe na fila do kanban)`}
                          className={cn(
                            "sticky top-0 z-10 cursor-pointer select-none whitespace-nowrap border-b border-slate-200 bg-slate-50 px-2 py-2 text-[11px] font-semibold uppercase tracking-wide text-slate-500 transition hover:text-slate-800 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-400 dark:hover:text-slate-200",
                            c.dir ? "text-right" : "text-left",
                            c.fixa && "left-8 z-20 shadow-[6px_0_6px_-6px_rgba(15,23,42,0.15)]",
                          )}
                        >
                          <span className="inline-flex items-center gap-1">
                            {c.label}
                            {ordenada && sort && (
                              <svg className={cn("h-3 w-3 text-brand dark:text-brand-300", sort.dir === -1 && "rotate-180")} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="m18 15-6-6-6 6" /></svg>
                            )}
                          </span>
                        </th>
                      );
                    })}
                    <th className="sticky top-0 z-10 border-b border-slate-200 bg-slate-50 px-2 py-2 dark:border-slate-700 dark:bg-slate-800/95" />
                  </tr>
                </thead>
                <tbody>
                  {visiveis.length === 0 ? (
                    <tr>
                      <td colSpan={colunas.length + 2} className="px-4 py-10 text-center text-slate-400 dark:text-slate-500">
                        {lente ? "Ninguém nesta lente — contagem zero também é informação." : "Nenhum aluno com esses filtros."}
                      </td>
                    </tr>
                  ) : (
                    visiveis.map((l) => {
                      const bloq = linhaBloqueada(l);
                      const colega = linhaColega(l);
                      // `Distinta` (13/08): mesma dedup do board — some quando a
                      // origem é "Aluno THB"/"Aluno Aurum" (o selo de aluno antigo
                      // já diz o mesmo fato na coluna Nome).
                      const recompra = !!origemRecompraDistinta(l.tags);
                      return (
                      <tr
                        key={l.comprador_id}
                        onClick={() => abrirFicha(l.comprador_id)}
                        title={bloq
                          ? TITLE_CARD_CANCELADO
                          : colega
                            ? `Card de ${l.responsavel ?? "outro operador"} — clique para abrir em leitura`
                            : "Clique para abrir a ficha"}
                        // O `bg-*` explícito em TODA linha não é decoração: as células
                        // fixas usam `bg-inherit`, e sem um fundo sólido no <tr> o texto
                        // rolado por baixo apareceria através delas.
                        className={cn(
                          "border-b transition",
                          bloq ? "cursor-not-allowed" : "cursor-pointer",
                          idsNovos.has(l.comprador_id)
                            ? "bg-emerald-50 hover:bg-emerald-100/70 dark:bg-emerald-500/10 dark:hover:bg-emerald-500/15"
                            : l.nao_contatar
                              ? "bg-rose-50/60 hover:bg-rose-50 dark:bg-rose-500/5 dark:hover:bg-rose-500/10"
                              : l.revisar
                                ? "bg-amber-50/60 hover:bg-amber-50 dark:bg-amber-500/5 dark:hover:bg-amber-500/10"
                                : "bg-white hover:bg-slate-50 dark:bg-slate-900 dark:hover:bg-slate-800/50",
                          l.cancelamento_em && "opacity-60",
                          marcados.has(l.comprador_id) && "bg-brand/5 dark:bg-brand-400/10",
                        )}
                      >
                        {/* Filete esquerdo = RECOMPRA. É o portador livre da linha: o
                            fundo já é do não-lido/travas/seleção. Índigo (13/08, mesma
                            paleta do board): recompra é contexto histórico, não alerta
                            — rose ficou só para cancelado e "não contatar". O selo
                            textual na coluna Nome tira qualquer ambiguidade. */}
                        <td
                          className={cn(
                            "sticky left-0 z-[1] w-8 border-b border-slate-100 bg-inherit px-2 py-1.5 dark:border-slate-800",
                            recompra && "border-l-[3px] border-l-indigo-400 dark:border-l-indigo-500",
                          )}
                          onClick={(e) => e.stopPropagation()}
                        >
                          <input
                            type="checkbox"
                            checked={marcados.has(l.comprador_id)}
                            disabled={bloq || colega}
                            title={bloq
                              ? TITLE_CARD_CANCELADO
                              : colega
                                ? `Card de ${l.responsavel ?? "outro operador"} — lote não age em card de colega`
                                : undefined}
                            onChange={() => setMarcados((prev) => {
                              const next = new Set(prev);
                              if (next.has(l.comprador_id)) next.delete(l.comprador_id); else next.add(l.comprador_id);
                              return next;
                            })}
                            className={celCheck}
                          />
                        </td>
                        {colunas.map((c) => (
                          <td
                            key={c.id}
                            onClick={c.edit ? (e) => e.stopPropagation() : undefined}
                            className={cn(
                              "border-b border-slate-100 px-2 py-1.5 text-slate-600 dark:border-slate-800 dark:text-slate-300",
                              c.dir && "text-right",
                              // A coluna fixa acompanha o scroll horizontal e projeta uma
                              // sombra à direita: sem ela, o conteúdo que passa por baixo
                              // parece pertencer à célula.
                              c.fixa && "sticky left-8 z-[1] bg-inherit shadow-[6px_0_6px_-6px_rgba(15,23,42,0.15)]",
                            )}
                          >
                            {c.render(l)}
                          </td>
                        ))}
                        <td className="border-b border-slate-100 px-2 py-1.5 text-right dark:border-slate-800" onClick={(e) => e.stopPropagation()}>
                          {/* Pagamento e cancelamento NÃO são células — têm consequência
                              na base mestre e a confirmação vive na ficha. Linha
                              cancelada (não-master) não tem ficha para abrir. */}
                          <button
                            onClick={() => abrirFicha(l.comprador_id)}
                            disabled={bloq}
                            title={bloq ? TITLE_CARD_CANCELADO : "Abrir a ficha (pagamento, cancelamento, sócios, timeline)"}
                            className={cn(
                              "rounded-md px-2 py-1 text-[11px] font-medium transition",
                              bloq
                                ? "cursor-not-allowed text-slate-300 dark:text-slate-600"
                                : "text-slate-500 hover:bg-slate-100 hover:text-brand dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-brand-300",
                            )}
                          >
                            Ficha
                          </button>
                        </td>
                      </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>

            {/* O rodapé onde o dinheiro aparece somado — recalculado a cada
                filtro/lente/busca, sempre sobre o que está na tela. */}
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600 dark:border-slate-700 dark:bg-slate-800/80 dark:text-slate-300">
              <span className="font-semibold text-slate-800 dark:text-slate-100">{visiveis.length} {visiveis.length === 1 ? "aluno" : "alunos"}</span>
              <span>
                · saldo a receber <strong className="tabular-nums text-slate-800 dark:text-slate-100">{brl(totSaldo)}</strong>
                {/* O sufixo só aparece quando a soma é incompleta — no caso normal
                    (todo mundo com saldo calculado) ele seria só ruído. */}
                {semSaldo > 0 && (
                  <span className="text-amber-600 dark:text-amber-400">
                    {" "}— de {comSaldo.length} dos {devendo.length} que devem
                    {" · "}
                    <button
                      onClick={() => setLente("sem_saldo")}
                      className="font-semibold underline decoration-dotted underline-offset-2 transition hover:text-amber-700 dark:hover:text-amber-300"
                      title="Ver quem está sem saldo calculável — essas pessoas devem, mas falta o crédito pró-rata delas e o valor não entra na soma"
                    >
                      {semSaldo} sem saldo calculável
                    </button>
                  </span>
                )}
              </span>
              <span>· {semResp} sem operador</span>
              <span>· {comLink} com link enviado</span>
              <span>· média de {mediaDias} dia(s) parado(s)</span>
              {salvando && <span className="inline-flex items-center gap-1 text-brand dark:text-brand-300"><Spinner className="h-3 w-3" /> salvando…</span>}
            </div>
          </div>
        </Reveal>
      )}

      {/* Barra de ações em lote — a seleção age de uma vez, mas o servidor aplica
          um a um, pelos serviços (e conta quem não passou). */}
      {marcados.size > 0 && (
        <div className="fixed inset-x-0 bottom-4 z-40 flex justify-center px-4">
          <div className="flex flex-wrap items-center justify-center gap-2 rounded-full border border-slate-200 bg-white/95 px-4 py-2 shadow-pop backdrop-blur dark:border-slate-700 dark:bg-slate-900/95">
            <span className="text-sm font-medium text-slate-700 dark:text-slate-200">
              {marcados.size} selecionado{marcados.size > 1 ? "s" : ""}
            </span>
            {/* Atribuir em lote é DISTRIBUIR — só master/gestor. A lista já vem
                recortada do servidor (gestor = só a equipe dele). Operador não
                vê este seletor: ele só assume card do pool, um a um, na linha. */}
            {podeDistribuir() && (
              <select
                value=""
                disabled={aplicandoLote}
                onChange={(e) => {
                  const v = e.target.value;
                  if (!v) return;
                  if (v === "__remover") lote({ responsavel: null }, "remover operador");
                  else lote({ responsavel: v }, `atribuir a ${v}`);
                }}
                className={cn(fieldCompactClass, "py-1.5 text-xs")}
                title="Atribuir operador (registra na timeline de cada um)"
              >
                <option value="">Operador…</option>
                {responsaveis.map((r) => <option key={r} value={r}>{r}</option>)}
                <option value="__remover">— remover operador —</option>
              </select>
            )}
            <select
              value=""
              disabled={aplicandoLote}
              onChange={(e) => { if (e.target.value) loteMover(e.target.value); }}
              className={cn(fieldCompactClass, "py-1.5 text-xs")}
              title="Mover etapa (respeita a trava do checklist — quem não passar aparece nominalmente)"
            >
              <option value="">Mover para…</option>
              {estagios.map((s) => (
                <option key={s.chave} value={s.chave}>{(s.aba ?? "comercial") === "ativacao" ? "Ativação · " : "Comercial · "}{s.nome}</option>
              ))}
            </select>
            <select
              value=""
              disabled={aplicandoLote}
              onChange={(e) => {
                const v = e.target.value;
                if (!v) return;
                if (v === "link_saldo_enviado") lote({ link_saldo_enviado: true }, "marcar link do saldo enviado");
                else {
                  const item = CHECKLIST.find((c) => c.campo === v);
                  lote({ [v]: true }, `marcar "${item?.label ?? v}"`);
                }
              }}
              className={cn(fieldCompactClass, "py-1.5 text-xs")}
              title="Marcar item do checklist ou o envio do link do saldo"
            >
              <option value="">Marcar…</option>
              {CHECKLIST.map((c) => <option key={c.campo} value={c.campo}>{c.label}</option>)}
              <option value="link_saldo_enviado">Link do saldo enviado</option>
            </select>
            {/* Tags: o picker busca/cria/atribui digitando (criar É digitar um
                nome novo); remover fica no select ao lado. Cada card loga a
                mudança na timeline; turma/origem são do sistema e não aparecem. */}
            <TagPicker
              opcoes={catalogoTags}
              disabled={aplicandoLote}
              onEscolher={(nome) => lote({ addTag: nome }, `adicionar a tag "${nome}"`)}
            />
            <select
              value=""
              disabled={aplicandoLote}
              onChange={(e) => {
                const t = e.target.value;
                if (t) lote({ removeTag: t }, `remover a tag "${t}"`);
              }}
              className={cn(fieldCompactClass, "py-1.5 text-xs")}
              title="Remover uma tag dos selecionados"
            >
              <option value="">Remover tag…</option>
              {canais.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
            <Button variant="secondary" size="sm" disabled={aplicandoLote} onClick={() => setMarcados(new Set())}>Limpar</Button>
            {podeDisparar && (
              <Button variant="primary" size="sm" disabled={aplicandoLote} onClick={() => setDispararLote(true)}>Disparar</Button>
            )}
            {aplicandoLote && <Spinner className="h-4 w-4" />}
          </div>
        </div>
      )}

      {/* Popover da remarcação (invariante nº 4): a data anterior fica no
          histórico (agendarHm), e o motivo explica por que ela caiu. */}
      {remarcar && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4 backdrop-blur-sm" onClick={fecharRemarcar}>
          <div className="w-full max-w-sm rounded-xl border border-slate-200 bg-white p-4 shadow-pop dark:border-slate-700 dark:bg-slate-900" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-sm font-semibold text-slate-800 dark:text-slate-100">
              {remarcar.novo ? "Remarcar" : "Desmarcar"} {remarcar.tipo === "reuniao" ? "a reunião" : "a entrevista"} de {remarcar.nome}
            </h3>
            <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
              {remarcar.novo
                ? <>De <strong className="tabular-nums">{fmtDataHora(remarcar.anterior)}</strong> para <strong className="tabular-nums">{fmtDataHora(remarcar.novo)}</strong> — será a {remarcar.vezes + 1}ª remarcação. A marcação anterior fica guardada no histórico.</>
                : <>A marcação de <strong className="tabular-nums">{fmtDataHora(remarcar.anterior)}</strong> será desmarcada — ela fica registrada no histórico.</>}
            </p>
            <label className="mt-3 block text-[11px] font-medium text-slate-500 dark:text-slate-400">
              Por que a marcação anterior caiu?
              <textarea
                value={motivoRemarcar}
                onChange={(e) => setMotivoRemarcar(e.target.value)}
                rows={2}
                placeholder="não compareceu, pediu para adiar…"
                className={cn(fieldClass, "mt-1")}
                autoFocus
              />
            </label>
            <div className="mt-3 flex justify-end gap-2">
              <Button variant="secondary" size="sm" onClick={fecharRemarcar}>Cancelar</Button>
              <Button
                variant="primary"
                size="sm"
                onClick={() => {
                  const r = remarcar;
                  setRemarcar(null);
                  const col = r.tipo === "reuniao" ? "reuniao_em" : "entrevista_em";
                  patch(r.compradorId, r.nome, { [col]: r.novo, agendamento_motivo: motivoRemarcar.trim() || null });
                }}
              >
                {remarcar.novo ? "Remarcar" : "Desmarcar"}
              </Button>
            </div>
          </div>
        </div>
      )}

      {dispararLote && (
        <DisparoModal
          selecao={linhas
            .filter((l) => marcados.has(l.comprador_id))
            .map((l) => ({ comprador_id: l.comprador_id, nome: l.nome, telefone: l.telefone ?? "", edicao: null }))}
          onClose={() => { setDispararLote(false); setMarcados(new Set()); carregar(true); }}
        />
      )}

      {selecionado && (
        <HmDrawer
          compradorId={selecionado}
          estagios={estagios}
          responsaveis={responsaveis}
          onClose={() => setSelecionado(null)}
          onChanged={() => carregar(true)}
        />
      )}

      {cadastrando && (
        <HmCadastroModal
          onClose={() => setCadastrando(false)}
          onCadastrado={async (compradorId) => {
            setCadastrando(false);
            await carregar(true);
            setSelecionado(compradorId);
          }}
        />
      )}
    </div>
  );
}

// ----------------------------------------------------------- células auxiliares
function Dinheiro({ v }: { v: number | null }) {
  return v === null ? <span>—</span> : <span className="whitespace-nowrap tabular-nums">{brl(v)}</span>;
}
function SimNao({ v }: { v: boolean }) {
  return v
    ? <span className="inline-flex rounded bg-emerald-100 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300">Sim</span>
    : <span className="text-slate-400 dark:text-slate-500">Não</span>;
}
// Contador que só grita quando o número vira sinal (remarcações, no-shows).
function NumAlerta({ v, limite }: { v: number; limite: number }) {
  return <span className={cn("tabular-nums font-medium", v >= limite ? "text-rose-600 dark:text-rose-400" : "text-slate-500 dark:text-slate-400")}>{v}</span>;
}
function ChecklistUm({ l, campo, salvando, patch }: {
  l: LinhaEsteira;
  campo: "ativ_searchie" | "ativ_comunidade" | "ativ_grupo" | "ativ_pesquisa";
  salvando: string | null;
  patch: (compradorId: string, nome: string, payload: Record<string, unknown>) => Promise<void>;
}) {
  return (
    <input
      type="checkbox"
      checked={!!l[campo]}
      disabled={salvando === l.comprador_id}
      onClick={(e) => e.stopPropagation()}
      onChange={(e) => patch(l.comprador_id, l.nome, { [campo]: e.target.checked })}
      className={celCheck}
    />
  );
}
