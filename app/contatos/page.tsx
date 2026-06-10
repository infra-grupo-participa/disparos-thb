"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { EdicaoBadge } from "@/app/_components/edicao-badge";
import { Button, Card, PageHeader, EmptyState, Spinner, cn, fieldClass } from "@/app/_components/ui";
import { Disparo } from "@/app/_components/disparo";

type SelDisparo = { comprador_id: string; nome: string; telefone: string; edicao?: string | null };

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
  const [estagios, setEstagios] = useState<Estagio[]>([]);
  const [contatos, setContatos] = useState<Contato[]>([]);
  const [carregando, setCarregando] = useState(true);

  const [fEstagio, setFEstagio] = useState("");
  const [fEdicao, setFEdicao] = useState("");
  const [fQ, setFQ] = useState("");
  const [fComTelefone, setFComTelefone] = useState(true);

  const [selecionados, setSelecionados] = useState<Set<string>>(new Set());
  const [dispararSelecao, setDispararSelecao] = useState<SelDisparo[] | null>(null);

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
    const escolhidos: SelDisparo[] = contatos
      .filter((c) => selecionados.has(c.comprador_id) && c.telefone)
      .map((c) => ({ comprador_id: c.comprador_id, nome: c.nome, telefone: c.telefone as string, edicao: c.edicao }));
    if (escolhidos.length === 0) return;
    setDispararSelecao(escolhidos); // abre o disparo como modal, sem sair da tela
  }

  const descricao = carregando ? (
    <span className="inline-flex items-center gap-2">
      <Spinner className="h-3.5 w-3.5" />
      Carregando contatos…
    </span>
  ) : (
    <>
      <span className="font-medium text-slate-700 dark:text-slate-200">{contatos.length}</span>{" "}
      {contatos.length === 1 ? "contato" : "contatos"}
      {selecionados.size > 0 && (
        <>
          {" · "}
          <span className="font-medium text-brand">{selecionados.size}</span> selecionado(s)
        </>
      )}
    </>
  );

  return (
    <div className="pb-24">
      <PageHeader
        title="Contatos HT"
        description={descricao}
        actions={
          <Button
            variant="primary"
            onClick={dispararSelecionados}
            disabled={selecionados.size === 0}
          >
            Disparar{selecionados.size > 0 ? ` para ${selecionados.size}` : ""}
          </Button>
        }
      />

      {/* Filtros */}
      <Card className="mb-5 p-4">
        <div className="flex flex-wrap items-center gap-3">
          <select
            value={fEstagio}
            onChange={(e) => setFEstagio(e.target.value)}
            className={cn(fieldClass, "w-auto")}
          >
            <option value="">Todos os estágios</option>
            {estagios.map((e) => (
              <option key={e.chave} value={e.chave}>{e.nome}</option>
            ))}
          </select>
          <select
            value={fEdicao}
            onChange={(e) => setFEdicao(e.target.value)}
            className={cn(fieldClass, "w-auto")}
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
            className={cn(fieldClass, "min-w-64 flex-1")}
          />
          <label className="flex select-none items-center gap-2 text-sm text-slate-600 dark:text-slate-300">
            <input
              type="checkbox"
              checked={fComTelefone}
              onChange={(e) => setFComTelefone(e.target.checked)}
              className="h-4 w-4 rounded border-slate-300 text-brand focus:ring-brand dark:border-slate-600"
            />
            Só com telefone
          </label>
          {temFiltro && (
            <Button variant="ghost" size="sm" onClick={limparFiltros}>
              Limpar filtros
            </Button>
          )}
        </div>
      </Card>

      {/* Conteúdo: carregando × vazio × tabela */}
      {carregando && contatos.length === 0 ? (
        <Card className="flex flex-col items-center justify-center gap-3 px-6 py-16 text-slate-400 dark:text-slate-500">
          <Spinner className="h-7 w-7" />
          <span className="text-sm">Carregando contatos…</span>
        </Card>
      ) : contatos.length === 0 && temFiltro ? (
        <EmptyState
          icon={
            <svg className="h-10 w-10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <circle cx="11" cy="11" r="7" />
              <path d="m21 21-4.3-4.3" />
              <path d="m8 8 6 6M14 8l-6 6" />
            </svg>
          }
          title="Nenhum contato com esses filtros"
          description="Tente ampliar a busca ou remover algum filtro."
          action={
            <Button variant="secondary" size="sm" onClick={limparFiltros}>
              Limpar filtros
            </Button>
          }
        />
      ) : contatos.length === 0 && !temFiltro ? (
        <EmptyState
          icon={
            <svg className="h-10 w-10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
              <circle cx="9" cy="7" r="4" />
              <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
              <path d="M16 3.13a4 4 0 0 1 0 7.75" />
            </svg>
          }
          title="Nenhum contato cadastrado ainda"
          description="Os contatos aparecem aqui assim que houver compradores no sistema."
        />
      ) : (
        <Card className="overflow-hidden">
          <table className="w-full text-sm">
            <thead className="border-b border-slate-200 bg-slate-50 text-left text-xs font-medium uppercase tracking-wide text-slate-500 dark:border-slate-800 dark:bg-slate-800/60 dark:text-slate-400">
              <tr>
                <th className="w-10 px-4 py-3">
                  <input
                    type="checkbox"
                    checked={todosSelecionados}
                    onChange={toggleTodos}
                    className="h-4 w-4 rounded border-slate-300 text-brand focus:ring-brand dark:border-slate-600"
                  />
                </th>
                <th className="px-4 py-3">Nome</th>
                <th className="px-4 py-3">Telefone</th>
                <th className="px-4 py-3">Edição</th>
                <th className="px-4 py-3">Estágio</th>
                <th className="px-4 py-3">Última compra</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {contatos.map((c) => (
                <tr
                  key={c.comprador_id}
                  className={cn(
                    "transition-colors hover:bg-slate-50 dark:hover:bg-slate-800/60",
                    selecionados.has(c.comprador_id) && "bg-brand/5 hover:bg-brand/10 dark:bg-brand-400/10 dark:hover:bg-brand-400/15",
                  )}
                >
                  <td className="px-4 py-3">
                    <input
                      type="checkbox"
                      disabled={!c.telefone}
                      checked={selecionados.has(c.comprador_id)}
                      onChange={() => toggle(c.comprador_id)}
                      className="h-4 w-4 rounded border-slate-300 text-brand focus:ring-brand disabled:opacity-40 dark:border-slate-600"
                    />
                  </td>
                  <td className="px-4 py-3">
                    <Link
                      href={`/contatos/${c.comprador_id}`}
                      className="font-medium text-slate-900 hover:text-brand hover:underline dark:text-slate-100 dark:hover:text-brand-300"
                    >
                      {c.nome}
                    </Link>
                    <div className="text-xs text-slate-400 dark:text-slate-500">{c.email}</div>
                  </td>
                  <td className="px-4 py-3 text-slate-600 dark:text-slate-300">
                    {c.telefone || <span className="text-rose-500 dark:text-rose-400">sem telefone</span>}
                  </td>
                  <td className="px-4 py-3"><EdicaoBadge edicao={c.edicao_ht ?? c.edicao} /></td>
                  <td className="px-4 py-3">
                    {c.estagio_nome ? (
                      <span
                        className="inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium text-white"
                        style={{ backgroundColor: corEstagio[c.estagio_chave || ""] || "#94a3b8" }}
                      >
                        {c.estagio_nome}
                      </span>
                    ) : (
                      <span className="text-slate-300 dark:text-slate-600">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-slate-500 dark:text-slate-400">{fmtData(c.ultima_compra_ht)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}

      {/* Barra de ação em massa — fixa no rodapé enquanto houver seleção */}
      {selecionados.size > 0 && (
        <div className="fixed inset-x-0 bottom-0 z-20 border-t border-slate-200 bg-white/95 shadow-[0_-2px_12px_rgba(0,0,0,0.06)] backdrop-blur dark:border-slate-800 dark:bg-slate-900/95">
          <div className="mx-auto flex max-w-6xl items-center gap-3 px-4 py-3">
            <span className="text-sm text-slate-700 dark:text-slate-200">
              <span className="font-semibold text-slate-900 dark:text-slate-100">{selecionados.size}</span>{" "}
              {selecionados.size === 1 ? "contato selecionado" : "contatos selecionados"}
            </span>
            <Button variant="ghost" size="sm" onClick={limparSelecao}>
              Limpar seleção
            </Button>
            <div className="flex-1" />
            <Button variant="primary" onClick={dispararSelecionados}>
              Disparar para {selecionados.size}
            </Button>
          </div>
        </div>
      )}

      {/* Disparo como modal — mesmo fluxo da página, sem sair de Contatos */}
      {dispararSelecao && (
        <div
          className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-900/50 p-4 backdrop-blur-sm sm:p-8"
          onClick={() => setDispararSelecao(null)}
        >
          <div
            className="w-full max-w-3xl rounded-2xl border border-slate-200 bg-slate-100 p-4 shadow-pop dark:border-slate-800 dark:bg-slate-950 sm:p-6"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-2 flex items-center justify-between">
              <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Novo disparo</h2>
              <button
                onClick={() => setDispararSelecao(null)}
                className="rounded-lg p-1.5 text-slate-400 transition hover:bg-slate-200 hover:text-slate-700 dark:hover:bg-slate-800 dark:hover:text-slate-200"
                aria-label="Fechar"
              >
                <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M18 6 6 18M6 6l12 12" /></svg>
              </button>
            </div>
            <Disparo
              selecaoInicial={dispararSelecao}
              aoFechar={() => { setDispararSelecao(null); limparSelecao(); carregar(); }}
            />
          </div>
        </div>
      )}
    </div>
  );
}
