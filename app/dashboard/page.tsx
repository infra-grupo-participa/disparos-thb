"use client";

import { useCallback, useEffect, useRef, useState } from "react";

type Kpis = { enviados: number; respondidos: number; sla_medio: number | null };
type LinhaTemplate = { template: string; enviados: number; respondidos: number; sla_medio: number | null };
type LinhaDisparo = {
  id: string; template: string | null; edicao_ht: string | null; iniciado_em: string;
  status: string; enviados: number; respondidos: number; sla_medio: number | null;
};

const POLL_MS = 15_000; // dashboard "ao vivo" sem Realtime: repolla o endpoint server-side.

function taxa(resp: number, env: number) {
  return env ? Math.round((resp / env) * 100) : 0;
}
function fmt(iso: string) {
  return new Date(iso).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
}
function hms(d: Date) {
  return d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

export default function DashboardPage() {
  const [kpis, setKpis] = useState<Kpis | null>(null);
  const [porTemplate, setPorTemplate] = useState<LinhaTemplate[]>([]);
  const [porDisparo, setPorDisparo] = useState<LinhaDisparo[]>([]);
  const [edicoes, setEdicoes] = useState<string[]>([]);

  // Filtros (seção 6.3 do projeto): período + edição do HT.
  const [desde, setDesde] = useState("");
  const [ate, setAte] = useState("");
  const [edicao, setEdicao] = useState("");

  const [atualizadoEm, setAtualizadoEm] = useState<Date | null>(null);
  const carregandoRef = useRef(false);

  const carregar = useCallback(async () => {
    if (carregandoRef.current) return; // evita sobreposição de polls
    carregandoRef.current = true;
    try {
      const params = new URLSearchParams();
      if (desde) params.set("desde", new Date(`${desde}T00:00:00`).toISOString());
      if (ate) params.set("ate", new Date(`${ate}T23:59:59`).toISOString());
      if (edicao) params.set("edicao", edicao);
      const r = await fetch(`/api/dashboard?${params.toString()}`);
      const d = await r.json();
      if (!d.ok) return;
      setKpis(d.kpis);
      setPorTemplate(d.porTemplate);
      setPorDisparo(d.porDisparo);
      if (Array.isArray(d.edicoes)) setEdicoes(d.edicoes);
      setAtualizadoEm(new Date());
    } catch {
      /* mantém os dados anteriores em caso de falha de rede */
    } finally {
      carregandoRef.current = false;
    }
  }, [desde, ate, edicao]);

  // Recarrega ao montar, quando um filtro muda e a cada POLL_MS (auto-refresh).
  useEffect(() => {
    carregar();
    const t = setInterval(carregar, POLL_MS);
    return () => clearInterval(t);
  }, [carregar]);

  function limparFiltros() {
    setDesde("");
    setAte("");
    setEdicao("");
  }

  const env = kpis?.enviados ?? 0;
  const resp = kpis?.respondidos ?? 0;
  const temFiltro = Boolean(desde || ate || edicao);

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <h1 className="text-xl font-semibold">Dashboard</h1>
        <div className="flex items-center gap-3 text-xs text-slate-400">
          {atualizadoEm && <span>Atualizado às {hms(atualizadoEm)} · a cada {POLL_MS / 1000}s</span>}
          <button
            onClick={carregar}
            className="rounded border border-slate-300 px-2 py-1 text-slate-600 hover:bg-slate-50"
          >
            Atualizar agora
          </button>
        </div>
      </div>

      {/* Filtros */}
      <div className="mb-5 flex flex-wrap items-end gap-3 rounded-lg border border-slate-200 bg-white p-3">
        <div>
          <label className="block text-xs text-slate-500">De</label>
          <input type="date" value={desde} onChange={(e) => setDesde(e.target.value)}
            className="mt-1 rounded-lg border border-slate-300 px-3 py-1.5 text-sm" />
        </div>
        <div>
          <label className="block text-xs text-slate-500">Até</label>
          <input type="date" value={ate} onChange={(e) => setAte(e.target.value)}
            className="mt-1 rounded-lg border border-slate-300 px-3 py-1.5 text-sm" />
        </div>
        <div>
          <label className="block text-xs text-slate-500">Edição HT</label>
          <select value={edicao} onChange={(e) => setEdicao(e.target.value)}
            className="mt-1 rounded-lg border border-slate-300 px-3 py-1.5 text-sm">
            <option value="">Todas</option>
            {edicoes.map((ed) => <option key={ed} value={ed}>{ed}</option>)}
          </select>
        </div>
        {temFiltro && (
          <button onClick={limparFiltros} className="text-sm text-slate-500 underline hover:text-slate-800">
            Limpar
          </button>
        )}
      </div>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Card titulo="Enviados" valor={env.toString()} />
        <Card titulo="Respondidos" valor={resp.toString()} />
        <Card titulo="Taxa de resposta" valor={`${taxa(resp, env)}%`} />
        <Card titulo="SLA médio" valor={kpis?.sla_medio != null ? `${kpis.sla_medio} min` : "—"} />
      </div>

      <h2 className="mb-2 mt-8 text-sm font-semibold uppercase text-slate-500">Por template</h2>
      <Tabela
        cols={["Template", "Enviados", "Respondidos", "% resposta", "SLA médio"]}
        linhas={porTemplate.map((t) => [
          t.template, t.enviados, t.respondidos, `${taxa(t.respondidos, t.enviados)}%`,
          t.sla_medio != null ? `${t.sla_medio} min` : "—",
        ])}
        vazio="Nenhum disparo ainda."
      />

      <h2 className="mb-2 mt-8 text-sm font-semibold uppercase text-slate-500">Por disparo</h2>
      <Tabela
        cols={["Data", "Template", "Edição", "Status", "Enviados", "Resp.", "% resp.", "SLA"]}
        linhas={porDisparo.map((d) => [
          fmt(d.iniciado_em), d.template || "—", d.edicao_ht || "—", d.status,
          d.enviados, d.respondidos, `${taxa(d.respondidos, d.enviados)}%`,
          d.sla_medio != null ? `${d.sla_medio}m` : "—",
        ])}
        vazio="Nenhum disparo ainda."
      />
    </div>
  );
}

function Card({ titulo, valor }: { titulo: string; valor: string }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4">
      <div className="text-xs uppercase tracking-wide text-slate-400">{titulo}</div>
      <div className="mt-1 text-2xl font-semibold text-slate-800">{valor}</div>
    </div>
  );
}

function Tabela({ cols, linhas, vazio }: { cols: string[]; linhas: (string | number)[][]; vazio: string }) {
  return (
    <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
      <table className="w-full text-sm">
        <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
          <tr>{cols.map((c) => <th key={c} className="px-3 py-2">{c}</th>)}</tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {linhas.map((l, i) => (
            <tr key={i}>{l.map((cel, j) => <td key={j} className="px-3 py-2 text-slate-700">{cel}</td>)}</tr>
          ))}
          {linhas.length === 0 && (
            <tr><td colSpan={cols.length} className="px-3 py-8 text-center text-slate-400">{vazio}</td></tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
