"use client";

// Toast compartilhado do sistema — confirmação visível de que uma ação gravou.
// Nasceu do registro de atendimento (o modal fechava sem sinal e o operador
// registrava duas vezes na dúvida), mas serve a qualquer tela.
//
// Uso: import { toast } from "@/app/_components/toast";  toast("Salvo!");
// O <Toaster /> é montado UMA vez no layout raiz — pub/sub de módulo, sem
// contexto: qualquer client component chama toast() sem precisar de provider.

import { useEffect, useState } from "react";
import { cn } from "@/app/_components/ui";

type TipoToast = "sucesso" | "erro";
type ToastItem = { id: number; msg: string; tipo: TipoToast };

let seq = 0;
let emitir: ((t: ToastItem) => void) | null = null;

export function toast(msg: string, tipo: TipoToast = "sucesso") {
  // Sem Toaster montado (ex.: teste isolado), a chamada é um no-op silencioso.
  emitir?.({ id: ++seq, msg, tipo });
}

const TOM: Record<TipoToast, { wrap: string; icone: string }> = {
  sucesso: {
    wrap: "border-emerald-200 bg-white text-slate-800 dark:border-emerald-500/30 dark:bg-slate-900 dark:text-slate-100",
    icone: "bg-emerald-100 text-emerald-600 dark:bg-emerald-500/15 dark:text-emerald-400",
  },
  erro: {
    wrap: "border-rose-200 bg-white text-slate-800 dark:border-rose-500/30 dark:bg-slate-900 dark:text-slate-100",
    icone: "bg-rose-100 text-rose-600 dark:bg-rose-500/15 dark:text-rose-400",
  },
};

export function Toaster() {
  const [itens, setItens] = useState<ToastItem[]>([]);

  useEffect(() => {
    const timers: ReturnType<typeof setTimeout>[] = [];
    emitir = (t) => {
      setItens((ls) => [...ls.slice(-2), t]); // no máximo 3 na tela
      // Erro fica mais tempo na tela: costuma explicar POR QUE algo não
      // aconteceu (checklist, saldo, permissão) e precisa dar tempo de ler.
      timers.push(setTimeout(() => setItens((ls) => ls.filter((x) => x.id !== t.id)), t.tipo === "erro" ? 7000 : 4000));
    };
    return () => { emitir = null; timers.forEach(clearTimeout); };
  }, []);

  return (
    // aria-live: o leitor de tela anuncia a confirmação sem roubar o foco.
    <div aria-live="polite" role="status" className="pointer-events-none fixed inset-x-0 bottom-5 z-[70] flex flex-col items-center gap-2 px-4">
      {itens.map((t) => (
        <div
          key={t.id}
          className={cn(
            // max-w + items-start: mensagens longas (ex.: por que o movimento
            // falhou) quebram linha em vez de virar uma faixa de tela inteira.
            "pointer-events-auto flex max-w-xl items-start gap-2.5 rounded-xl border py-2.5 pl-2.5 pr-4 text-left text-sm font-medium shadow-pop",
            "motion-safe:animate-fade-in",
            TOM[t.tipo].wrap,
          )}
        >
          <span className={cn("flex h-6 w-6 shrink-0 items-center justify-center rounded-full", TOM[t.tipo].icone)} aria-hidden>
            {t.tipo === "sucesso" ? (
              <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="m5 13 4 4L19 7" /></svg>
            ) : (
              <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M12 8v5M12 16.5h.01" /></svg>
            )}
          </span>
          {t.msg}
          <button
            onClick={() => setItens((ls) => ls.filter((x) => x.id !== t.id))}
            aria-label="Fechar aviso"
            className="-mr-1.5 ml-1 rounded-md p-1 text-slate-400 transition hover:text-slate-600 dark:hover:text-slate-200"
          >
            <svg className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="m6 6 12 12M18 6 6 18" /></svg>
          </button>
        </div>
      ))}
    </div>
  );
}
