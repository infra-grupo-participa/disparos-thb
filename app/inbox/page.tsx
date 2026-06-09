"use client";

import { useCallback, useEffect, useState } from "react";
import { EdicaoBadge } from "@/app/_components/edicao-badge";
import { Button, Card, EmptyState, Spinner, cn, fieldClass } from "@/app/_components/ui";

type Conversa = {
  comprador_id: string; nome: string; telefone: string | null; edicao: string | null;
  estagio_nome: string | null; ultima_resposta_em: string | null; ultima_msg: string | null;
};
type Mensagem = { id: string; de: "lead" | "cs"; tipo: string; texto: string; data: string | null };

function fmtData(iso: string | null) {
  return iso ? new Date(iso).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) : "";
}

function fmtHora(iso: string | null) {
  return iso ? new Date(iso).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }) : "";
}

// Inicial e cor de avatar derivada do nome (determinística).
function inicial(nome: string) {
  return (nome?.trim()?.[0] || "?").toUpperCase();
}
const AVATAR_CORES = [
  "bg-brand-100 text-brand-700",
  "bg-blue-100 text-blue-700",
  "bg-emerald-100 text-emerald-700",
  "bg-amber-100 text-amber-800",
  "bg-violet-100 text-violet-700",
  "bg-rose-100 text-rose-700",
  "bg-cyan-100 text-cyan-700",
];
function corAvatar(nome: string) {
  let h = 0;
  for (let i = 0; i < (nome?.length || 0); i++) h = (h * 31 + nome.charCodeAt(i)) >>> 0;
  return AVATAR_CORES[h % AVATAR_CORES.length];
}

function Avatar({ nome, size = "md" }: { nome: string; size?: "sm" | "md" }) {
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center justify-center rounded-full font-semibold",
        size === "sm" ? "h-9 w-9 text-sm" : "h-10 w-10 text-base",
        corAvatar(nome),
      )}
    >
      {inicial(nome)}
    </span>
  );
}

export default function InboxPage() {
  const [conversas, setConversas] = useState<Conversa[]>([]);
  const [sel, setSel] = useState<Conversa | null>(null);
  const [mensagens, setMensagens] = useState<Mensagem[]>([]);
  const [carregandoMsg, setCarregandoMsg] = useState(false);
  const [aviso, setAviso] = useState<string | null>(null);
  const [texto, setTexto] = useState("");
  const [enviando, setEnviando] = useState(false);

  const carregarConversas = useCallback(async () => {
    const r = await fetch("/api/inbox");
    const d = await r.json();
    if (d.ok) setConversas(d.conversas);
  }, []);
  useEffect(() => { carregarConversas(); }, [carregarConversas]);

  const abrir = useCallback(async (c: Conversa) => {
    setSel(c); setMensagens([]); setAviso(null); setCarregandoMsg(true);
    try {
      const r = await fetch(`/api/inbox/${c.comprador_id}`);
      const d = await r.json();
      if (d.ok) { setMensagens(d.mensagens); setAviso(d.aviso ?? null); }
    } finally { setCarregandoMsg(false); }
  }, []);

  async function enviar() {
    if (!sel || !texto.trim()) return;
    setEnviando(true);
    try {
      const r = await fetch(`/api/inbox/${sel.comprador_id}`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ texto }),
      });
      const d = await r.json();
      if (!d.ok) { alert(d.reason || "Falha ao enviar (a janela de 24h pode estar fechada)."); return; }
      setTexto("");
      await abrir(sel);
    } finally { setEnviando(false); }
  }

  return (
    <Card className="grid h-[78vh] grid-cols-1 overflow-hidden p-0 lg:grid-cols-[340px_1fr]">
      {/* Fila de conversas */}
      <aside className="flex min-h-0 flex-col border-b border-slate-200 lg:border-b-0 lg:border-r">
        <header className="flex items-center justify-between gap-2 border-b border-slate-100 px-5 py-4">
          <h1 className="text-lg font-semibold tracking-tight text-slate-900">Inbox</h1>
          <span className="inline-flex items-center rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-semibold text-slate-600">
            {conversas.length}
          </span>
        </header>

        <div className="min-h-0 flex-1 overflow-auto">
          {conversas.length === 0 ? (
            <div className="p-4">
              <EmptyState
                title="Nenhuma conversa"
                description="Quando um lead responder, a conversa aparecerá aqui."
              />
            </div>
          ) : (
            <ul className="divide-y divide-slate-100">
              {conversas.map((c) => {
                const ativo = sel?.comprador_id === c.comprador_id;
                return (
                  <li key={c.comprador_id}>
                    <button
                      onClick={() => abrir(c)}
                      className={cn(
                        "flex w-full items-start gap-3 px-4 py-3 text-left transition",
                        ativo ? "bg-brand-50" : "hover:bg-slate-50",
                      )}
                    >
                      <Avatar nome={c.nome} />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center justify-between gap-2">
                          <span className={cn("truncate font-semibold", ativo ? "text-brand-700" : "text-slate-800")}>
                            {c.nome}
                          </span>
                          <span className="shrink-0 text-[11px] tabular-nums text-slate-400">
                            {fmtData(c.ultima_resposta_em)}
                          </span>
                        </div>
                        <div className="mt-0.5 flex items-center justify-between gap-2">
                          <span className="truncate text-xs text-slate-500">{c.ultima_msg || "—"}</span>
                          <EdicaoBadge edicao={c.edicao} className="shrink-0" />
                        </div>
                      </div>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </aside>

      {/* Conversa selecionada */}
      <section className="flex min-h-0 flex-col">
        {!sel ? (
          <div className="flex flex-1 items-center justify-center p-8">
            <EmptyState
              icon={
                <svg className="h-10 w-10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                  <path d="M8 10h8M8 14h5M21 12a9 9 0 0 1-13.36 7.87L3 21l1.13-4.64A9 9 0 1 1 21 12Z" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              }
              title="Selecione uma conversa"
              description="Escolha um contato na lista à esquerda para ver o histórico e responder."
            />
          </div>
        ) : (
          <>
            <header className="flex items-center gap-3 border-b border-slate-100 px-5 py-3">
              <Avatar nome={sel.nome} size="sm" />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="truncate font-semibold text-slate-900">{sel.nome}</span>
                  <EdicaoBadge edicao={sel.edicao} />
                </div>
                <p className="mt-0.5 truncate text-xs text-slate-500">
                  {sel.telefone || "Sem telefone"}
                  {sel.estagio_nome ? <span className="text-slate-300"> · </span> : null}
                  {sel.estagio_nome}
                </p>
              </div>
            </header>

            <div className="min-h-0 flex-1 space-y-2 overflow-auto bg-[#ECE5DD] p-4">
              {carregandoMsg && (
                <div className="flex items-center justify-center gap-2 py-6 text-sm text-slate-600">
                  <Spinner /> Carregando conversa…
                </div>
              )}
              {aviso && (
                <div className="mx-auto w-fit max-w-[85%] rounded-full bg-amber-50 px-3 py-1 text-center text-xs font-medium text-amber-700 ring-1 ring-inset ring-amber-200">
                  {aviso}
                </div>
              )}
              {mensagens.map((m) => {
                const cs = m.de === "cs";
                return (
                  <div key={m.id} className={cn("flex", cs ? "justify-end" : "justify-start")}>
                    <div
                      className={cn(
                        "max-w-[75%] rounded-2xl px-3 py-2 text-sm shadow-sm",
                        cs ? "rounded-br-sm bg-[#DCF8C6]" : "rounded-bl-sm bg-white",
                      )}
                    >
                      {m.tipo === "template" && (
                        <span className="mb-0.5 block text-[10px] font-semibold uppercase tracking-wide text-slate-400">
                          Template
                        </span>
                      )}
                      <p className="whitespace-pre-wrap break-words text-slate-800">{m.texto}</p>
                      <span className="mt-1 block text-right text-[10px] tabular-nums text-slate-400">{fmtHora(m.data)}</span>
                    </div>
                  </div>
                );
              })}
              {!carregandoMsg && mensagens.length === 0 && !aviso && (
                <p className="py-6 text-center text-sm text-slate-500">Sem mensagens nesta conversa.</p>
              )}
            </div>

            <div className="border-t border-slate-100 bg-white px-4 py-3">
              <div className="flex items-end gap-2">
                <input
                  value={texto}
                  onChange={(e) => setTexto(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); enviar(); } }}
                  placeholder="Escreva uma resposta…"
                  className={cn(fieldClass, "flex-1")}
                />
                <Button onClick={enviar} disabled={enviando || !texto.trim()}>
                  {enviando ? (<><Spinner className="text-white" /> Enviando…</>) : "Enviar"}
                </Button>
              </div>
              <p className="mt-2 flex items-center gap-1.5 text-[11px] text-slate-400">
                <svg className="h-3 w-3 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
                A resposta só é entregue dentro da janela de 24h após a última mensagem do lead.
              </p>
            </div>
          </>
        )}
      </section>
    </Card>
  );
}
