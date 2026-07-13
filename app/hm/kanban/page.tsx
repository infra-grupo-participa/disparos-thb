"use client";

import { Fragment, useCallback, useEffect, useRef, useState } from "react";
import type { DragEvent, WheelEvent } from "react";
import { Button, cn, fieldClass, Spinner } from "@/app/_components/ui";
import { Avatar, corAvatar, inicial } from "@/app/_components/avatar";
import { Reveal } from "@/app/_components/anim";
import { HmDrawer } from "@/app/hm/_components/hm-drawer";
import { DisparoModal } from "@/app/_components/disparo";
import { TagChip } from "@/app/_components/tags";
import { useMe } from "@/app/_components/use-me";
import { MarcaPortal } from "@/app/_components/marca";

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
  tags: string[];
  apto_ativacao: boolean;
  reuniao_em: string | null;
  entrevista_em: string | null;
  pagamento_em: string | null;
  ultima_msg: string | null;
  entrou_estagio_em: string | null;
};
type Coluna = { chave: string; nome: string; cor: string; aba: string | null };

const ABAS: { id: string; label: string }[] = [
  { id: "comercial", label: "Comercial" },
  { id: "ativacao", label: "Ativação" },
];

const COL_PAGAMENTO = "hm_pagamento_realizado";

// Em qual coluna DESTA aba o card aparece — ou null se ele não pertence a ela.
// Quem quitou o saldo vive na Ativação, mas o Comercial não pode perdê-lo de
// vista: ele continua visível lá, parado em "Pagamento Realizado". É o mesmo
// card (um único estágio no banco), mostrado nas duas esteiras.
function colunaNaAba(card: Card, aba: string): string | null {
  const abaDoCard = card.estagio_aba ?? "comercial";
  if (abaDoCard === aba) return card.estagio_chave;
  if (aba === "comercial" && abaDoCard === "ativacao") return COL_PAGAMENTO;
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
  const { podeDisparar } = useMe();
  const [colunas, setColunas] = useState<Coluna[]>([]);
  const [cards, setCards] = useState<Card[]>([]);
  const [responsaveis, setResponsaveis] = useState<string[]>([]);
  const [canais, setCanais] = useState<string[]>([]);
  const [turmas, setTurmas] = useState<string[]>([]);
  const [estagios, setEstagios] = useState<Estagio[]>([]);
  const [filtroResp, setFiltroResp] = useState("");
  const [filtroCanal, setFiltroCanal] = useState("");
  const [filtroTurma, setFiltroTurma] = useState("");
  const [busca, setBusca] = useState("");
  const [aba, setAba] = useState("comercial");
  const [carregando, setCarregando] = useState(true);
  const [alvo, setAlvo] = useState<Alvo | null>(null);
  const [selecionado, setSelecionado] = useState<string | null>(null);
  const [marcados, setMarcados] = useState<Set<string>>(new Set());
  const [dispararLote, setDispararLote] = useState(false);
  const arrastando = useRef<Card | null>(null);

  function toggleMarcado(id: string) {
    setMarcados((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  // Os filtros que estão valendo — o board os usa para ler, e o relatório para
  // exportar. Um relatório que ignorasse o filtro da tela seria uma armadilha.
  const paramsFiltro = new URLSearchParams();
  if (filtroResp) paramsFiltro.set("responsavel", filtroResp);
  if (filtroCanal) paramsFiltro.set("canal", filtroCanal);
  if (filtroTurma) paramsFiltro.set("turma", filtroTurma);

  const carregar = useCallback(async () => {
    setCarregando(true);
    try {
      const params = new URLSearchParams();
      if (filtroResp) params.set("responsavel", filtroResp);
      if (filtroCanal) params.set("canal", filtroCanal);
      if (filtroTurma) params.set("turma", filtroTurma);
      const r = await fetch(`/api/hm/kanban?${params.toString()}`);
      const d = await r.json();
      if (d.ok) {
        setColunas(d.colunas);
        setCards(d.cards);
        if (Array.isArray(d.responsaveis)) setResponsaveis(d.responsaveis);
        if (Array.isArray(d.canais)) setCanais(d.canais);
        if (Array.isArray(d.turmas)) setTurmas(d.turmas);
      }
    } finally {
      setCarregando(false);
    }
  }, [filtroResp, filtroCanal, filtroTurma]);

  useEffect(() => { carregar(); }, [carregar]);
  useEffect(() => {
    fetch("/api/hm/estagios").then((r) => r.json()).then((d) => { if (d.ok) setEstagios(d.estagios); }).catch(() => {});
  }, []);

  // Um único gesto responde por duas coisas: a coluna (para onde) e a ordem
  // vertical (em que lugar da fila). `antesDe` é o card que ficará logo abaixo —
  // null significa "no fim da coluna".
  async function mover(card: Card, estagioChave: string, antesDe: string | null) {
    const mudouDeColuna = colunaNaAba(card, aba) !== estagioChave;
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
    try {
      const r = await fetch("/api/hm/kanban", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ compradorId: card.comprador_id, estagioChave, antesDe }),
      });
      // A ativação incompleta barra a saída de "Acesso Liberado": o servidor
      // devolve o que falta, e o board diz — em vez de o card voltar sozinho
      // sem explicação (o recarregar abaixo desfaz o movimento otimista).
      if (!r.ok) {
        const d = await r.json().catch(() => ({}));
        if (d?.reason === "checklist_incompleto") {
          window.alert(
            `A ativação de ${card.nome} ainda não está completa.\n\nFalta: ${(d.faltando ?? []).join(", ")}.\n\n` +
              "Marque os itens na ficha do card para poder avançar.",
          );
        }
      }
    } finally {
      await carregar();
    }
  }

  const q = busca.trim().toLowerCase();
  const cardsFiltrados = q ? cards.filter((c) => c.nome.toLowerCase().includes(q) || (c.telefone ?? "").includes(q)) : cards;
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
            <MarcaPortal portal="hm" altura="h-7" comNome={false} />
            <h1 className="text-xl font-semibold tracking-tight text-slate-900 dark:text-slate-100">Ativação · Holding Masters</h1>
          </div>
          <p className="mt-0.5 text-sm text-slate-500 dark:text-slate-400">
            {totalComercial + totalAtivacao} aluno(s) — arraste os cards entre as etapas e para cima/baixo para ordenar a fila.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {/* Relatório da esteira inteira — sai com os filtros que estão valendo */}
          <a href={`/api/hm/kanban/export?${paramsFiltro.toString()}`} title="Baixar o relatório da esteira (resumo + uma aba por etapa)">
            <Button variant="secondary" size="sm">Exportar .xlsx</Button>
          </a>
          {podeDisparar && cardsFiltrados.length > 0 && (
            <Button
              variant="secondary"
              size="sm"
              onClick={() => {
                const ids = cardsFiltrados.map((c) => c.comprador_id);
                const todos = ids.length > 0 && ids.every((id) => marcados.has(id));
                setMarcados(todos ? new Set() : new Set(ids));
              }}
            >
              {cardsFiltrados.every((c) => marcados.has(c.comprador_id))
                ? "Limpar seleção"
                : `Selecionar todos (${cardsFiltrados.length})`}
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
          <input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar aluno…" className={cn(fieldClass, "w-full pl-8")} />
        </div>

        {responsaveis.length > 0 && (
          <select value={filtroResp} onChange={(e) => setFiltroResp(e.target.value)} className={cn(fieldClass, "w-auto min-w-[9rem]")} title="Responsável">
            <option value="">Responsável: todos</option>
            {responsaveis.map((r) => <option key={r} value={r}>{r}</option>)}
          </select>
        )}
        {canais.length > 0 && (
          <select value={filtroCanal} onChange={(e) => setFiltroCanal(e.target.value)} className={cn(fieldClass, "w-auto min-w-[10rem]")} title="Canal de aquisição / público">
            <option value="">Canal: todos</option>
            {canais.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
        )}
        {turmas.length > 0 && (
          <select value={filtroTurma} onChange={(e) => setFiltroTurma(e.target.value)} className={cn(fieldClass, "w-auto min-w-[9rem]")} title="Turma (atual ou de origem)">
            <option value="">Turma: todas</option>
            {turmas.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
        )}
        {(filtroResp || filtroCanal || filtroTurma || busca) && (
          <button
            onClick={() => { setFiltroResp(""); setFiltroCanal(""); setFiltroTurma(""); setBusca(""); }}
            className="shrink-0 rounded-md px-2 py-1.5 text-xs font-medium text-slate-500 transition hover:bg-slate-100 hover:text-slate-800 dark:text-slate-400 dark:hover:bg-slate-800"
          >
            Limpar filtros
          </button>
        )}
      </div>

      {carregando && cards.length === 0 ? (
        <div className="flex items-center justify-center gap-3 py-20 text-slate-400 dark:text-slate-500">
          <Spinner className="h-6 w-6" /> <span className="text-sm">Carregando esteira…</span>
        </div>
      ) : (
        <div className="-mx-4 overflow-x-auto px-4 pb-4 sm:-mx-6 sm:px-6" onWheel={rolarBoardHorizontal}>
          <Reveal className="flex gap-3">
            {colunasAba.map((col) => {
              const doCol = cardsFiltrados.filter((c) => colunaNaAba(c, aba) === col.chave);
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
                      {cards.filter((c) => colunaNaAba(c, aba) === col.chave).length}
                    </span>
                  </div>
                  <div
                    data-col-scroll
                    onDragOver={(e) => {
                      const card = arrastando.current;
                      if (!card) return;
                      // Espelho não se reordena na própria coluna (a fila dele é a
                      // da Ativação): sem preventDefault, o drop nem acontece.
                      if (ehEspelho(card, aba) && col.chave === COL_PAGAMENTO) return;
                      e.preventDefault();
                      const indice = indiceSobOCursor(e);
                      setAlvo((a) => (a?.col === col.chave && a.indice === indice ? a : { col: col.chave, indice }));
                    }}
                    onDragLeave={(e) => {
                      if (e.currentTarget.contains(e.relatedTarget as Node | null)) return;
                      setAlvo((a) => (a?.col === col.chave ? null : a));
                    }}
                    onDrop={(e) => {
                      e.preventDefault();
                      const card = arrastando.current;
                      const indice = alvo?.col === col.chave ? alvo.indice : 0;
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
                    {doCol.length === 0 && marca < 0 ? (
                      <p className="px-2 py-6 text-center text-xs text-slate-400 dark:text-slate-600">Sem cards</p>
                    ) : (
                      doCol.map((card, i) => (
                        <Fragment key={card.comprador_id}>
                          {marca === i && <LinhaDrop />}
                          <CardItem
                            card={card}
                            espelho={ehEspelho(card, aba)}
                            onDragStart={() => { arrastando.current = card; }}
                            onDragEnd={() => { arrastando.current = null; setAlvo(null); }}
                            onAbrir={() => setSelecionado(card.comprador_id)}
                            selecionavel={podeDisparar}
                            marcado={marcados.has(card.comprador_id)}
                            onToggleMarcado={() => toggleMarcado(card.comprador_id)}
                          />
                        </Fragment>
                      ))
                    )}
                    {marca === doCol.length && <LinhaDrop />}
                  </div>
                </div>
              );
            })}
          </Reveal>
        </div>
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

      {selecionado && (
        <HmDrawer
          compradorId={selecionado}
          estagios={estagios}
          responsaveis={responsaveis}
          onClose={() => setSelecionado(null)}
          onChanged={carregar}
        />
      )}
    </div>
  );
}

// Linha que mostra em que ponto da fila o card vai cair.
function LinhaDrop() {
  return <div aria-hidden className="h-0.5 shrink-0 rounded-full bg-brand dark:bg-brand-400" />;
}

function CardItem({
  card, espelho, onDragStart, onDragEnd, onAbrir, selecionavel, marcado, onToggleMarcado,
}: {
  card: Card; espelho: boolean; onDragStart: () => void; onDragEnd: () => void; onAbrir: () => void;
  selecionavel: boolean; marcado: boolean; onToggleMarcado: () => void;
}) {
  const cat = catLabel(card.categoria_entrada);
  const wa = waLink(card.telefone);
  // Data relevante à etapa: reunião (Comercial) ou entrevista (Ativação).
  const dataEtapa = card.estagio_chave === "hm_reuniao_agendada" ? { label: "Reunião", quando: card.reuniao_em }
    : card.estagio_chave === "hm_entrevista_agendada" ? { label: "Entrevista", quando: card.entrevista_em }
    : null;
  return (
    <div
      data-card
      role="button"
      tabIndex={0}
      draggable
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onClick={onAbrir}
      onKeyDown={(e) => { if (e.key === "Enter") onAbrir(); }}
      className={cn(
        "group relative block cursor-pointer rounded-lg border bg-white p-2.5 shadow-card transition hover:border-brand/30 hover:shadow-soft active:cursor-grabbing dark:bg-slate-900 dark:hover:border-brand-400/30",
        marcado ? "border-brand ring-1 ring-brand dark:border-brand-400 dark:ring-brand-400" : "border-slate-200 dark:border-slate-800",
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
          {cat && <span className={cn("inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-semibold", cat.cls)}>{cat.txt}</span>}
          {card.apto_ativacao && (
            <span className="inline-flex items-center gap-0.5 rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold text-amber-800 dark:bg-amber-500/15 dark:text-amber-300" title="Pagamento do saldo confirmado">
              <svg className="h-2.5 w-2.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5" /></svg>
              pago
            </span>
          )}
        </div>
        <span className={cn("flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold", corAvatar(card.nome))}>{inicial(card.nome)}</span>
      </div>

      <p className="mt-1.5 truncate text-sm font-semibold text-slate-800 dark:text-slate-100">{card.nome}</p>
      {card.plano && <p className="mt-0.5 truncate text-[11px] text-slate-400 dark:text-slate-500">{card.plano}</p>}

      {espelho && (
        <p className="mt-1 inline-flex items-center gap-1 rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-500 dark:bg-slate-800 dark:text-slate-400" title="Este card já está na esteira de Ativação — aqui ele é só o registro do pagamento">
          <svg className="h-2.5 w-2.5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14M13 6l6 6-6 6" /></svg>
          Ativação · {card.estagio_nome ?? "em andamento"}
        </p>
      )}

      {card.tags.length > 0 && (
        <div className="mt-1.5 flex flex-wrap gap-1">
          {card.tags.map((t) => <TagChip key={t} tag={t} mini />)}
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
            <span title="Sem responsável" className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-dashed border-slate-300 text-slate-300 dark:border-slate-600 dark:text-slate-600">
              <svg className="h-2.5 w-2.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2" /><circle cx="12" cy="7" r="4" /></svg>
            </span>
          )}
          <span className={cn("inline-flex items-center gap-1 truncate text-[11px] font-medium tabular-nums", tempoTom(card.entrou_estagio_em))} title="Tempo nesta etapa">
            <svg className="h-3 w-3 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></svg>
            {card.entrou_estagio_em ? `${relativo(card.entrou_estagio_em)} na etapa` : "—"}
          </span>
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
