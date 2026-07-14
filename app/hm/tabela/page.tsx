"use client";

import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { Button, cn, fieldClass, fieldCompactClass, Spinner } from "@/app/_components/ui";
import { Avatar } from "@/app/_components/avatar";
import { Reveal } from "@/app/_components/anim";
import { TagChip } from "@/app/_components/tags";
import { HmDrawer } from "@/app/hm/_components/hm-drawer";
import { HmVisao } from "@/app/hm/_components/hm-visao";
import { HmCanaisFixos } from "@/app/hm/_components/hm-canais";
import { DisparoModal } from "@/app/_components/disparo";
import { useMe } from "@/app/_components/use-me";
import { MarcaPortal } from "@/app/_components/marca";
import type { LinhaEsteira, QuandoHm } from "@/lib/services/hm-relatorio";

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
function dt(v: QuandoHm): Date | null {
  if (!v) return null;
  const d = new Date(v);
  return isNaN(d.getTime()) ? null : d;
}
function fmtDataHora(v: QuandoHm): string {
  const d = dt(v);
  return d ? d.toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", year: "2-digit", hour: "2-digit", minute: "2-digit" }) : "—";
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
    id: "previsao_vencida", grupo: "Cobrança do saldo", label: "Previsão vencida",
    test: (l, hoje0) => { const d = dt(l.pagamento_previsto_em); return !!d && d.getTime() < hoje0 && !l.pagamento_em; },
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
    id: "sem_responsavel", grupo: "Higiene", label: "Sem responsável",
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
    // Deve o saldo e o sistema não sabe quanto: a fn_hm_prorata só devolve linha
    // para quem tem os insumos do crédito (valor pago + data da compra antiga).
    // Sem isso, a pessoa não entra na soma do rodapé e some de toda cobrança —
    // é uma lacuna, não um zero. Acionável dos dois lados: ou falta digitar o
    // crédito do aluno da base, ou falta definir o valor do lead novo (que
    // depende do sinal que ele pagou — R$300 no HT ATM, R$2.000 na Imersão POA).
    id: "sem_saldo", grupo: "Higiene", label: "Sem saldo calculado", destaque: true,
    test: (l) => !l.apto_ativacao && num(l.saldo_a_pagar) === null,
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
  sortVal: (l: LinhaEsteira) => number | string | null;
  render: (l: LinhaEsteira) => ReactNode;
};

const PRESETS: Record<VisaoId, string[]> = {
  comercial: ["nome", "telefone", "etapa", "esteira", "dias", "responsavel", "entrada", "acordo", "meio", "previsao", "link", "saldo"],
  ativacao: ["nome", "etapa", "esteira", "dias", "responsavel", "checklist", "grupo_informes", "pendencia", "entrevista", "na_base", "socios"],
  agenda: ["nome", "responsavel", "reuniao", "reuniao_resultado", "reunioes_remarcadas", "entrevista", "entrevista_resultado", "entrevistas_remarcadas", "no_shows"],
  financeiro: ["nome", "entrada", "turma_origem", "credito", "saldo", "valor_total", "valor_pago", "pagamento_em", "forma", "meio"],
  // A auditoria: as colunas do XLSX, na mesma ordem (+ a Turma atual, editável).
  tudo: ["nome", "telefone", "email", "etapa", "esteira", "dias", "responsavel", "entrada", "turma_origem", "turma",
    "reuniao", "reuniao_resultado", "reunioes_remarcadas", "entrevista", "entrevista_resultado", "entrevistas_remarcadas",
    "no_shows", "meio", "previsao", "acordo", "link", "saldo", "credito", "valor_total", "valor_pago", "pagamento_em",
    "apto", "ativ_searchie", "ativ_comunidade", "ativ_grupo", "ativ_pesquisa", "pendencia", "nao_contatar", "revisar",
    "socios", "cancelamento_em", "cancelamento_motivo", "na_base", "tags"],
};

// --------------------------------------------------------------------- página
export default function HmTabelaPage() {
  const { podeDisparar } = useMe();
  const [linhas, setLinhas] = useState<LinhaEsteira[]>([]);
  const [estagios, setEstagios] = useState<Estagio[]>([]);
  const [responsaveis, setResponsaveis] = useState<string[]>([]);
  const [canais, setCanais] = useState<string[]>([]);
  const [canaisQtd, setCanaisQtd] = useState<Record<string, number>>({});
  const [turmas, setTurmas] = useState<string[]>([]);
  const [filtroResp, setFiltroResp] = useState("");
  const [filtroCanal, setFiltroCanal] = useState("");
  const [filtroTurma, setFiltroTurma] = useState("");
  const [filtrosProntos, setFiltrosProntos] = useState(false);
  const [busca, setBusca] = useState("");
  const [visao, setVisao] = useState<VisaoId>("comercial");
  const [lente, setLente] = useState<string | null>(null);
  const [sort, setSort] = useState<{ id: string; dir: 1 | -1 } | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [salvando, setSalvando] = useState<string | null>(null);
  const [marcados, setMarcados] = useState<Set<string>>(new Set());
  const [selecionado, setSelecionado] = useState<string | null>(null);
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
    setFiltroResp(sp.get("responsavel") ?? "");
    setFiltroCanal(sp.get("canal") ?? "");
    setFiltroTurma(sp.get("turma") ?? "");
    setFiltrosProntos(true);
  }, []);
  useEffect(() => {
    if (!filtrosProntos) return;
    const params = new URLSearchParams();
    if (filtroResp) params.set("responsavel", filtroResp);
    if (filtroCanal) params.set("canal", filtroCanal);
    if (filtroTurma) params.set("turma", filtroTurma);
    const qs = params.toString();
    window.history.replaceState(null, "", qs ? `?${qs}` : window.location.pathname);
  }, [filtroResp, filtroCanal, filtroTurma, filtrosProntos]);

  const paramsFiltro = new URLSearchParams();
  if (filtroResp) paramsFiltro.set("responsavel", filtroResp);
  if (filtroCanal) paramsFiltro.set("canal", filtroCanal);
  if (filtroTurma) paramsFiltro.set("turma", filtroTurma);

  // responsavel/canal/turma vão ao SERVIDOR — a mesma query do board e do XLSX.
  // Lentes e busca ficam no cliente, sobre as linhas já carregadas (~130).
  const carregar = useCallback(async (silencioso = false) => {
    if (!silencioso) setCarregando(true);
    try {
      const params = new URLSearchParams();
      if (filtroResp) params.set("responsavel", filtroResp);
      if (filtroCanal) params.set("canal", filtroCanal);
      if (filtroTurma) params.set("turma", filtroTurma);
      const r = await fetch(`/api/hm/tabela?${params.toString()}`);
      const d = await r.json();
      if (d.ok) {
        setLinhas(d.linhas);
        setEstagios(d.estagios);
        if (Array.isArray(d.responsaveis)) setResponsaveis(d.responsaveis);
        if (Array.isArray(d.canais)) setCanais(d.canais);
        if (Array.isArray(d.turmas)) setTurmas(d.turmas);
        if (d.canaisQtd) setCanaisQtd(d.canaisQtd);
      }
    } finally {
      setCarregando(false);
    }
  }, [filtroResp, filtroCanal, filtroTurma]);
  useEffect(() => { if (filtrosProntos) carregar(); }, [carregar, filtrosProntos]);

  // ------------------------------------------------------------- escrita (1 linha)
  // Único ponto de escrita unitária: o MESMO PATCH da ficha. Etapa vira
  // moverEstagioHm, data de reunião/entrevista vira agendarHm — a tabela nunca
  // escreve por fora dos serviços.
  const patch = useCallback(async (compradorId: string, nome: string, payload: Record<string, unknown>) => {
    setSalvando(compradorId);
    try {
      const r = await fetch(`/api/hm/contato/${compradorId}`, {
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
        }
      }
    } finally {
      setSalvando(null);
      await carregar(true);
    }
  }, [carregar]);

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
      const r = await fetch("/api/hm/lote", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ compradorIds: ids, ...payload }),
      });
      const d = await r.json().catch(() => ({}));
      if (d?.ok) setResultadoLote({ pedido, total: ids.length, aplicados: d.aplicados ?? 0, falhas: d.falhas ?? [] });
    } finally {
      setAplicandoLote(false);
      await carregar(true);
    }
  }, [marcados, carregar]);

  const loteMover = useCallback((chave: string) => {
    const destino = estagios.find((e) => e.chave === chave);
    if (!destino) return;
    const dos = linhas.filter((l) => marcados.has(l.comprador_id));
    const abaDestino = destino.aba ?? "comercial";
    if (abaDestino === "ativacao") {
      const semPagto = dos.filter((l) => !l.apto_ativacao).length;
      if (semPagto > 0) {
        const ok = window.confirm(
          `Mover ${dos.length} aluno(s) para "${destino.nome}" os coloca na esteira de Ativação.\n\n` +
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

  const q = busca.trim().toLowerCase();
  const base = useMemo(
    () => (q
      ? linhas.filter((l) => l.nome.toLowerCase().includes(q) || (l.telefone ?? "").includes(q) || (l.email ?? "").toLowerCase().includes(q))
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
      id: "nome", label: "Nome",
      sortVal: (l) => l.nome.toLowerCase(),
      render: (l) => (
        <div className="flex min-w-0 max-w-[16rem] items-center gap-1.5">
          <span className="truncate font-semibold text-slate-800 dark:text-slate-100">{l.nome}</span>
          {l.nao_contatar && <span className="h-2 w-2 shrink-0 rounded-full bg-rose-500" title={`Não contatar${l.nao_contatar_motivo ? ` — ${l.nao_contatar_motivo}` : ""}`} />}
          {l.revisar && <span className="h-2 w-2 shrink-0 rounded-full bg-amber-500" title={`Revisar${l.revisar_motivo ? ` — ${l.revisar_motivo}` : ""}`} />}
        </div>
      ),
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
          title="Trocar a etapa (passa pela mesma regra do board — inclusive a trava do checklist)"
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
      id: "responsavel", label: "Responsável", edit: true,
      sortVal: (l) => l.responsavel?.toLowerCase() ?? null,
      render: (l) => (
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
      ),
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
        const vencida = !!dPrev && dPrev.getTime() < hoje0 && !l.pagamento_em;
        return (
          <input
            key={String(l.pagamento_previsto_em ?? "")}
            type="date"
            defaultValue={toDateInput(l.pagamento_previsto_em)}
            disabled={salvando === l.comprador_id}
            onClick={(e) => e.stopPropagation()}
            onBlur={(e) => { if (e.target.value !== toDateInput(l.pagamento_previsto_em)) patch(l.comprador_id, l.nome, { pagamento_previsto_em: e.target.value || null }); }}
            className={cn(celInput, "min-w-[7.5rem] tabular-nums", vencida && "text-rose-600 dark:text-rose-400")}
            title={vencida ? "Previsão vencida — a data passou e o pagamento não veio" : undefined}
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
      sortVal: (l) => (l.apto_ativacao ? null : num(l.saldo_a_pagar)),
      render: (l) => {
        if (l.apto_ativacao) {
          return <span className="text-[11px] font-medium text-emerald-600 dark:text-emerald-400" title={l.pagamento_em ? `Quitado em ${fmtDataHora(l.pagamento_em)}` : "Saldo quitado"}>quitado</span>;
        }
        const s = num(l.saldo_a_pagar);
        if (s !== null) return <span className="whitespace-nowrap font-semibold tabular-nums text-slate-800 dark:text-slate-100">{brl(s)}</span>;
        // Devendo, mas sem valor: a fn_hm_prorata não teve os insumos do crédito.
        // Um "—" mudo se leria como zero — e zero é exatamente o que esta pessoa
        // NÃO deve. O traço avisa que é lacuna, e diz o que falta preencher.
        return (
          <span
            className="cursor-help font-medium text-amber-600 underline decoration-dotted underline-offset-2 dark:text-amber-400"
            title={l.turma_origem
              ? "Sem saldo calculado — o crédito pró-rata deste aluno não foi informado (valor pago e data da compra anterior, na ficha)."
              : "Sem saldo calculado — o valor devido por este lead ainda não foi definido (depende do sinal que ele pagou)."}
          >
            —
          </span>
        );
      },
    },
    credito: {
      id: "credito", label: "Crédito pró-rata", dir: true,
      sortVal: (l) => num(l.credito),
      render: (l) => <Dinheiro v={num(l.credito)} />,
    },
    valor_total: { id: "valor_total", label: "Valor total", dir: true, sortVal: (l) => num(l.valor_total), render: (l) => <Dinheiro v={num(l.valor_total)} /> },
    valor_pago: { id: "valor_pago", label: "Valor pago", dir: true, sortVal: (l) => num(l.valor_pago), render: (l) => <Dinheiro v={num(l.valor_pago)} /> },
    pagamento_em: {
      id: "pagamento_em", label: "Pagamento em",
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
          {l.tags.length ? l.tags.map((t) => <TagChip key={t} tag={t} mini />) : "—"}
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
  const visiveis = colSort && sort
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

  // ----------------------------------------------------------------- rodapé
  // A leitura que o board nunca deu: o card sabe o saldo de UM; a tabela soma o
  // de todos. "A receber" é só de quem ainda deve — saldo de quem quitou é história.
  //
  // E a soma é PARCIAL, por construção: `saldo_a_pagar` vem da fn_hm_prorata, que
  // só devolve linha para quem tem os insumos do crédito (valor pago + data da
  // compra anterior) — ou seja, aluno da base com o crédito digitado. Lead novo e
  // aluno sem crédito informado entram como null, e um null somado como zero
  // esconderia gente que deve dinheiro dentro de um total que parece completo.
  // Não dá para derivar o que falta (o saldo do lead depende do sinal que ele
  // pagou: R$300 no HT ATM, R$2.000 na Imersão POA — chutar 14.700 seria inventar
  // dado). Então a soma declara a própria cobertura, e a lente "Sem saldo
  // calculado" mostra quem ficou de fora.
  const devendo = visiveis.filter((l) => !l.apto_ativacao);
  const comSaldo = devendo.filter((l) => num(l.saldo_a_pagar) !== null);
  const semSaldo = devendo.length - comSaldo.length;
  const totSaldo = comSaldo.reduce((acc, l) => acc + (num(l.saldo_a_pagar) ?? 0), 0);
  const semResp = visiveis.filter((l) => !l.responsavel).length;
  const comLink = visiveis.filter((l) => !!l.link_saldo_enviado_em).length;
  const diasArr = visiveis.map((l) => l.dias_na_etapa).filter((x): x is number => x !== null && x !== undefined);
  const mediaDias = diasArr.length ? Math.round(diasArr.reduce((a, b) => a + b, 0) / diasArr.length) : 0;

  const todosMarcados = visiveis.length > 0 && visiveis.every((l) => marcados.has(l.comprador_id));
  const gruposLente = Array.from(new Set(LENTES.map((le) => le.grupo)));

  return (
    <div>
      {/* Cabeçalho — identidade, volume e o alternador de leitura. */}
      <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="flex items-center gap-2.5">
            <MarcaPortal portal="hm" altura="h-7" comNome={false} />
            <h1 className="text-xl font-semibold tracking-tight text-slate-900 dark:text-slate-100">Ativação · Holding Masters</h1>
          </div>
          <p className="mt-0.5 text-sm text-slate-500 dark:text-slate-400">
            {linhas.length} aluno(s) — a esteira em linhas: ordene, filtre, edite na célula e aja em lote.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <HmVisao atual="tabela" filtros={{ responsavel: filtroResp, canal: filtroCanal, turma: filtroTurma }} />
          {/* O XLSX é o mesmo relatório desta tela — mesmos filtros, mesma função. */}
          <a href={`/api/hm/kanban/export?${paramsFiltro.toString()}`} title="Baixar o relatório da esteira (resumo + uma aba por etapa)">
            <Button variant="secondary" size="sm">Exportar .xlsx</Button>
          </a>
        </div>
      </div>

      {/* Barra de controle: visões + busca + filtros (estes vão ao servidor). */}
      <div className="mb-2 flex flex-wrap items-center gap-2 rounded-xl border border-slate-200 bg-white p-2 dark:border-slate-800 dark:bg-slate-900">
        <div className="inline-flex shrink-0 rounded-lg bg-slate-100 p-0.5 dark:bg-slate-800/80">
          {VISOES.map((v) => (
            <button
              key={v.id}
              onClick={() => setVisao(v.id)}
              className={cn(
                "rounded-md px-3 py-1.5 text-sm font-medium transition",
                visao === v.id
                  ? "bg-white text-slate-900 shadow-card dark:bg-slate-700 dark:text-slate-100"
                  : "text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200",
              )}
            >
              {v.label}
            </button>
          ))}
        </div>

        <span className="mx-1 hidden h-6 w-px bg-slate-200 dark:bg-slate-700 sm:block" />

        <div className="relative w-52 min-w-[9rem]">
          <svg className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8" /><path d="m21 21-4.3-4.3" /></svg>
          <input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar aluno…" className={cn(fieldClass, "pl-8")} />
        </div>

        {responsaveis.length > 0 && (
          <select value={filtroResp} onChange={(e) => setFiltroResp(e.target.value)} className={fieldCompactClass} title="Responsável">
            <option value="">Responsável: todos</option>
            {responsaveis.map((r) => <option key={r} value={r}>{r}</option>)}
          </select>
        )}
        {canais.length > 0 && (
          <select value={filtroCanal} onChange={(e) => setFiltroCanal(e.target.value)} className={fieldCompactClass} title="Canal de aquisição / público">
            <option value="">Canal: todos</option>
            {canais.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
        )}
        {turmas.length > 0 && (
          <select value={filtroTurma} onChange={(e) => setFiltroTurma(e.target.value)} className={fieldCompactClass} title="Turma (atual ou de origem)">
            <option value="">Turma: todas</option>
            {turmas.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
        )}
        {(filtroResp || filtroCanal || filtroTurma || busca || lente) && (
          <button
            onClick={() => { setFiltroResp(""); setFiltroCanal(""); setFiltroTurma(""); setBusca(""); setLente(null); }}
            className="shrink-0 rounded-md px-2 py-1.5 text-xs font-medium text-slate-500 transition hover:bg-slate-100 hover:text-slate-800 dark:text-slate-400 dark:hover:bg-slate-800"
          >
            Limpar filtros
          </button>
        )}
      </div>

      {/* A régua dos canais fixos — total de vendas por canal, clicável (é o
          mesmo filtro de canal do dropdown, que segue existindo para o resto). */}
      <HmCanaisFixos contagem={canaisQtd} ativo={filtroCanal} onChange={setFiltroCanal} />

      {/* Lentes: o que está ERRADO com as pessoas, não onde elas estão. Uma faixa
          só, discreta — a lente é um atalho, não o assunto da tela. Contagem zero
          também é informação (ninguém travado ali), mas fala baixo. */}
      <div className="mb-3 flex flex-wrap items-baseline gap-x-1 gap-y-1 px-1 text-[11px] leading-5">
        {gruposLente.map((grupo, gi) => (
          <Fragment key={grupo}>
            {gi > 0 && <span className="mx-1.5 hidden h-3 w-px self-center bg-slate-200 dark:bg-slate-700 sm:block" />}
            <span className="mr-0.5 font-medium text-slate-400 dark:text-slate-500">{grupo.toLowerCase()}:</span>
            {LENTES.filter((le) => le.grupo === grupo).map((le) => {
              const n = contagemLente.get(le.id) ?? 0;
              const ativa = lente === le.id;
              return (
                <button
                  key={le.id}
                  onClick={() => setLente(ativa ? null : le.id)}
                  title={le.label}
                  className={cn(
                    "inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 font-medium transition",
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
      </div>

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

      {carregando && linhas.length === 0 ? (
        <div className="flex items-center justify-center gap-3 py-20 text-slate-400 dark:text-slate-500">
          <Spinner className="h-6 w-6" /> <span className="text-sm">Carregando esteira…</span>
        </div>
      ) : (
        <Reveal>
          <div className="js-reveal overflow-hidden rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
            <div className="max-h-[68vh] overflow-auto">
              <table className="w-full min-w-max border-separate border-spacing-0 text-xs">
                <thead>
                  <tr>
                    <th className="sticky top-0 z-10 w-8 border-b border-slate-200 bg-slate-50 px-2 py-2 dark:border-slate-700 dark:bg-slate-800/95">
                      <input
                        type="checkbox"
                        checked={todosMarcados}
                        onChange={() => {
                          const ids = visiveis.map((l) => l.comprador_id);
                          setMarcados(todosMarcados ? new Set() : new Set(ids));
                        }}
                        title={todosMarcados ? "Limpar seleção" : `Selecionar os ${visiveis.length} visíveis`}
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
                            "sticky top-0 z-10 cursor-pointer select-none whitespace-nowrap border-b border-slate-200 bg-slate-50 px-2 py-2 text-[11px] font-semibold uppercase tracking-wide text-slate-500 transition hover:text-slate-800 dark:border-slate-700 dark:bg-slate-800/95 dark:text-slate-400 dark:hover:text-slate-200",
                            c.dir ? "text-right" : "text-left",
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
                    visiveis.map((l) => (
                      <tr
                        key={l.comprador_id}
                        onClick={() => setSelecionado(l.comprador_id)}
                        title="Clique para abrir a ficha"
                        className={cn(
                          "cursor-pointer border-b transition",
                          l.nao_contatar
                            ? "bg-rose-50/60 hover:bg-rose-50 dark:bg-rose-500/5 dark:hover:bg-rose-500/10"
                            : l.revisar
                              ? "bg-amber-50/60 hover:bg-amber-50 dark:bg-amber-500/5 dark:hover:bg-amber-500/10"
                              : "hover:bg-slate-50 dark:hover:bg-slate-800/50",
                          l.cancelamento_em && "opacity-60",
                          marcados.has(l.comprador_id) && "bg-brand/5 dark:bg-brand-400/10",
                        )}
                      >
                        <td className="border-b border-slate-100 px-2 py-1.5 dark:border-slate-800" onClick={(e) => e.stopPropagation()}>
                          <input
                            type="checkbox"
                            checked={marcados.has(l.comprador_id)}
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
                            )}
                          >
                            {c.render(l)}
                          </td>
                        ))}
                        <td className="border-b border-slate-100 px-2 py-1.5 text-right dark:border-slate-800" onClick={(e) => e.stopPropagation()}>
                          {/* Pagamento e cancelamento NÃO são células — têm consequência
                              na base mestre e a confirmação vive na ficha. */}
                          <button
                            onClick={() => setSelecionado(l.comprador_id)}
                            title="Abrir a ficha (pagamento, cancelamento, sócios, timeline)"
                            className="rounded-md px-2 py-1 text-[11px] font-medium text-slate-500 transition hover:bg-slate-100 hover:text-brand dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-brand-300"
                          >
                            Ficha
                          </button>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>

            {/* O rodapé onde o dinheiro aparece somado — recalculado a cada
                filtro/lente/busca, sempre sobre o que está na tela. */}
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600 dark:border-slate-700 dark:bg-slate-800/80 dark:text-slate-300">
              <span className="font-semibold text-slate-800 dark:text-slate-100">{visiveis.length} aluno(s)</span>
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
                      title="Ver quem está sem saldo calculado — essas pessoas devem, mas o valor não entra na soma"
                    >
                      {semSaldo} sem saldo calculado
                    </button>
                  </span>
                )}
              </span>
              <span>· {semResp} sem responsável</span>
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
            <select
              value=""
              disabled={aplicandoLote}
              onChange={(e) => {
                const v = e.target.value;
                if (!v) return;
                if (v === "__remover") lote({ responsavel: null }, "remover responsável");
                else lote({ responsavel: v }, `atribuir a ${v}`);
              }}
              className={cn(fieldCompactClass, "py-1.5 text-xs")}
              title="Atribuir responsável (registra na timeline de cada um)"
            >
              <option value="">Responsável…</option>
              {responsaveis.map((r) => <option key={r} value={r}>{r}</option>)}
              <option value="__remover">— remover responsável —</option>
            </select>
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
