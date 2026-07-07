"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Button, cn, fieldClass, Spinner } from "@/app/_components/ui";
import { corAvatar, inicial, Avatar } from "@/app/_components/avatar";

const SALDO_CHECKOUT = "https://pay.hotmart.com/L97981750T?off=2vibw97m";

type Estagio = { chave: string; nome: string; aba: string | null };
type Contato = {
  comprador_id: string; nome: string; email: string | null; telefone: string | null;
  turma: string | null; plano: string | null; categoria_entrada: string | null;
  estagio_chave: string | null; estagio_nome: string | null; responsavel: string | null;
  reuniao_em: string | null; entrevista_em: string | null; pagamento_em: string | null;
  pagamento_forma: string | null; apto_ativacao: boolean;
};
type Interacao = { tipo: string; descricao: string | null; autor: string | null; criado_em: string };

function fmt(iso: string | null) {
  return iso ? new Date(iso).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) : "—";
}
function toLocalInput(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}
function fromLocalInput(v: string): string | null {
  if (!v) return null;
  const d = new Date(v);
  return isNaN(d.getTime()) ? null : d.toISOString();
}

// Painel rápido do card: mover etapa, agendar, pagamento e responsável sem sair
// do board. Edições persistem via /api/hm/contato/[id] e recarregam o board.
export function HmDrawer({
  compradorId, estagios, responsaveis, onClose, onChanged,
}: {
  compradorId: string; estagios: Estagio[]; responsaveis: string[];
  onClose: () => void; onChanged: () => void;
}) {
  const [c, setC] = useState<Contato | null>(null);
  const [timeline, setTimeline] = useState<Interacao[]>([]);
  const [salvando, setSalvando] = useState(false);
  const [reuniao, setReuniao] = useState("");
  const [entrevista, setEntrevista] = useState("");
  const [nota, setNota] = useState("");

  const recarregar = useCallback(async () => {
    const r = await fetch(`/api/hm/contato/${compradorId}`);
    const d = await r.json();
    if (d.ok) {
      setC(d.contato);
      setTimeline(d.timeline ?? []);
      setReuniao(toLocalInput(d.contato.reuniao_em));
      setEntrevista(toLocalInput(d.contato.entrevista_em));
    }
  }, [compradorId]);
  useEffect(() => { setC(null); recarregar(); }, [recarregar]);

  async function patch(payload: Record<string, unknown>) {
    setSalvando(true);
    try {
      await fetch(`/api/hm/contato/${compradorId}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      await recarregar();
      onChanged();
    } finally {
      setSalvando(false);
    }
  }

  const jaPagou = !!c?.pagamento_em;

  return (
    <>
      <div className="fixed inset-0 z-40 bg-slate-900/40 backdrop-blur-sm" onClick={onClose} />
      <aside className="fixed inset-y-0 right-0 z-50 flex w-full max-w-md flex-col overflow-hidden border-l border-slate-200 bg-white shadow-pop animate-fade-in dark:border-slate-800 dark:bg-slate-900">
        {!c ? (
          <div className="flex flex-1 items-center justify-center gap-2 text-sm text-slate-400"><Spinner className="h-5 w-5" /> Carregando…</div>
        ) : (
          <>
            <div className="flex items-start gap-3 border-b border-slate-100 p-5 dark:border-slate-800">
              <span className={cn("flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-base font-semibold", corAvatar(c.nome))}>{inicial(c.nome)}</span>
              <div className="min-w-0 flex-1">
                <h2 className="truncate text-lg font-semibold text-slate-900 dark:text-slate-100">{c.nome}</h2>
                <p className="truncate text-xs text-slate-500 dark:text-slate-400">{c.telefone || "sem telefone"}{c.turma ? ` · ${c.turma}` : ""}</p>
                {c.plano && <p className="mt-0.5 truncate text-xs text-slate-400 dark:text-slate-500">{c.plano}</p>}
              </div>
              <button onClick={onClose} className="rounded-lg p-1.5 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800 dark:hover:text-slate-200">
                <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M18 6 6 18M6 6l12 12" /></svg>
              </button>
            </div>

            <div className="flex-1 space-y-4 overflow-y-auto p-5">
              {c.apto_ativacao && (
                <div className="flex items-center gap-2 rounded-lg bg-emerald-50 px-3 py-2 text-sm font-medium text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300">
                  <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5" /></svg>
                  Apto para ativação{c.pagamento_em ? ` · pago ${fmt(c.pagamento_em)}` : ""}
                </div>
              )}

              <Campo label="Etapa">
                <select value={c.estagio_chave ?? ""} onChange={(e) => patch({ estagio_chave: e.target.value })} className={fieldClass} disabled={salvando}>
                  {estagios.map((s) => <option key={s.chave} value={s.chave}>{s.aba === "ativacao" ? "Ativação · " : "Comercial · "}{s.nome}</option>)}
                </select>
              </Campo>

              <Campo label="Responsável (CS)">
                <div className="flex items-center gap-2">
                  {c.responsavel && <Avatar nome={c.responsavel} className="h-8 w-8 text-xs" />}
                  <select value={c.responsavel ?? ""} onChange={(e) => patch({ responsavel: e.target.value || null })} className={fieldClass} disabled={salvando}>
                    <option value="">— Sem responsável —</option>
                    {c.responsavel && !responsaveis.includes(c.responsavel) && <option value={c.responsavel}>{c.responsavel}</option>}
                    {responsaveis.map((r) => <option key={r} value={r}>{r}</option>)}
                  </select>
                </div>
              </Campo>

              <Campo label="Reunião comercial (data e hora)">
                <div className="flex items-center gap-2">
                  <input type="datetime-local" value={reuniao} onChange={(e) => setReuniao(e.target.value)} className={fieldClass} />
                  <Button variant="secondary" size="sm" disabled={salvando} onClick={() => patch({ reuniao_em: fromLocalInput(reuniao) })}>OK</Button>
                </div>
              </Campo>

              <Campo label="Entrevista de ativação (data e hora)">
                <div className="flex items-center gap-2">
                  <input type="datetime-local" value={entrevista} onChange={(e) => setEntrevista(e.target.value)} className={fieldClass} />
                  <Button variant="secondary" size="sm" disabled={salvando} onClick={() => patch({ entrevista_em: fromLocalInput(entrevista) })}>OK</Button>
                </div>
              </Campo>

              {!jaPagou && (
                <div className="rounded-lg border border-amber-200 bg-amber-50/60 p-3 dark:border-amber-500/30 dark:bg-amber-500/10">
                  <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-amber-700 dark:text-amber-300">Saldo — R$ 14.700</p>
                  <div className="flex flex-wrap items-center gap-2">
                    <Button variant="primary" size="sm" disabled={salvando} onClick={() => patch({ pagamento_forma: "avista", marcar_pagamento: true })}>Registrar pagamento</Button>
                    <a href={SALDO_CHECKOUT} target="_blank" rel="noreferrer" className="text-xs font-medium text-brand hover:underline dark:text-brand-300">Abrir checkout Hotmart</a>
                  </div>
                </div>
              )}

              <Campo label="Nota rápida">
                <div className="flex items-end gap-2">
                  <textarea value={nota} onChange={(e) => setNota(e.target.value)} rows={2} className={fieldClass} placeholder="Anotar na timeline…" />
                  <Button variant="secondary" size="sm" disabled={!nota.trim() || salvando} onClick={() => { patch({ nota }); setNota(""); }}>Anotar</Button>
                </div>
              </Campo>

              {timeline.length > 0 && (
                <div>
                  <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">Últimas interações</p>
                  <ul className="space-y-1.5">
                    {timeline.slice(0, 6).map((it, i) => (
                      <li key={i} className="text-xs text-slate-500 dark:text-slate-400">
                        <span className="text-slate-700 dark:text-slate-200">{it.descricao || it.tipo}</span>
                        <span className="tabular-nums"> · {fmt(it.criado_em)}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>

            <div className="sticky bottom-0 flex gap-2 border-t border-slate-100 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
              <Link href={`/hm/contatos/${c.comprador_id}`} className="flex-1">
                <Button variant="secondary" className="w-full">Ficha completa</Button>
              </Link>
              {c.telefone && (
                <a href={`https://wa.me/${c.telefone.replace(/\D/g, "").replace(/^(?!55)/, "55")}`} target="_blank" rel="noreferrer" className="flex-1">
                  <Button variant="primary" className="w-full">WhatsApp</Button>
                </a>
              )}
            </div>
          </>
        )}
      </aside>
    </>
  );
}

function Campo({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">{label}</label>
      {children}
    </div>
  );
}
