"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { WheelEvent } from "react";
import { cn, fieldClass, Spinner } from "@/app/_components/ui";
import { Avatar, corAvatar, inicial } from "@/app/_components/avatar";
import { Reveal } from "@/app/_components/anim";
import { HmDrawer } from "@/app/hm/_components/hm-drawer";

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
type Coluna = { chave: string; nome: string; cor: string; aba: string | null; total: number };

const ABAS: { id: string; label: string }[] = [
  { id: "comercial", label: "Comercial" },
  { id: "ativacao", label: "Ativação" },
];

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
  const [colunas, setColunas] = useState<Coluna[]>([]);
  const [cards, setCards] = useState<Card[]>([]);
  const [responsaveis, setResponsaveis] = useState<string[]>([]);
  const [estagios, setEstagios] = useState<Estagio[]>([]);
  const [filtroResp, setFiltroResp] = useState("");
  const [busca, setBusca] = useState("");
  const [aba, setAba] = useState("comercial");
  const [carregando, setCarregando] = useState(true);
  const [sobre, setSobre] = useState<string | null>(null);
  const [selecionado, setSelecionado] = useState<string | null>(null);
  const arrastando = useRef<Card | null>(null);

  const carregar = useCallback(async () => {
    setCarregando(true);
    try {
      const params = new URLSearchParams();
      if (filtroResp) params.set("responsavel", filtroResp);
      const r = await fetch(`/api/hm/kanban?${params.toString()}`);
      const d = await r.json();
      if (d.ok) {
        setColunas(d.colunas);
        setCards(d.cards);
        if (Array.isArray(d.responsaveis)) setResponsaveis(d.responsaveis);
      }
    } finally {
      setCarregando(false);
    }
  }, [filtroResp]);

  useEffect(() => { carregar(); }, [carregar]);
  useEffect(() => {
    fetch("/api/hm/estagios").then((r) => r.json()).then((d) => { if (d.ok) setEstagios(d.estagios); }).catch(() => {});
  }, []);

  async function mover(card: Card, estagioChave: string) {
    if (card.estagio_chave === estagioChave) return;
    // Otimista; se a etapa for "Pagamento Realizado", o servidor joga pra
    // Ativação — recarrega para refletir a transição automática.
    const vaiParaAtivacao = estagioChave === "hm_pagamento_realizado";
    setCards((cs) => cs.map((c) => (c.comprador_id === card.comprador_id ? { ...c, estagio_chave: estagioChave } : c)));
    try {
      await fetch("/api/hm/kanban", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ compradorId: card.comprador_id, estagioChave }),
      });
    } finally {
      if (vaiParaAtivacao) await carregar();
    }
  }

  const q = busca.trim().toLowerCase();
  const cardsFiltrados = q ? cards.filter((c) => c.nome.toLowerCase().includes(q) || (c.telefone ?? "").includes(q)) : cards;
  const colunasAba = colunas.filter((c) => (c.aba ?? "comercial") === aba);
  const totalComercial = colunas.filter((c) => c.aba === "comercial").reduce((s, c) => s + c.total, 0);
  const totalAtivacao = colunas.filter((c) => c.aba === "ativacao").reduce((s, c) => s + c.total, 0);

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-slate-900 dark:text-slate-100">Ativação · Holding Masters</h1>
          <p className="mt-0.5 text-sm text-slate-500 dark:text-slate-400">
            Turma T39 · {totalComercial + totalAtivacao} aluno(s) — arraste os cards entre as etapas.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative">
            <svg className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8" /><path d="m21 21-4.3-4.3" /></svg>
            <input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar aluno…" className={cn(fieldClass, "w-48 pl-8")} />
          </div>
          {responsaveis.length > 0 && (
            <select value={filtroResp} onChange={(e) => setFiltroResp(e.target.value)} className={cn(fieldClass, "w-auto")}>
              <option value="">Todos os responsáveis</option>
              {responsaveis.map((r) => <option key={r} value={r}>{r}</option>)}
            </select>
          )}
        </div>
      </div>

      {/* Abas Comercial / Ativação */}
      <div className="mb-4 inline-flex rounded-lg border border-slate-200 bg-slate-50 p-1 dark:border-slate-800 dark:bg-slate-900/60">
        {ABAS.map((a) => {
          const ativa = aba === a.id;
          const total = a.id === "comercial" ? totalComercial : totalAtivacao;
          return (
            <button
              key={a.id}
              onClick={() => setAba(a.id)}
              className={cn(
                "flex items-center gap-2 rounded-md px-4 py-1.5 text-sm font-medium transition",
                ativa ? "bg-white text-slate-900 shadow-card dark:bg-slate-800 dark:text-slate-100" : "text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200",
              )}
            >
              {a.label}
              <span className={cn("rounded-full px-1.5 py-0.5 text-[11px] font-semibold tabular-nums", ativa ? "bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-200" : "bg-slate-200/60 text-slate-500 dark:bg-slate-800 dark:text-slate-400")}>{total}</span>
            </button>
          );
        })}
      </div>

      {carregando && cards.length === 0 ? (
        <div className="flex items-center justify-center gap-3 py-20 text-slate-400 dark:text-slate-500">
          <Spinner className="h-6 w-6" /> <span className="text-sm">Carregando esteira…</span>
        </div>
      ) : (
        <div className="-mx-4 overflow-x-auto px-4 pb-4 sm:-mx-6 sm:px-6" onWheel={rolarBoardHorizontal}>
          <Reveal className="flex gap-3">
            {colunasAba.map((col) => {
              const doCol = cardsFiltrados.filter((c) => c.estagio_chave === col.chave);
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
                  </div>
                  <div data-col-scroll className="flex max-h-[70vh] flex-col gap-2 overflow-y-auto p-2">
                    {doCol.length === 0 ? (
                      <p className="px-2 py-6 text-center text-xs text-slate-400 dark:text-slate-600">Sem cards</p>
                    ) : (
                      doCol.map((card) => (
                        <CardItem key={card.comprador_id} card={card} onDragStart={() => { arrastando.current = card; }} onAbrir={() => setSelecionado(card.comprador_id)} />
                      ))
                    )}
                  </div>
                </div>
              );
            })}
          </Reveal>
        </div>
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

function CardItem({ card, onDragStart, onAbrir }: { card: Card; onDragStart: () => void; onAbrir: () => void }) {
  const cat = catLabel(card.categoria_entrada);
  const wa = waLink(card.telefone);
  // Data relevante à etapa: reunião (Comercial) ou entrevista (Ativação).
  const dataEtapa = card.estagio_chave === "hm_reuniao_agendada" ? { label: "Reunião", quando: card.reuniao_em }
    : card.estagio_chave === "hm_entrevista_agendada" ? { label: "Entrevista", quando: card.entrevista_em }
    : null;
  return (
    <div
      role="button"
      tabIndex={0}
      draggable
      onDragStart={onDragStart}
      onClick={onAbrir}
      onKeyDown={(e) => { if (e.key === "Enter") onAbrir(); }}
      className="group relative block cursor-pointer rounded-lg border border-slate-200 bg-white p-2.5 shadow-card transition hover:border-brand/30 hover:shadow-soft dark:border-slate-800 dark:bg-slate-900 dark:hover:border-brand-400/30"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex flex-wrap gap-1">
          {cat && <span className={cn("inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-semibold", cat.cls)}>{cat.txt}</span>}
          {card.apto_ativacao && (
            <span className="inline-flex items-center gap-0.5 rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold text-amber-800 dark:bg-amber-500/15 dark:text-amber-300" title="Pagamento do saldo confirmado">
              <svg className="h-2.5 w-2.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5" /></svg>
              apto
            </span>
          )}
        </div>
        <span className={cn("flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold", corAvatar(card.nome))}>{inicial(card.nome)}</span>
      </div>

      <p className="mt-1.5 truncate text-sm font-semibold text-slate-800 dark:text-slate-100">{card.nome}</p>
      {card.plano && <p className="mt-0.5 truncate text-[11px] text-slate-400 dark:text-slate-500">{card.plano}</p>}

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
