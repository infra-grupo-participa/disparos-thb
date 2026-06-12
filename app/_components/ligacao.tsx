"use client";

import { useCallback, useEffect, useState } from "react";
import { Button, Card, cn, fieldClass } from "@/app/_components/ui";

// Registro de ligações do contato. Hoje funciona em modo "tel:" (abre o
// discador e o operador registra o resultado); quando o discador Nvoip for
// plugado, o botão passa a iniciar a chamada e o webhook completa os dados.

export type Ligacao = {
  id: string;
  telefone: string;
  operador: string | null;
  resultado: string | null;
  duracaoSeg: number | null;
  anotacao: string | null;
  retornoEm: string | null;
  urlGravacao: string | null;
  status: string;
  criadoEm: string;
};

const RESULTADOS = [
  { v: "atendeu", label: "Atendeu", tom: "bg-emerald-50 text-emerald-700 ring-emerald-200 dark:bg-emerald-500/15 dark:text-emerald-300 dark:ring-emerald-500/30" },
  { v: "nao_atendeu", label: "Não atendeu", tom: "bg-amber-50 text-amber-700 ring-amber-200 dark:bg-amber-500/15 dark:text-amber-300 dark:ring-amber-500/30" },
  { v: "caixa_postal", label: "Caixa postal", tom: "bg-blue-50 text-blue-700 ring-blue-200 dark:bg-blue-500/15 dark:text-blue-300 dark:ring-blue-500/30" },
  { v: "ocupado", label: "Ocupado", tom: "bg-violet-50 text-violet-700 ring-violet-200 dark:bg-violet-500/15 dark:text-violet-300 dark:ring-violet-500/30" },
  { v: "numero_errado", label: "Número errado", tom: "bg-rose-50 text-rose-700 ring-rose-200 dark:bg-rose-500/15 dark:text-rose-300 dark:ring-rose-500/30" },
] as const;
const RES_LABEL: Record<string, string> = Object.fromEntries(RESULTADOS.map((r) => [r.v, r.label]));
const RES_TOM: Record<string, string> = Object.fromEntries(RESULTADOS.map((r) => [r.v, r.tom]));

const telLink = (t: string) => `tel:${(t || "").replace(/[^0-9+]/g, "")}`;
function relativo(iso: string | null) {
  if (!iso) return "";
  const min = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
  if (min < 60) return `${min}min`;
  if (min < 1440) return `${Math.round(min / 60)}h`;
  return `${Math.round(min / 1440)}d`;
}
const PhoneIcon = ({ className }: { className?: string }) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.96.36 1.9.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.91.34 1.85.57 2.81.7A2 2 0 0 1 22 16.92Z" /></svg>
);

export function CardLigacoes({ compradorId, telefone, onRegistrado }: {
  compradorId: string; telefone: string | null; onRegistrado?: () => void;
}) {
  const [ligacoes, setLigacoes] = useState<Ligacao[]>([]);
  const [aberto, setAberto] = useState(false);

  const carregar = useCallback(async () => {
    const r = await fetch(`/api/ligacoes?comprador_id=${compradorId}`);
    const d = await r.json();
    if (d.ok) setLigacoes(d.ligacoes);
  }, [compradorId]);
  useEffect(() => { carregar(); }, [carregar]);

  return (
    <Card className="p-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-slate-700 dark:text-slate-200">Ligações</h2>
        <Button variant="primary" className="h-8 gap-1.5 px-3 text-xs" onClick={() => setAberto(true)} disabled={!telefone}>
          <PhoneIcon className="h-3.5 w-3.5" /> Ligar
        </Button>
      </div>
      {!telefone && <p className="mt-2 text-xs text-rose-500 dark:text-rose-400">Sem telefone cadastrado.</p>}

      <div className="mt-3 space-y-2">
        {ligacoes.map((l) => (
          <div key={l.id} className="flex items-start gap-2 rounded-lg border border-slate-100 p-2 text-xs dark:border-slate-800">
            <PhoneIcon className="mt-0.5 h-3.5 w-3.5 shrink-0 text-slate-400" />
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-1.5">
                {l.resultado
                  ? <span className={cn("rounded-full px-1.5 py-0.5 font-medium ring-1 ring-inset", RES_TOM[l.resultado])}>{RES_LABEL[l.resultado]}</span>
                  : <span className="rounded-full bg-slate-100 px-1.5 py-0.5 font-medium text-slate-500 dark:bg-slate-800 dark:text-slate-400">{l.status === "iniciada" ? "Em andamento" : "—"}</span>}
                {l.duracaoSeg ? <span className="text-slate-400">{Math.max(1, Math.round(l.duracaoSeg / 60))}min</span> : null}
                {l.urlGravacao && <a href={l.urlGravacao} target="_blank" rel="noreferrer" className="text-brand hover:underline dark:text-brand-300">áudio</a>}
                <span className="ml-auto text-slate-400">{relativo(l.criadoEm)}</span>
              </div>
              {l.anotacao && <p className="mt-0.5 text-slate-600 dark:text-slate-300">{l.anotacao}</p>}
              <p className="mt-0.5 text-[11px] text-slate-400">{l.operador || "—"}{l.retornoEm ? ` · retorno ${new Date(l.retornoEm).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}` : ""}</p>
            </div>
          </div>
        ))}
        {ligacoes.length === 0 && <p className="py-2 text-center text-xs text-slate-400 dark:text-slate-500">Nenhuma ligação ainda.</p>}
      </div>

      {aberto && telefone && (
        <LigacaoModal
          compradorId={compradorId}
          telefone={telefone}
          onClose={() => setAberto(false)}
          onSalvo={() => { setAberto(false); carregar(); onRegistrado?.(); }}
        />
      )}
    </Card>
  );
}

function LigacaoModal({ compradorId, telefone, onClose, onSalvo }: {
  compradorId: string; telefone: string; onClose: () => void; onSalvo: () => void;
}) {
  const [resultado, setResultado] = useState<string>("atendeu");
  const [duracao, setDuracao] = useState("");
  const [anotacao, setAnotacao] = useState("");
  const [retorno, setRetorno] = useState("");
  const [salvando, setSalvando] = useState(false);

  async function salvar() {
    setSalvando(true);
    let operador: string | null = null;
    try { operador = localStorage.getItem("cs_atendente"); } catch { /* noop */ }
    const body: Record<string, unknown> = { compradorId, telefone, resultado, operador };
    if (duracao.trim()) body.duracaoSeg = Math.round(parseFloat(duracao.replace(",", ".")) * 60);
    if (anotacao.trim()) body.anotacao = anotacao.trim();
    if (retorno) body.retornoEm = new Date(retorno).toISOString();
    const r = await fetch("/api/ligacoes", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    setSalvando(false);
    if (r.ok) onSalvo();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4" onClick={onClose}>
      <div className="w-full max-w-sm rounded-xl bg-white p-5 shadow-xl dark:bg-slate-900" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h3 className="text-base font-semibold text-slate-800 dark:text-slate-100">Registrar ligação</h3>
          <button onClick={onClose} aria-label="Fechar" className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200">
            <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="m6 6 12 12M18 6 6 18" /></svg>
          </button>
        </div>

        <a href={telLink(telefone)} className="mt-3 flex items-center justify-center gap-2 rounded-lg bg-emerald-600 py-2.5 text-sm font-semibold text-white transition hover:bg-emerald-700">
          <PhoneIcon className="h-4 w-4" /> Discar {telefone}
        </a>

        <label className="mt-4 block text-xs font-medium text-slate-500 dark:text-slate-400">Resultado</label>
        <div className="mt-1.5 flex flex-wrap gap-1.5">
          {RESULTADOS.map((r) => (
            <button key={r.v} onClick={() => setResultado(r.v)}
              className={cn("rounded-full px-2.5 py-1 text-xs font-medium ring-1 ring-inset transition",
                resultado === r.v ? r.tom : "bg-slate-50 text-slate-500 ring-slate-200 hover:bg-slate-100 dark:bg-slate-800 dark:text-slate-400 dark:ring-slate-700")}>
              {r.label}
            </button>
          ))}
        </div>

        <div className="mt-3 grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-medium text-slate-500 dark:text-slate-400">Duração (min)</label>
            <input value={duracao} onChange={(e) => setDuracao(e.target.value)} inputMode="decimal" placeholder="ex: 3" className={cn(fieldClass, "mt-1")} />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-500 dark:text-slate-400">Agendar retorno</label>
            <input type="datetime-local" value={retorno} onChange={(e) => setRetorno(e.target.value)} className={cn(fieldClass, "mt-1")} />
          </div>
        </div>

        <label className="mt-3 block text-xs font-medium text-slate-500 dark:text-slate-400">Anotação</label>
        <textarea value={anotacao} onChange={(e) => setAnotacao(e.target.value)} rows={3} placeholder="Como foi a conversa, próximo passo…" className={cn(fieldClass, "mt-1 resize-none")} />

        <div className="mt-4 flex gap-2">
          <Button variant="ghost" className="flex-1" onClick={onClose}>Cancelar</Button>
          <Button variant="primary" className="flex-1" onClick={salvar} disabled={salvando}>{salvando ? "Salvando…" : "Salvar"}</Button>
        </div>
      </div>
    </div>
  );
}
