"use client";

// Composer do Inbox — input de resposta + respostas rápidas + envio.
// Vive FORA do InboxPage por performance: o texto digitado é estado LOCAL,
// então cada tecla re-renderiza só este componente — não a fila (até 200
// itens) nem as bolhas do thread. O pai monta com key={comprador_id}: trocar
// de conversa zera o campo (nunca vaza texto para o lead errado) e o
// autoFocus dispara de novo.

import { memo, useEffect, useRef, useState } from "react";
import { Button, Spinner, cn, fieldClass } from "@/app/_components/ui";
import { toast } from "@/app/_components/toast";
import { fmtHora, fmtMin } from "@/app/_components/inbox-itens";

const SNIPPETS_DEFAULT = [
  "Olá! Tudo bem? 😊 Aqui é o time do Holding Total.",
  "Que bom te ver por aqui! Como posso ajudar?",
  "O link do nosso grupo é: ",
  "Sua dúvida foi resolvida? Qualquer coisa é só chamar! 🙌",
];

export const InboxComposer = memo(function InboxComposer({ onEnviar, expiraEm }: {
  // Envia de fato (otimista, no pai). Devolve true se o servidor aceitou.
  onEnviar: (texto: string) => Promise<boolean>;
  // Fim da janela de 24h — mostra "fecha em 2h" e fica âmbar quando está acabando.
  expiraEm: string | null;
}) {
  const [texto, setTexto] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [snippets, setSnippets] = useState<string[]>(SNIPPETS_DEFAULT);
  // Nova resposta rápida: input inline no lugar do window.prompt — Enter salva,
  // Esc ou clicar fora cancelam (o gesto de salvar é explícito, sem surpresa
  // de blur gravando texto pela metade). null = campo fechado.
  const [novoSnippet, setNovoSnippet] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    try {
      const s = localStorage.getItem("cs_snippets");
      if (s) setSnippets(JSON.parse(s));
    } catch { /* noop */ }
  }, []);

  // Tick de 30s só para o contador "fecha em Xh" andar — barato: re-renderiza
  // apenas o composer.
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!expiraEm) return;
    const t = setInterval(() => setTick((n) => n + 1), 30000);
    return () => clearInterval(t);
  }, [expiraEm]);
  const restanteMin = expiraEm ? Math.max(0, Math.round((new Date(expiraEm).getTime() - Date.now()) / 60000)) : null;
  const urgente = restanteMin != null && restanteMin <= 60;

  async function enviar() {
    const txt = texto.trim();
    // Guard de concorrência: Enter repetido durante um envio em voo não dispara
    // um segundo POST (e não perde o texto — ele continua no campo).
    if (!txt || enviando) return;
    setEnviando(true);
    setTexto("");
    const ok = await onEnviar(txt);
    setEnviando(false);
    // Falhou: devolve o texto SÓ se o operador não recomeçou a digitar nesse
    // meio-tempo — nunca sobrescreve o que já está no campo.
    if (!ok) setTexto((atual) => (atual.trim() ? atual : txt));
    inputRef.current?.focus();
  }

  function salvarSnippet() {
    const t = (novoSnippet ?? "").trim();
    setNovoSnippet(null);
    if (!t) return;
    const novo = [...snippets, t];
    setSnippets(novo);
    try { localStorage.setItem("cs_snippets", JSON.stringify(novo)); } catch { /* noop */ }
    toast("Resposta rápida adicionada.");
  }

  return (
    <div className="border-t border-slate-100 bg-white px-4 py-3 dark:border-slate-800 dark:bg-slate-900">
      {/* Respostas rápidas */}
      <div className="mb-2 flex flex-wrap gap-1.5">
        {snippets.map((s, i) => (
          <button key={i} onClick={() => { setTexto((t) => (t ? t + " " : "") + s); inputRef.current?.focus(); }} title={s}
            className="max-w-[180px] truncate rounded-full border border-slate-200 px-2.5 py-1 text-xs text-slate-600 transition hover:border-brand/30 hover:bg-brand/5 dark:border-slate-700 dark:text-slate-300 dark:hover:border-brand-400/30 dark:hover:bg-brand-400/10">
            {s}
          </button>
        ))}
        {novoSnippet === null ? (
          <button onClick={() => setNovoSnippet("")} title="Adicionar resposta rápida" className="rounded-full border border-dashed border-slate-300 px-2.5 py-1 text-xs text-slate-400 transition hover:text-slate-600 dark:border-slate-600 dark:hover:text-slate-300">+ atalho</button>
        ) : (
          <input
            autoFocus
            value={novoSnippet}
            onChange={(e) => setNovoSnippet(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") { e.preventDefault(); salvarSnippet(); }
              if (e.key === "Escape") setNovoSnippet(null);
            }}
            onBlur={() => setNovoSnippet(null)}
            placeholder="Nova resposta rápida… (Enter salva, Esc cancela)"
            aria-label="Nova resposta rápida"
            className="w-72 max-w-full rounded-full border border-dashed border-brand/50 bg-transparent px-2.5 py-1 text-xs text-slate-700 outline-none placeholder:text-slate-400 focus:border-brand dark:border-brand-400/50 dark:text-slate-200 dark:placeholder:text-slate-500"
          />
        )}
      </div>
      <div className="flex items-end gap-2">
        <input
          ref={inputRef}
          autoFocus
          value={texto}
          onChange={(e) => setTexto(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void enviar(); } }}
          placeholder="Escreva uma resposta…"
          aria-label="Resposta ao lead"
          className={cn(fieldClass, "flex-1")}
        />
        <Button onClick={() => void enviar()} disabled={enviando || !texto.trim()}>
          {enviando ? (<><Spinner className="text-white" /> Enviando…</>) : "Enviar"}
        </Button>
      </div>
      <p className={cn("mt-2 flex items-center gap-1.5 text-[11px]", urgente ? "text-amber-600 dark:text-amber-400" : "text-emerald-600 dark:text-emerald-400")}>
        <svg className="h-3 w-3 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" strokeLinecap="round" strokeLinejoin="round" /></svg>
        Janela aberta{restanteMin != null ? ` · fecha em ${fmtMin(restanteMin)} (${fmtHora(expiraEm)})` : ""} — você pode escrever livremente. Responder marca a conversa como resolvida.
      </p>
    </div>
  );
});
