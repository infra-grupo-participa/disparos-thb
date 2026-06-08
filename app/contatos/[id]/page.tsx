"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";

type Estagio = { chave: string; nome: string; cor: string | null };
type Contato = {
  comprador_id: string; nome: string; email: string; telefone: string | null;
  edicao: string | null; ultima_compra_ht: string | null;
  estagio_chave: string | null; estagio_nome: string | null;
  proxima_acao_em: string | null; proxima_acao_nota: string | null;
  observacoes: string | null; ultima_resposta_em: string | null;
};
type Interacao = { tipo: string; descricao: string | null; autor: string | null; criado_em: string };

const ICONE: Record<string, string> = {
  disparo: "📤", resposta: "💬", nota: "📝", mudanca_estagio: "🔀", sistema: "⚙️",
};
function fmt(iso: string | null) {
  return iso ? new Date(iso).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", year: "2-digit", hour: "2-digit", minute: "2-digit" }) : "—";
}

export default function ContatoDetalhe({ params }: { params: { id: string } }) {
  const id = params.id;
  const [estagios, setEstagios] = useState<Estagio[]>([]);
  const [contato, setContato] = useState<Contato | null>(null);
  const [timeline, setTimeline] = useState<Interacao[]>([]);
  const [nota, setNota] = useState("");
  const [obs, setObs] = useState("");
  const [proxData, setProxData] = useState("");
  const [proxNota, setProxNota] = useState("");

  const carregar = useCallback(async () => {
    const r = await fetch(`/api/contato/${id}`);
    const d = await r.json();
    if (d.ok) {
      setContato(d.contato);
      setTimeline(d.timeline);
      setObs(d.contato.observacoes || "");
      setProxNota(d.contato.proxima_acao_nota || "");
      setProxData(d.contato.proxima_acao_em ? d.contato.proxima_acao_em.slice(0, 16) : "");
    }
  }, [id]);

  useEffect(() => {
    fetch("/api/estagios").then((r) => r.json()).then((d) => d.ok && setEstagios(d.estagios)).catch(() => {});
    carregar();
  }, [carregar]);

  async function patch(payload: Record<string, unknown>) {
    await fetch(`/api/contato/${id}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload),
    });
    await carregar();
  }

  if (!contato) return <div className="text-slate-400">Carregando…</div>;

  return (
    <div>
      <Link href="/contatos" className="text-sm text-slate-500 hover:text-slate-800">← Contatos</Link>

      <div className="mt-2 grid gap-6 lg:grid-cols-[1fr_380px]">
        {/* Coluna principal */}
        <div>
          <h1 className="text-xl font-semibold">{contato.nome}</h1>
          <p className="text-sm text-slate-500">
            {contato.email} · {contato.telefone || "sem telefone"} · {contato.edicao || "edição —"}
          </p>

          <h2 className="mb-2 mt-6 text-sm font-semibold uppercase text-slate-500">Timeline</h2>
          <div className="space-y-2">
            {timeline.map((i, idx) => (
              <div key={idx} className="flex gap-3 rounded-lg border border-slate-200 bg-white p-3 text-sm">
                <span>{ICONE[i.tipo] || "•"}</span>
                <div className="flex-1">
                  <div className="text-slate-700">{i.descricao}</div>
                  <div className="text-xs text-slate-400">{fmt(i.criado_em)} · {i.autor || "—"}</div>
                </div>
              </div>
            ))}
            {timeline.length === 0 && <div className="text-sm text-slate-400">Sem interações ainda.</div>}
          </div>
        </div>

        {/* Painel de CS */}
        <div className="space-y-4">
          <div className="rounded-lg border border-slate-200 bg-white p-4">
            <label className="block text-xs uppercase text-slate-400">Estágio</label>
            <select
              value={contato.estagio_chave || ""}
              onChange={(e) => patch({ estagio_chave: e.target.value })}
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
            >
              {estagios.map((e) => <option key={e.chave} value={e.chave}>{e.nome}</option>)}
            </select>
            {contato.ultima_resposta_em && (
              <p className="mt-2 text-xs text-green-600">Última resposta: {fmt(contato.ultima_resposta_em)}</p>
            )}
          </div>

          <div className="rounded-lg border border-slate-200 bg-white p-4">
            <label className="block text-xs uppercase text-slate-400">Próxima ação (follow-up)</label>
            <input type="datetime-local" value={proxData} onChange={(e) => setProxData(e.target.value)}
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-1.5 text-sm" />
            <input placeholder="O que fazer…" value={proxNota} onChange={(e) => setProxNota(e.target.value)}
              className="mt-2 w-full rounded-lg border border-slate-300 px-3 py-1.5 text-sm" />
            <button onClick={() => patch({ proxima_acao_em: proxData, proxima_acao_nota: proxNota })}
              className="mt-2 w-full rounded-lg bg-brand py-1.5 text-sm font-medium text-white hover:bg-brand-light">
              Salvar follow-up
            </button>
          </div>

          <div className="rounded-lg border border-slate-200 bg-white p-4">
            <label className="block text-xs uppercase text-slate-400">Observações</label>
            <textarea value={obs} onChange={(e) => setObs(e.target.value)} rows={3}
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-1.5 text-sm" />
            <button onClick={() => patch({ observacoes: obs })}
              className="mt-2 w-full rounded-lg border border-slate-300 py-1.5 text-sm hover:bg-slate-50">
              Salvar observações
            </button>
          </div>

          <div className="rounded-lg border border-slate-200 bg-white p-4">
            <label className="block text-xs uppercase text-slate-400">Adicionar nota à timeline</label>
            <input value={nota} onChange={(e) => setNota(e.target.value)} placeholder="Ex: ligou pedindo nota fiscal"
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-1.5 text-sm" />
            <button onClick={async () => { await patch({ nota }); setNota(""); }} disabled={!nota.trim()}
              className="mt-2 w-full rounded-lg border border-slate-300 py-1.5 text-sm hover:bg-slate-50 disabled:opacity-50">
              Adicionar nota
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
