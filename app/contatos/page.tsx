"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

type Estagio = {
  id: number;
  chave: string;
  nome: string;
  cor: string | null;
};

type Contato = {
  comprador_id: string;
  nome: string;
  email: string;
  telefone: string | null;
  edicao: string | null;
  estagio_chave: string | null;
  estagio_nome: string | null;
  ultima_compra_ht: string | null;
  proxima_acao_em: string | null;
  ultima_resposta_em: string | null;
};

function fmtData(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" });
}

export default function ContatosPage() {
  const router = useRouter();
  const [estagios, setEstagios] = useState<Estagio[]>([]);
  const [contatos, setContatos] = useState<Contato[]>([]);
  const [carregando, setCarregando] = useState(true);

  const [fEstagio, setFEstagio] = useState("");
  const [fEdicao, setFEdicao] = useState("");
  const [fQ, setFQ] = useState("");
  const [fComTelefone, setFComTelefone] = useState(true);

  const [selecionados, setSelecionados] = useState<Set<string>>(new Set());

  const corEstagio = useMemo(() => {
    const m: Record<string, string> = {};
    for (const e of estagios) m[e.chave] = e.cor || "#94a3b8";
    return m;
  }, [estagios]);

  useEffect(() => {
    fetch("/api/estagios")
      .then((r) => r.json())
      .then((d) => d.ok && setEstagios(d.estagios))
      .catch(() => {});
  }, []);

  const carregar = useCallback(async () => {
    setCarregando(true);
    const params = new URLSearchParams();
    if (fEstagio) params.set("estagio", fEstagio);
    if (fEdicao) params.set("edicao", fEdicao);
    if (fQ) params.set("q", fQ);
    if (fComTelefone) params.set("com_telefone", "1");
    try {
      const r = await fetch(`/api/contatos?${params.toString()}`);
      const d = await r.json();
      if (d.ok) setContatos(d.contatos);
    } finally {
      setCarregando(false);
    }
  }, [fEstagio, fEdicao, fQ, fComTelefone]);

  // debounce simples nos filtros
  useEffect(() => {
    const t = setTimeout(carregar, 250);
    return () => clearTimeout(t);
  }, [carregar]);

  const todosVisiveis = contatos.filter((c) => c.telefone);
  const todosSelecionados = todosVisiveis.length > 0 && todosVisiveis.every((c) => selecionados.has(c.comprador_id));

  function toggle(id: string) {
    setSelecionados((prev) => {
      const n = new Set(prev);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });
  }

  function toggleTodos() {
    setSelecionados((prev) => {
      if (todosSelecionados) return new Set();
      const n = new Set(prev);
      for (const c of todosVisiveis) n.add(c.comprador_id);
      return n;
    });
  }

  function dispararSelecionados() {
    const escolhidos = contatos
      .filter((c) => selecionados.has(c.comprador_id) && c.telefone)
      .map((c) => ({ comprador_id: c.comprador_id, nome: c.nome, telefone: c.telefone, edicao: c.edicao }));
    if (escolhidos.length === 0) return;
    sessionStorage.setItem("cs_disparo_selecao", JSON.stringify(escolhidos));
    router.push("/disparar");
  }

  return (
    <div>
      <div className="mb-4 flex items-end justify-between">
        <div>
          <h1 className="text-xl font-semibold text-slate-800">Contatos HT</h1>
          <p className="text-sm text-slate-500">
            {carregando ? "Carregando…" : `${contatos.length} contatos`}
            {selecionados.size > 0 && ` · ${selecionados.size} selecionado(s)`}
          </p>
        </div>
        <button
          onClick={dispararSelecionados}
          disabled={selecionados.size === 0}
          className="rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand-light disabled:opacity-50"
        >
          Disparar para selecionados ({selecionados.size})
        </button>
      </div>

      {/* Filtros */}
      <div className="mb-4 flex flex-wrap items-center gap-3 rounded-lg border border-slate-200 bg-white p-3">
        <select
          value={fEstagio}
          onChange={(e) => setFEstagio(e.target.value)}
          className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm"
        >
          <option value="">Todos os estágios</option>
          {estagios.map((e) => (
            <option key={e.chave} value={e.chave}>{e.nome}</option>
          ))}
        </select>
        <input
          placeholder="Edição (ex: HT20)"
          value={fEdicao}
          onChange={(e) => setFEdicao(e.target.value)}
          className="w-40 rounded-lg border border-slate-300 px-3 py-1.5 text-sm"
        />
        <input
          placeholder="Buscar nome, e-mail ou telefone"
          value={fQ}
          onChange={(e) => setFQ(e.target.value)}
          className="min-w-64 flex-1 rounded-lg border border-slate-300 px-3 py-1.5 text-sm"
        />
        <label className="flex items-center gap-2 text-sm text-slate-600">
          <input type="checkbox" checked={fComTelefone} onChange={(e) => setFComTelefone(e.target.checked)} />
          Só com telefone
        </label>
      </div>

      {/* Tabela */}
      <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th className="w-10 px-3 py-2">
                <input type="checkbox" checked={todosSelecionados} onChange={toggleTodos} />
              </th>
              <th className="px-3 py-2">Nome</th>
              <th className="px-3 py-2">Telefone</th>
              <th className="px-3 py-2">Edição</th>
              <th className="px-3 py-2">Estágio</th>
              <th className="px-3 py-2">Última compra</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {contatos.map((c) => (
              <tr key={c.comprador_id} className={selecionados.has(c.comprador_id) ? "bg-brand/5" : ""}>
                <td className="px-3 py-2">
                  <input
                    type="checkbox"
                    disabled={!c.telefone}
                    checked={selecionados.has(c.comprador_id)}
                    onChange={() => toggle(c.comprador_id)}
                  />
                </td>
                <td className="px-3 py-2">
                  <Link href={`/contatos/${c.comprador_id}`} className="font-medium text-brand hover:underline">
                    {c.nome}
                  </Link>
                  <div className="text-xs text-slate-400">{c.email}</div>
                </td>
                <td className="px-3 py-2 text-slate-600">{c.telefone || <span className="text-red-400">sem telefone</span>}</td>
                <td className="px-3 py-2 text-slate-600">{c.edicao || "—"}</td>
                <td className="px-3 py-2">
                  {c.estagio_nome ? (
                    <span
                      className="inline-block rounded-full px-2 py-0.5 text-xs font-medium text-white"
                      style={{ backgroundColor: corEstagio[c.estagio_chave || ""] || "#94a3b8" }}
                    >
                      {c.estagio_nome}
                    </span>
                  ) : "—"}
                </td>
                <td className="px-3 py-2 text-slate-500">{fmtData(c.ultima_compra_ht)}</td>
              </tr>
            ))}
            {!carregando && contatos.length === 0 && (
              <tr>
                <td colSpan={6} className="px-3 py-10 text-center text-slate-400">
                  Nenhum contato com os filtros atuais.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
