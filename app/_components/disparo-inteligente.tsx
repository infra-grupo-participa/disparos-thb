"use client";

import { useCallback, useEffect, useState } from "react";
import { Button, Spinner, cn, fieldClass } from "@/app/_components/ui";
import { usePortal } from "@/app/_components/use-portal";

type Elegivel = { comprador_id: string; nome: string; telefone: string; edicao: string | null; ultimo_disparo_em: string | null; motivo: string };
type Sel = { comprador_id: string; nome: string; telefone: string; edicao?: string | null };
type Modo = "novos" | "frios" | "ambos";

const fmtDias = (iso: string | null) => {
  if (!iso) return "nunca abordado";
  const d = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
  return d <= 0 ? "abordado hoje" : `há ${d} dia${d > 1 ? "s" : ""}`;
};

// Auxílio inteligente ao operador: monta sozinho a lista de quem está pronto para
// receber disparo — sem garimpar o board. Foca em quem NUNCA foi abordado ou está
// sem contato faz tempo, o pedido do dia a dia do SDR.
export function DisparoInteligente({ onDisparar, onClose }: { onDisparar: (sel: Sel[]) => void; onClose: () => void }) {
  const { evento } = usePortal();
  const [modo, setModo] = useState<Modo>("ambos");
  const [dias, setDias] = useState(7);
  const [dados, setDados] = useState<{ contatos: Elegivel[]; resumo: { nunca: number; frios: number } } | null>(null);
  const [carregando, setCarregando] = useState(true);

  const buscar = useCallback(async () => {
    setCarregando(true);
    try {
      const r = await fetch(`/api/disparos/elegiveis?evento=${evento}&modo=${modo}&dias=${dias}&limite=1000`);
      const d = await r.json();
      if (d.ok) setDados({ contatos: d.contatos, resumo: d.resumo });
    } finally {
      setCarregando(false);
    }
  }, [evento, modo, dias]);

  useEffect(() => { buscar(); }, [buscar]);

  const total = dados?.contatos.length ?? 0;

  const OPCOES: { k: Modo; titulo: string; desc: string }[] = [
    { k: "novos", titulo: "Ainda não abordados", desc: "nunca receberam um disparo" },
    { k: "frios", titulo: "Sem retorno faz tempo", desc: `último disparo há mais de ${dias} dias` },
    { k: "ambos", titulo: "Os dois (recomendado)", desc: "novos + quem esfriou" },
  ];

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-900/50 p-4 backdrop-blur-sm sm:p-8" onClick={onClose}>
      <div className="w-full max-w-lg rounded-2xl border border-slate-200 bg-white p-5 shadow-pop dark:border-slate-800 dark:bg-slate-900 sm:p-6" onClick={(e) => e.stopPropagation()}>
        <div className="mb-1 flex items-center justify-between">
          <h2 className="flex items-center gap-2 text-lg font-semibold text-slate-900 dark:text-slate-100">
            <svg className="h-5 w-5 text-brand" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83" /></svg>
            Disparo inteligente
          </h2>
          <button onClick={onClose} className="rounded-lg p-1.5 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800 dark:hover:text-slate-200" aria-label="Fechar">
            <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M18 6 6 18M6 6l12 12" /></svg>
          </button>
        </div>
        <p className="mb-4 text-sm text-slate-500 dark:text-slate-400">
          O sistema monta a lista de quem está pronto para abordar — sem reenviar para quem já recebeu há pouco.
        </p>

        {/* Critério */}
        <div className="space-y-2">
          {OPCOES.map((o) => (
            <button
              key={o.k}
              onClick={() => setModo(o.k)}
              className={cn(
                "flex w-full items-center gap-3 rounded-lg border px-3 py-2.5 text-left transition",
                modo === o.k ? "border-brand bg-brand/5 ring-1 ring-brand/30 dark:border-brand-400 dark:bg-brand-400/10" : "border-slate-200 hover:border-slate-300 dark:border-slate-800 dark:hover:border-slate-700",
              )}
            >
              <span className={cn("flex h-4 w-4 shrink-0 items-center justify-center rounded-full border-2", modo === o.k ? "border-brand bg-brand dark:border-brand-400 dark:bg-brand-400" : "border-slate-300 dark:border-slate-600")}>
                {modo === o.k && <span className="h-1.5 w-1.5 rounded-full bg-white dark:bg-slate-900" />}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-medium text-slate-800 dark:text-slate-100">{o.titulo}</span>
                <span className="block text-xs text-slate-400 dark:text-slate-500">{o.desc}</span>
              </span>
            </button>
          ))}
        </div>

        {/* Dias (para frios/ambos) */}
        {modo !== "novos" && (
          <div className="mt-3 flex items-center gap-2 text-sm text-slate-600 dark:text-slate-300">
            <span>Considerar “frio” quem está sem contato há</span>
            <select value={dias} onChange={(e) => setDias(Number(e.target.value))} className={cn(fieldClass, "w-auto py-1 text-sm")}>
              {[3, 5, 7, 14, 30].map((d) => <option key={d} value={d}>{d} dias</option>)}
            </select>
          </div>
        )}

        {/* Resultado */}
        <div className="mt-4 rounded-lg border border-slate-200 bg-slate-50/60 p-4 dark:border-slate-800 dark:bg-slate-800/40">
          {carregando ? (
            <div className="flex items-center justify-center gap-2 py-3 text-sm text-slate-500 dark:text-slate-400"><Spinner /> Calculando…</div>
          ) : total === 0 ? (
            <p className="py-2 text-center text-sm text-slate-500 dark:text-slate-400">Ninguém elegível com esse critério. 🎉</p>
          ) : (
            <>
              <div className="flex items-baseline gap-2">
                <span className="text-3xl font-bold tabular-nums text-brand dark:text-brand-300">{total}</span>
                <span className="text-sm text-slate-500 dark:text-slate-400">contato(s) prontos para abordar</span>
              </div>
              <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1 text-xs">
                {(dados?.resumo.nunca ?? 0) > 0 && <span className="text-emerald-600 dark:text-emerald-400">{dados?.resumo.nunca} nunca abordados</span>}
                {(dados?.resumo.frios ?? 0) > 0 && <span className="text-amber-600 dark:text-amber-400">{dados?.resumo.frios} esfriaram</span>}
              </div>
              {/* Amostra dos primeiros da fila */}
              <ul className="mt-3 max-h-32 space-y-1 overflow-auto text-sm">
                {dados?.contatos.slice(0, 8).map((c) => (
                  <li key={c.comprador_id} className="flex items-center justify-between gap-2 text-slate-600 dark:text-slate-300">
                    <span className="truncate">{c.nome}</span>
                    <span className="shrink-0 text-[11px] text-slate-400 dark:text-slate-500">{fmtDias(c.ultimo_disparo_em)}</span>
                  </li>
                ))}
                {total > 8 && <li className="text-[11px] text-slate-400 dark:text-slate-500">+ {total - 8} outros</li>}
              </ul>
            </>
          )}
        </div>

        <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button variant="secondary" onClick={onClose}>Cancelar</Button>
          <Button
            variant="primary"
            disabled={carregando || total === 0}
            onClick={() => onDisparar((dados?.contatos ?? []).map((c) => ({ comprador_id: c.comprador_id, nome: c.nome, telefone: c.telefone, edicao: c.edicao })))}
          >
            Preparar disparo para {total}
          </Button>
        </div>
      </div>
    </div>
  );
}
