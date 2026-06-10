"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Button, cn, fieldClass, Spinner } from "@/app/_components/ui";
import { DisparoModal } from "@/app/_components/disparo";

type SelDisparo = { comprador_id: string; nome: string; telefone: string; edicao?: string | null };

type Card = {
  comprador_id: string;
  nome: string;
  telefone: string | null;
  edicao: string | null;
  estagio_chave: string;
  tags: string[];
  ultima_resposta_em: string | null;
  ultima_msg: string | null;
};
type Coluna = { chave: string; nome: string; cor: string; total: number };
type Interacao = { tipo: string; descricao: string | null; autor: string | null; criado_em: string };
type Metricas = { disparos_recebidos: number; disparos_respondidos: number; sla_medio: number | null; ultima_resposta_disparo: string | null };
type Detalhe = {
  contato: { nome: string; email: string; telefone: string | null; edicao: string | null; estagio_chave: string | null; estagio_nome: string | null; ultima_compra_ht: string | null };
  timeline: Interacao[];
  metricas: Metricas;
};

const AVATAR = ["bg-brand-100 text-brand-700", "bg-blue-100 text-blue-700", "bg-emerald-100 text-emerald-700", "bg-amber-100 text-amber-800", "bg-violet-100 text-violet-700", "bg-rose-100 text-rose-700", "bg-cyan-100 text-cyan-700"];
const AVATAR_DARK = ["dark:bg-brand-400/20 dark:text-brand-300", "dark:bg-blue-500/20 dark:text-blue-300", "dark:bg-emerald-500/20 dark:text-emerald-300", "dark:bg-amber-500/20 dark:text-amber-300", "dark:bg-violet-500/20 dark:text-violet-300", "dark:bg-rose-500/20 dark:text-rose-300", "dark:bg-cyan-500/20 dark:text-cyan-300"];
function corAvatar(nome: string) {
  let h = 0;
  for (let i = 0; i < (nome?.length || 0); i++) h = (h * 31 + nome.charCodeAt(i)) >>> 0;
  const i = h % AVATAR.length;
  return `${AVATAR[i]} ${AVATAR_DARK[i]}`;
}
const inicial = (nome: string) => (nome?.trim()?.[0] || "?").toUpperCase();

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

const EDICAO_COR: Record<string, string> = {
  HT21: "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300",
  HT22: "bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300",
  HT23: "bg-lime-100 text-lime-700 dark:bg-lime-500/15 dark:text-lime-300",
  HT24: "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300",
  HT25: "bg-cyan-100 text-cyan-700 dark:bg-cyan-500/15 dark:text-cyan-300",
  HT26: "bg-blue-100 text-blue-700 dark:bg-blue-500/15 dark:text-blue-300",
  HT27: "bg-violet-100 text-violet-700 dark:bg-violet-500/15 dark:text-violet-300",
};

export default function KanbanPage() {
  const [colunas, setColunas] = useState<Coluna[]>([]);
  const [cards, setCards] = useState<Card[]>([]);
  const [edicoes, setEdicoes] = useState<string[]>([]);
  const [edicao, setEdicao] = useState<string | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [selecionado, setSelecionado] = useState<Card | null>(null);
  const [dispararSelecao, setDispararSelecao] = useState<SelDisparo[] | null>(null);
  const [selecaoMulti, setSelecaoMulti] = useState<Set<string>>(new Set());
  const [menu, setMenu] = useState<{ card: Card; x: number; y: number } | null>(null);
  const arrastando = useRef<Card | null>(null);
  const [sobre, setSobre] = useState<string | null>(null);

  const carregar = useCallback(async (ed: string) => {
    setCarregando(true);
    try {
      const params = new URLSearchParams();
      if (ed) params.set("edicao", ed);
      const r = await fetch(`/api/kanban?${params.toString()}`);
      const d = await r.json();
      if (d.ok) {
        setColunas(d.colunas);
        setCards(d.cards);
        if (Array.isArray(d.edicoes)) setEdicoes(d.edicoes);
        if (edicao === null && d.edicoes?.length) { setEdicao(d.edicoes[0]); return; }
      }
    } finally {
      setCarregando(false);
    }
  }, [edicao]);

  useEffect(() => { carregar(edicao ?? ""); }, [edicao, carregar]);

  async function mover(card: Card, estagioChave: string) {
    if (card.estagio_chave === estagioChave) return;
    const anterior = card.estagio_chave;
    setCards((cs) => cs.map((c) => (c.comprador_id === card.comprador_id ? { ...c, estagio_chave: estagioChave } : c)));
    setColunas((cols) => cols.map((c) =>
      c.chave === estagioChave ? { ...c, total: c.total + 1 } : c.chave === anterior ? { ...c, total: Math.max(0, c.total - 1) } : c,
    ));
    try {
      await fetch("/api/kanban", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ compradorId: card.comprador_id, estagioChave }) });
    } catch { carregar(edicao ?? ""); }
  }

  async function dispararEtapa(col: Coluna) {
    const params = new URLSearchParams({ estagio: col.chave, com_telefone: "1" });
    if (edicao) params.set("edicao", edicao);
    const r = await fetch(`/api/contatos?${params.toString()}`);
    const d = await r.json();
    const lista = (d.ok ? d.contatos : []).filter((c: { telefone: string | null }) => c.telefone);
    if (lista.length === 0) { alert("Nenhum contato com telefone nesta etapa."); return; }
    setDispararSelecao(lista.map((c: { comprador_id: string; nome: string; telefone: string; edicao: string | null }) => ({ comprador_id: c.comprador_id, nome: c.nome, telefone: c.telefone, edicao: c.edicao })));
  }

  // Seleção múltipla (checkbox / menu de contexto) para disparo em lote.
  function toggleSel(id: string) {
    setSelecaoMulti((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  }
  function selecionarEtapa(chave: string) {
    setSelecaoMulti((s) => { const n = new Set(s); cards.filter((c) => c.estagio_chave === chave).forEach((c) => n.add(c.comprador_id)); return n; });
  }
  function dispararCards(lista: Card[]) {
    const sel = lista.filter((c) => c.telefone).map((c) => ({ comprador_id: c.comprador_id, nome: c.nome, telefone: c.telefone as string, edicao: c.edicao }));
    if (sel.length === 0) { alert("Nenhum dos selecionados tem telefone."); return; }
    setDispararSelecao(sel);
  }
  const cardsSelecionados = () => cards.filter((c) => selecaoMulti.has(c.comprador_id));

  const totalGeral = colunas.reduce((s, c) => s + c.total, 0);

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-slate-900 dark:text-slate-100">Jornada do HT</h1>
          <p className="mt-0.5 text-sm text-slate-500 dark:text-slate-400">
            {totalGeral} comprador(es){edicao ? ` · ${edicao}` : ""} — arraste os cards entre as etapas, clique para ver detalhes.
          </p>
        </div>
        <select value={edicao ?? ""} onChange={(e) => setEdicao(e.target.value)} className={cn(fieldClass, "w-auto")}>
          <option value="">Todas as edições</option>
          {edicoes.map((ed) => <option key={ed} value={ed}>{ed}</option>)}
        </select>
      </div>

      {carregando && cards.length === 0 ? (
        <div className="flex items-center justify-center gap-3 py-20 text-slate-400 dark:text-slate-500">
          <Spinner className="h-6 w-6" /> <span className="text-sm">Carregando jornada…</span>
        </div>
      ) : (
        <div className={cn("-mx-4 flex gap-3 overflow-x-auto px-4 pb-4 sm:-mx-6 sm:px-6", selecaoMulti.size > 0 && "pb-20")}>
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
                  "flex w-72 shrink-0 flex-col rounded-xl border bg-slate-50/60 transition dark:bg-slate-900/40",
                  ativa ? "border-brand/40 bg-brand/5 dark:border-brand-400/40 dark:bg-brand-400/10" : "border-slate-200 dark:border-slate-800",
                )}
              >
                <div className="flex items-center gap-2 border-b border-slate-200 px-3 py-2.5 dark:border-slate-800">
                  <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: col.cor }} />
                  <span className="flex-1 truncate text-sm font-semibold text-slate-700 dark:text-slate-200">{col.nome}</span>
                  <span className="rounded-full bg-slate-200 px-2 py-0.5 text-xs font-semibold tabular-nums text-slate-600 dark:bg-slate-800 dark:text-slate-300">{col.total}</span>
                  {col.total > 0 && (
                    <button
                      onClick={() => dispararEtapa(col)}
                      title="Disparar para esta etapa"
                      className="flex h-6 w-6 items-center justify-center rounded-md text-slate-400 transition hover:bg-brand/10 hover:text-brand dark:text-slate-500 dark:hover:bg-brand-400/15 dark:hover:text-brand-300"
                    >
                      <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m22 2-7 20-4-9-9-4Z M22 2 11 13" /></svg>
                    </button>
                  )}
                </div>

                <div className="flex max-h-[70vh] flex-col gap-2 overflow-y-auto p-2">
                  {doCol.length === 0 ? (
                    <p className="px-2 py-6 text-center text-xs text-slate-400 dark:text-slate-600">Sem cards</p>
                  ) : (
                    doCol.map((card) => (
                      <CardItem
                        key={card.comprador_id}
                        card={card}
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
        </div>
      )}

      {selecionado && (
        <Drawer
          card={selecionado}
          colunas={colunas}
          onClose={() => setSelecionado(null)}
          onMover={(chave) => { mover(selecionado, chave); setSelecionado({ ...selecionado, estagio_chave: chave }); }}
          onDisparar={() => {
            if (selecionado.telefone) setDispararSelecao([{ comprador_id: selecionado.comprador_id, nome: selecionado.nome, telefone: selecionado.telefone, edicao: selecionado.edicao }]);
            setSelecionado(null);
          }}
        />
      )}

      {dispararSelecao && (
        <DisparoModal selecao={dispararSelecao} onClose={() => { setDispararSelecao(null); setSelecaoMulti(new Set()); carregar(edicao ?? ""); }} />
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
            <Button variant="primary" onClick={() => dispararCards(cardsSelecionados())}>Disparar para {selecaoMulti.size}</Button>
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
            <MenuItem onClick={() => { toggleSel(menu.card.comprador_id); setMenu(null); }}>
              {selecaoMulti.has(menu.card.comprador_id) ? "Desselecionar" : "Selecionar"}
            </MenuItem>
            <MenuItem onClick={() => { selecionarEtapa(menu.card.estagio_chave); setMenu(null); }}>Selecionar todos desta etapa</MenuItem>
            <div className="my-1 border-t border-slate-100 dark:border-slate-800" />
            <MenuItem onClick={() => { dispararCards([menu.card]); setMenu(null); }}>Disparar para este</MenuItem>
            {selecaoMulti.size > 0 && (
              <MenuItem onClick={() => { dispararCards(cardsSelecionados()); setMenu(null); }}>Disparar para selecionados ({selecaoMulti.size})</MenuItem>
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

function CardItem({ card, selecionado, modoSelecao, onDragStart, onClick, onToggleSel, onMenu }: {
  card: Card; selecionado: boolean; modoSelecao: boolean;
  onDragStart: () => void; onClick: () => void; onToggleSel: () => void; onMenu: (x: number, y: number) => void;
}) {
  return (
    <div
      role="button"
      tabIndex={0}
      draggable
      onDragStart={onDragStart}
      onClick={onClick}
      onContextMenu={(e) => { e.preventDefault(); onMenu(e.clientX, e.clientY); }}
      onKeyDown={(e) => { if (e.key === "Enter") onClick(); }}
      className={cn(
        "group relative block cursor-grab rounded-lg border bg-white p-2.5 shadow-card transition hover:shadow-soft active:cursor-grabbing dark:bg-slate-900",
        selecionado ? "border-brand ring-2 ring-brand/30 dark:border-brand-400 dark:ring-brand-400/30" : "border-slate-200 hover:border-brand/30 dark:border-slate-800 dark:hover:border-brand-400/30",
      )}
    >
      {/* Checkbox de seleção — aparece no hover ou quando já há seleção */}
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

      <div className="flex items-start justify-between gap-2">
        <div className="flex flex-wrap gap-1">
          {card.edicao && (
            <span className={cn("inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-semibold", EDICAO_COR[card.edicao] || "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300")}>{card.edicao}</span>
          )}
          {(card.tags || []).slice(0, 2).map((t) => (
            <span key={t} className="inline-flex items-center rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-500 dark:bg-slate-800 dark:text-slate-400">{t}</span>
          ))}
        </div>
        <span className={cn("flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold", corAvatar(card.nome))}>{inicial(card.nome)}</span>
      </div>
      <p className="mt-1.5 truncate text-sm font-semibold text-slate-800 dark:text-slate-100">{card.nome}</p>
      <div className="mt-1 flex items-center gap-1.5 text-xs text-slate-400 dark:text-slate-500">
        <svg className="h-3.5 w-3.5 shrink-0 text-emerald-500" viewBox="0 0 24 24" fill="currentColor"><path d="M12.04 2C6.58 2 2.13 6.45 2.13 11.91c0 1.76.46 3.45 1.32 4.95L2 22l5.25-1.38c1.45.79 3.08 1.21 4.79 1.21h.01c5.46 0 9.91-4.45 9.91-9.91C21.96 6.45 17.5 2 12.04 2Z" /></svg>
        <span className="flex-1 truncate">{card.ultima_msg ? card.ultima_msg.replace(/^Respondeu:\s*/, "") : "—"}</span>
        {card.ultima_resposta_em && <span className="shrink-0 tabular-nums">{relativo(card.ultima_resposta_em)}</span>}
      </div>
    </div>
  );
}

const TL_ICONE: Record<string, { e: string; ring: string }> = {
  disparo: { e: "📤", ring: "bg-blue-50 ring-blue-200 dark:bg-blue-500/15 dark:ring-blue-500/30" },
  resposta: { e: "💬", ring: "bg-emerald-50 ring-emerald-200 dark:bg-emerald-500/15 dark:ring-emerald-500/30" },
  nota: { e: "📝", ring: "bg-amber-50 ring-amber-200 dark:bg-amber-500/15 dark:ring-amber-500/30" },
  mudanca_estagio: { e: "🔀", ring: "bg-violet-50 ring-violet-200 dark:bg-violet-500/15 dark:ring-violet-500/30" },
  sistema: { e: "⚙️", ring: "bg-slate-50 ring-slate-200 dark:bg-slate-800/60 dark:ring-slate-700" },
};

function Drawer({ card, colunas, onClose, onMover, onDisparar }: {
  card: Card; colunas: Coluna[]; onClose: () => void; onMover: (chave: string) => void; onDisparar: () => void;
}) {
  const [det, setDet] = useState<Detalhe | null>(null);

  useEffect(() => {
    setDet(null);
    fetch(`/api/contato/${card.comprador_id}`).then((r) => r.json()).then((d) => { if (d.ok) setDet(d); }).catch(() => {});
  }, [card.comprador_id]);

  const m = det?.metricas;
  const taxa = m && m.disparos_recebidos ? Math.round((m.disparos_respondidos / m.disparos_recebidos) * 100) : 0;
  const respondeu = !!(m && m.disparos_respondidos > 0);

  return (
    <>
      <div className="fixed inset-0 z-40 bg-slate-900/40 backdrop-blur-sm" onClick={onClose} />
      <aside className="fixed inset-y-0 right-0 z-50 flex w-full max-w-md flex-col overflow-y-auto border-l border-slate-200 bg-white shadow-pop animate-fade-in dark:border-slate-800 dark:bg-slate-900">
        {/* Header */}
        <div className="flex items-start gap-3 border-b border-slate-100 p-5 dark:border-slate-800">
          <span className={cn("flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-base font-semibold", corAvatar(card.nome))}>{inicial(card.nome)}</span>
          <div className="min-w-0 flex-1">
            <h2 className="truncate text-lg font-semibold text-slate-900 dark:text-slate-100">{card.nome}</h2>
            <p className="truncate text-xs text-slate-500 dark:text-slate-400">{card.telefone || "sem telefone"}{card.edicao ? ` · ${card.edicao}` : ""}</p>
          </div>
          <button onClick={onClose} className="rounded-lg p-1.5 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800 dark:hover:text-slate-200">
            <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M18 6 6 18M6 6l12 12" /></svg>
          </button>
        </div>

        <div className="flex-1 space-y-5 p-5">
          {/* Respondeu? + métricas */}
          <div className={cn("flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium",
            respondeu ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300" : "bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400")}>
            {respondeu ? "✓ Já respondeu a disparo" : "Ainda não respondeu a disparos"}
          </div>

          <div className="grid grid-cols-2 gap-2">
            <MiniM label="Disparos" valor={m?.disparos_recebidos ?? "—"} />
            <MiniM label="Respondidos" valor={m?.disparos_respondidos ?? "—"} />
            <MiniM label="Taxa" valor={m ? `${taxa}%` : "—"} />
            <MiniM label="SLA médio" valor={m?.sla_medio != null ? `${m.sla_medio} min` : "—"} />
          </div>

          {/* Mover etapa */}
          <div>
            <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">Etapa da jornada</label>
            <select
              value={card.estagio_chave}
              onChange={(e) => onMover(e.target.value)}
              className={fieldClass}
            >
              {colunas.map((c) => <option key={c.chave} value={c.chave}>{c.nome}</option>)}
            </select>
          </div>

          {/* Histórico */}
          <div>
            <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">Histórico</h3>
            {!det ? (
              <div className="flex items-center gap-2 py-4 text-sm text-slate-400 dark:text-slate-500"><Spinner className="h-4 w-4" /> Carregando…</div>
            ) : det.timeline.length === 0 ? (
              <p className="py-2 text-sm text-slate-400 dark:text-slate-500">Sem interações ainda.</p>
            ) : (
              <ul className="space-y-3">
                {det.timeline.slice(0, 30).map((it, i) => {
                  const ic = TL_ICONE[it.tipo] || TL_ICONE.sistema;
                  return (
                    <li key={i} className="flex gap-2.5">
                      <span className={cn("flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs ring-1 ring-inset", ic.ring)}>{ic.e}</span>
                      <div className="min-w-0 flex-1">
                        <p className="text-sm text-slate-700 dark:text-slate-200">{it.descricao || it.tipo}</p>
                        <p className="text-[11px] tabular-nums text-slate-400 dark:text-slate-500">{fmt(it.criado_em)}{it.autor ? ` · ${it.autor}` : ""}</p>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </div>

        {/* Ações */}
        <div className="sticky bottom-0 flex gap-2 border-t border-slate-100 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
          <Link href={`/contatos/${card.comprador_id}`} className="flex-1">
            <Button variant="secondary" className="w-full">Ficha completa</Button>
          </Link>
          {card.telefone && <Button variant="primary" onClick={onDisparar} className="flex-1">Disparar</Button>}
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
