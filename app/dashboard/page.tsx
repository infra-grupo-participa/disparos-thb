"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";

import { EdicaoBadge } from "@/app/_components/edicao-badge";

type Kpis = { enviados: number; respondidos: number; sla_medio: number | null };

type Metricas = { enviados: number; respondidos: number; sla_medio: number | null };
type NoDisparo = Metricas & { id: string; iniciado_em: string; status: string };
type NoTemplate = Metricas & { template: string; disparos: NoDisparo[] };
type NoEdicao = Metricas & { edicao_ht: string; templates: NoTemplate[] };

type Atividade = {
  id: string; template: string | null; edicao_ht: string | null;
  iniciado_em: string; status: string; enviados: number; respondidos: number;
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
  const [arvore, setArvore] = useState<NoEdicao[]>([]);
  const [atividade, setAtividade] = useState<Atividade[]>([]);
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
      if (Array.isArray(d.arvore)) setArvore(d.arvore);
      if (Array.isArray(d.atividade)) setAtividade(d.atividade);
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

  const proximaAcao = useMemo(
    () => derivarProximaAcao(arvore, atividade),
    [arvore, atividade],
  );

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

      <ProximaAcao acao={proximaAcao} />

      <div data-testid="kpis" className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Card titulo="Enviados" valor={env.toString()} />
        <Card titulo="Respondidos" valor={resp.toString()} />
        <Card titulo="Taxa de resposta" valor={`${taxa(resp, env)}%`} />
        <Card titulo="SLA médio" valor={kpis?.sla_medio != null ? `${kpis.sla_medio} min` : "—"} />
      </div>

      <h2 className="mb-2 mt-8 text-sm font-semibold uppercase text-slate-500">
        Detalhamento — Edição → Template → Disparo
      </h2>
      <Arvore arvore={arvore} />

      <h2 className="mb-2 mt-8 text-sm font-semibold uppercase text-slate-500">Atividade de disparos</h2>
      <Atividades itens={atividade} />
    </div>
  );
}

type AcaoTom = "alerta" | "sugestao" | "neutro";
type Acao = { tom: AcaoTom; titulo: string; descricao: string };

const STATUS_ERRO = ["erro", "falha"];

function derivarProximaAcao(arvore: NoEdicao[], atividade: Atividade[]): Acao {
  // 1) Disparos com erro/falha têm prioridade máxima.
  const comErro = atividade.filter((a) => STATUS_ERRO.includes((a.status || "").toLowerCase()));
  if (comErro.length > 0) {
    return {
      tom: "alerta",
      titulo: `${comErro.length} ${comErro.length === 1 ? "disparo com erro" : "disparos com erro"}`,
      descricao: "Verifique o que falhou antes de seguir com novos envios.",
    };
  }

  // 2) Edição ativa (presente na árvore) ainda sem nenhum disparo realizado.
  const semDisparo = arvore.find((ed) => ed.enviados === 0);
  if (semDisparo) {
    const nome = semDisparo.edicao_ht || "esta edição";
    return {
      tom: "sugestao",
      titulo: `Edição ${nome} ainda sem disparo`,
      descricao: "Comece um disparo para esta edição quando estiver pronto.",
    };
  }

  // 3) Nada na árvore: ainda não há trabalho registrado.
  if (arvore.length === 0) {
    return {
      tom: "sugestao",
      titulo: "Nenhum disparo registrado",
      descricao: "Selecione contatos e faça o primeiro disparo para acompanhar os resultados aqui.",
    };
  }

  // 4) Tudo certo.
  return {
    tom: "neutro",
    titulo: "Tudo em dia",
    descricao: "Nenhuma ação pendente no momento.",
  };
}

const ACAO_ESTILO: Record<AcaoTom, { card: string; icone: string; titulo: string }> = {
  alerta: {
    card: "border-rose-200 bg-rose-50",
    icone: "text-rose-500",
    titulo: "text-rose-800",
  },
  sugestao: {
    card: "border-brand/30 bg-brand/5",
    icone: "text-brand",
    titulo: "text-slate-800",
  },
  neutro: {
    card: "border-emerald-200 bg-emerald-50",
    icone: "text-emerald-500",
    titulo: "text-emerald-800",
  },
};

function ProximaAcao({ acao }: { acao: Acao }) {
  const estilo = ACAO_ESTILO[acao.tom];
  return (
    <div className={`mb-5 flex items-start gap-3 rounded-lg border p-4 ${estilo.card}`}>
      <span className={`mt-0.5 shrink-0 ${estilo.icone}`} aria-hidden="true">
        {acao.tom === "alerta" ? (
          <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0Z" />
            <path d="M12 9v4M12 17h.01" />
          </svg>
        ) : acao.tom === "neutro" ? (
          <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
            <path d="m9 11 3 3L22 4" />
          </svg>
        ) : (
          <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M9 18h6M10 22h4" />
            <path d="M15.09 14c.18-.98.65-1.74 1.41-2.5A4.65 4.65 0 0 0 18 8a6 6 0 0 0-12 0c0 1 .23 2.23 1.5 3.5.76.76 1.23 1.52 1.41 2.5" />
          </svg>
        )}
      </span>
      <div className="min-w-0">
        <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Próxima ação</div>
        <p className={`mt-0.5 text-base font-semibold ${estilo.titulo}`}>{acao.titulo}</p>
        <p className="mt-0.5 text-sm text-slate-600">{acao.descricao}</p>
      </div>
    </div>
  );
}

const STATUS_CLASSE: Record<string, string> = {
  concluido: "bg-emerald-100 text-emerald-700 ring-emerald-300",
  concluído: "bg-emerald-100 text-emerald-700 ring-emerald-300",
  enviado: "bg-emerald-100 text-emerald-700 ring-emerald-300",
  em_andamento: "bg-blue-100 text-blue-700 ring-blue-300",
  enviando: "bg-blue-100 text-blue-700 ring-blue-300",
  agendado: "bg-amber-100 text-amber-800 ring-amber-300",
  erro: "bg-rose-100 text-rose-700 ring-rose-300",
  falha: "bg-rose-100 text-rose-700 ring-rose-300",
};

function StatusBadge({ status }: { status: string }) {
  const cor = STATUS_CLASSE[status?.toLowerCase()] || "bg-slate-100 text-slate-600 ring-slate-300";
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold ring-1 ring-inset ${cor}`}>
      {status || "—"}
    </span>
  );
}

function Metricas({ m }: { m: Metricas }) {
  return (
    <div className="flex shrink-0 items-center gap-4 text-xs text-slate-500">
      <span><span className="font-semibold text-slate-700">{m.enviados}</span> env.</span>
      <span><span className="font-semibold text-slate-700">{m.respondidos}</span> resp.</span>
      <span className="font-semibold text-brand">{taxa(m.respondidos, m.enviados)}%</span>
      <span>SLA {m.sla_medio != null ? `${m.sla_medio}m` : "—"}</span>
    </div>
  );
}

function Chevron({ aberto }: { aberto: boolean }) {
  return (
    <span className={`inline-block w-3 shrink-0 text-slate-400 transition-transform ${aberto ? "rotate-90" : ""}`}>
      ▸
    </span>
  );
}

function Arvore({ arvore }: { arvore: NoEdicao[] }) {
  const [abertos, setAbertos] = useState<Record<string, boolean>>({});
  const toggle = (k: string) => setAbertos((s) => ({ ...s, [k]: !s[k] }));

  if (arvore.length === 0) {
    return (
      <EstadoVazio
        titulo="Nenhum disparo ainda"
        descricao="Quando você fizer um disparo, o detalhamento por edição e template aparece aqui."
        icone={
          <svg className="h-8 w-8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M3 7v10a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-6l-2-2H5a2 2 0 0 0-2 2Z" />
          </svg>
        }
      />
    );
  }

  return (
    <div className="divide-y divide-slate-100 overflow-hidden rounded-lg border border-slate-200 bg-white text-sm">
      {arvore.map((ed) => {
        const ke = `e:${ed.edicao_ht}`;
        const abertoE = !!abertos[ke];
        return (
          <div key={ke || "sem-edicao"}>
            <button
              onClick={() => toggle(ke)}
              className="flex w-full items-center gap-2 px-3 py-2.5 text-left hover:bg-slate-50"
            >
              <Chevron aberto={abertoE} />
              <EdicaoBadge edicao={ed.edicao_ht || null} />
              <div className="flex-1" />
              <Metricas m={ed} />
            </button>

            {abertoE && (
              <div className="bg-slate-50/40">
                {ed.templates.map((tpl) => {
                  const kt = `${ke}|t:${tpl.template}`;
                  const abertoT = !!abertos[kt];
                  return (
                    <div key={kt}>
                      <button
                        onClick={() => toggle(kt)}
                        className="flex w-full items-center gap-2 py-2 pl-8 pr-3 text-left hover:bg-slate-100"
                      >
                        <Chevron aberto={abertoT} />
                        <span className="font-medium text-slate-700">{tpl.template}</span>
                        <div className="flex-1" />
                        <Metricas m={tpl} />
                      </button>

                      {abertoT && (
                        <div className="bg-white">
                          {tpl.disparos.map((dp) => (
                            <div
                              key={dp.id}
                              className="flex items-center gap-2 border-t border-slate-100 py-2 pl-[3.75rem] pr-3"
                            >
                              <span className="text-xs text-slate-500">{fmt(dp.iniciado_em)}</span>
                              <StatusBadge status={dp.status} />
                              <div className="flex-1" />
                              <Metricas m={dp} />
                            </div>
                          ))}
                          {tpl.disparos.length === 0 && (
                            <div className="border-t border-slate-100 py-2 pl-[3.75rem] pr-3 text-xs text-slate-400">
                              Sem disparos.
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
                {ed.templates.length === 0 && (
                  <div className="py-2 pl-8 pr-3 text-xs text-slate-400">Sem templates.</div>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function Atividades({ itens }: { itens: Atividade[] }) {
  if (itens.length === 0) {
    return (
      <EstadoVazio
        titulo="Sem atividade recente"
        descricao="Os disparos mais recentes aparecem aqui assim que começarem a ser enviados."
        icone={
          <svg className="h-8 w-8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M22 12h-4l-3 9L9 3l-3 9H2" />
          </svg>
        }
      />
    );
  }
  return (
    <ul className="divide-y divide-slate-100 overflow-hidden rounded-lg border border-slate-200 bg-white">
      {itens.map((a) => (
        <li key={a.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2.5 text-sm">
          <span className="w-28 shrink-0 text-xs text-slate-500">{fmt(a.iniciado_em)}</span>
          <StatusBadge status={a.status} />
          <span className="font-medium text-slate-700">{a.template || "—"}</span>
          <EdicaoBadge edicao={a.edicao_ht || null} />
          <div className="flex-1" />
          <span className="text-xs text-slate-500">
            <span className="font-semibold text-slate-700">{a.enviados}</span> env. ·{" "}
            <span className="font-semibold text-slate-700">{a.respondidos}</span> resp. ·{" "}
            <span className="font-semibold text-brand">{taxa(a.respondidos, a.enviados)}%</span>
          </span>
        </li>
      ))}
    </ul>
  );
}

function EstadoVazio({
  titulo,
  descricao,
  icone,
}: {
  titulo: string;
  descricao: string;
  icone: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center gap-2 rounded-lg border border-slate-200 bg-white px-4 py-10 text-center">
      <span className="text-slate-300">{icone}</span>
      <p className="text-sm font-medium text-slate-700">{titulo}</p>
      <p className="max-w-sm text-sm text-slate-500">{descricao}</p>
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
