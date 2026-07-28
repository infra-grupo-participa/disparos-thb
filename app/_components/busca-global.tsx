"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { usePortal } from "@/app/_components/use-portal";

type Res = { comprador_id: string; nome: string; email: string; telefone: string | null; edicao: string | null };

// Busca global de contato no portal atual (Ctrl/Cmd+K). Leva ao detalhe do portal.
export default function BuscaGlobal() {
  const router = useRouter();
  const { evento, base } = usePortal();
  const [aberto, setAberto] = useState(false);
  const [q, setQ] = useState("");
  const [res, setRes] = useState<Res[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") { e.preventDefault(); setAberto(true); }
      if (e.key === "Escape") setAberto(false);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => { if (aberto) setTimeout(() => inputRef.current?.focus(), 40); }, [aberto]);

  useEffect(() => {
    if (!aberto) return;
    const t = setTimeout(async () => {
      if (q.trim().length < 2) { setRes([]); return; }
      try {
        const r = await fetch(`/api/contatos?evento=${evento}&q=${encodeURIComponent(q.trim())}`);
        const d = await r.json();
        if (d.ok) setRes(d.contatos.slice(0, 12));
      } catch { /* noop */ }
    }, 250);
    return () => clearTimeout(t);
  }, [q, aberto, evento]);

  function ir(id: string) { setAberto(false); setQ(""); setRes([]); router.push(`${base}/contatos/${id}`); }

  return (
    <>
      <button
        onClick={() => setAberto(true)}
        aria-label="Buscar lead"
        title="Buscar (Ctrl+K)"
        className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-500 transition hover:bg-slate-100 hover:text-slate-800 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-100"
      >
        <svg className="h-[18px] w-[18px]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="7" /><path d="m21 21-4.3-4.3" /></svg>
      </button>

      {aberto && (
        <div className="fixed inset-0 z-[70] flex items-start justify-center bg-slate-900/40 p-4 pt-24 backdrop-blur-sm" onClick={() => setAberto(false)}>
          <div className="w-full max-w-lg overflow-hidden rounded-xl border border-slate-200 bg-white shadow-pop dark:border-slate-800 dark:bg-slate-900" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center gap-2 border-b border-slate-100 px-4 dark:border-slate-800">
              <svg className="h-4 w-4 shrink-0 text-slate-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="11" cy="11" r="7" /><path d="m21 21-4.3-4.3" /></svg>
              <input
                ref={inputRef}
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Buscar lead por nome, e-mail ou telefone…"
                className="w-full bg-transparent py-3 text-sm text-slate-800 outline-none placeholder:text-slate-400 dark:text-slate-100"
              />
            </div>
            <div className="max-h-80 overflow-y-auto">
              {res.length === 0 ? (
                <p className="px-4 py-6 text-center text-sm text-slate-400 dark:text-slate-500">
                  {q.trim().length < 2 ? "Digite ao menos 2 caracteres" : "Nenhum resultado"}
                </p>
              ) : (
                res.map((c) => (
                  <button
                    key={c.comprador_id}
                    onClick={() => ir(c.comprador_id)}
                    className="flex w-full items-center gap-3 px-4 py-2.5 text-left transition hover:bg-slate-50 dark:hover:bg-slate-800/60"
                  >
                    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-slate-100 text-xs font-semibold text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                      {(c.nome?.trim()?.[0] || "?").toUpperCase()}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-slate-800 dark:text-slate-100">{c.nome}</p>
                      <p className="truncate text-xs text-slate-400 dark:text-slate-500">{c.telefone || c.email}{c.edicao ? ` · ${c.edicao}` : ""}</p>
                    </div>
                  </button>
                ))
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
