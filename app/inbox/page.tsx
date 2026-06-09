"use client";

import { useCallback, useEffect, useState } from "react";
import { EdicaoBadge } from "@/app/_components/edicao-badge";

type Conversa = {
  comprador_id: string; nome: string; telefone: string | null; edicao: string | null;
  estagio_nome: string | null; ultima_resposta_em: string | null; ultima_msg: string | null;
};
type Mensagem = { id: string; de: "lead" | "cs"; tipo: string; texto: string; data: string | null };

function fmtData(iso: string | null) {
  return iso ? new Date(iso).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) : "";
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
    <div className="grid h-[75vh] gap-4 lg:grid-cols-[320px_1fr]">
      {/* Fila de conversas */}
      <div className="overflow-auto rounded-lg border border-slate-200 bg-white">
        <div className="sticky top-0 border-b border-slate-100 bg-white px-4 py-3">
          <h1 className="font-semibold text-slate-800">Inbox</h1>
          <p className="text-xs text-slate-400">{conversas.length} conversa(s)</p>
        </div>
        {conversas.length === 0 && <p className="p-6 text-center text-sm text-slate-400">Nenhuma resposta ainda.</p>}
        {conversas.map((c) => (
          <button
            key={c.comprador_id}
            onClick={() => abrir(c)}
            className={`block w-full border-b border-slate-50 px-4 py-3 text-left hover:bg-slate-50 ${sel?.comprador_id === c.comprador_id ? "bg-brand/5" : ""}`}>
            <div className="flex items-center justify-between gap-2">
              <span className="truncate font-medium text-slate-800">{c.nome}</span>
              <EdicaoBadge edicao={c.edicao} />
            </div>
            <div className="mt-0.5 truncate text-xs text-slate-500">{c.ultima_msg || "—"}</div>
            <div className="text-[10px] text-slate-400">{fmtData(c.ultima_resposta_em)}</div>
          </button>
        ))}
      </div>

      {/* Conversa selecionada */}
      <div className="flex flex-col overflow-hidden rounded-lg border border-slate-200 bg-white">
        {!sel ? (
          <div className="flex flex-1 items-center justify-center text-sm text-slate-400">
            Selecione uma conversa à esquerda.
          </div>
        ) : (
          <>
            <div className="border-b border-slate-100 px-4 py-3">
              <div className="flex items-center gap-2">
                <span className="font-semibold text-slate-800">{sel.nome}</span>
                <EdicaoBadge edicao={sel.edicao} />
              </div>
              <p className="text-xs text-slate-400">{sel.telefone} · {sel.estagio_nome || ""}</p>
            </div>

            <div className="flex-1 space-y-2 overflow-auto bg-[#ECE5DD] p-4">
              {carregandoMsg && <p className="text-center text-sm text-slate-500">Carregando conversa…</p>}
              {aviso && <p className="text-center text-xs text-amber-600">{aviso}</p>}
              {mensagens.map((m) => (
                <div key={m.id} className={`flex ${m.de === "cs" ? "justify-end" : "justify-start"}`}>
                  <div className={`max-w-[75%] rounded-2xl px-3 py-2 text-sm shadow-sm ${m.de === "cs" ? "rounded-tr-sm bg-[#DCF8C6]" : "rounded-tl-sm bg-white"}`}>
                    {m.tipo === "template" && <span className="mb-0.5 block text-[10px] font-medium uppercase text-slate-400">Template</span>}
                    <p className="whitespace-pre-wrap text-slate-800">{m.texto}</p>
                    <span className="mt-1 block text-right text-[10px] text-slate-400">{fmtData(m.data)}</span>
                  </div>
                </div>
              ))}
              {!carregandoMsg && mensagens.length === 0 && !aviso && (
                <p className="text-center text-sm text-slate-500">Sem mensagens.</p>
              )}
            </div>

            <div className="border-t border-slate-100 p-3">
              <div className="flex gap-2">
                <input
                  value={texto}
                  onChange={(e) => setTexto(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); enviar(); } }}
                  placeholder="Escreva uma resposta…"
                  className="flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-brand" />
                <button
                  onClick={enviar}
                  disabled={enviando || !texto.trim()}
                  className="rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand-light disabled:opacity-50">
                  {enviando ? "Enviando…" : "Enviar"}
                </button>
              </div>
              <p className="mt-1 text-[10px] text-slate-400">
                A resposta só é entregue dentro da janela de 24h após a última mensagem do lead.
              </p>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
