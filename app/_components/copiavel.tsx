"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { cn } from "@/app/_components/ui";

// Telefone e e-mail do contato, logo abaixo do nome, prontos para copiar.
//
// O operador vive precisando desses dois dados: para discar, para achar a pessoa
// no Searchie, para colar num grupo. Antes ele tinha de abrir a ficha, selecionar
// o texto com o mouse e torcer para não pegar um espaço a mais. Um clique copia.

function useCopia() {
  const [copiado, setCopiado] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Limpa o timer se o componente sair da tela antes do aviso apagar.
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  const copiar = useCallback(async (valor: string) => {
    try {
      await navigator.clipboard.writeText(valor);
    } catch {
      // Navegador sem permissão de clipboard (ou http sem TLS): cai no textarea.
      const ta = document.createElement("textarea");
      ta.value = valor;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand("copy"); } catch { /* desiste em silêncio */ }
      document.body.removeChild(ta);
    }
    setCopiado(valor);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setCopiado(null), 1200);
  }, []);

  return { copiado, copiar };
}

const IconeCopia = ({ className }: { className?: string }) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <rect x="9" y="9" width="12" height="12" rx="2" />
    <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
  </svg>
);
const IconeOk = ({ className }: { className?: string }) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d="M20 6 9 17l-5-5" />
  </svg>
);

// Um valor copiável. `onClick` não propaga: em tabela e kanban, o clique na
// linha/card abre a ficha — copiar o telefone não pode arrastar o operador para
// dentro de uma tela que ele não pediu.
export function Copiavel({
  valor, rotulo, className, mono,
}: {
  valor: string | null | undefined;
  rotulo?: string;
  className?: string;
  mono?: boolean;
}) {
  const { copiado, copiar } = useCopia();
  const v = (valor ?? "").trim();
  if (!v) return <span className={cn("text-slate-300 dark:text-slate-600", className)}>—</span>;

  const foiCopiado = copiado === v;
  return (
    <button
      type="button"
      onClick={(e) => { e.stopPropagation(); e.preventDefault(); copiar(v); }}
      title={foiCopiado ? "Copiado!" : `Copiar ${rotulo ?? v}`}
      aria-label={foiCopiado ? `${rotulo ?? v} copiado` : `Copiar ${rotulo ?? v}`}
      className={cn(
        "group/c inline-flex max-w-full items-center gap-1 rounded px-0.5 -mx-0.5 text-left transition",
        "hover:bg-slate-100 dark:hover:bg-slate-800",
        foiCopiado && "bg-emerald-50 dark:bg-emerald-500/15",
        className,
      )}
    >
      <span className={cn("truncate", mono && "tabular-nums", foiCopiado && "text-emerald-700 dark:text-emerald-300")}>{v}</span>
      {foiCopiado
        ? <IconeOk className="h-3 w-3 shrink-0 text-emerald-600 dark:text-emerald-400" />
        : <IconeCopia className="h-3 w-3 shrink-0 text-slate-400 opacity-0 transition group-hover/c:opacity-100" />}
    </button>
  );
}

// O par telefone + e-mail, do jeito que aparece abaixo do nome em toda tela.
// `compacto` encolhe para caber no card do kanban.
export function ContatoDoNome({
  telefone, email, compacto, className,
}: {
  telefone: string | null | undefined;
  email: string | null | undefined;
  compacto?: boolean;
  className?: string;
}) {
  const tem = (telefone ?? "").trim() || (email ?? "").trim();
  if (!tem) return null;

  return (
    <div className={cn("flex min-w-0 flex-col", compacto ? "gap-0" : "gap-0.5", className)}>
      {(telefone ?? "").trim() && (
        <Copiavel
          valor={telefone}
          rotulo="telefone"
          mono
          className={cn("text-slate-500 dark:text-slate-400", compacto ? "text-[10px]" : "text-xs")}
        />
      )}
      {(email ?? "").trim() && (
        <Copiavel
          valor={email}
          rotulo="e-mail"
          className={cn("text-slate-400 dark:text-slate-500", compacto ? "text-[10px]" : "text-xs")}
        />
      )}
    </div>
  );
}
