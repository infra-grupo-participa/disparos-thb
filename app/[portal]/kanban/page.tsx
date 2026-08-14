"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { MouseEvent, ReactNode, WheelEvent } from "react";
import Link from "next/link";
import { Button, EmptyState, cn, fieldClass, fieldCompactClass, Spinner } from "@/app/_components/ui";
import { DisparoModal } from "@/app/_components/disparo";
import { DisparoInteligente } from "@/app/_components/disparo-inteligente";
import { TagsIcon, TAGS_PADRAO, tagTone } from "@/app/_components/tags";
import { Reveal } from "@/app/_components/anim";
import { Avatar, corAvatar, inicial } from "@/app/_components/avatar";
import { EdicaoBadge } from "@/app/_components/edicao-badge";
import { toast } from "@/app/_components/toast";
import { useMe, msgErroPermissao, msgErroCarregamento } from "@/app/_components/use-me";
import { usePortal } from "@/app/_components/use-portal";
import { MarcaPortal } from "@/app/_components/marca";

type SelDisparo = { comprador_id: string; nome: string; telefone: string; edicao?: string | null };

type Card = {
  comprador_id: string;
  nome: string;
  email: string | null;
  telefone: string | null;
  edicao: string | null;
  estagio_chave: string;
  tags: string[];
  responsavel: string | null;
  opt_out: boolean;
  ultima_resposta_em: string | null;
  ultima_msg: string | null;
  entrou_estagio_em: string | null;
};
type Coluna = { chave: string; nome: string; cor: string; total: number };
type Interacao = { tipo: string; descricao: string | null; autor: string | null; criado_em: string };
type Metricas = { disparos_recebidos: number; disparos_respondidos: number; sla_medio: number | null; ultima_resposta_disparo: string | null };
type Formulario = { tipo: string; respostas: Record<string, string> | null; pontuacao: number | string | null; respondido_em: string | null };
type Detalhe = {
  contato: {
    nome: string; email: string; telefone: string | null; edicao: string | null; estagio_chave: string | null; estagio_nome: string | null;
    ultima_compra_ht: string | null; tags: string[] | null; responsavel: string | null; opt_out: boolean;
    // Dono por id (a rota já devolve) — é o que diz se o card é de um colega.
    responsavel_id?: string | null;
    legado_no_grupo: boolean | null; legado_ativado: boolean | null;
  };
  timeline: Interacao[];
  metricas: Metricas;
  formularios?: Formulario[];
  score?: number;
};

const FORM_TITULO: Record<string, string> = { matricula: "Qualificação", ficha_hm: "Ficha de Interesse HM", pesquisa: "Pesquisa de qualificação" };

function nivelScore(score: number) {
  if (score >= 60) return { label: "Quente", txt: "text-emerald-600 dark:text-emerald-400", bar: "bg-emerald-500" };
  if (score >= 30) return { label: "Morno", txt: "text-amber-600 dark:text-amber-400", bar: "bg-amber-500" };
  return { label: "Frio", txt: "text-sky-600 dark:text-sky-400", bar: "bg-sky-500" };
}

// Sinal sim/não — situação do lead num relance (no grupo, formulários, etc).
function Sinal({ on, label }: { on: boolean; label: string }) {
  return (
    <span className={cn("inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ring-inset",
      on ? "bg-emerald-50 text-emerald-700 ring-emerald-200 dark:bg-emerald-500/15 dark:text-emerald-300 dark:ring-emerald-500/30"
         : "bg-slate-50 text-slate-400 ring-slate-200 dark:bg-slate-800/50 dark:text-slate-500 dark:ring-slate-700")}>
      <svg className="h-2.5 w-2.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round"><path d={on ? "M20 6 9 17l-5-5" : "M18 6 6 18M6 6l12 12"} /></svg>
      {label}
    </span>
  );
}

function relativo(iso: string | null): string {
  if (!iso) return "";
  const min = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
  if (min < 60) return `${min}m`;
  if (min < 1440) return `${Math.round(min / 60)}h`;
  return `${Math.round(min / 1440)}d`;
}
function fmt(iso: string | null) {
  return iso ? new Date(iso).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) : "—";
}

// Monta o link do WhatsApp (wa.me) a partir do telefone, prefixando 55 quando necessário.
function waLink(tel: string | null): string | null {
  if (!tel) return null;
  let d = tel.replace(/\D/g, "");
  if (d.length < 8) return null;
  if (!d.startsWith("55")) d = "55" + d;
  return `https://wa.me/${d}`;
}
// Rola o board na horizontal com a roda do mouse — assim todas as colunas
// ficam acessíveis sem depender de trackpad/scrollbar. Deixa as colunas com
// muitos cards rolarem na vertical primeiro (não sequestra o scroll interno).
function rolarBoardHorizontal(e: WheelEvent<HTMLDivElement>) {
  const board = e.currentTarget;
  if (board.scrollWidth <= board.clientWidth) return; // nada a rolar
  let node = e.target as HTMLElement | null;
  while (node && node !== board) {
    if (node.hasAttribute?.("data-col-scroll") && node.scrollHeight > node.clientHeight) {
      const aindaRola =
        (e.deltaY < 0 && node.scrollTop > 0) ||
        (e.deltaY > 0 && node.scrollTop + node.clientHeight < node.scrollHeight - 1);
      if (aindaRola) return; // a coluna sob o cursor ainda pode rolar na vertical
    }
    node = node.parentElement;
  }
  if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) {
    board.scrollLeft += e.deltaY;
  }
}

// Cor do indicador de tempo na etapa — esfria/esquenta conforme o card "envelhece" na esteira.
function tempoTom(iso: string | null): string {
  if (!iso) return "text-slate-400 dark:text-slate-500";
  const dias = (Date.now() - new Date(iso).getTime()) / 86_400_000;
  if (dias >= 7) return "text-rose-500 dark:text-rose-400";
  if (dias >= 3) return "text-amber-500 dark:text-amber-400";
  return "text-slate-400 dark:text-slate-500";
}

export default function KanbanPage() {
  const { me, nivel, podeDisparar: podeDisparaFn, podeDistribuir, acaoLivre } = useMe();
  const { portal, evento, base, nome: eventoNome, ehHT } = usePortal();
  const podeDisparar = podeDisparaFn(evento);
  // Card de COLEGA (28/07): o operador VÊ o pool + os cards da equipe, mas só
  // AGE no que é dele ou está livre — o detalhe abre em leitura e a API recusa
  // escrita com 403 `card_de_outro_operador`. A regra é o escopoAcao de
  // lib/papeis (nivel vem de lá, via useMe); como o payload do CARD do kanban
  // genérico não traz ids de dono, aqui a comparação é pelo NOME
  // (`responsavel` × `me.nome`) — o Drawer refina pelo `responsavel_id` que o
  // detalhe devolve (useMe.ehCardDeColega).
  // Ação livre no Seminário para a equipe principal (30/07): quando vale, nenhum
  // card é "de colega" — a fila do SEM é arrastável por inteiro (espelha o backend).
  const cardDeColega = (c: Card) => !acaoLivre(evento) && nivel === "operador" && !!c.responsavel && !!me && c.responsavel !== me.nome;
  const [colunas, setColunas] = useState<Coluna[]>([]);
  const [cards, setCards] = useState<Card[]>([]);
  const [edicoes, setEdicoes] = useState<string[]>([]);
  const [edicao, setEdicao] = useState<string | null>(null);
  const [responsaveis, setResponsaveis] = useState<string[]>([]);
  const [usuarios, setUsuarios] = useState<string[]>([]); // nomes dos CS ativos (atribuição)
  const [tags, setTags] = useState<string[]>([]);
  const [filtroResp, setFiltroResp] = useState("");
  const [filtroTag, setFiltroTag] = useState("");
  const [carregando, setCarregando] = useState(true);
  // Antes um 500 ou uma queda de rede na carga inicial ficavam mudos: a tela
  // parava de carregar e mostrava o board vazio, indistinguível de "sem
  // cards" — o operador não tinha como saber que era falha, não ausência.
  const [erro, setErro] = useState<string | null>(null);
  const [selecionado, setSelecionado] = useState<Card | null>(null);
  const [dispararSelecao, setDispararSelecao] = useState<SelDisparo[] | null>(null);
  const [showInteligente, setShowInteligente] = useState(false);
  const [selecaoMulti, setSelecaoMulti] = useState<Set<string>>(new Set());
  const [menu, setMenu] = useState<{ card: Card; x: number; y: number } | null>(null);
  const arrastando = useRef<Card | null>(null);
  const [sobre, setSobre] = useState<string | null>(null);

  const carregar = useCallback(async () => {
    setCarregando(true);
    try {
      const params = new URLSearchParams();
      params.set("evento", evento);
      if (edicao) params.set("edicao", edicao);
      if (filtroResp) params.set("responsavel", filtroResp);
      if (filtroTag) params.set("tag", filtroTag);
      const r = await fetch(`/api/kanban?${params.toString()}`);
      if (!r.ok) { setErro(msgErroCarregamento(r.status)); return; }
      const d = await r.json();
      if (d.ok) {
        setErro(null);
        setColunas(d.colunas);
        setCards(d.cards);
        if (Array.isArray(d.edicoes)) setEdicoes(d.edicoes);
        if (Array.isArray(d.responsaveis)) setResponsaveis(d.responsaveis);
        if (Array.isArray(d.tags)) setTags(d.tags);
        if (edicao === null && d.edicoes?.length) { setEdicao(d.edicoes[0]); return; }
      } else {
        setErro(msgErroPermissao(d.reason) ?? "Não foi possível carregar a jornada. Tente de novo.");
      }
    } catch {
      // Falha de rede de verdade: o fetch nem completou.
      setErro(msgErroCarregamento());
    } finally {
      setCarregando(false);
    }
  }, [edicao, filtroResp, filtroTag, evento]);

  useEffect(() => { carregar(); }, [carregar]);

  // CS ativos (para atribuir como responsável). 1x na montagem.
  useEffect(() => {
    fetch("/api/usuarios")
      .then((r) => r.json())
      .then((d) => { if (d.ok) setUsuarios(d.usuarios.filter((u: { ativo: boolean }) => u.ativo).map((u: { nome: string }) => u.nome)); })
      .catch(() => {});
  }, []);

  // União dos nomes de CS cadastrados com responsáveis já gravados (legado).
  const opcoesResponsavel = [...new Set([...usuarios, ...responsaveis])].sort();

  async function mover(card: Card, estagioChave: string) {
    if (card.estagio_chave === estagioChave) return;
    const anterior = card.estagio_chave;
    // Update OTIMISTA: move o card já. Mas o PATCH precisa CONFIRMAR — um 403/400/
    // 500 NÃO lança (fetch só rejeita em falha de rede), então checar res.ok é
    // obrigatório. Sem isso, o move falhava calado: a tela mostrava o card na
    // coluna nova, o banco nunca gravava, e o refresh "voltava" o card (bug 30/07).
    const reverter = () => {
      setCards((cs) => cs.map((c) => (c.comprador_id === card.comprador_id ? { ...c, estagio_chave: anterior } : c)));
      setColunas((cols) => cols.map((c) =>
        c.chave === anterior ? { ...c, total: c.total + 1 } : c.chave === estagioChave ? { ...c, total: Math.max(0, c.total - 1) } : c,
      ));
    };
    setCards((cs) => cs.map((c) => (c.comprador_id === card.comprador_id ? { ...c, estagio_chave: estagioChave } : c)));
    setColunas((cols) => cols.map((c) =>
      c.chave === estagioChave ? { ...c, total: c.total + 1 } : c.chave === anterior ? { ...c, total: Math.max(0, c.total - 1) } : c,
    ));
    try {
      // Passa o evento EXPLÍCITO na query: sem isso o backend cai no cookie
      // cs_evento (eventoDe), que fora do HT resolve o evento errado e o move volta
      // 400 estagio_invalido (o card "não movia" no Seminário — bug 30/07). O GET
      // já mandava ?evento; a escrita não — era a assimetria que quebrava.
      const r = await fetch(`/api/kanban?evento=${encodeURIComponent(evento)}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ compradorId: card.comprador_id, estagioChave }) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok || !d.ok) {
        reverter();
        toast(msgErroPermissao(d?.reason) ?? "Não foi possível mover o card. Tente de novo.", "erro");
      }
    } catch {
      // Falha de rede: reverte o otimismo e reconcilia com o servidor.
      reverter();
      carregar();
    }
  }

  async function dispararEtapa(col: Coluna) {
    const params = new URLSearchParams({ estagio: col.chave, com_telefone: "1", evento });
    if (edicao) params.set("edicao", edicao);
    const r = await fetch(`/api/contatos?${params.toString()}`);
    const d = await r.json();
    const lista = (d.ok ? d.contatos : []).filter((c: { telefone: string | null }) => c.telefone);
    if (lista.length === 0) { toast("Nenhum lead com telefone nesta etapa.", "erro"); return; }
    setDispararSelecao(lista.map((c: { comprador_id: string; nome: string; telefone: string; edicao: string | null }) => ({ comprador_id: c.comprador_id, nome: c.nome, telefone: c.telefone, edicao: c.edicao })));
  }

  // Seleção múltipla (checkbox / menu de contexto) para disparo em lote.
  // Card de colega fica FORA da seleção: lote/disparo é agir num card em que o
  // operador não pode agir (a API recusaria um a um).
  function toggleSel(id: string) {
    const c = cards.find((x) => x.comprador_id === id);
    if (c && cardDeColega(c) && !selecaoMulti.has(id)) return;
    setSelecaoMulti((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  }
  function selecionarEtapa(chave: string) {
    setSelecaoMulti((s) => { const n = new Set(s); cards.filter((c) => c.estagio_chave === chave && !cardDeColega(c)).forEach((c) => n.add(c.comprador_id)); return n; });
  }
  function dispararCards(lista: Card[]) {
    const sel = lista.filter((c) => c.telefone).map((c) => ({ comprador_id: c.comprador_id, nome: c.nome, telefone: c.telefone as string, edicao: c.edicao }));
    if (sel.length === 0) { toast("Nenhum dos selecionados tem telefone.", "erro"); return; }
    setDispararSelecao(sel);
  }
  const cardsSelecionados = () => cards.filter((c) => selecaoMulti.has(c.comprador_id));

  // Seleciona a COLUNA INTEIRA — inclusive os cards além dos ~40 renderizados no
  // DOM. Busca os ids da etapa no servidor e marca todos; clicar de novo desmarca.
  const [colBusy, setColBusy] = useState<string | null>(null);
  async function selecionarColunaToda(col: Coluna) {
    setColBusy(col.chave);
    try {
      const params = new URLSearchParams({ estagio: col.chave, evento });
      if (edicao) params.set("edicao", edicao);
      const r = await fetch(`/api/contatos?${params.toString()}`);
      const d = await r.json();
      const ids: string[] = (d.ok ? d.contatos : []).map((c: { comprador_id: string }) => c.comprador_id);
      setSelecaoMulti((s) => {
        const n = new Set(s);
        const todosJa = ids.length > 0 && ids.every((id) => n.has(id));
        ids.forEach((id) => (todosJa ? n.delete(id) : n.add(id)));
        return n;
      });
    } finally {
      setColBusy(null);
    }
  }

  // Disparo da seleção múltipla: como a seleção pode conter cards não
  // renderizados (coluna inteira), resolve os telefones no servidor pelos ids.
  async function dispararSelecaoMulti() {
    const ids = new Set(selecaoMulti);
    if (!ids.size) return;
    const params = new URLSearchParams({ com_telefone: "1", evento });
    if (edicao) params.set("edicao", edicao);
    const r = await fetch(`/api/contatos?${params.toString()}`);
    const d = await r.json();
    const lista = (d.ok ? d.contatos : [])
      .filter((c: { comprador_id: string; telefone: string | null }) => ids.has(c.comprador_id) && c.telefone)
      .map((c: { comprador_id: string; nome: string; telefone: string; edicao: string | null }) => ({ comprador_id: c.comprador_id, nome: c.nome, telefone: c.telefone, edicao: c.edicao }));
    if (!lista.length) { toast("Nenhum dos selecionados tem telefone.", "erro"); return; }
    setDispararSelecao(lista);
  }

  // Ações em lote sobre a seleção (tag / responsável).
  async function lote(payload: { addTag?: string; responsavel?: string | null }) {
    const ids = [...selecaoMulti];
    if (!ids.length) return;
    // evento explícito na query (mesmo motivo do mover): fora do HT o cookie
    // resolveria o evento errado e o lote agiria no portal errado / falharia.
    await fetch(`/api/kanban/lote?evento=${encodeURIComponent(evento)}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ compradorIds: ids, ...payload }) });
    await carregar();
  }
  function addTagLote() {
    const t = window.prompt("Tag para adicionar aos selecionados:");
    if (t && t.trim()) lote({ addTag: t.trim() });
  }

  const totalGeral = colunas.reduce((s, c) => s + c.total, 0);

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="flex items-center gap-2.5">
            <MarcaPortal portal={portal} altura="h-7" comNome={false} />
            <h1 className="text-xl font-semibold tracking-tight text-slate-900 dark:text-slate-100">{ehHT ? "Jornada do HT" : `Jornada · ${eventoNome}`}</h1>
          </div>
          <p className="mt-0.5 text-sm text-slate-500 dark:text-slate-400">
            {totalGeral} {ehHT ? "comprador(es)" : "lead(s)"}{edicao ? ` · ${edicao}` : ""} — arraste os cards entre as etapas, clique para ver detalhes.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <select value={edicao ?? ""} onChange={(e) => setEdicao(e.target.value)} className={fieldCompactClass}>
            <option value="">Todas as edições</option>
            {edicoes.map((ed) => <option key={ed} value={ed}>{ed}</option>)}
          </select>
          {opcoesResponsavel.length > 0 && (
            <select value={filtroResp} onChange={(e) => setFiltroResp(e.target.value)} className={fieldCompactClass}>
              <option value="">Todos os operadores</option>
              {opcoesResponsavel.map((r) => <option key={r} value={r}>{r}</option>)}
            </select>
          )}
          {tags.length > 0 && (
            <select value={filtroTag} onChange={(e) => setFiltroTag(e.target.value)} className={fieldCompactClass}>
              <option value="">Todas as tags</option>
              {tags.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          )}
          {podeDisparar && (
            <Button variant="primary" size="sm" onClick={() => setShowInteligente(true)} title="O sistema monta a lista de quem abordar">
              <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83" /></svg>
              Disparo inteligente
            </Button>
          )}
        </div>
      </div>

      {carregando && cards.length === 0 ? (
        <div className="flex items-center justify-center gap-3 py-20 text-slate-400 dark:text-slate-500">
          <Spinner className="h-6 w-6" /> <span className="text-sm">Carregando jornada…</span>
        </div>
      ) : erro && colunas.length === 0 ? (
        <EmptyState
          icon={
            <svg className="h-9 w-9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0Z" />
              <path d="M12 9v4M12 17h.01" />
            </svg>
          }
          title="Não foi possível carregar a jornada"
          description={erro}
          action={<Button variant="secondary" onClick={carregar}>Tentar de novo</Button>}
        />
      ) : (
        <div
          className={cn("-mx-4 overflow-x-auto px-4 pb-4 sm:-mx-6 sm:px-6", selecaoMulti.size > 0 && "pb-20")}
          onWheel={rolarBoardHorizontal}
        >
          {/* Falha ao recarregar (filtro trocou, ação depois de mover card…) com
              o board já tendo dados: avisa sem trocar a tela inteira por um erro. */}
          {erro && (
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-300" role="alert">
              <span>{erro}</span>
              <Button variant="secondary" size="sm" className="shrink-0" onClick={carregar}>Tentar de novo</Button>
            </div>
          )}
        <Reveal className="flex gap-3">
          {colunas.map((col) => {
            const doCol = cards.filter((c) => c.estagio_chave === col.chave);
            const ativa = sobre === col.chave;
            return (
              <div
                key={col.chave}
                onDragOver={(e) => { e.preventDefault(); setSobre(col.chave); }}
                onDragLeave={() => setSobre((s) => (s === col.chave ? null : s))}
                onDrop={() => { if (arrastando.current) mover(arrastando.current, col.chave); arrastando.current = null; setSobre(null); }}
                className={cn(
                  "js-reveal flex w-72 shrink-0 flex-col rounded-xl border bg-slate-50/60 transition dark:bg-slate-900/40",
                  ativa ? "border-brand/40 bg-brand/5 dark:border-brand-400/40 dark:bg-brand-400/10" : "border-slate-200 dark:border-slate-800",
                )}
              >
                <div className="flex items-center gap-2 border-b border-slate-200 px-3 py-2.5 dark:border-slate-800">
                  <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: col.cor }} />
                  <span className="flex-1 truncate text-sm font-semibold text-slate-700 dark:text-slate-200">{col.nome}</span>
                  <span className="rounded-full bg-slate-200 px-2 py-0.5 text-xs font-semibold tabular-nums text-slate-600 dark:bg-slate-800 dark:text-slate-300">{col.total}</span>
                  {col.total > 0 && (
                    <button
                      onClick={() => selecionarColunaToda(col)}
                      disabled={colBusy === col.chave}
                      title={`Selecionar todos os ${col.total} cards desta coluna`}
                      className="flex h-6 w-6 items-center justify-center rounded-md text-slate-400 transition hover:bg-brand/10 hover:text-brand disabled:opacity-50 dark:text-slate-500 dark:hover:bg-brand-400/15 dark:hover:text-brand-300"
                    >
                      {colBusy === col.chave
                        ? <Spinner className="h-3.5 w-3.5" />
                        : <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" /><path d="m9 11 3 3L22 4" /></svg>}
                    </button>
                  )}
                  {col.total > 0 && podeDisparar && (
                    <button
                      onClick={() => dispararEtapa(col)}
                      title="Disparar para esta etapa"
                      className="flex h-6 w-6 items-center justify-center rounded-md text-slate-400 transition hover:bg-brand/10 hover:text-brand dark:text-slate-500 dark:hover:bg-brand-400/15 dark:hover:text-brand-300"
                    >
                      <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m22 2-7 20-4-9-9-4Z M22 2 11 13" /></svg>
                    </button>
                  )}
                </div>

                <div data-col-scroll className="flex max-h-[70vh] flex-col gap-2 overflow-y-auto p-2">
                  {doCol.length === 0 ? (
                    <p className="px-2 py-6 text-center text-xs text-slate-400 dark:text-slate-600">Ninguém nesta etapa</p>
                  ) : (
                    doCol.map((card) => (
                      <CardItem
                        key={card.comprador_id}
                        card={card}
                        // Mesmo conceito do board HM: para o OPERADOR, o selo
                        // diz o que é POOL (livre para assumir) vs. o que tem
                        // dono — master/gestor distribuem, não assumem, então
                        // para eles seria ruído. Aqui o dono é o texto
                        // `responsavel` (o payload genérico não expõe ids);
                        // para o operador, card visível sem texto = pool.
                        ehPool={nivel === "operador" && !card.responsavel}
                        // Card de colega: abre em leitura, não arrasta, não entra
                        // em lote — o selo diz de quem ele é.
                        colega={cardDeColega(card)}
                        selecionado={selecaoMulti.has(card.comprador_id)}
                        modoSelecao={selecaoMulti.size > 0}
                        onDragStart={() => { arrastando.current = card; }}
                        onClick={() => setSelecionado(card)}
                        onToggleSel={() => toggleSel(card.comprador_id)}
                        onMenu={(x, y) => setMenu({ card, x, y })}
                      />
                    ))
                  )}
                  {col.total > doCol.length && (
                    <p className="px-2 py-2 text-center text-[11px] text-slate-400 dark:text-slate-500">+ {col.total - doCol.length} além dos {doCol.length} mostrados</p>
                  )}
                </div>
              </div>
            );
          })}
        </Reveal>
        </div>
      )}

      {selecionado && (
        <Drawer
          card={selecionado}
          colunas={colunas}
          responsaveis={opcoesResponsavel}
          podeDisparar={podeDisparar}
          onAtualizar={carregar}
          onClose={() => setSelecionado(null)}
          onMover={(chave) => { mover(selecionado, chave); setSelecionado({ ...selecionado, estagio_chave: chave }); }}
          onDisparar={() => {
            if (selecionado.telefone) setDispararSelecao([{ comprador_id: selecionado.comprador_id, nome: selecionado.nome, telefone: selecionado.telefone, edicao: selecionado.edicao }]);
            setSelecionado(null);
          }}
        />
      )}

      {dispararSelecao && (
        <DisparoModal selecao={dispararSelecao} onClose={() => { setDispararSelecao(null); setSelecaoMulti(new Set()); carregar(); }} />
      )}

      {showInteligente && (
        <DisparoInteligente
          onClose={() => setShowInteligente(false)}
          onDisparar={(sel) => { setShowInteligente(false); if (sel.length) setDispararSelecao(sel); }}
        />
      )}

      {/* Barra de ação da seleção múltipla */}
      {selecaoMulti.size > 0 && !dispararSelecao && (
        <div className="fixed inset-x-0 bottom-0 z-40 border-t border-slate-200 bg-white/95 shadow-[0_-2px_12px_rgba(0,0,0,0.06)] backdrop-blur dark:border-slate-800 dark:bg-slate-900/95">
          <div className="mx-auto flex max-w-4xl items-center gap-3 px-4 py-3">
            <span className="text-sm text-slate-700 dark:text-slate-200">
              <span className="font-semibold text-slate-900 dark:text-slate-100">{selecaoMulti.size}</span> selecionado(s)
            </span>
            <Button variant="ghost" size="sm" onClick={() => setSelecaoMulti(new Set())}>Limpar</Button>
            <div className="flex-1" />
            <Button variant="secondary" size="sm" onClick={addTagLote}>+ Tag</Button>
            {/* Atribuir em lote é DISTRIBUIR — só master/gestor. O operador não
                vê o seletor: ele assume contato sem dono um a um, pela ficha. */}
            {podeDistribuir() && (
              <select
                value=""
                onChange={(e) => { const v = e.target.value; if (v) lote({ responsavel: v === "__nenhum__" ? null : v }); e.target.value = ""; }}
                className={cn(fieldClass, "w-auto py-1.5 text-xs")}
                title="Atribuir operador aos selecionados"
              >
                <option value="">Atribuir operador…</option>
                {opcoesResponsavel.map((r) => <option key={r} value={r}>{r}</option>)}
                <option value="__nenhum__">— Remover operador —</option>
              </select>
            )}
            {podeDisparar && (
              <Button variant="primary" onClick={dispararSelecaoMulti}>Disparar para {selecaoMulti.size}</Button>
            )}
          </div>
        </div>
      )}

      {/* Menu de contexto (botão direito no card) */}
      {menu && (
        <>
          <div className="fixed inset-0 z-[55]" onClick={() => setMenu(null)} onContextMenu={(e) => { e.preventDefault(); setMenu(null); }} />
          <div
            className="fixed z-[60] w-56 overflow-hidden rounded-lg border border-slate-200 bg-white py-1 shadow-pop dark:border-slate-700 dark:bg-slate-900"
            style={{ top: Math.min(menu.y, (typeof window !== "undefined" ? window.innerHeight : 800) - 230), left: Math.min(menu.x, (typeof window !== "undefined" ? window.innerWidth : 1200) - 240) }}
          >
            {/* Card de colega: selecionar/disparar são AÇÃO — o menu avisa e não
                oferece; "Abrir detalhes" continua (a leitura é o ponto). */}
            {cardDeColega(menu.card) && (
              <p className="px-3 pb-1.5 text-[11px] text-slate-500 dark:text-slate-400">
                Card de {menu.card.responsavel ?? "outro operador"} — abre em leitura.
              </p>
            )}
            {!cardDeColega(menu.card) && (
            <MenuItem onClick={() => { toggleSel(menu.card.comprador_id); setMenu(null); }}>
              {selecaoMulti.has(menu.card.comprador_id) ? "Desselecionar" : "Selecionar"}
            </MenuItem>
            )}
            <MenuItem onClick={() => { const col = colunas.find((c) => c.chave === menu.card.estagio_chave); if (col) selecionarColunaToda(col); setMenu(null); }}>Selecionar toda a coluna</MenuItem>
            {podeDisparar && !cardDeColega(menu.card) && (
              <>
                <div className="my-1 border-t border-slate-100 dark:border-slate-800" />
                <MenuItem onClick={() => { dispararCards([menu.card]); setMenu(null); }}>Disparar para este</MenuItem>
                {selecaoMulti.size > 0 && (
                  <MenuItem onClick={() => { dispararSelecaoMulti(); setMenu(null); }}>Disparar para selecionados ({selecaoMulti.size})</MenuItem>
                )}
              </>
            )}
            <div className="my-1 border-t border-slate-100 dark:border-slate-800" />
            <MenuItem onClick={() => { setSelecionado(menu.card); setMenu(null); }}>Abrir detalhes</MenuItem>
          </div>
        </>
      )}
    </div>
  );
}

function MenuItem({ children, onClick }: { children: React.ReactNode; onClick: () => void }) {
  return (
    <button onClick={onClick} className="block w-full px-3 py-2 text-left text-sm text-slate-700 transition hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-800">
      {children}
    </button>
  );
}

function CardItem({ card, ehPool, colega, selecionado, modoSelecao, onDragStart, onClick, onToggleSel, onMenu }: {
  card: Card; ehPool?: boolean; colega?: boolean; selecionado: boolean; modoSelecao: boolean;
  onDragStart: () => void; onClick: () => void; onToggleSel: () => void; onMenu: (x: number, y: number) => void;
}) {
  const { base } = usePortal();
  return (
    <div
      role="button"
      tabIndex={0}
      // Card de colega abre (em leitura), mas não arrasta — mover é agir.
      draggable={!colega}
      onDragStart={colega ? undefined : onDragStart}
      onClick={onClick}
      onContextMenu={(e) => { e.preventDefault(); onMenu(e.clientX, e.clientY); }}
      onKeyDown={(e) => { if (e.key === "Enter") onClick(); }}
      title={colega ? `Card de ${card.responsavel ?? "outro operador"} — clique para abrir em leitura` : undefined}
      className={cn(
        "group relative block rounded-lg border bg-white p-2.5 shadow-card transition hover:shadow-soft dark:bg-slate-900",
        colega ? "cursor-pointer" : "cursor-grab active:cursor-grabbing",
        selecionado ? "border-brand ring-2 ring-brand/30 dark:border-brand-400 dark:ring-brand-400/30" : "border-slate-200 hover:border-brand/30 dark:border-slate-800 dark:hover:border-brand-400/30",
      )}
    >
      {/* Checkbox de seleção — aparece no hover ou quando já há seleção.
          Card de colega não entra em seleção (lote é agir) — sem a bolinha. */}
      {!colega && (
      <button
        onClick={(e) => { e.stopPropagation(); onToggleSel(); }}
        aria-label="Selecionar"
        className={cn(
          "absolute -left-1.5 -top-1.5 z-10 flex h-5 w-5 items-center justify-center rounded-full border-2 transition",
          selecionado
            ? "border-brand bg-brand text-white dark:border-brand-400 dark:bg-brand-400 dark:text-slate-900"
            : cn("border-slate-300 bg-white text-transparent dark:border-slate-600 dark:bg-slate-900", modoSelecao ? "opacity-100" : "opacity-0 group-hover:opacity-100"),
        )}
      >
        <svg className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5" /></svg>
      </button>
      )}

      <div className="flex items-start justify-between gap-2">
        <div className="flex flex-wrap gap-1">
          {/* Paleta única de edição (edicao-badge.tsx) — a mesma da lista de Leads. */}
          {card.edicao && <EdicaoBadge edicao={card.edicao} />}
          {card.opt_out && (
            <span className="inline-flex items-center gap-0.5 rounded bg-rose-100 px-1.5 py-0.5 text-[10px] font-semibold text-rose-600 dark:bg-rose-500/15 dark:text-rose-300" title="Opt-out: não recebe disparos">
              <svg className="h-2.5 w-2.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><circle cx="12" cy="12" r="10" /><path d="m5 5 14 14" /></svg>
              opt-out
            </span>
          )}
          {/* Selo do pool (só na visão do operador) — mesmo visual do board HM:
              este card está livre; abra os detalhes e clique em "Atribuir a mim". */}
          {ehPool && (
            <span
              className="inline-flex items-center gap-0.5 rounded border border-dashed border-teal-400 px-1.5 py-0.5 text-[10px] font-semibold text-teal-700 dark:border-teal-500/50 dark:text-teal-300"
              title="Card do pool — sem dono. Abra a ficha e clique em “Atribuir a mim” para assumir."
            >
              <svg className="h-2.5 w-2.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M19 8v6M22 11h-6" /></svg>
              Pool · livre
            </span>
          )}
          {/* Card de colega (visão do operador): contexto, não bloqueio — o
              MESMO selo do board HM, com o nome do dono. Abre em leitura. */}
          {colega && (
            <span
              className="inline-flex max-w-[10rem] items-center gap-0.5 truncate rounded border border-slate-300 bg-slate-50 px-1.5 py-0.5 text-[10px] font-semibold text-slate-500 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-400"
              title={`Card de ${card.responsavel ?? "outro operador"} — você pode ver os detalhes e o histórico, mas quem age é o dono ou o gestor.`}
            >
              <svg className="h-2.5 w-2.5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z" /><circle cx="12" cy="12" r="3" /></svg>
              <span className="truncate">com {card.responsavel ?? "colega"}</span>
            </span>
          )}
          <TagsIcon tags={card.tags} />
        </div>
        <span className={cn("flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold", corAvatar(card.nome))}>{inicial(card.nome)}</span>
      </div>
      <p className="mt-1.5 truncate text-sm font-semibold text-slate-800 dark:text-slate-100">{card.nome}</p>
      <div className="mt-1 flex items-center gap-1.5 text-xs text-slate-400 dark:text-slate-500">
        <svg className="h-3.5 w-3.5 shrink-0 text-emerald-500" viewBox="0 0 24 24" fill="currentColor"><path d="M12.04 2C6.58 2 2.13 6.45 2.13 11.91c0 1.76.46 3.45 1.32 4.95L2 22l5.25-1.38c1.45.79 3.08 1.21 4.79 1.21h.01c5.46 0 9.91-4.45 9.91-9.91C21.96 6.45 17.5 2 12.04 2Z" /></svg>
        <span className="flex-1 truncate">{card.ultima_msg ? card.ultima_msg.replace(/^Respondeu:\s*/, "") : "—"}</span>
        {card.ultima_resposta_em && <span className="shrink-0 tabular-nums">{relativo(card.ultima_resposta_em)}</span>}
      </div>

      {/* Rodapé: responsável (canto inferior esquerdo) + tempo na etapa + ações */}
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
            {card.entrou_estagio_em ? `${relativo(card.entrou_estagio_em)} na etapa` : "sem registro"}
          </span>
        </div>
        <div className="flex items-center gap-0.5 opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100">
          {waLink(card.telefone) && (
            <AcaoCard href={waLink(card.telefone)!} title="Abrir no WhatsApp" cor="hover:text-emerald-600 dark:hover:text-emerald-400">
              <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="currentColor"><path d="M12.04 2C6.58 2 2.13 6.45 2.13 11.91c0 1.76.46 3.45 1.32 4.95L2 22l5.25-1.38c1.45.79 3.08 1.21 4.79 1.21h.01c5.46 0 9.91-4.45 9.91-9.91C21.96 6.45 17.5 2 12.04 2Z" /></svg>
            </AcaoCard>
          )}
          {card.telefone && (
            <AcaoCard href={`tel:${card.telefone.replace(/[^0-9+]/g, "")}`} title="Ligar" cor="hover:text-blue-600 dark:hover:text-blue-400">
              <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.96.36 1.9.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.91.34 1.85.57 2.81.7A2 2 0 0 1 22 16.92Z" /></svg>
            </AcaoCard>
          )}
          {card.email && (
            <AcaoCard href={`mailto:${card.email}`} title="Enviar e-mail" cor="hover:text-violet-600 dark:hover:text-violet-400">
              <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="4" width="20" height="16" rx="2" /><path d="m22 7-10 5L2 7" /></svg>
            </AcaoCard>
          )}
          <AcaoCard link href={`${base}/inbox?c=${card.comprador_id}`} title="Conversar no inbox" cor="hover:text-brand dark:hover:text-brand-300">
            <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" /></svg>
          </AcaoCard>
        </div>
      </div>
    </div>
  );
}

// Botão de ação rápida no card (WhatsApp / ligar / e-mail / inbox). Para de propagar o clique p/ não abrir o detalhe.
function AcaoCard({ href, title, cor, link, children }: { href: string; title: string; cor: string; link?: boolean; children: ReactNode }) {
  const cls = cn("flex h-7 w-7 items-center justify-center rounded-md text-slate-400 transition hover:bg-slate-100 dark:text-slate-500 dark:hover:bg-slate-800", cor);
  const stop = (e: MouseEvent) => e.stopPropagation();
  if (link) return <Link href={href} title={title} aria-label={title} onClick={stop} className={cls}>{children}</Link>;
  return (
    <a href={href} title={title} aria-label={title} onClick={stop} target={href.startsWith("http") ? "_blank" : undefined} rel="noreferrer" className={cls}>
      {children}
    </a>
  );
}

const TL_ICONE: Record<string, { path: string; wrap: string }> = {
  disparo: { path: "m22 2-7 20-4-9-9-4Z M22 2 11 13", wrap: "bg-blue-50 text-blue-600 ring-blue-200 dark:bg-blue-500/15 dark:text-blue-400 dark:ring-blue-500/30" },
  resposta: { path: "M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z", wrap: "bg-emerald-50 text-emerald-600 ring-emerald-200 dark:bg-emerald-500/15 dark:text-emerald-400 dark:ring-emerald-500/30" },
  nota: { path: "M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7 M18.5 2.5a2.1 2.1 0 0 1 3 3L12 15l-4 1 1-4Z", wrap: "bg-amber-50 text-amber-600 ring-amber-200 dark:bg-amber-500/15 dark:text-amber-400 dark:ring-amber-500/30" },
  mudanca_estagio: { path: "M16 3h5v5 M21 3l-7 7 M8 21H3v-5 M3 21l7-7", wrap: "bg-violet-50 text-violet-600 ring-violet-200 dark:bg-violet-500/15 dark:text-violet-400 dark:ring-violet-500/30" },
  sistema: { path: "M13 2 3 14h9l-1 8 10-12h-9l1-8z", wrap: "bg-slate-100 text-slate-500 ring-slate-200 dark:bg-slate-800/60 dark:text-slate-400 dark:ring-slate-700" },
};

function Drawer({ card, colunas, responsaveis, podeDisparar, onClose, onMover, onDisparar, onAtualizar }: {
  card: Card; colunas: Coluna[]; responsaveis: string[]; podeDisparar: boolean; onClose: () => void; onMover: (chave: string) => void; onDisparar: () => void; onAtualizar: () => void;
}) {
  const { base, evento } = usePortal();
  const { me, podeDistribuir, ehCardDeColega } = useMe();
  const [det, setDet] = useState<Detalhe | null>(null);
  const [tagNova, setTagNova] = useState("");
  const [aba, setAba] = useState<"resumo" | "forms" | "historico">("resumo");

  const recarregar = useCallback(
    () => fetch(`/api/contato/${card.comprador_id}?evento=${encodeURIComponent(evento)}`).then((r) => r.json()).then((d) => { if (d.ok) setDet(d); }).catch(() => {}),
    [card.comprador_id, evento],
  );
  useEffect(() => { setDet(null); recarregar(); }, [recarregar]);

  // Card de COLEGA abre em LEITURA (28/07): sem mover etapa, sem tags, sem
  // opt-out — timeline e formulários seguem abertos, que é o ponto. A regra é
  // o escopoAcao de lib/papeis (via useMe.ehCardDeColega), a MESMA do backend.
  // No Seminário a equipe principal age livre (30/07): passa o evento p/ liberar.
  const somenteLeitura = ehCardDeColega(det?.contato, evento);

  async function patch(payload: Record<string, unknown>) {
    // Toda escrita passa por aqui — barrar no ponto único (mesmo padrão do HM).
    if (somenteLeitura) { toast(msgErroPermissao("card_de_outro_operador")!, "erro"); return; }
    // evento explícito: sem isso o backend cai no cookie e, fora do HT, escreve/
    // valida no evento errado (mover pela ficha dava estagio_invalido no SEM).
    await fetch(`/api/contato/${card.comprador_id}?evento=${encodeURIComponent(evento)}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
    await recarregar();
    onAtualizar();
  }
  const tagsAtuais = det?.contato.tags ?? [];
  function addTag() {
    const t = tagNova.trim();
    setTagNova("");
    if (t && !tagsAtuais.includes(t)) patch({ tags: [...tagsAtuais, t] });
  }
  const removeTag = (t: string) => patch({ tags: tagsAtuais.filter((x) => x !== t) });

  const m = det?.metricas;
  const taxa = m && m.disparos_recebidos ? Math.round((m.disparos_respondidos / m.disparos_recebidos) * 100) : 0;
  const respondeu = !!(m && m.disparos_respondidos > 0);
  const forms = det?.formularios ?? [];
  const score = det?.score ?? 0;
  const nivel = nivelScore(score);
  const noGrupo = !!(det?.contato.tags?.includes("No grupo") || det?.contato.legado_no_grupo);

  return (
    <>
      <div className="fixed inset-0 z-40 bg-slate-900/40 backdrop-blur-sm" onClick={onClose} />
      <aside className="fixed inset-y-0 right-0 z-50 flex w-full max-w-md flex-col overflow-hidden border-l border-slate-200 bg-white shadow-pop animate-fade-in dark:border-slate-800 dark:bg-slate-900">
        {/* Header */}
        <div className="flex items-start gap-3 border-b border-slate-100 p-5 dark:border-slate-800">
          <span className={cn("flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-base font-semibold", corAvatar(card.nome))}>{inicial(card.nome)}</span>
          <div className="min-w-0 flex-1">
            <h2 className="truncate text-lg font-semibold text-slate-900 dark:text-slate-100">{card.nome}</h2>
            <p className="truncate text-xs text-slate-500 dark:text-slate-400">{card.telefone || "sem telefone"}{card.edicao ? ` · ${card.edicao}` : ""}</p>
          </div>
          <Button variant="ghost" size="icon" onClick={onClose} aria-label="Fechar painel">
            <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12" /></svg>
          </Button>
        </div>

        {/* Abas */}
        <div className="flex gap-1 border-b border-slate-100 px-3 dark:border-slate-800">
          {([["resumo", "Resumo"], ["forms", `Formulários${forms.length ? ` (${forms.length})` : ""}`], ["historico", "Histórico"]] as const).map(([k, label]) => (
            <button
              key={k}
              onClick={() => setAba(k)}
              className={cn(
                "relative px-3 py-2.5 text-sm font-medium transition-colors",
                aba === k ? "text-brand dark:text-brand-300" : "text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200",
              )}
            >
              {label}
              {aba === k && <span className="absolute inset-x-2 -bottom-px h-0.5 rounded-full bg-brand dark:bg-brand-400" />}
            </button>
          ))}
        </div>

        <div className="flex-1 space-y-5 overflow-y-auto p-5">
          {/* ===== Aba RESUMO ===== */}
          {aba === "resumo" && (
            <>
              {/* Card de colega: contexto, não erro — o mesmo aviso slate do HM. */}
              {somenteLeitura && (
                <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600 dark:border-slate-700 dark:bg-slate-800/60 dark:text-slate-300">
                  <strong className="text-slate-700 dark:text-slate-200">Card de {det?.contato.responsavel ?? "outro operador"}.</strong>{" "}
                  Você pode ver os detalhes e o histórico, mas não alterar — só quem pode agir é o dono ou o gestor.
                </div>
              )}
              {/* Respondeu? + métricas */}
              <div className={cn("flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium",
                respondeu ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300" : "bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400")}>
                {respondeu ? "✓ Já respondeu a disparo" : "Ainda não respondeu a disparos"}
              </div>

              {/* Termômetro + situação do lead */}
              {det && (
                <div className="space-y-3 rounded-lg border border-slate-200 bg-slate-50/60 p-3 dark:border-slate-800 dark:bg-slate-800/40">
                  <div>
                    <div className="flex items-center justify-between text-xs">
                      <span className="font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">Termômetro</span>
                      <span className={cn("font-bold", nivel.txt)}>{nivel.label} · {score}/100</span>
                    </div>
                    <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-slate-200/70 dark:bg-slate-700/50">
                      <div className={cn("h-full rounded-full", nivel.bar)} style={{ width: `${Math.max(2, score)}%` }} />
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    <Sinal on={noGrupo} label="No grupo" />
                    <Sinal on={forms.some((f) => f.tipo === "matricula" || f.tipo === "pesquisa")} label="Qualificação" />
                    <Sinal on={forms.some((f) => f.tipo === "ficha_hm")} label="Ficha HM" />
                    <Sinal on={!!det.contato.legado_ativado} label="Ativado" />
                  </div>
                </div>
              )}

              <div className="grid grid-cols-2 gap-2">
                <MiniM label="Disparos" valor={m?.disparos_recebidos ?? "—"} />
                <MiniM label="Respondidos" valor={m?.disparos_respondidos ?? "—"} />
                <MiniM label="Taxa" valor={m ? `${taxa}%` : "—"} />
                <MiniM label="SLA médio" valor={m?.sla_medio != null ? `${m.sla_medio} min` : "—"} />
              </div>

              {/* Mover etapa */}
              <div>
                <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">Etapa da jornada</label>
                <select value={card.estagio_chave} disabled={somenteLeitura} onChange={(e) => onMover(e.target.value)} className={fieldClass}>
                  {colunas.map((c) => <option key={c.chave} value={c.chave}>{c.nome}</option>)}
                </select>
              </div>

              {/* Tags, responsável e opt-out */}
              {det && (
                <div className="space-y-3">
                  <div>
                    <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">Tags</label>
                    <div className="flex flex-wrap items-center gap-1.5">
                      {tagsAtuais.map((t) => (
                        <span key={t} className={cn("inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset", tagTone(t))}>
                          {t}
                          {!somenteLeitura && <button onClick={() => removeTag(t)} className="opacity-60 transition hover:opacity-100" aria-label={`Remover ${t}`}>×</button>}
                        </span>
                      ))}
                      {!somenteLeitura && (
                        <input
                          value={tagNova}
                          onChange={(e) => setTagNova(e.target.value)}
                          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addTag(); } }}
                          onBlur={addTag}
                          placeholder="+ nova"
                          className="w-20 rounded-full border border-dashed border-slate-300 bg-transparent px-2 py-0.5 text-xs outline-none placeholder:text-slate-400 focus:border-brand dark:border-slate-600 dark:text-slate-200"
                        />
                      )}
                    </div>
                    {!somenteLeitura && (
                      <div className="mt-1.5 flex flex-wrap gap-1">
                        {TAGS_PADRAO.filter((t) => !tagsAtuais.includes(t)).map((t) => (
                          <button key={t} onClick={() => patch({ tags: [...tagsAtuais, t] })} className={cn("rounded-full px-2 py-0.5 text-[11px] font-medium opacity-70 ring-1 ring-inset transition hover:opacity-100", tagTone(t))}>+ {t}</button>
                        ))}
                      </div>
                    )}
                  </div>
                  <div>
                    <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">Operador</label>
                    {podeDistribuir() ? (
                      // MASTER/GESTOR: seletor de destino (o backend valida a equipe).
                      <div className="flex items-center gap-2">
                        {det.contato.responsavel && <Avatar nome={det.contato.responsavel} className="h-8 w-8 text-xs" />}
                        <select
                          value={det.contato.responsavel ?? ""}
                          onChange={(e) => { const v = e.target.value; patch({ responsavel: v || null }); }}
                          className={fieldClass}
                        >
                          <option value="">— Sem operador —</option>
                          {det.contato.responsavel && !responsaveis.includes(det.contato.responsavel) && (
                            <option value={det.contato.responsavel}>{det.contato.responsavel}</option>
                          )}
                          {responsaveis.map((r) => <option key={r} value={r}>{r}</option>)}
                        </select>
                      </div>
                    ) : (
                      // OPERADOR: sem seletor — lê o dono; contato livre pode assumir.
                      <div className="flex items-center gap-2 pt-1">
                        {det.contato.responsavel ? (
                          <>
                            <Avatar nome={det.contato.responsavel} className="h-8 w-8 text-xs" />
                            <span className="text-sm font-medium text-slate-700 dark:text-slate-200">{det.contato.responsavel}</span>
                          </>
                        ) : (
                          <span className="inline-flex items-center rounded-lg border border-dashed border-teal-400 px-2.5 py-1.5 text-xs font-medium text-teal-700 dark:border-teal-500/50 dark:text-teal-300">
                            Sem operador — livre para assumir
                          </span>
                        )}
                      </div>
                    )}
                    {/* Assumir: master/gestor sempre; operador SÓ contato sem dono. */}
                    {me?.nome && det.contato.responsavel !== me.nome && (podeDistribuir() || !det.contato.responsavel) && (
                      <button
                        type="button"
                        onClick={() => patch({ responsavel: me.nome })}
                        className="mt-1.5 inline-flex items-center gap-1.5 text-xs font-medium text-brand transition hover:underline dark:text-brand-300"
                        title={det.contato.responsavel ? `Assumir de ${det.contato.responsavel}` : "Assumir este lead"}
                      >
                        <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M19 8v6M22 11h-6" /></svg>
                        {det.contato.responsavel ? "Assumir para mim" : "Atribuir a mim"}
                      </button>
                    )}
                  </div>
                  <label className="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-200">
                    <input type="checkbox" checked={!!det.contato.opt_out} disabled={somenteLeitura} onChange={(e) => patch({ opt_out: e.target.checked })} className="h-4 w-4 rounded border-slate-300 text-rose-600 focus:ring-rose-500 dark:border-slate-600" />
                    Opt-out — não recebe disparos
                  </label>
                </div>
              )}
              {!det && <div className="flex items-center gap-2 py-4 text-sm text-slate-400 dark:text-slate-500"><Spinner className="h-4 w-4" /> Carregando…</div>}
            </>
          )}

          {/* ===== Aba FORMULÁRIOS ===== */}
          {aba === "forms" && (
            !det ? (
              <div className="flex items-center gap-2 py-4 text-sm text-slate-400 dark:text-slate-500"><Spinner className="h-4 w-4" /> Carregando…</div>
            ) : forms.length === 0 ? (
              <p className="py-2 text-sm text-slate-400 dark:text-slate-500">Nenhum formulário respondido por este lead.</p>
            ) : (
              <div className="space-y-4">
                {forms.map((f, i) => {
                  const respostas = f.respostas && typeof f.respostas === "object" ? Object.entries(f.respostas) : [];
                  return (
                    <div key={i} className="rounded-lg border border-slate-200 p-3 dark:border-slate-800">
                      <div className="mb-2 flex items-center justify-between gap-2">
                        <h4 className="text-sm font-semibold text-slate-800 dark:text-slate-100">{FORM_TITULO[f.tipo] || f.tipo}</h4>
                        {f.pontuacao != null && f.pontuacao !== "" && (
                          <span className="shrink-0 rounded-full bg-brand/10 px-2 py-0.5 text-xs font-semibold tabular-nums text-brand dark:bg-brand-400/15 dark:text-brand-300">{f.pontuacao} pts</span>
                        )}
                      </div>
                      <dl className="space-y-2">
                        {respostas.map(([q, a]) => (
                          <div key={q}>
                            <dt className="text-xs text-slate-400 dark:text-slate-500">{q}</dt>
                            <dd className="text-sm font-medium text-slate-700 dark:text-slate-200">{String(a).trim() || "—"}</dd>
                          </div>
                        ))}
                        {respostas.length === 0 && <p className="text-sm text-slate-400 dark:text-slate-500">Sem respostas registradas.</p>}
                      </dl>
                      {f.respondido_em && <p className="mt-2 border-t border-slate-100 pt-2 text-xs text-slate-400 dark:border-slate-800 dark:text-slate-500">Respondido em {fmt(f.respondido_em)}</p>}
                    </div>
                  );
                })}
              </div>
            )
          )}

          {/* ===== Aba HISTÓRICO ===== */}
          {aba === "historico" && (
            !det ? (
              <div className="flex items-center gap-2 py-4 text-sm text-slate-400 dark:text-slate-500"><Spinner className="h-4 w-4" /> Carregando…</div>
            ) : det.timeline.length === 0 ? (
              <p className="py-2 text-sm text-slate-400 dark:text-slate-500">Sem interações ainda.</p>
            ) : (
              <ul className="space-y-3">
                {det.timeline.slice(0, 50).map((it, i) => {
                  const ic = TL_ICONE[it.tipo] || TL_ICONE.sistema;
                  return (
                    <li key={i} className="flex gap-2.5">
                      <span className={cn("flex h-7 w-7 shrink-0 items-center justify-center rounded-full ring-1 ring-inset", ic.wrap)}>
                        <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d={ic.path} /></svg>
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="text-sm text-slate-700 dark:text-slate-200">{it.descricao || it.tipo}</p>
                        <p className="text-[11px] tabular-nums text-slate-400 dark:text-slate-500">{fmt(it.criado_em)}{it.autor ? ` · ${it.autor}` : ""}</p>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )
          )}
        </div>

        {/* Ações */}
        <div className="sticky bottom-0 flex gap-2 border-t border-slate-100 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
          <Link href={`${base}/contatos/${card.comprador_id}`} className="flex-1">
            <Button variant="secondary" className="w-full">Ficha completa</Button>
          </Link>
          {/* Disparar é AGIR no lead do colega — some no modo leitura. */}
          {card.telefone && podeDisparar && !somenteLeitura && <Button variant="primary" onClick={onDisparar} className="flex-1">Disparar</Button>}
        </div>
      </aside>
    </>
  );
}

function MiniM({ label, valor }: { label: string; valor: string | number }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50/60 p-2.5 dark:border-slate-800 dark:bg-slate-800/40">
      <div className="text-lg font-semibold tabular-nums text-slate-900 dark:text-slate-100">{valor}</div>
      <div className="text-[11px] font-medium uppercase tracking-wide text-slate-400 dark:text-slate-500">{label}</div>
    </div>
  );
}
