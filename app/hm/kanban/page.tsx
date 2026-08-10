"use client";

import { Fragment, useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import type { DragEvent, WheelEvent } from "react";
import { Button, cn, EmptyState, fieldClass, Spinner } from "@/app/_components/ui";
import { Avatar, corAvatar, inicial } from "@/app/_components/avatar";
import { Reveal } from "@/app/_components/anim";
import { HmDrawer } from "@/app/hm/_components/hm-drawer";
import { HmSocioDrawer } from "@/app/hm/_components/hm-socio-drawer";
import { HmCadastroModal } from "@/app/hm/_components/hm-cadastro";
import { HmVisao } from "@/app/hm/_components/hm-visao";
import { gruposCanal, HmCanaisFixos } from "@/app/hm/_components/hm-canais";
import { MultiSelect } from "@/app/_components/multi-select";
import { DisparoModal } from "@/app/_components/disparo";
import { DisparoInteligente } from "@/app/_components/disparo-inteligente";
import { TagChip } from "@/app/_components/tags";
import { ContatoDoNome } from "@/app/_components/copiavel";
import { useMe, msgErroPermissao } from "@/app/_components/use-me";
import { toast } from "@/app/_components/toast";
import { MarcaPortal } from "@/app/_components/marca";
import { useProdutoHm } from "@/app/hm/_components/use-produto";
import { SeloEquipe, COR_EQUIPE_PADRAO } from "@/app/hm/_components/selo-equipe";
import { ehEstagioCancelamento, origemRecompra, SeloRecompra, TITLE_CARD_CANCELADO } from "@/app/hm/_components/card-sinais";
import { casaBusca } from "@/lib/busca";

type Estagio = { chave: string; nome: string; aba: string | null };

type Card = {
  comprador_id: string;
  nome: string;
  email: string | null;
  telefone: string | null;
  turma: string | null;
  plano: string | null;
  categoria_entrada: string | null;
  estagio_chave: string;
  estagio_nome: string | null;
  estagio_aba: string | null;
  responsavel: string | null;
  // Equipes (0140): dono por id + a equipe do card (do dono OU do canal roteado).
  // equipe_id null e responsavel_id null = pool (visível a todos).
  responsavel_id: string | null;
  equipe_id: string | null;
  equipe_nome: string | null;
  equipe_cor: string | null;
  equipe_tipo: "principal" | "comum" | null;
  // Atribuição travada pelo admin (0142): operador comum não mexe. inbox_status
  // dá o selo de conversa pendente no card.
  atribuicao_admin: boolean;
  inbox_status: string | null;
  tags: string[];
  apto_ativacao: boolean;
  reuniao_em: string | null;
  entrevista_em: string | null;
  pagamento_em: string | null;
  pagamento_previsto_em: string | null;
  quitado: boolean;
  parcelado: boolean;
  /** Falso-verde: o saldo zerou por dupla contagem do crédito pró-rata (0112),
   *  não por quitação. O card avisa em vez de mentir; quanto cobrar é do comercial. */
  conferir_saldo: boolean;
  ultima_msg: string | null;
  entrou_estagio_em: string | null;
  /** A MESMA pessoa nos outros boards (0164), pronto para exibir:
   *  "HM: Entrevista Finalizada". Null = ela só existe neste portal. */
  outros_portais: string | null;
};
type Coluna = { chave: string; nome: string; cor: string; aba: string | null };

// O sócio convidado (aba "SÓCIOS T39"). NÃO é comprador nem card financeiro:
// mora pendurado no titular (cs.hm_socios) e aparece na Ativação só para o Thomas
// liberar o acesso. Fluxo simples — três checks e pronto.
type Socio = {
  socio_id: string;
  contato_hm_id: string;
  nome: string;
  email: string | null;
  telefone: string | null;
  link_facebook: string | null;
  origem: string | null;
  ativ_searchie: boolean;
  ativ_comunidade: boolean;
  ativ_grupo: boolean;
  titular_comprador_id: string;
  titular_nome: string;
  titular_turma: string | null;
  titular_origem: string | null;
  titular_cancelado: boolean;
  checks_feitos: number;
  status: "nao_iniciado" | "em_ativacao" | "ativado" | "sem_acesso";
  // Estágio próprio do sócio quando arrastado (0150); null = coluna derivada.
  estagio_chave: string | null;
  // O sócio já existe em public.thb_alunos (a base que o GPS lê)? E o titular?
  na_base: boolean;
  titular_na_base: boolean;
};

// O sócio "certinho na base": só está de fato na base mestre THB quando tem
// cadastro lá (na_base). Se o titular já é aluno mas o sócio não, é o gargalo —
// ele pagou e quer acesso, mas o GPS não o enxerga. Antes de o titular pagar, o
// sócio ainda não deve existir na base (é só um convidado).
function estadoNaBase(s: Socio): "na_base" | "fora_da_base" | "aguarda_titular" {
  if (s.na_base) return "na_base";
  return s.titular_na_base ? "fora_da_base" : "aguarda_titular";
}

// Em qual coluna da Ativação o sócio aparece. Se o operador ARRASTOU o card
// (estagio_chave setado, 0150), a coluna é essa — vale o gesto manual. Caso
// contrário, deriva do status: 3 acessos → "Acesso Liberado"; senão "Pendente de
// Liberação", onde o Thomas trabalha. Titular cancelado também cai em pendente (é
// a fila do "remover acesso"), mas com o alerta vermelho.
function colunaDoSocio(s: Socio): string {
  if (s.estagio_chave) return s.estagio_chave;
  return s.status === "ativado" ? "hm_acesso_liberado" : "hm_pendente_liberacao";
}

const ABAS: { id: string; label: string }[] = [
  { id: "comercial", label: "Comercial" },
  { id: "ativacao", label: "Ativação" },
];

const COL_PAGAMENTO = "hm_pagamento_realizado";
const COL_CANCELAMENTO = "hm_cancelamento"; // "Reclamada" — o cliente PEDIU o cancelamento
const COL_REEMBOLSADO = "hm_reembolsado"; // o reembolso foi EXECUTADO (o fato) — marca o aluno
const COL_PARCELADO = "hm_pagamento_parcelado"; // espelho de quem paga em parcelas (ainda deve)

// Em qual coluna DESTA aba o card aparece — ou null se ele não pertence a ela.
// Quem quitou o saldo vive na Ativação, mas o Comercial não pode perdê-lo de
// vista: ele continua visível lá, parado em "Pagamento Realizado". É o mesmo
// card (um único estágio no banco), mostrado nas duas esteiras.
function colunaNaAba(card: Card, aba: string): string | null {
  const abaDoCard = card.estagio_aba ?? "comercial";
  if (abaDoCard === aba) return card.estagio_chave;
  // Espelho no Comercial: quem quitou aparece em "Pagamento Realizado"; quem ainda
  // paga em parcelas aparece em "Pagamento Parcelado" (a parcela está em curso).
  if (aba === "comercial" && abaDoCard === "ativacao") return card.parcelado ? COL_PARCELADO : COL_PAGAMENTO;
  return null;
}
// Espelho = card que está de fato na Ativação e aparece no Comercial só como
// registro do pagamento. Arrastá-lo de volta desfaz o pagamento (o servidor
// limpa apto_ativacao), então o board avisa antes.
function ehEspelho(card: Card, aba: string): boolean {
  return aba === "comercial" && (card.estagio_aba ?? "comercial") === "ativacao";
}

function relativo(iso: string | null): string {
  if (!iso) return "";
  const min = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
  if (min < 60) return `${min}m`;
  if (min < 1440) return `${Math.round(min / 60)}h`;
  return `${Math.round(min / 1440)}d`;
}
function fmtDataHora(iso: string | null): string {
  return iso ? new Date(iso).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) : "—";
}
function waLink(tel: string | null): string | null {
  if (!tel) return null;
  let d = tel.replace(/\D/g, "");
  if (d.length < 8) return null;
  if (!d.startsWith("55")) d = "55" + d;
  return `https://wa.me/${d}`;
}
function tempoTom(iso: string | null): string {
  if (!iso) return "text-slate-400 dark:text-slate-500";
  const dias = (Date.now() - new Date(iso).getTime()) / 86_400_000;
  if (dias >= 7) return "text-rose-500 dark:text-rose-400";
  if (dias >= 3) return "text-amber-500 dark:text-amber-400";
  return "text-slate-400 dark:text-slate-500";
}
// Categoria de entrada → rótulo curto no card.
function catLabel(cat: string | null): { txt: string; cls: string } | null {
  if (cat === "sinal") return { txt: "Sinal", cls: "bg-sky-100 text-sky-700 dark:bg-sky-500/15 dark:text-sky-300" };
  if (cat === "compra_cheia") return { txt: "Compra cheia", cls: "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300" };
  return null;
}

// O estado da parcela — a leitura RASA que a Ativação faz do financeiro. "Em dia"
// (indigo) enquanto não vence a data prometida; "atrasada" (vermelho) depois — e aí
// quem age é o Financeiro (grupoparticipa.app.br), não a ativação. Sem data
// combinada, fica neutro: o Financeiro ainda não definiu o vencimento.
function parcelaStatus(card: Card): { txt: string; cls: string; title: string } | null {
  if (!card.parcelado) return null;
  const prev = card.pagamento_previsto_em ? new Date(card.pagamento_previsto_em) : null;
  if (prev && prev.getTime() < Date.now()) {
    return { txt: "Parcela atrasada", cls: "bg-rose-100 text-rose-700 dark:bg-rose-500/15 dark:text-rose-300",
      title: `Parcela vencida em ${prev.toLocaleDateString("pt-BR")} — a cobrança é do Financeiro (grupoparticipa.app.br)` };
  }
  return { txt: prev ? "Parcela em dia" : "Parcelando", cls: "bg-indigo-100 text-indigo-700 dark:bg-indigo-500/15 dark:text-indigo-300",
    title: prev ? `Próxima parcela combinada para ${prev.toLocaleDateString("pt-BR")}` : "Pagando em parcelas — sem data de vencimento combinada com o Financeiro" };
}

// Posição onde o card cairá: entre quais dois cards da coluna o cursor está.
// O índice é visual (conta o próprio card arrastado, que continua na lista
// durante o gesto) — vira uma âncora ("antes de quem") na hora de salvar.
type Alvo = { col: string; indice: number };

function indiceSobOCursor(e: DragEvent<HTMLDivElement>): number {
  const cards = Array.from(e.currentTarget.querySelectorAll<HTMLElement>("[data-card]"));
  for (let i = 0; i < cards.length; i++) {
    const r = cards[i].getBoundingClientRect();
    if (e.clientY < r.top + r.height / 2) return i;
  }
  return cards.length;
}

// Auto-scroll da coluna durante o arrasto. Sem isto, numa coluna alta (a de
// entrevistas passa de 20 cards) o arrasto só alcança o que está visível — não dá
// para levar o card lá para o fim, e parece que só se move "de quadrinho em
// quadrinho". Enquanto o cursor fica na zona de borda (topo/base), a coluna rola
// sozinha, num loop de requestAnimationFrame que a soltura/saída encerram.
let rafAutoScroll: number | null = null;
function pararAutoScroll() {
  if (rafAutoScroll !== null) { cancelAnimationFrame(rafAutoScroll); rafAutoScroll = null; }
}
function autoScrollColuna(el: HTMLElement, clientY: number) {
  pararAutoScroll();
  const r = el.getBoundingClientRect();
  const zona = 56; // px de borda que ativam a rolagem
  let vel = 0;
  if (clientY < r.top + zona) vel = -Math.ceil((r.top + zona - clientY) / 4);
  else if (clientY > r.bottom - zona) vel = Math.ceil((clientY - (r.bottom - zona)) / 4);
  if (vel === 0) return;
  const passo = () => {
    const antes = el.scrollTop;
    el.scrollTop += vel;
    if (el.scrollTop === antes) { rafAutoScroll = null; return; } // chegou ao topo/fim
    rafAutoScroll = requestAnimationFrame(passo);
  };
  rafAutoScroll = requestAnimationFrame(passo);
}

// Aplica o movimento na lista local antes da resposta do servidor: tira o card e
// o recoloca logo acima do vizinho (ou no fim da coluna, quando não há vizinho).
// A tela filtra os cards por coluna preservando a ordem do array — é ela que
// carrega a ordenação vertical até o próximo carregamento.
function reordenarLocal(cards: Card[], card: Card, colChave: string, antesDe: string | null, aba: string): Card[] {
  const movido: Card = { ...card, estagio_chave: colChave, estagio_aba: aba };
  const resto = cards.filter((c) => c.comprador_id !== card.comprador_id);
  const pos = antesDe ? resto.findIndex((c) => c.comprador_id === antesDe) : -1;
  if (pos >= 0) {
    resto.splice(pos, 0, movido);
    return resto;
  }
  const naColuna = resto.filter((c) => colunaNaAba(c, aba) === colChave);
  const ultimo = naColuna.at(-1);
  const fim = ultimo ? resto.findIndex((c) => c.comprador_id === ultimo.comprador_id) + 1 : resto.length;
  resto.splice(fim, 0, movido);
  return resto;
}

function rolarBoardHorizontal(e: WheelEvent<HTMLDivElement>) {
  const board = e.currentTarget;
  if (board.scrollWidth <= board.clientWidth) return;
  let node = e.target as HTMLElement | null;
  while (node && node !== board) {
    if (node.hasAttribute?.("data-col-scroll") && node.scrollHeight > node.clientHeight) {
      const aindaRola = (e.deltaY < 0 && node.scrollTop > 0) || (e.deltaY > 0 && node.scrollTop + node.clientHeight < node.scrollHeight - 1);
      if (aindaRola) return;
    }
    node = node.parentElement;
  }
  if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) board.scrollLeft += e.deltaY;
}

export default function HmKanbanPage() {
  const { nivel, podeDisparar: podeDisparaFn, podeVerTudo, podeDistribuir, ehMaster, ehCardDeColega } = useMe();
  // Produto/board (0155): a mesma tela serve HM, Aurum e ETHB pela URL.
  const { produto, portal, nome: nomePortal } = useProdutoHm();
  const qp = produto === "HM" ? "" : `produto=${produto}`; // sufixo p/ as APIs
  const podeDisparar = podeDisparaFn("HM");
  // Card em Reclamada/Reembolsado é SÓ do master (o backend devolve 403 no GET
  // da ficha) — para os demais a UI nem convida ao clique. Enquanto a sessão
  // carrega (ehMaster()=false), nasce bloqueado: na dúvida, a regra fecha.
  const cardBloqueado = (c: Card) => ehEstagioCancelamento(c.estagio_chave) && !ehMaster();
  // Card de COLEGA (28/07): o operador VÊ o pool + todos os cards da equipe,
  // mas só AGE no que é dele ou está livre. O card do colega abre em LEITURA
  // (o drawer cuida disso); aqui o board não convida a arrastar nem a lote —
  // a API recusa com 403 `card_de_outro_operador`. A regra é o escopoAcao de
  // lib/papeis (via useMe.ehCardDeColega), a MESMA do backend.
  // Evento "HM": a ação livre da equipe principal (03/08) desliga o "de colega"
  // no board inteiro do HM — a equipe que ativa arrasta a esteira entre si, como
  // no Seminário. Sem o evento, o gate por operador voltaria a travar o arrasto.
  const cardDeColega = (c: Card) => ehCardDeColega(c, "HM");
  // Aba "Equipes" do alternador: master (gere) e gestor (vê a própria equipe).
  const podeConfigEquipes = podeDistribuir();
  const [colunas, setColunas] = useState<Coluna[]>([]);
  const [cards, setCards] = useState<Card[]>([]);
  const [socios, setSocios] = useState<Socio[]>([]);
  const [responsaveis, setResponsaveis] = useState<string[]>([]);
  const [canais, setCanais] = useState<string[]>([]);
  const [canaisQtd, setCanaisQtd] = useState<Record<string, number>>({});
  // Cores do catálogo de tags (0067) — a cor é da tag, não da tela.
  const [coresTags, setCoresTags] = useState<Record<string, string | null>>({});
  const [turmas, setTurmas] = useState<string[]>([]);
  const [estagios, setEstagios] = useState<Estagio[]>([]);
  // Cada filtro aceita VÁRIOS valores (OU dentro do filtro, E entre filtros).
  const [filtroResp, setFiltroResp] = useState<string[]>([]);
  const [filtroCanal, setFiltroCanal] = useState<string[]>([]);
  const [filtroTurma, setFiltroTurma] = useState<string[]>([]);
  // Os filtros nascem da URL e voltam para ela: é assim que o alternador
  // Kanban ⇄ Tabela troca de leitura sem perder o contexto do que se olhava.
  const [filtrosProntos, setFiltrosProntos] = useState(false);
  const [busca, setBusca] = useState("");
  const [aba, setAba] = useState("comercial");
  const [carregando, setCarregando] = useState(true);
  // Falha de carga/recarga do board — antes era silenciosa: a esteira parecia
  // vazia (ou congelada após um movimento) sem nenhuma explicação.
  const [erro, setErro] = useState<string | null>(null);
  const [alvo, setAlvo] = useState<Alvo | null>(null);
  const [selecionado, setSelecionado] = useState<string | null>(null);
  // Deep-link ?card=<comprador_id> (0164): quem vem do selo "esta pessoa também está
  // em X" cai no board do outro portal já com o card à vista. `destacado` faz o card
  // pulsar por alguns segundos — sem isso o operador chega num board de 33 cards sem
  // saber para onde olhar.
  const [destacado, setDestacado] = useState<string | null>(null);
  const [socioAberto, setSocioAberto] = useState<Socio | null>(null);
  const [addSocio, setAddSocio] = useState<{ compradorId: string; nome: string } | null>(null);
  const [marcados, setMarcados] = useState<Set<string>>(new Set());
  const [dispararLote, setDispararLote] = useState(false);
  // Disparo inteligente: a seleção vem pronta da API /elegiveis (novos/frios) já
  // recortada por equipe no backend, em vez dos cards marcados à mão.
  const [showInteligente, setShowInteligente] = useState(false);
  const [dispararSelecao, setDispararSelecao] = useState<{ comprador_id: string; nome: string; telefone: string; edicao?: string | null }[] | null>(null);
  // Card a caminho da coluna de cancelamento, esperando a resposta: pediu ou cancelou?
  const [cancelando, setCancelando] = useState<{ card: Card; antesDe: string | null } | null>(null);
  const [menu, setMenu] = useState<{ card: Card; x: number; y: number } | null>(null);
  const [cadastrando, setCadastrando] = useState(false);
  const arrastando = useRef<Card | null>(null);
  // Sócio sendo arrastado (0150) — trilho separado do titular; o drop da coluna
  // checa este primeiro (o sócio só troca de coluna, não reordena).
  const arrastandoSocio = useRef<Socio | null>(null);

  function toggleMarcado(id: string) {
    setMarcados((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  // Os filtros que estão valendo — o board os usa para ler, e o relatório para
  // exportar. Um relatório que ignorasse o filtro da tela seria uma armadilha.
  // Multi-valor = parâmetro repetido (?canal=A&canal=B), lido com getAll.
  const paramsFiltro = new URLSearchParams();
  for (const v of filtroResp) paramsFiltro.append("responsavel", v);
  for (const v of filtroCanal) paramsFiltro.append("canal", v);
  for (const v of filtroTurma) paramsFiltro.append("turma", v);
  if (produto !== "HM") paramsFiltro.set("produto", produto);

  const carregar = useCallback(async () => {
    setCarregando(true);
    try {
      const params = new URLSearchParams();
      for (const v of filtroResp) params.append("responsavel", v);
      for (const v of filtroCanal) params.append("canal", v);
      for (const v of filtroTurma) params.append("turma", v);
      if (produto !== "HM") params.set("produto", produto);
      const r = await fetch(`/api/hm/kanban?${params.toString()}`);
      const d = await r.json();
      if (d.ok) {
        setErro(null);
        setColunas(d.colunas);
        setCards(d.cards);
        if (Array.isArray(d.socios)) setSocios(d.socios);
        if (Array.isArray(d.responsaveis)) setResponsaveis(d.responsaveis);
        if (Array.isArray(d.canais)) setCanais(d.canais);
        if (Array.isArray(d.turmas)) setTurmas(d.turmas);
        if (d.canaisQtd) setCanaisQtd(d.canaisQtd);
      } else {
        setErro(msgErroPermissao(d.reason) ?? "Não foi possível carregar a esteira. Tente de novo.");
      }
    } catch {
      setErro("Sem conexão com o servidor. Verifique a rede e tente de novo.");
    } finally {
      setCarregando(false);
    }
  }, [filtroResp, filtroCanal, filtroTurma, produto]);

  // Liga/desliga um dos 3 acessos do sócio. Otimista, e reusa a rota que já
  // existe (o sócio é editado pelo card do TITULAR). Sem financeiro, sem timeline.
  async function toggleSocioCheck(s: Socio, campo: "ativ_searchie" | "ativ_comunidade" | "ativ_grupo") {
    const novo = !s[campo];
    setSocios((lista) => lista.map((x) => {
      if (x.socio_id !== s.socio_id) return x;
      const at = { ...x, [campo]: novo };
      const n = Number(at.ativ_searchie) + Number(at.ativ_comunidade) + Number(at.ativ_grupo);
      const status: Socio["status"] = at.titular_cancelado ? "sem_acesso"
        : n === 3 ? "ativado" : n > 0 ? "em_ativacao" : "nao_iniciado";
      return { ...at, checks_feitos: n, status };
    }));
    await fetch(`/api/hm/contato/${s.titular_comprador_id}/socios`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ socioId: s.socio_id, [campo]: novo }),
    });
  }

  // Arrasta o sócio para outra coluna da Ativação (0150). Fixa o estágio próprio
  // dele; reusa a rota de sócios (é edição do sócio, não do titular). Otimista.
  async function moverSocio(s: Socio, estagioChave: string) {
    if (colunaDoSocio(s) === estagioChave) return;
    setSocios((lista) => lista.map((x) => (x.socio_id === s.socio_id ? { ...x, estagio_chave: estagioChave } : x)));
    const r = await fetch(`/api/hm/contato/${s.titular_comprador_id}/socios`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ socioId: s.socio_id, estagio_chave: estagioChave }),
    });
    const d = await r.json().catch(() => ({ ok: false }));
    if (!d.ok) { alert("Não foi possível mover o sócio."); carregar(); }
  }

  // "Enviar à base": empurra o sócio órfão para a base mestre THB. Reusa a função
  // que já roda no provisionamento do titular; aqui é sob demanda, para os sócios
  // cujo titular pagou mas que nunca entraram na base. Recarrega para o selo virar
  // "Na base THB". Só faz sentido quando o titular já é aluno.
  const [enviandoBase, setEnviandoBase] = useState<Set<string>>(new Set());
  async function enviarSocioParaBase(s: Socio) {
    setEnviandoBase((atual) => new Set(atual).add(s.socio_id));
    try {
      const r = await fetch(`/api/hm/contato/${s.titular_comprador_id}/socios/provisionar`, { method: "POST" });
      const d = await r.json().catch(() => ({}));
      if (!r.ok || !d?.ok) toast(`Não foi possível enviar ${s.nome} à base. Tente de novo.`, "erro");
      else if (!d.provisionados) toast(`${s.nome} não foi enviado: o titular precisa estar como aluno na base primeiro.`, "erro");
      else toast(`${s.nome} enviado à base THB.`);
      await carregar();
    } finally {
      setEnviandoBase((atual) => { const n = new Set(atual); n.delete(s.socio_id); return n; });
    }
  }

  // Lê os filtros da URL uma vez, antes do primeiro carregamento — senão o
  // board buscaria sem filtro e refaria a busca logo em seguida.
  // O board abre SEM filtro: mostra todo mundo. A régua de canais fixos e os
  // dropdowns (canal/turma/responsável) seguem à mão para recortar quando o time
  // quiser — mas nada some por padrão. (Antes os 5 canais fixos entravam
  // pré-marcados e escondiam quem não estava neles — Venda direta, Imersão POA,
  // sem-canal —; só apareciam via "Limpar filtros".) Um ?canal=X na URL — vindo
  // da tabela ou de um link — ainda é respeitado.
  useEffect(() => {
    const sp = new URLSearchParams(window.location.search);
    setFiltroResp(sp.getAll("responsavel"));
    setFiltroCanal(sp.getAll("canal"));
    setFiltroTurma(sp.getAll("turma"));
    // ?card= chega ANTES dos cards carregarem: guarda o alvo e deixa o efeito de
    // scroll agir quando a lista existir no DOM.
    const alvo = sp.get("card");
    if (alvo) { setDestacado(alvo); setSelecionado(alvo); }
    setFiltrosProntos(true);
  }, []);

  // Rola até o card do deep-link e o destaca. Roda quando os cards já estão na tela
  // (por isso depende de `cards`), e o timer limpa o realce para ele não ficar
  // pulsando para sempre. O ?card= sai da URL no efeito de filtros logo abaixo.
  useEffect(() => {
    if (!destacado || cards.length === 0) return;
    const el = document.querySelector<HTMLElement>(`[data-card="${destacado}"]`);
    el?.scrollIntoView({ behavior: "smooth", block: "center" });
    const t = setTimeout(() => setDestacado(null), 4000);
    return () => clearTimeout(t);
  }, [destacado, cards]);
  useEffect(() => {
    if (!filtrosProntos) return;
    const qs = paramsFiltro.toString();
    window.history.replaceState(null, "", qs ? `?${qs}` : window.location.pathname);
  }, [filtroResp, filtroCanal, filtroTurma, filtrosProntos]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (filtrosProntos) carregar(); }, [carregar, filtrosProntos]);
  useEffect(() => {
    fetch("/api/hm/tags").then((r) => r.json()).then((d) => {
      if (d.ok) setCoresTags(Object.fromEntries(d.tags.map((t: { nome: string; cor: string | null }) => [t.nome, t.cor])));
    }).catch(() => {});
    fetch("/api/hm/estagios").then((r) => r.json()).then((d) => { if (d.ok) setEstagios(d.estagios); }).catch(() => {});
  }, []);

  // Um único gesto responde por duas coisas: a coluna (para onde) e a ordem
  // vertical (em que lugar da fila). `antesDe` é o card que ficará logo abaixo —
  // null significa "no fim da coluna".
  // Manda o movimento ao servidor e diz o que aconteceu. É o único ponto que
  // conversa com a API de mover — o arrasto e o menu passam os dois por aqui.
  async function patchMover(card: Card, estagioChave: string, antesDe: string | null) {
    try {
      const r = await fetch("/api/hm/kanban", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ compradorId: card.comprador_id, estagioChave, antesDe }),
      });
      // "Ativação Realizada" é a única porta com trava: só entra quem cumpriu o
      // checklist. O servidor devolve o que falta, e o board diz — em vez de o
      // card voltar sozinho sem explicação (o recarregar abaixo desfaz o
      // movimento otimista).
      if (!r.ok) {
        const d = await r.json().catch(() => ({}));
        if (d?.reason === "checklist_incompleto") {
          toast(
            `${card.nome} ainda não pode entrar em "Ativação Realizada" — falta: ${(d.faltando ?? []).join(", ")}. Marque os itens do checklist na ficha do card.`,
            "erro",
          );
        } else if (d?.reason === "saldo_em_aberto") {
          // O sinal não é pagamento realizado: só entra na Ativação quem quitou o
          // saldo. O board desfaz o movimento otimista no carregar abaixo.
          const falta = typeof d.faltam === "number" && d.faltam > 0
            ? ` Faltam ${d.faltam.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })} do saldo.`
            : "";
          toast(
            `${card.nome} ainda não pagou o saldo — o sinal não é pagamento realizado.${falta} Registre o pagamento do saldo (valor cheio) na ficha antes de mover para a Ativação.`,
            "erro",
          );
        } else {
          // 403 de permissão (sem_portal / sem_permissao / atribuicao_travada…):
          // diz o MOTIVO em vez de o card só voltar sozinho.
          const msg = msgErroPermissao(d?.reason);
          if (msg) toast(msg, "erro");
        }
      }
    } finally {
      await carregar();
    }
  }

  // O reembolso é o fato consumado: confirma antes de marcar o aluno na base.
  // O servidor (confirmar_cancelamento) já leva o card para "Reembolsado".
  async function confirmarReembolso(card: Card) {
    const ok = window.confirm(
      `Confirmar o REEMBOLSO de ${card.nome}?\n\n` +
        "Use quando o reembolso já foi executado (na Hotmart ou por fora). " +
        "Marca o aluno como cancelado na base (cadastro e histórico ficam) e avisa no Slack para removerem os acessos.",
    );
    if (!ok) { await carregar(); return; }
    await fetch(`/api/hm/contato/${card.comprador_id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ confirmar_cancelamento: true }),
    });
    await carregar();
  }

  // Mover pelo menu — para QUALQUER etapa, inclusive de outra esteira. O arrasto
  // só alcança as colunas visíveis na aba atual; era por isso que um card na
  // Ativação não conseguia voltar ao Comercial (e vice-versa) sem passar pelo
  // caminho do pagamento. Aqui a esteira inteira está à mão.
  async function moverParaEtapa(card: Card, destino: Estagio) {
    if (card.estagio_chave === destino.chave) return;
    // Cancelar tem duas leituras — pediu ou cancelou —, e a diferença muda o
    // mundo: o definitivo marca o aluno na base e chama quem remove os acessos.
    // Perguntar aqui é o que permite o gesto único sem confundir as duas.
    if (destino.chave === COL_CANCELAMENTO) { setCancelando({ card, antesDe: null }); return; }
    // "Reembolsado" é o fato consumado — confirma e marca o aluno na base.
    if (destino.chave === COL_REEMBOLSADO) { await confirmarReembolso(card); return; }
    const abaDestino = destino.aba ?? "comercial";
    const abaAtual = card.estagio_aba ?? "comercial";
    // Tirar da Ativação um card pago desfaz o pagamento (o servidor limpa a marca).
    if (abaAtual === "ativacao" && abaDestino === "comercial" && destino.chave !== "hm_cancelamento") {
      const ok = window.confirm(
        `${card.nome} já quitou o saldo e está em "${card.estagio_nome ?? "Ativação"}".\n\n` +
          `Movê-lo para "${destino.nome}" desfaz o pagamento e tira o card da esteira de Ativação. Continuar?`,
      );
      if (!ok) return;
    }
    // Entrar na Ativação é dizer "pagou": o servidor marca o pagamento e cria o
    // aluno na base. Melhor avisar do que deixar o operador descobrir depois.
    if (abaAtual === "comercial" && abaDestino === "ativacao" && !card.apto_ativacao) {
      const ok = window.confirm(
        `Mover ${card.nome} para "${destino.nome}" o coloca na esteira de Ativação.\n\n` +
          "Isso marca o saldo como pago e cria o aluno na base THB. Continuar?",
      );
      if (!ok) return;
    }
    await patchMover(card, destino.chave, null);
  }

  // Desfazer o último movimento (o miss-click do arrasto).
  async function desfazerMovimento(card: Card) {
    try {
      const r = await fetch(`/api/hm/contato/${card.comprador_id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reverter: true }),
      });
      const d = await r.json().catch(() => ({}));
      if (!d?.ok) toast(`${card.nome} não tem um movimento anterior para desfazer.`, "erro");
    } finally {
      await carregar();
    }
  }

  async function mover(card: Card, estagioChave: string, antesDe: string | null) {
    const mudouDeColuna = colunaNaAba(card, aba) !== estagioChave;
    // Cair na coluna de cancelamento pede a pergunta (ver moverParaEtapa).
    // Reordenar DENTRO dela, não: quem já está lá já foi perguntado.
    if (mudouDeColuna && estagioChave === COL_CANCELAMENTO) {
      setCancelando({ card, antesDe });
      return;
    }
    // Cair em "Reembolsado" é declarar o FATO: o reembolso foi executado. Isso
    // marca o aluno na base e chama quem remove os acessos — pede confirmação.
    if (mudouDeColuna && estagioChave === COL_REEMBOLSADO) {
      await confirmarReembolso(card);
      return;
    }
    // O espelho é só o registro do pagamento no Comercial: o card mora na
    // Ativação e a ordem dele pertence à fila de lá. Reordenar aqui não teria
    // onde ser gravado — ignora o gesto vertical.
    if (!mudouDeColuna && ehEspelho(card, aba)) return;
    // Arrastar o espelho para outra coluna do Comercial tira o card da Ativação
    // e apaga o pagamento — nunca é o que a pessoa quis fazer sem pensar.
    // Cancelamento é a exceção: lá o pagamento é preservado (o servidor sabe).
    if (mudouDeColuna && ehEspelho(card, aba) && estagioChave !== "hm_cancelamento") {
      const etapa = card.estagio_nome ?? "Ativação";
      const ok = window.confirm(
        `${card.nome} já quitou o saldo e está em "${etapa}" na Ativação.\n\n` +
          "Trazê-lo de volta ao Comercial desfaz o pagamento e tira o card da Ativação. Continuar?",
      );
      if (!ok) return;
    }
    // Otimista; o servidor pode redirecionar o destino (ex.: "Pagamento
    // Realizado" joga o card para a Ativação) — por isso recarrega depois.
    setCards((cs) => reordenarLocal(cs, card, estagioChave, antesDe, aba));
    await patchMover(card, estagioChave, antesDe);
  }

  // Regras da busca livre em lib/busca.ts (acento, telefone por dígitos, nome
  // composto em qualquer ordem) — as MESMAS da tabela.
  const q = busca.trim();
  const cardsFiltrados = q ? cards.filter((c) => casaBusca(q, { texto: [c.nome], numero: [c.telefone] })) : cards;
  // Cancelados (não-master) e cards de colega ficam FORA da seleção em massa:
  // disparo/lote sobre eles é agir num card em que a pessoa não pode agir.
  const cardsSelecionaveis = cardsFiltrados.filter((c) => !cardBloqueado(c) && !cardDeColega(c));
  const colunasAba = colunas.filter((c) => (c.aba ?? "comercial") === aba);
  // O card pago conta nas duas abas (ele aparece nas duas) — por isso o total
  // sai daqui, e não de um count no banco que não conhece o espelho.
  const totalComercial = cards.filter((c) => colunaNaAba(c, "comercial")).length;
  const totalAtivacao = cards.filter((c) => colunaNaAba(c, "ativacao")).length;

  return (
    <div>
      {/* Cabeçalho: identidade e volume — nada de controle aqui. */}
      <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="flex items-center gap-2.5">
            <MarcaPortal portal={portal} altura="h-7" comNome={false} />
            <h1 className="text-xl font-semibold tracking-tight text-slate-900 dark:text-slate-100">Ativação · {nomePortal}</h1>
          </div>
          <p className="mt-0.5 text-sm text-slate-500 dark:text-slate-400">
            {totalComercial + totalAtivacao} lead(s) — arraste os cards entre as etapas e para cima/baixo para ordenar a fila.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {/* Cadastrar à mão — só o master (admin do GP). Card é reflexo da Hotmart;
              colaborador não cria card à mão (30/07). */}
          {ehMaster() && (
            <Button variant="secondary" size="sm" onClick={() => setCadastrando(true)}>+ Cadastrar</Button>
          )}
          {/* A outra leitura da mesma esteira — os filtros viajam na URL */}
          <HmVisao atual="kanban" filtros={{ responsavel: filtroResp, canal: filtroCanal, turma: filtroTurma }} podeConfig={podeConfigEquipes} />
          {/* Relatório da esteira — sai com os filtros que estão valendo. O servidor
              recorta por equipe: só o master baixa a esteira INTEIRA; para os demais
              o rótulo não promete o que o arquivo não traz. */}
          <a
            href={`/api/hm/kanban/export?${paramsFiltro.toString()}`}
            title={podeVerTudo()
              ? "Baixar o relatório da esteira inteira (resumo + uma aba por etapa)"
              : "Baixar o relatório da SUA visão da esteira (o pool + os cards que você vê), resumo + uma aba por etapa"}
          >
            <Button variant="secondary" size="sm">Esteira .xlsx</Button>
          </a>
          {/* O dinheiro é outro relatório: quem deve, quanto entrou e os cancelamentos. */}
          <a
            href={`/api/hm/financeiro/export?${paramsFiltro.toString()}`}
            title={podeVerTudo()
              ? "Baixar o financeiro (resumo, carteira, a receber, razão de pagamentos e cancelamentos)"
              : "Baixar o financeiro da SUA visão da esteira (resumo, carteira, a receber, pagamentos e cancelamentos dos cards que você vê)"}
          >
            <Button variant="secondary" size="sm">Financeiro .xlsx</Button>
          </a>
          {podeDisparar && cardsSelecionaveis.length > 0 && (
            <Button
              variant="secondary"
              size="sm"
              onClick={() => {
                // Cards cancelados ficam FORA do "selecionar todos" para quem
                // não é master — seleção em massa é um caminho indireto de agir
                // sobre um card que a pessoa não pode nem abrir.
                const ids = cardsSelecionaveis.map((c) => c.comprador_id);
                const todos = ids.length > 0 && ids.every((id) => marcados.has(id));
                setMarcados(todos ? new Set() : new Set(ids));
              }}
            >
              {cardsSelecionaveis.every((c) => marcados.has(c.comprador_id))
                ? "Limpar seleção"
                : `Selecionar todos (${cardsSelecionaveis.length})`}
            </Button>
          )}
          {podeDisparar && (
            <Button variant="secondary" size="sm" onClick={() => setShowInteligente(true)} title="Montar a lista sozinho: quem nunca recebeu ou está sem contato há dias (só da sua visão)">
              Disparo inteligente
            </Button>
          )}
        </div>
      </div>

      {/* Barra de controle: abas + filtros na MESMA linha, lado a lado. Antes eles
          empilhavam e empurravam o board para baixo — o kanban é o assunto da
          tela, não os filtros. Em telas estreitas a barra quebra sozinha. */}
      <div className="mb-4 flex flex-wrap items-center gap-2 rounded-xl border border-slate-200 bg-white p-2 dark:border-slate-800 dark:bg-slate-900">
        <div className="inline-flex shrink-0 rounded-lg bg-slate-100 p-0.5 dark:bg-slate-800/80">
          {ABAS.map((a) => {
            const ativa = aba === a.id;
            const total = a.id === "comercial" ? totalComercial : totalAtivacao;
            return (
              <button
                key={a.id}
                onClick={() => setAba(a.id)}
                className={cn(
                  "flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition",
                  ativa
                    ? "bg-white text-slate-900 shadow-card dark:bg-slate-700 dark:text-slate-100"
                    : "text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200",
                )}
              >
                {a.label}
                <span className={cn(
                  "rounded-full px-1.5 py-0.5 text-[11px] font-semibold tabular-nums",
                  ativa ? "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-200" : "bg-slate-200/70 text-slate-500 dark:bg-slate-900 dark:text-slate-400",
                )}>{total}</span>
              </button>
            );
          })}
        </div>

        <span className="mx-1 hidden h-6 w-px bg-slate-200 dark:bg-slate-700 sm:block" />

        <div className="relative min-w-[10rem] flex-1">
          <svg className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8" /><path d="m21 21-4.3-4.3" /></svg>
          <input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar lead…" className={cn(fieldClass, "w-full pl-8")} />
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
        {(filtroResp.length > 0 || filtroCanal.length > 0 || filtroTurma.length > 0 || busca) && (
          <button
            onClick={() => { setFiltroResp([]); setFiltroCanal([]); setFiltroTurma([]); setBusca(""); }}
            className="shrink-0 rounded-md px-2 py-1.5 text-xs font-medium text-slate-500 transition hover:bg-slate-100 hover:text-slate-800 dark:text-slate-400 dark:hover:bg-slate-800"
          >
            Limpar filtros
          </button>
        )}
      </div>

      {/* A régua dos canais que a operação acompanha agora — total de vendas de
          cada um, sempre à vista; clicar soma/tira o canal do filtro (o mesmo
          filtro do dropdown, que continua servindo para o resto). */}
      <HmCanaisFixos
        contagem={canaisQtd}
        ativos={filtroCanal}
        onToggle={(c) => setFiltroCanal((prev) => (prev.includes(c) ? prev.filter((x) => x !== c) : [...prev, c]))}
        produto={produto}
      />

      {/* Recarga falhou COM cards na tela (ex.: logo após mover um card): o
          board pode estar defasado em relação ao banco — avisa em vez de calar. */}
      {erro && cards.length > 0 && (
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-300" role="alert">
          <span>{erro} O board pode estar desatualizado.</span>
          <button onClick={carregar} className="shrink-0 font-medium underline-offset-2 hover:underline">Recarregar</button>
        </div>
      )}

      {carregando && cards.length === 0 ? (
        <div className="flex items-center justify-center gap-3 py-20 text-slate-400 dark:text-slate-500">
          <Spinner className="h-6 w-6" /> <span className="text-sm">Carregando esteira…</span>
        </div>
      ) : erro && cards.length === 0 ? (
        // Falhou e não há NADA na tela: sem isto a esteira parecia vazia de
        // verdade — o operador não sabia se era rede ou se os cards sumiram.
        <EmptyState
          icon={
            <svg className="h-9 w-9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0Z" />
              <path d="M12 9v4M12 17h.01" />
            </svg>
          }
          title="Não foi possível carregar a esteira"
          description={erro}
          action={<Button variant="secondary" onClick={carregar}>Tentar de novo</Button>}
        />
      ) : (
        <div className="-mx-4 overflow-x-auto px-4 pb-4 sm:-mx-6 sm:px-6" onWheel={rolarBoardHorizontal}>
          <Reveal className="flex gap-3">
            {colunasAba.map((col) => {
              const doCol = cardsFiltrados.filter((c) => colunaNaAba(c, aba) === col.chave);
              // Sócios só existem na Ativação; entram na coluna definida pelo status.
              const sociosDaCol = aba === "ativacao"
                ? socios.filter((s) => colunaDoSocio(s) === col.chave
                    && (!q || casaBusca(q, { texto: [s.nome, s.titular_nome] })))
                : [];
              const ativa = alvo?.col === col.chave;
              // Onde a linha de inserção aparece nesta coluna (-1 = em nenhum lugar).
              const marca = ativa ? alvo.indice : -1;
              return (
                <div
                  key={col.chave}
                  className={cn(
                    "js-reveal flex w-72 shrink-0 flex-col rounded-xl border bg-slate-50/60 transition dark:bg-slate-900/40",
                    ativa ? "border-brand/40 bg-brand/5 dark:border-brand-400/40 dark:bg-brand-400/10" : "border-slate-200 dark:border-slate-800",
                  )}
                >
                  <div className="group/col flex items-center gap-2 border-b border-slate-200 px-3 py-2.5 dark:border-slate-800">
                    <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: col.cor }} />
                    <span className="flex-1 truncate text-sm font-semibold text-slate-700 dark:text-slate-200">{col.nome}</span>
                    {/* Relatório só desta etapa — mesmos filtros do board */}
                    <a
                      href={`/api/hm/kanban/export?${paramsFiltro.toString()}${paramsFiltro.toString() ? "&" : ""}estagio=${col.chave}`}
                      title={`Baixar o relatório de "${col.nome}"`}
                      className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-slate-400 opacity-0 transition hover:bg-slate-200 hover:text-slate-700 focus:opacity-100 group-hover/col:opacity-100 dark:hover:bg-slate-800 dark:hover:text-slate-200"
                    >
                      <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 3v12m0 0 4-4m-4 4-4-4M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" /></svg>
                    </a>
                    <span className="rounded-full bg-slate-200 px-2 py-0.5 text-xs font-semibold tabular-nums text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                      {cards.filter((c) => colunaNaAba(c, aba) === col.chave).length
                        + (aba === "ativacao" ? socios.filter((s) => colunaDoSocio(s) === col.chave).length : 0)}
                    </span>
                  </div>
                  <div
                    data-col-scroll
                    onDragOver={(e) => {
                      // Sócio arrastado (0150): só troca de coluna (sem reordenar).
                      // Aceita o drop em qualquer coluna da Ativação e destaca a coluna.
                      if (arrastandoSocio.current) {
                        e.preventDefault();
                        setAlvo((a) => (a?.col === col.chave ? a : { col: col.chave, indice: -1 }));
                        autoScrollColuna(e.currentTarget, e.clientY);
                        return;
                      }
                      const card = arrastando.current;
                      if (!card) return;
                      // Espelho não se reordena na própria coluna (a fila dele é a
                      // da Ativação): sem preventDefault, o drop nem acontece.
                      if (ehEspelho(card, aba) && col.chave === COL_PAGAMENTO) return;
                      e.preventDefault();
                      const indice = indiceSobOCursor(e);
                      setAlvo((a) => (a?.col === col.chave && a.indice === indice ? a : { col: col.chave, indice }));
                      // Rola a coluna quando o cursor encosta na borda — é o que
                      // deixa arrastar até o fim de uma coluna longa.
                      autoScrollColuna(e.currentTarget, e.clientY);
                    }}
                    onDragLeave={(e) => {
                      if (e.currentTarget.contains(e.relatedTarget as Node | null)) return;
                      pararAutoScroll();
                      setAlvo((a) => (a?.col === col.chave ? null : a));
                    }}
                    onDrop={(e) => {
                      e.preventDefault();
                      pararAutoScroll();
                      // Sócio arrastado (0150): fixa a coluna dele e encerra.
                      const socio = arrastandoSocio.current;
                      if (socio) {
                        arrastandoSocio.current = null;
                        setAlvo(null);
                        moverSocio(socio, col.chave);
                        return;
                      }
                      const card = arrastando.current;
                      // Recalcula a posição pelo cursor no momento do drop — com o
                      // auto-scroll, o alvo guardado pode estar defasado.
                      const indice = indiceSobOCursor(e);
                      arrastando.current = null;
                      setAlvo(null);
                      if (!card) return;
                      const atual = doCol.findIndex((c) => c.comprador_id === card.comprador_id);
                      // Soltar logo acima ou logo abaixo de si mesmo é o mesmo lugar.
                      if (atual >= 0 && (indice === atual || indice === atual + 1)) return;
                      const vizinho = doCol[indice] ?? null;
                      mover(card, col.chave, vizinho?.comprador_id ?? null);
                    }}
                    className="flex max-h-[70vh] min-h-[72px] flex-col gap-2 overflow-y-auto p-2"
                  >
                    {doCol.length === 0 && sociosDaCol.length === 0 && marca < 0 ? (
                      <p className="px-2 py-6 text-center text-xs text-slate-400 dark:text-slate-600">Sem cards</p>
                    ) : (
                      doCol.map((card, i) => (
                        <Fragment key={card.comprador_id}>
                          {marca === i && <LinhaDrop />}
                          <CardItem
                            card={card}
                            espelho={ehEspelho(card, aba)}
                            // Para o OPERADOR, o board diz o que é POOL (livre para
                            // assumir) vs. o que já tem dono — master/gestor não
                            // precisam do selo (eles distribuem, não assumem).
                            ehPool={nivel === "operador" && !card.responsavel_id && !card.equipe_id && !card.atribuicao_admin}
                            // Cancelado (Reclamada/Reembolsado) + não-master: o card
                            // fica visível, mas não abre nem arrasta — o backend já
                            // devolve 403; aqui a UI deixa de convidar ao gesto.
                            bloqueado={cardBloqueado(card)}
                            // Card de colega: abre em LEITURA (contexto, não erro) —
                            // sem arrasto e sem lote; o selo diz de quem ele é.
                            colega={cardDeColega(card)}
                            onDragStart={() => { arrastando.current = card; }}
                            onDragEnd={() => { pararAutoScroll(); arrastando.current = null; setAlvo(null); }}
                            destacado={destacado === card.comprador_id}
                            onAbrir={() => { if (!cardBloqueado(card)) setSelecionado(card.comprador_id); }}
                            onMenu={(x, y) => setMenu({ card, x, y })}
                            selecionavel={podeDisparar && !cardBloqueado(card) && !cardDeColega(card)}
                            marcado={marcados.has(card.comprador_id)}
                            onToggleMarcado={() => toggleMarcado(card.comprador_id)}
                            coresTags={coresTags}
                          />
                        </Fragment>
                      ))
                    )}
                    {marca === doCol.length && <LinhaDrop />}
                    {/* Sócios convidados — cards azuis, fora da máquina financeira.
                        O Thomas libera os 3 acessos aqui; a Ana toca depois. */}
                    {sociosDaCol.map((s) => (
                      <SocioCard
                        key={s.socio_id}
                        socio={s}
                        onAbrir={() => setSocioAberto(s)}
                        onToggle={(campo) => toggleSocioCheck(s, campo)}
                        onEnviarBase={() => enviarSocioParaBase(s)}
                        enviandoBase={enviandoBase.has(s.socio_id)}
                        // Arrastar (0150): titular cancelado fica preso (é a fila de
                        // remoção); o resto pode ser movido entre as colunas.
                        arrastavel={!s.titular_cancelado}
                        onDragStart={() => { arrastandoSocio.current = s; }}
                        onDragEnd={() => { pararAutoScroll(); arrastandoSocio.current = null; setAlvo(null); }}
                      />
                    ))}
                  </div>
                </div>
              );
            })}
          </Reveal>
        </div>
      )}

      {/* Menu do card (botão direito). O arrasto só alcança as colunas da aba
          aberta — aqui a esteira inteira está disponível, nos dois sentidos, mais
          o desfazer do último movimento. */}
      {menu && (
        <>
          <div className="fixed inset-0 z-[55]" onClick={() => setMenu(null)} onContextMenu={(e) => { e.preventDefault(); setMenu(null); }} />
          <div
            className="fixed z-[60] max-h-[70vh] w-60 overflow-y-auto rounded-lg border border-slate-200 bg-white py-1 shadow-pop dark:border-slate-700 dark:bg-slate-900"
            style={{
              top: Math.min(menu.y, (typeof window !== "undefined" ? window.innerHeight : 800) - 380),
              left: Math.min(menu.x, (typeof window !== "undefined" ? window.innerWidth : 1200) - 260),
            }}
          >
            <p className="truncate px-3 py-1.5 text-xs font-semibold text-slate-500 dark:text-slate-400">{menu.card.nome}</p>
            {/* Card cancelado (não-master): ficha e sócios são as rotas que o
                backend fecha com 403 — o menu não oferece a porta trancada. */}
            {cardBloqueado(menu.card) && (
              <p className="px-3 pb-1.5 text-[11px] text-rose-600 dark:text-rose-400">{TITLE_CARD_CANCELADO}</p>
            )}
            {/* Card de colega: a ficha abre (em leitura); mover, sócio e desfazer
                são ações — a API recusaria com 403, o menu não oferece. */}
            {cardDeColega(menu.card) && (
              <p className="px-3 pb-1.5 text-[11px] text-slate-500 dark:text-slate-400">
                Card de {menu.card.responsavel ?? "outro operador"} — abre em leitura.
              </p>
            )}
            <MenuItem disabled={cardBloqueado(menu.card)} onClick={() => { setSelecionado(menu.card.comprador_id); setMenu(null); }}>Abrir ficha</MenuItem>
            <MenuItem disabled={cardBloqueado(menu.card) || cardDeColega(menu.card)} onClick={() => { const c = menu.card; setMenu(null); setAddSocio({ compradorId: c.comprador_id, nome: c.nome }); }}>+ Adicionar sócio</MenuItem>
            <MenuItem disabled={cardDeColega(menu.card)} onClick={() => { const c = menu.card; setMenu(null); desfazerMovimento(c); }}>Desfazer último movimento</MenuItem>

            {ABAS.map((a) => {
              const doGrupo = estagios.filter((e) => (e.aba ?? "comercial") === a.id);
              if (doGrupo.length === 0) return null;
              return (
                <div key={a.id}>
                  <div className="mt-1 border-t border-slate-100 px-3 pb-1 pt-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-400 dark:border-slate-800 dark:text-slate-500">
                    Mover para · {a.label}
                  </div>
                  {doGrupo.map((e) => {
                    const atual = e.chave === menu.card.estagio_chave;
                    return (
                      <MenuItem
                        key={e.chave}
                        disabled={atual || cardDeColega(menu.card)}
                        onClick={() => { const c = menu.card; setMenu(null); moverParaEtapa(c, e); }}
                      >
                        <span className="flex items-center justify-between gap-2">
                          <span className="truncate">{e.nome}</span>
                          {atual && <span className="shrink-0 text-[10px] font-semibold uppercase text-brand">aqui</span>}
                        </span>
                      </MenuItem>
                    );
                  })}
                </div>
              );
            })}
          </div>
        </>
      )}

      {/* Barra de ação — disparo em lote dos cards marcados (só quem pode disparar) */}
      {podeDisparar && marcados.size > 0 && (
        <div className="fixed inset-x-0 bottom-4 z-40 flex justify-center px-4">
          <div className="flex items-center gap-3 rounded-full border border-slate-200 bg-white/95 px-4 py-2 shadow-pop backdrop-blur dark:border-slate-700 dark:bg-slate-900/95">
            <span className="text-sm font-medium text-slate-700 dark:text-slate-200">
              {marcados.size} selecionado{marcados.size > 1 ? "s" : ""}
            </span>
            <Button variant="secondary" size="sm" onClick={() => setMarcados(new Set())}>Limpar</Button>
            <Button variant="primary" size="sm" onClick={() => setDispararLote(true)}>Disparar</Button>
          </div>
        </div>
      )}

      {dispararLote && (
        <DisparoModal
          selecao={cards
            .filter((c) => marcados.has(c.comprador_id))
            .map((c) => ({ comprador_id: c.comprador_id, nome: c.nome, telefone: c.telefone ?? "", edicao: null }))}
          onClose={() => { setDispararLote(false); setMarcados(new Set()); carregar(); }}
        />
      )}

      {/* Disparo inteligente: monta a lista pela API /elegiveis (recortada por
          equipe no backend) e abre o mesmo DisparoModal com ela. */}
      {showInteligente && (
        <DisparoInteligente
          onClose={() => setShowInteligente(false)}
          onDisparar={(sel) => { setShowInteligente(false); if (sel.length) setDispararSelecao(sel); }}
        />
      )}
      {dispararSelecao && (
        <DisparoModal
          selecao={dispararSelecao}
          onClose={() => { setDispararSelecao(null); carregar(); }}
        />
      )}

      {cancelando && (
        <CancelamentoModal
          nome={cancelando.card.nome}
          onFechar={() => { setCancelando(null); carregar(); }}
          onEscolher={async (definitivo, motivo) => {
            const { card, antesDe } = cancelando;
            setCancelando(null);
            if (definitivo) {
              // O FATO: confirmar_cancelamento já leva o card para "Reembolsado"
              // e marca o aluno na base — não passa por "Reclamada".
              await fetch(`/api/hm/contato/${card.comprador_id}`, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ confirmar_cancelamento: true, cancelamento_motivo: motivo || null }),
              });
            } else {
              // O PEDIDO: só move para "Reclamada". O acesso continua valendo.
              await patchMover(card, COL_CANCELAMENTO, antesDe);
              if (motivo) {
                await fetch(`/api/hm/contato/${card.comprador_id}`, {
                  method: "PATCH",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ cancelamento_motivo: motivo }),
                });
              }
            }
            await carregar();
          }}
        />
      )}

      {selecionado && (
        <HmDrawer
          compradorId={selecionado}
          estagios={estagios}
          responsaveis={responsaveis}
          onClose={() => setSelecionado(null)}
          onChanged={carregar}
        />
      )}

      {socioAberto && (
        <HmSocioDrawer
          socio={socioAberto}
          onClose={() => setSocioAberto(null)}
          onChanged={carregar}
        />
      )}

      {addSocio && (
        <AddSocioModal
          compradorId={addSocio.compradorId}
          titularNome={addSocio.nome}
          onClose={() => setAddSocio(null)}
          onSalvo={() => { setAddSocio(null); carregar(); }}
        />
      )}

      {cadastrando && (
        <HmCadastroModal
          produto={produto}
          onClose={() => setCadastrando(false)}
          onCadastrado={async (compradorId) => {
            setCadastrando(false);
            await carregar();
            // Abre a ficha do recém-cadastrado: quase sempre falta completar algo
            // (o crédito pró-rata, o telefone) e a ficha é onde isso se faz.
            setSelecionado(compradorId);
          }}
        />
      )}
    </div>
  );
}

// Pediu ou cancelou? A pergunta que separa a intenção do fato.
//
// Enquanto é PEDIDO, o aluno continua aluno: reembolso pode ser negado pela
// Hotmart (fora dos 7 dias) e gente desiste de cancelar. Já o DEFINITIVO marca o
// aluno na base — ele some das telas do GPS, mantendo cadastro e histórico — e
// chama, no Slack, quem tem de remover os acessos.
//
// Quando o cancelamento vem pela Hotmart, nada disto aparece: o webhook faz o
// caminho inteiro sozinho. Esta tela é para o cancelamento fechado por fora
// (acordo, Pix devolvido) — e o aviso ao Thomas sai UMA vez só, venha de onde vier.
// O card do SÓCIO — azul sutil, para distinguir de longe do aluno titular. Ele
// não é um card financeiro: não arrasta, não abre ficha de cobrança, não entra
// em lente nenhuma. Só os 3 acessos e o status. Quando o titular cancela, o
// acesso do sócio cai junto (cascata) e o card pede a remoção.
function SocioCard({ socio: s, onAbrir, onToggle, onEnviarBase, enviandoBase, arrastavel, onDragStart, onDragEnd }: {
  socio: Socio;
  onAbrir: () => void;
  onToggle: (campo: "ativ_searchie" | "ativ_comunidade" | "ativ_grupo") => void;
  onEnviarBase: () => void;
  enviandoBase: boolean;
  arrastavel?: boolean;
  onDragStart?: () => void;
  onDragEnd?: () => void;
}) {
  const wa = waLink(s.telefone);
  const semAcesso = s.status === "sem_acesso";
  const base = estadoNaBase(s);
  const baseBadge = base === "na_base"
    ? { txt: "Na base THB", cls: "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300", title: "O sócio já tem cadastro na base mestre (o GPS o enxerga)." }
    : base === "fora_da_base"
      ? { txt: "Fora da base — provisionar", cls: "bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300", title: "O titular já é aluno, mas este sócio ainda não foi enviado à base THB. O GPS não o enxerga." }
      : { txt: "Aguarda o titular pagar", cls: "bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400", title: "O sócio entra na base quando o titular quitar (mesma turma e validade)." };
  const checks: { campo: "ativ_searchie" | "ativ_comunidade" | "ativ_grupo"; label: string; on: boolean }[] = [
    { campo: "ativ_searchie", label: "Searchie", on: s.ativ_searchie },
    { campo: "ativ_comunidade", label: "Comunidade", on: s.ativ_comunidade },
    { campo: "ativ_grupo", label: "Grupo", on: s.ativ_grupo },
  ];
  const badge = semAcesso
    ? { txt: "Sem acesso — remover", cls: "bg-rose-100 text-rose-700 dark:bg-rose-500/15 dark:text-rose-300" }
    : s.status === "ativado"
      ? { txt: "Ativado", cls: "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300" }
      : s.status === "em_ativacao"
        ? { txt: "Em ativação", cls: "bg-sky-100 text-sky-700 dark:bg-sky-500/15 dark:text-sky-300" }
        : { txt: "Não iniciado", cls: "bg-slate-200 text-slate-600 dark:bg-slate-700 dark:text-slate-300" };

  return (
    <div
      data-socio
      draggable={arrastavel}
      onDragStart={arrastavel ? onDragStart : undefined}
      onDragEnd={arrastavel ? onDragEnd : undefined}
      onClick={onAbrir}
      title={arrastavel ? "Arraste para outra coluna, ou clique para abrir a ficha do sócio" : "Abrir a ficha do sócio"}
      className={cn(
        "relative block cursor-pointer rounded-lg border p-2.5 shadow-card transition hover:shadow-pop",
        arrastavel && "cursor-grab active:cursor-grabbing",
        semAcesso
          ? "border-rose-200 bg-rose-50/50 dark:border-rose-500/25 dark:bg-rose-500/5"
          : "border-sky-200 bg-sky-50/60 dark:border-sky-500/25 dark:bg-sky-500/5",
      )}
    >
      <div className="flex items-center gap-1.5">
        <span className="inline-flex items-center gap-0.5 rounded bg-sky-500/15 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-sky-700 dark:text-sky-300">
          <svg className="h-2.5 w-2.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm13 10v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" /></svg>
          Sócio
        </span>
        <span className={cn("ml-auto inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-semibold", badge.cls)}>{badge.txt}</span>
      </div>

      <p className="mt-1.5 truncate text-sm font-semibold text-slate-800 dark:text-slate-100" title={s.nome}>{s.nome}</p>
      {/* Indicador visível de vínculo: "sócio de [titular]" — badge de acesso rápido */}
      <div className="mt-1 flex max-w-full items-center gap-1 rounded-md border border-slate-200 bg-slate-100 px-1.5 py-0.5 dark:border-slate-700 dark:bg-slate-800/80" title={`Sócio de ${s.titular_nome}`}>
        <svg className="h-3 w-3 shrink-0 text-slate-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 17H7A5 5 0 0 1 7 7h2m6 0h2a5 5 0 0 1 0 10h-2m-7-5h8" /></svg>
        <span className="truncate text-[11px] text-slate-600 dark:text-slate-300">sócio de <span className="font-semibold text-slate-800 dark:text-slate-100">{s.titular_nome}</span></span>
      </div>

      {/* "Certinho na base": diz se o GPS já enxerga o sócio. Fora da base com o
          titular pagante é o gargalo — vira botão para enviar à base num clique. */}
      {base === "fora_da_base" ? (
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); onEnviarBase(); }}
          disabled={enviandoBase}
          title="O titular já é aluno, mas este sócio ainda não está na base THB. Clique para enviá-lo (mesma turma e validade do titular)."
          className={cn("mt-1.5 inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-medium transition", baseBadge.cls, "hover:brightness-95 disabled:opacity-60")}
        >
          <svg className="h-2.5 w-2.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M12 9v4m0 4h.01M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0Z" /></svg>
          {enviandoBase ? "Enviando…" : "Enviar à base THB"}
        </button>
      ) : (
        <span className={cn("mt-1.5 inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-medium", baseBadge.cls)} title={baseBadge.title}>
          {baseBadge.txt}
        </span>
      )}

      {semAcesso && (
        <p className="mt-1.5 rounded bg-rose-100 px-2 py-1 text-[10px] font-medium text-rose-700 dark:bg-rose-500/15 dark:text-rose-300">
          O titular cancelou — o acesso do sócio deve ser removido.
        </p>
      )}

      {/* Os 3 acessos: o Thomas clica conforme libera. */}
      <div className="mt-2 flex flex-wrap gap-1">
        {checks.map((c) => (
          <button
            key={c.campo}
            type="button"
            onClick={(e) => { e.stopPropagation(); onToggle(c.campo); }}
            title={c.on ? `${c.label} liberado — clique para desmarcar` : `Marcar ${c.label} como liberado`}
            className={cn(
              "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-medium transition",
              c.on
                ? "border-emerald-300 bg-emerald-100 text-emerald-700 dark:border-emerald-500/40 dark:bg-emerald-500/15 dark:text-emerald-300"
                : "border-slate-300 bg-white text-slate-500 hover:border-sky-300 hover:text-sky-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-400",
            )}
          >
            {c.on && <svg className="h-2.5 w-2.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5" /></svg>}
            {c.label}
          </button>
        ))}
      </div>

      {(s.telefone || s.email) && (
        <div className="mt-1.5 space-y-0.5 text-[11px] text-slate-500 dark:text-slate-400">
          {wa ? (
            <a href={wa} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()} className="block hover:text-emerald-600" title="WhatsApp">{s.telefone}</a>
          ) : s.telefone ? <span className="block">{s.telefone}</span> : null}
          {/* E-mail em linha própria e com quebra (break-all) — não corta mais */}
          {s.email && <span className="block break-all" title={s.email}>{s.email}</span>}
        </div>
      )}
      {/* Deixa explícito que o card abre a ficha */}
      <p className="mt-1.5 text-right text-[10px] font-medium text-sky-600 dark:text-sky-400">abrir ficha →</p>
    </div>
  );
}

// Atalho do kanban: convidar o 1º sócio de um titular sem abrir a ficha inteira.
// O vínculo ao titular é automático (a rota grava com o contato_hm_id dele) e, se
// o titular já for aluno, o sócio já vai para a base THB.
function AddSocioModal({ compradorId, titularNome, onClose, onSalvo }: {
  compradorId: string; titularNome: string; onClose: () => void; onSalvo: () => void;
}) {
  const [f, setF] = useState({ nome: "", email: "", telefone: "" });
  const [salvando, setSalvando] = useState(false);
  async function salvar() {
    setSalvando(true);
    try {
      await fetch(`/api/hm/contato/${compradorId}/socios`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ nome: f.nome.trim(), email: f.email.trim() || null, telefone: f.telefone.trim() || null }),
      });
      onSalvo();
    } finally { setSalvando(false); }
  }
  return (
    <>
      <div className="fixed inset-0 z-40 bg-slate-900/40 backdrop-blur-sm" onClick={onClose} />
      <div className="fixed left-1/2 top-1/2 z-50 w-full max-w-sm -translate-x-1/2 -translate-y-1/2 rounded-xl border border-slate-200 bg-white p-5 shadow-pop dark:border-slate-800 dark:bg-slate-900">
        <h2 className="text-base font-semibold text-slate-800 dark:text-slate-100">Adicionar sócio</h2>
        <p className="mt-0.5 text-sm text-slate-500 dark:text-slate-400">Vincula automaticamente a <span className="font-medium">{titularNome}</span>.</p>
        <div className="mt-3 space-y-2">
          <input autoFocus value={f.nome} onChange={(e) => setF({ ...f, nome: e.target.value })} placeholder="Nome do sócio" className={cn(fieldClass, "w-full")} />
          <input value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} placeholder="E-mail" className={cn(fieldClass, "w-full")} />
          <input value={f.telefone} onChange={(e) => setF({ ...f, telefone: e.target.value })} placeholder="Telefone" className={cn(fieldClass, "w-full")} />
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="ghost" size="sm" onClick={onClose}>Cancelar</Button>
          <Button variant="primary" size="sm" disabled={salvando || f.nome.trim().length < 2} onClick={salvar}>
            {salvando ? "Salvando…" : "Adicionar"}
          </Button>
        </div>
      </div>
    </>
  );
}

function CancelamentoModal({ nome, onEscolher, onFechar }: {
  nome: string;
  onEscolher: (definitivo: boolean, motivo: string) => Promise<void>;
  onFechar: () => void;
}) {
  const [motivo, setMotivo] = useState("");
  const [salvando, setSalvando] = useState(false);

  async function escolher(definitivo: boolean) {
    setSalvando(true);
    try { await onEscolher(definitivo, motivo.trim()); } finally { setSalvando(false); }
  }

  return (
    <>
      <div className="fixed inset-0 z-40 bg-slate-900/40 backdrop-blur-sm" onClick={onFechar} />
      <div className="fixed left-1/2 top-1/2 z-50 w-full max-w-md -translate-x-1/2 -translate-y-1/2 rounded-xl border border-slate-200 bg-white p-5 shadow-pop dark:border-slate-800 dark:bg-slate-900">
        <h2 className="text-base font-semibold text-slate-800 dark:text-slate-100">
          Cancelamento de {nome}
        </h2>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
          O cancelamento já é definitivo, ou a pessoa só pediu?
        </p>

        <label className="mt-3 block text-[11px] font-medium text-slate-500 dark:text-slate-400">
          Motivo (por que está saindo?)
          <textarea
            value={motivo}
            onChange={(e) => setMotivo(e.target.value)}
            rows={2}
            placeholder="Ex.: pediu reembolso na semana de arrependimento"
            className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 outline-none focus:border-brand focus:ring-2 focus:ring-brand/20 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-200"
          />
        </label>

        <div className="mt-4 space-y-2">
          <button
            onClick={() => escolher(false)}
            disabled={salvando}
            className="w-full rounded-lg border border-amber-300 px-3 py-2 text-left text-sm hover:bg-amber-50 disabled:opacity-50 dark:border-amber-500/40 dark:hover:bg-amber-500/10"
          >
            <span className="font-medium text-amber-700 dark:text-amber-300">Só solicitou</span>
            <span className="block text-[11px] text-slate-500 dark:text-slate-400">
              O card sai da esteira, mas o acesso continua valendo. Nada muda na base — dá para voltar atrás.
            </span>
          </button>

          <button
            onClick={() => escolher(true)}
            disabled={salvando}
            className="w-full rounded-lg border border-rose-300 px-3 py-2 text-left text-sm hover:bg-rose-50 disabled:opacity-50 dark:border-rose-500/40 dark:hover:bg-rose-500/10"
          >
            <span className="font-medium text-rose-700 dark:text-rose-300">Reembolso confirmado</span>
            <span className="block text-[11px] text-slate-500 dark:text-slate-400">
              Vai para <strong>Reembolsado</strong>. Marca o aluno como cancelado (o cadastro e o histórico ficam) e avisa no Slack para removerem os acessos.
            </span>
          </button>
        </div>

        <button
          onClick={onFechar}
          disabled={salvando}
          className="mt-3 w-full rounded-lg px-3 py-1.5 text-sm text-slate-500 hover:bg-slate-100 disabled:opacity-50 dark:text-slate-400 dark:hover:bg-slate-800"
        >
          Não mover o card
        </button>
      </div>
    </>
  );
}

// Linha que mostra em que ponto da fila o card vai cair.
function LinhaDrop() {
  return <div aria-hidden className="h-0.5 shrink-0 rounded-full bg-brand dark:bg-brand-400" />;
}

function MenuItem({ children, onClick, disabled }: { children: React.ReactNode; onClick: () => void; disabled?: boolean }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "block w-full px-3 py-1.5 text-left text-sm transition",
        disabled
          ? "cursor-default text-slate-400 dark:text-slate-600"
          : "text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-800",
      )}
    >
      {children}
    </button>
  );
}

// Selos informativos do card, colapsados num "+N" discreto. Regra do corte:
// fica SEMPRE visível o que muda a ação do operador (cadeado de cancelado,
// pool, conferir saldo, equipe); colapsa o que é só contexto (categoria de
// entrada, parcela/pago, recompra — que já tem a borda superior vermelha como
// sinal permanente). Acessível: o aria-label do botão lista todos os selos
// (o leitor de tela ouve tudo sem abrir); Enter/Espaço abrem, Esc fecha, e o
// foco do teclado também revela o popover.
function SelosExtras({ itens }: { itens: { key: string; rotulo: string; el: React.ReactNode }[] }) {
  const [aberto, setAberto] = useState(false);
  if (itens.length === 0) return null;
  return (
    <span
      className="relative inline-flex"
      onMouseEnter={() => setAberto(true)}
      onMouseLeave={() => setAberto(false)}
    >
      <button
        type="button"
        aria-expanded={aberto}
        aria-label={`Mais ${itens.length} selo(s): ${itens.map((i) => i.rotulo).join("; ")}`}
        onClick={(e) => { e.stopPropagation(); setAberto((v) => !v); }}
        // stopPropagation sempre: Enter aqui não pode abrir a ficha (o card
        // inteiro é role=button e escuta Enter).
        onKeyDown={(e) => { e.stopPropagation(); if (e.key === "Escape") setAberto(false); }}
        onFocus={() => setAberto(true)}
        onBlur={() => setAberto(false)}
        className="inline-flex items-center rounded border border-slate-200 bg-slate-50 px-1.5 py-0.5 text-[10px] font-semibold tabular-nums text-slate-500 transition hover:border-slate-300 hover:text-slate-700 focus:outline-none focus:ring-2 focus:ring-brand/40 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-400 dark:hover:border-slate-500 dark:hover:text-slate-200"
      >
        +{itens.length}
      </button>
      {aberto && (
        <span className="absolute left-0 top-full z-30 mt-1 flex w-max max-w-[15rem] flex-wrap gap-1 rounded-lg border border-slate-200 bg-white p-1.5 shadow-pop dark:border-slate-700 dark:bg-slate-900">
          {itens.map((i) => <Fragment key={i.key}>{i.el}</Fragment>)}
        </span>
      )}
    </span>
  );
}

function CardItem({
  card, espelho, ehPool, bloqueado, colega, onDragStart, onDragEnd, onAbrir, onMenu, selecionavel, marcado, onToggleMarcado, coresTags, destacado,
}: {
  card: Card; espelho: boolean; ehPool?: boolean; bloqueado?: boolean; colega?: boolean; onDragStart: () => void; onDragEnd: () => void; onAbrir: () => void;
  onMenu: (x: number, y: number) => void;
  selecionavel: boolean; marcado: boolean; onToggleMarcado: () => void;
  coresTags: Record<string, string | null>;
  /** Alvo do deep-link ?card= (0164): pulsa por alguns segundos para o olho achar. */
  destacado?: boolean;
}) {
  const cat = catLabel(card.categoria_entrada);
  const parcela = parcelaStatus(card);
  // Verde é "não deve mais nada". Quem está em conferência não entra: ali o zero é
  // aritmética, não quitação — e um verde errado faz o time parar de cobrar.
  const verde = card.quitado && !card.conferir_saldo;
  const wa = waLink(card.telefone);
  // Recompra (27/07, "por ora"): já era aluno antes de comprar — tag "Origem Txx"
  // ou "Aluno THB"/"Aluno Aurum" (nunca "Turma T39", que todo mundo ganha).
  const recompra = origemRecompra(card.tags);
  // O card tem equipe? A borda esquerda é DELA (modelo de acesso, mais importante
  // que qualquer outro sinal). `equipe_cor` nula NÃO apaga a faixa: cai no cinza
  // padrão — antes o card de uma equipe sem cor parecia do pool sem ser.
  const temEquipe = !!(card.equipe_id || card.equipe_nome);
  const poolSemDono = !temEquipe && !card.responsavel_id;
  // Data relevante à etapa: reunião (Comercial) ou entrevista (Ativação).
  const dataEtapa = card.estagio_chave === "hm_reuniao_agendada" ? { label: "Reunião", quando: card.reuniao_em }
    : card.estagio_chave === "hm_entrevista_agendada" ? { label: "Entrevista", quando: card.entrevista_em }
    : null;
  // Selos SÓ informativos → colapsam no "+N" (ver SelosExtras). Recompra segue
  // sinalizada pela borda superior vermelha mesmo com o selo colapsado.
  const extras: { key: string; rotulo: string; el: React.ReactNode }[] = [];
  if (recompra) extras.push({ key: "recompra", rotulo: `Recompra (${recompra})`, el: <SeloRecompra origem={recompra} /> });
  if (cat) extras.push({
    key: "cat", rotulo: `Entrada: ${cat.txt}`,
    el: <span className={cn("inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-semibold", cat.cls)}>{cat.txt}</span>,
  });
  if (parcela) extras.push({
    key: "parcela", rotulo: parcela.txt,
    el: (
      <span className={cn("inline-flex items-center gap-0.5 rounded px-1.5 py-0.5 text-[10px] font-semibold", parcela.cls)} title={parcela.title}>
        {parcela.txt === "Parcela atrasada"
          ? <svg className="h-2.5 w-2.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M12 8v4m0 4h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z" /></svg>
          : <svg className="h-2.5 w-2.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2v4m0 12v4m10-10h-4M6 12H2" /></svg>}
        {parcela.txt}
      </span>
    ),
  });
  else if (card.apto_ativacao) extras.push({
    key: "pago", rotulo: "Saldo pago",
    el: (
      <span className="inline-flex items-center gap-0.5 rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold text-amber-800 dark:bg-amber-500/15 dark:text-amber-300" title="Pagamento do saldo confirmado">
        <svg className="h-2.5 w-2.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5" /></svg>
        pago
      </span>
    ),
  });
  return (
    <div
      // O id no atributo (0164) é o que o deep-link ?card= usa para achar e rolar
      // até este card. Continua servindo ao querySelectorAll do arrasto.
      data-card={card.comprador_id}
      role={bloqueado ? undefined : "button"}
      tabIndex={bloqueado ? -1 : 0}
      // Card de colega abre (em leitura), mas não arrasta — mover é agir.
      draggable={!bloqueado && !colega}
      onDragStart={bloqueado || colega ? undefined : onDragStart}
      onDragEnd={onDragEnd}
      onClick={bloqueado ? undefined : onAbrir}
      onContextMenu={(e) => { e.preventDefault(); onMenu(e.clientX, e.clientY); }}
      onKeyDown={(e) => { if (e.key === "Enter" && !bloqueado) onAbrir(); }}
      title={bloqueado
        ? TITLE_CARD_CANCELADO
        : colega
          ? `Card de ${card.responsavel ?? "outro operador"} — clique para abrir em leitura`
          : "Clique para abrir · botão direito para mover ou desfazer"}
      // Portadores de cor por INLINE STYLE (vencem qualquer classe):
      //   • borda ESQUERDA = cor da equipe dona (0140). Cor nula cai no cinza
      //     padrão; pool de verdade (sem equipe e sem dono) ganha a MESMA faixa
      //     tracejada — "livre" é um estado, não um defeito de renderização.
      //   • borda SUPERIOR = recompra (vermelho). É o único portador livre do
      //     card: a esquerda é da equipe, o fundo é do quitado, a borda/anel são
      //     da seleção e os badges já disputam a primeira linha. O rose-500 lê
      //     bem sobre branco e sobre slate-900.
      style={{
        ...(temEquipe
          ? { borderLeftColor: card.equipe_cor || COR_EQUIPE_PADRAO, borderLeftWidth: 3 }
          : poolSemDono
            ? { borderLeft: "3px dashed rgba(148, 163, 184, 0.7)" }
            : {}),
        ...(recompra ? { borderTopColor: "#f43f5e", borderTopWidth: 3 } : {}),
      }}
      className={cn(
        "group relative block rounded-lg border p-2.5 shadow-card transition",
        bloqueado
          ? "cursor-not-allowed"
          : "cursor-pointer hover:border-brand/30 hover:shadow-soft active:cursor-grabbing",
        // Alvo do deep-link (0164): anel índigo pulsante — mesma cor do selo que
        // trouxe o operador até aqui, para ele reconhecer o que clicou.
        destacado && "animate-pulse ring-2 ring-indigo-400 ring-offset-2 dark:ring-indigo-400 dark:ring-offset-slate-950",
        // Saldo quitado: um verde sutil, só o suficiente para diferenciar de longe
        // quem não deve mais nada. Não vale quando o card está selecionado (a borda
        // da marca vence) nem sobrescreve o anel de seleção.
        // `conferir_saldo` TIRA o verde: nesses o saldo zerou por dupla contagem do
        // crédito (0112), não por quitação — pintar de verde seria o board mentindo.
        verde
          ? "bg-emerald-50/50 dark:bg-emerald-500/5"
          : "bg-white dark:bg-slate-900",
        marcado
          ? "border-brand ring-1 ring-brand dark:border-brand-400 dark:ring-brand-400"
          : verde
            ? "border-emerald-200 dark:border-emerald-500/25"
            : card.conferir_saldo
              ? "border-amber-300 dark:border-amber-500/40"
              : "border-slate-200 dark:border-slate-800",
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex flex-wrap items-center gap-1">
          {selecionavel && (
            <input
              type="checkbox"
              checked={marcado}
              onClick={(e) => e.stopPropagation()}
              onChange={onToggleMarcado}
              title="Selecionar para disparo"
              className="mr-1 h-4 w-4 rounded border-slate-300 text-brand focus:ring-brand dark:border-slate-600"
            />
          )}
          {/* Card cancelado bloqueado: o cadeado diz POR QUE o clique não abre.
              Rose (e não âmbar, que é a trava de atribuição do admin). */}
          {bloqueado && (
            <span
              className="inline-flex items-center gap-0.5 rounded bg-rose-100 px-1.5 py-0.5 text-[10px] font-semibold text-rose-700 dark:bg-rose-500/15 dark:text-rose-300"
              title={TITLE_CARD_CANCELADO}
            >
              <svg className="h-2.5 w-2.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" /></svg>
              só admin GP
            </span>
          )}
          {/* Selo do pool (só na visão do operador): este card está livre —
              abra a ficha e clique em "Atribuir a mim". */}
          {ehPool && (
            <span
              className="inline-flex items-center gap-0.5 rounded border border-dashed border-teal-400 px-1.5 py-0.5 text-[10px] font-semibold text-teal-700 dark:border-teal-500/50 dark:text-teal-300"
              title="Card do pool — sem dono. Abra a ficha e clique em “Atribuir a mim” para assumir."
            >
              <svg className="h-2.5 w-2.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M19 8v6M22 11h-6" /></svg>
              Pool · livre
            </span>
          )}
          {/* Card de colega (visão do operador): contexto, não bloqueio — slate
              discreto, com o NOME do dono. Abre em leitura; não arrasta. */}
          {colega && (
            <span
              className="inline-flex max-w-[10rem] items-center gap-0.5 truncate rounded border border-slate-300 bg-slate-50 px-1.5 py-0.5 text-[10px] font-semibold text-slate-500 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-400"
              title={`Card de ${card.responsavel ?? "outro operador"} — você pode ver a ficha e o histórico, mas quem age é o dono ou o gestor.`}
            >
              <svg className="h-2.5 w-2.5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z" /><circle cx="12" cy="12" r="3" /></svg>
              <span className="truncate">com {card.responsavel ?? "colega"}</span>
            </span>
          )}
          {/* Falso-verde do crédito pró-rata: avisa em vez de deixar o card mentir. */}
          {card.conferir_saldo && (
            <span
              className="inline-flex items-center gap-0.5 rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold text-amber-800 dark:bg-amber-500/15 dark:text-amber-300"
              title="Saldo zerado por dupla contagem do crédito pró-rata — não é quitação. O comercial precisa decidir quanto cobrar antes de dar como pago."
            >
              <svg className="h-2.5 w-2.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M12 8v4m0 4h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z" /></svg>
              conferir saldo
            </span>
          )}
          {/* A MESMA pessoa em outro board (0164). O operador do Aurum precisa saber
              que ela já está em "Acesso Liberado" no HM antes de abordar como contato
              novo — e vice-versa. Indigo para não competir com os alertas (âmbar). */}
          {card.outros_portais && (
            // Clicar no selo LEVA ao card da mesma pessoa no outro board — que rola
            // até ele e o destaca (0164). `stopPropagation` porque o card inteiro é
            // clicável: sem isso o drawer deste card abriria por baixo da navegação.
            <Link
              href={`/${(card.outros_portais.split(":")[0] || "hm").trim().toLowerCase()}/kanban?card=${card.comprador_id}`}
              onClick={(e) => e.stopPropagation()}
              className="inline-flex items-center gap-0.5 rounded bg-indigo-100 px-1.5 py-0.5 text-[10px] font-semibold text-indigo-700 transition hover:bg-indigo-200 dark:bg-indigo-500/15 dark:text-indigo-300 dark:hover:bg-indigo-500/25"
              title={`Abrir esta pessoa no outro board — ${card.outros_portais}`}
            >
              <svg className="h-2.5 w-2.5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.5 1.5" /><path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7L12 19" /></svg>
              <span className="truncate">{card.outros_portais}</span>
            </Link>
          )}
          {/* Recompra, categoria de entrada e parcela/pago são contexto, não
              ação: moram no "+N" (hover/foco/Enter revelam; o aria-label lê tudo). */}
          <SelosExtras itens={extras} />
        </div>
        <span className={cn("flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold", corAvatar(card.nome))}>{inicial(card.nome)}</span>
      </div>

      <p className="mt-1.5 truncate text-sm font-semibold text-slate-800 dark:text-slate-100">{card.nome}</p>
      {/* Telefone e e-mail a um clique: copiar não pode exigir abrir a ficha. */}
      <ContatoDoNome telefone={card.telefone} email={card.email} compacto className="mt-0.5" />
      {card.plano && <p className="mt-0.5 truncate text-[11px] text-slate-400 dark:text-slate-500">{card.plano}</p>}

      {espelho && (
        <p className="mt-1 inline-flex items-center gap-1 rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-500 dark:bg-slate-800 dark:text-slate-400" title="Este card já está na esteira de Ativação — aqui ele é só o registro do pagamento">
          <svg className="h-2.5 w-2.5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14M13 6l6 6-6 6" /></svg>
          Ativação · {card.estagio_nome ?? "em andamento"}
        </p>
      )}

      {card.tags.length > 0 && (
        <div className="mt-1.5 flex flex-wrap gap-1">
          {card.tags.map((t) => <TagChip key={t} tag={t} mini cor={coresTags[t]} />)}
        </div>
      )}

      {dataEtapa?.quando && (
        <div className="mt-1.5 inline-flex items-center gap-1 rounded bg-blue-50 px-1.5 py-0.5 text-[11px] font-medium text-blue-700 dark:bg-blue-500/15 dark:text-blue-300">
          <svg className="h-3 w-3 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M8 2v4M16 2v4M3.5 9h17M21 8.5V17c0 3-1.5 5-5 5H8c-3.5 0-5-2-5-5V8.5c0-3 1.5-5 5-5h8c3.5 0 5 2 5 5Z" /></svg>
          {dataEtapa.label}: {fmtDataHora(dataEtapa.quando)}
        </div>
      )}

      <div className="mt-2 flex items-center justify-between gap-2 border-t border-slate-100 pt-1.5 dark:border-slate-800">
        <div className="flex min-w-0 items-center gap-1.5">
          {card.responsavel ? (
            <Avatar nome={card.responsavel} className="h-5 w-5 text-[9px] ring-2 ring-white dark:ring-slate-900" />
          ) : (
            <span title="Sem operador" className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-dashed border-slate-300 text-slate-300 dark:border-slate-600 dark:text-slate-600">
              <svg className="h-2.5 w-2.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2" /><circle cx="12" cy="7" r="4" /></svg>
            </span>
          )}
          <span className={cn("inline-flex items-center gap-1 truncate text-[11px] font-medium tabular-nums", tempoTom(card.entrou_estagio_em))} title="Tempo nesta etapa">
            <svg className="h-3 w-3 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></svg>
            {card.entrou_estagio_em ? `${relativo(card.entrou_estagio_em)} na etapa` : "—"}
          </span>
          {/* Selo da equipe dona (0140) — o componente resolve cor nula (cinza
              padrão, o selo não some) e o contraste do texto (WCAG sobre a cor
              livre do picker — antes era branco fixo e sumia sobre cor clara).
              Pool não mostra selo. */}
          {card.equipe_nome && (
            <SeloEquipe
              nome={card.equipe_nome}
              cor={card.equipe_cor}
              title={`Equipe: ${card.equipe_nome}${card.responsavel_id ? "" : " (canal roteado — sem dono ainda)"}`}
            />
          )}
          {/* Cadeado: atribuição travada pelo admin (0142) — operador comum não mexe. */}
          {card.atribuicao_admin && (
            <span title="Atribuição travada pelo admin" className="inline-flex shrink-0 items-center text-amber-500 dark:text-amber-400">
              <svg className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" /></svg>
            </span>
          )}
          {/* Conversa pendente no inbox (Fase 2) — o lead respondeu e espera. */}
          {card.inbox_status === "pendente" && (
            <span title="Conversa pendente no inbox" className="inline-flex shrink-0 items-center text-emerald-500 dark:text-emerald-400">
              <svg className="h-3 w-3" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2C6.48 2 2 6.02 2 11c0 2.6 1.23 4.94 3.2 6.55L4 22l4.9-1.66c.98.27 2.02.41 3.1.41 5.52 0 10-4.02 10-9S17.52 2 12 2Z" /></svg>
            </span>
          )}
        </div>
        {wa && (
          <a
            href={wa}
            onClick={(e) => e.stopPropagation()}
            target="_blank"
            rel="noreferrer"
            title="Abrir no WhatsApp"
            className="flex h-7 w-7 items-center justify-center rounded-md text-slate-400 opacity-0 transition hover:bg-slate-100 hover:text-emerald-600 group-hover:opacity-100 dark:text-slate-500 dark:hover:bg-slate-800 dark:hover:text-emerald-400"
          >
            <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="currentColor"><path d="M12.04 2C6.58 2 2.13 6.45 2.13 11.91c0 1.76.46 3.45 1.32 4.95L2 22l5.25-1.38c1.45.79 3.08 1.21 4.79 1.21h.01c5.46 0 9.91-4.45 9.91-9.91C21.96 6.45 17.5 2 12.04 2Z" /></svg>
          </a>
        )}
      </div>
    </div>
  );
}
