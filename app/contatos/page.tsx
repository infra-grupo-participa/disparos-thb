"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { EdicaoBadge } from "@/app/_components/edicao-badge";

const EDICOES_HT = ["HT21", "HT22", "HT23", "HT24", "HT25", "HT26", "HT27"];

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
  edicao_ht: string | null;
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
  const temFiltro = Boolean(fEstagio || fEdicao || fQ);

  function limparFiltros() {
    setFEstagio("");
    setFEdicao("");
    setFQ("");
  }

  function limparSelecao() {
    setSelecionados(new Set());
  }

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
    <div className="pb-24">
      <div className="mb-4">
        <h1 className="text-xl font-semibold text-slate-800">Contatos HT</h1>
        <p className="text-sm text-slate-500">
          {carregando ? "Carregando…" : `${contatos.length} ${contatos.length === 1 ? "contato" : "contatos"}`}
          {selecionados.size > 0 && ` · ${selecionados.size} selecionado(s)`}
        </p>
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
        <select
          value={fEdicao}
          onChange={(e) => setFEdicao(e.target.value)}
          className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm"
        >
          <option value="">Todas as edições</option>
          {EDICOES_HT.map((ed) => (
            <option key={ed} value={ed}>{ed}</option>
          ))}
        </select>
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
                <td className="px-3 py-2"><EdicaoBadge edicao={c.edicao_ht ?? c.edicao} /></td>
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
            {carregando && contatos.length === 0 && (
              <tr>
                <td colSpan={6} className="px-3 py-12 text-center">
                  <div className="flex flex-col items-center gap-2 text-slate-400">
                    <svg className="h-7 w-7 animate-spin text-slate-300" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v3a5 5 0 00-5 5H4z" />
                    </svg>
                    <span className="text-sm">Carregando contatos…</span>
                  </div>
                </td>
              </tr>
            )}
            {!carregando && contatos.length === 0 && temFiltro && (
              <tr>
                <td colSpan={6} className="px-3 py-12 text-center">
                  <div className="mx-auto flex max-w-sm flex-col items-center gap-3 text-slate-500">
                    <svg className="h-9 w-9 text-slate-300" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <circle cx="11" cy="11" r="7" />
                      <path d="m21 21-4.3-4.3" />
                      <path d="m8 8 6 6M14 8l-6 6" />
                    </svg>
                    <div>
                      <p className="text-sm font-medium text-slate-700">Nenhum contato com esses filtros</p>
                      <p className="text-sm text-slate-500">Tente ampliar a busca ou remover algum filtro.</p>
                    </div>
                    <button
                      onClick={limparFiltros}
                      className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
                    >
                      Limpar filtros
                    </button>
                  </div>
                </td>
              </tr>
            )}
            {!carregando && contatos.length === 0 && !temFiltro && (
              <tr>
                <td colSpan={6} className="px-3 py-12 text-center">
                  <div className="mx-auto flex max-w-sm flex-col items-center gap-3 text-slate-500">
                    <svg className="h-9 w-9 text-slate-300" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
                      <circle cx="9" cy="7" r="4" />
                      <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
                      <path d="M16 3.13a4 4 0 0 1 0 7.75" />
                    </svg>
                    <div>
                      <p className="text-sm font-medium text-slate-700">Nenhum contato cadastrado ainda</p>
                      <p className="text-sm text-slate-500">Os contatos aparecem aqui assim que houver compradores no sistema.</p>
                    </div>
                  </div>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Barra de ação em massa — fixa no rodapé enquanto houver seleção */}
      {selecionados.size > 0 && (
        <div className="fixed inset-x-0 bottom-0 z-20 border-t border-slate-200 bg-white/95 shadow-[0_-2px_8px_rgba(0,0,0,0.06)] backdrop-blur">
          <div className="mx-auto flex max-w-6xl items-center gap-3 px-4 py-3">
            <span className="text-sm text-slate-700">
              <span className="font-semibold text-slate-900">{selecionados.size}</span>{" "}
              {selecionados.size === 1 ? "contato selecionado" : "contatos selecionados"}
            </span>
            <button
              onClick={limparSelecao}
              className="text-sm text-slate-500 underline-offset-2 hover:text-slate-800 hover:underline"
            >
              Limpar seleção
            </button>
            <div className="flex-1" />
            <button
              onClick={dispararSelecionados}
              className="rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand-light"
            >
              Disparar para {selecionados.size}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
