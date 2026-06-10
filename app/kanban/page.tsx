"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { cn, fieldClass, Spinner } from "@/app/_components/ui";

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

// Avatar com inicial e cor determinística pelo nome.
const AVATAR = ["bg-brand-100 text-brand-700", "bg-blue-100 text-blue-700", "bg-emerald-100 text-emerald-700", "bg-amber-100 text-amber-800", "bg-violet-100 text-violet-700", "bg-rose-100 text-rose-700", "bg-cyan-100 text-cyan-700"];
const AVATAR_DARK = ["dark:bg-brand-400/20 dark:text-brand-300", "dark:bg-blue-500/20 dark:text-blue-300", "dark:bg-emerald-500/20 dark:text-emerald-300", "dark:bg-amber-500/20 dark:text-amber-300", "dark:bg-violet-500/20 dark:text-violet-300", "dark:bg-rose-500/20 dark:text-rose-300", "dark:bg-cyan-500/20 dark:text-cyan-300"];
function corAvatar(nome: string) {
  let h = 0;
  for (let i = 0; i < (nome?.length || 0); i++) h = (h * 31 + nome.charCodeAt(i)) >>> 0;
  const i = h % AVATAR.length;
  return `${AVATAR[i]} ${AVATAR_DARK[i]}`;
}
function inicial(nome: string) {
  return (nome?.trim()?.[0] || "?").toUpperCase();
}

// Tempo relativo curto desde a última atividade (ex.: 17m, 3h, 2d).
function relativo(iso: string | null): string {
  if (!iso) return "";
  const min = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
  if (min < 60) return `${min}m`;
  if (min < 1440) return `${Math.round(min / 60)}h`;
  return `${Math.round(min / 1440)}d`;
}

export default function KanbanPage() {
  const [colunas, setColunas] = useState<Coluna[]>([]);
  const [cards, setCards] = useState<Card[]>([]);
  const [edicoes, setEdicoes] = useState<string[]>([]);
  const [edicao, setEdicao] = useState<string | null>(null); // null = ainda não inicializado
  const [carregando, setCarregando] = useState(true);
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
        // Primeira carga: foca na edição mais recente (HT atual).
        if (edicao === null && d.edicoes?.length) {
          setEdicao(d.edicoes[0]);
          return; // o efeito recarrega com a edição definida
        }
      }
    } finally {
      setCarregando(false);
    }
  }, [edicao]);

  useEffect(() => { carregar(edicao ?? ""); }, [edicao, carregar]);

  async function mover(card: Card, estagioChave: string) {
    if (card.estagio_chave === estagioChave) return;
    const anterior = card.estagio_chave;
    // Otimista: move o card e ajusta os contadores na hora.
    setCards((cs) => cs.map((c) => (c.comprador_id === card.comprador_id ? { ...c, estagio_chave: estagioChave } : c)));
    setColunas((cols) => cols.map((c) =>
      c.chave === estagioChave ? { ...c, total: c.total + 1 } : c.chave === anterior ? { ...c, total: Math.max(0, c.total - 1) } : c,
    ));
    try {
      await fetch("/api/kanban", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ compradorId: card.comprador_id, estagioChave }),
      });
    } catch {
      carregar(edicao ?? ""); // reverte buscando o estado real
    }
  }

  const totalGeral = colunas.reduce((s, c) => s + c.total, 0);

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-slate-900 dark:text-slate-100">Jornada do HT</h1>
          <p className="mt-0.5 text-sm text-slate-500 dark:text-slate-400">
            {totalGeral} comprador(es){edicao ? ` · ${edicao}` : ""} — arraste os cards entre as etapas.
          </p>
        </div>
        <select
          value={edicao ?? ""}
          onChange={(e) => setEdicao(e.target.value)}
          className={cn(fieldClass, "w-auto")}
        >
          <option value="">Todas as edições</option>
          {edicoes.map((ed) => <option key={ed} value={ed}>{ed}</option>)}
        </select>
      </div>

      {carregando && cards.length === 0 ? (
        <div className="flex items-center justify-center gap-3 py-20 text-slate-400 dark:text-slate-500">
          <Spinner className="h-6 w-6" /> <span className="text-sm">Carregando jornada…</span>
        </div>
      ) : (
        <div className="-mx-4 flex gap-3 overflow-x-auto px-4 pb-4 sm:-mx-6 sm:px-6">
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
                {/* Header da coluna */}
                <div className="flex items-center gap-2 border-b border-slate-200 px-3 py-2.5 dark:border-slate-800">
                  <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: col.cor }} />
                  <span className="flex-1 truncate text-sm font-semibold text-slate-700 dark:text-slate-200">{col.nome}</span>
                  <span className="rounded-full bg-slate-200 px-2 py-0.5 text-xs font-semibold tabular-nums text-slate-600 dark:bg-slate-800 dark:text-slate-300">{col.total}</span>
                </div>

                {/* Cards */}
                <div className="flex max-h-[70vh] flex-col gap-2 overflow-y-auto p-2">
                  {doCol.length === 0 ? (
                    <p className="px-2 py-6 text-center text-xs text-slate-400 dark:text-slate-600">Sem cards</p>
                  ) : (
                    doCol.map((card) => (
                      <CardItem key={card.comprador_id} card={card} onDragStart={() => { arrastando.current = card; }} />
                    ))
                  )}
                  {col.total > doCol.length && (
                    <p className="px-2 py-2 text-center text-[11px] text-slate-400 dark:text-slate-500">
                      + {col.total - doCol.length} além dos {doCol.length} mostrados
                    </p>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
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

function CardItem({ card, onDragStart }: { card: Card; onDragStart: () => void }) {
  return (
    <Link
      href={`/contatos/${card.comprador_id}`}
      draggable
      onDragStart={onDragStart}
      className="group block cursor-grab rounded-lg border border-slate-200 bg-white p-2.5 shadow-card transition hover:border-brand/30 hover:shadow-soft active:cursor-grabbing dark:border-slate-800 dark:bg-slate-900 dark:hover:border-brand-400/30"
    >
      {/* Tags + avatar */}
      <div className="flex items-start justify-between gap-2">
        <div className="flex flex-wrap gap-1">
          {card.edicao && (
            <span className={cn("inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-semibold", EDICAO_COR[card.edicao] || "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300")}>
              {card.edicao}
            </span>
          )}
          {(card.tags || []).slice(0, 2).map((t) => (
            <span key={t} className="inline-flex items-center rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-500 dark:bg-slate-800 dark:text-slate-400">{t}</span>
          ))}
        </div>
        <span className={cn("flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold", corAvatar(card.nome))}>
          {inicial(card.nome)}
        </span>
      </div>

      {/* Nome */}
      <p className="mt-1.5 truncate text-sm font-semibold text-slate-800 dark:text-slate-100">{card.nome}</p>

      {/* Última mensagem */}
      <div className="mt-1 flex items-center gap-1.5 text-xs text-slate-400 dark:text-slate-500">
        <svg className="h-3.5 w-3.5 shrink-0 text-emerald-500" viewBox="0 0 24 24" fill="currentColor"><path d="M12.04 2C6.58 2 2.13 6.45 2.13 11.91c0 1.76.46 3.45 1.32 4.95L2 22l5.25-1.38c1.45.79 3.08 1.21 4.79 1.21h.01c5.46 0 9.91-4.45 9.91-9.91C21.96 6.45 17.5 2 12.04 2Z" /></svg>
        <span className="flex-1 truncate">{card.ultima_msg ? card.ultima_msg.replace(/^Respondeu:\s*/, "") : "—"}</span>
        {card.ultima_resposta_em && <span className="shrink-0 tabular-nums">{relativo(card.ultima_resposta_em)}</span>}
      </div>
    </Link>
  );
}
