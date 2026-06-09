"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";

import { EdicaoBadge } from "@/app/_components/edicao-badge";
import { Button, Card, EmptyState, PageHeader, cn, fieldClass } from "@/app/_components/ui";

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
      <PageHeader
        title="Dashboard"
        actions={
          <div className="flex items-center gap-3">
            {atualizadoEm && (
              <span className="hidden items-center gap-1.5 text-xs text-slate-400 sm:inline-flex">
                <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-400" aria-hidden="true" />
                Atualizado às {hms(atualizadoEm)} · a cada {POLL_MS / 1000}s
              </span>
            )}
            <Button variant="secondary" size="sm" onClick={carregar}>
              <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M3 12a9 9 0 0 1 15-6.7L21 8M21 3v5h-5M21 12a9 9 0 0 1-15 6.7L3 16M3 21v-5h5" />
              </svg>
              Atualizar agora
            </Button>
          </div>
        }
      />

      {/* Filtros */}
      <Card className="mb-5 p-3.5">
        <div className="flex flex-wrap items-end gap-3">
          <div className="min-w-[9rem] flex-1 sm:flex-none">
            <label className="mb-1 block text-xs font-medium text-slate-500">De</label>
            <input type="date" value={desde} onChange={(e) => setDesde(e.target.value)} className={fieldClass} />
          </div>
          <div className="min-w-[9rem] flex-1 sm:flex-none">
            <label className="mb-1 block text-xs font-medium text-slate-500">Até</label>
            <input type="date" value={ate} onChange={(e) => setAte(e.target.value)} className={fieldClass} />
          </div>
          <div className="min-w-[9rem] flex-1 sm:flex-none">
            <label className="mb-1 block text-xs font-medium text-slate-500">Edição HT</label>
            <select value={edicao} onChange={(e) => setEdicao(e.target.value)} className={fieldClass}>
              <option value="">Todas</option>
              {edicoes.map((ed) => <option key={ed} value={ed}>{ed}</option>)}
            </select>
          </div>
          {temFiltro && (
            <button
              onClick={limparFiltros}
              className="ml-auto inline-flex items-center gap-1 self-end py-2 text-sm font-medium text-slate-500 transition hover:text-slate-800 sm:ml-0"
            >
              <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M18 6 6 18M6 6l12 12" />
              </svg>
              Limpar filtros
            </button>
          )}
        </div>
      </Card>

      <ProximaAcao acao={proximaAcao} />

      <div data-testid="kpis" className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Kpi
          titulo="Enviados"
          valor={env.toString()}
          tom="blue"
          icone={
            <path d="m22 2-7 20-4-9-9-4Z M22 2 11 13" />
          }
        />
        <Kpi
          titulo="Respondidos"
          valor={resp.toString()}
          tom="emerald"
          icone={
            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
          }
        />
        <Kpi
          titulo="Taxa de resposta"
          valor={`${taxa(resp, env)}%`}
          tom="brand"
          icone={
            <>
              <path d="M3 3v18h18" />
              <path d="m19 9-5 5-4-4-3 3" />
            </>
          }
        />
        <Kpi
          titulo="SLA médio"
          valor={kpis?.sla_medio != null ? `${kpis.sla_medio} min` : "—"}
          tom="amber"
          icone={
            <>
              <circle cx="12" cy="12" r="9" />
              <path d="M12 7v5l3 2" />
            </>
          }
        />
      </div>

      <SectionTitle>Detalhamento · Edição → Template → Disparo</SectionTitle>
      <Arvore arvore={arvore} />

      <SectionTitle>Atividade de disparos</SectionTitle>
      <Atividades itens={atividade} />
    </div>
  );
}

function SectionTitle({ children }: { children: ReactNode }) {
  return (
    <h2 className="mb-3 mt-8 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
      <span className="h-3.5 w-1 rounded-full bg-brand/60" aria-hidden="true" />
      {children}
    </h2>
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

const ACAO_ESTILO: Record<
  AcaoTom,
  { card: string; iconWrap: string; titulo: string; eyebrow: string }
> = {
  alerta: {
    card: "border-rose-200 bg-gradient-to-br from-rose-50 to-white",
    iconWrap: "bg-rose-100 text-rose-600 ring-1 ring-inset ring-rose-200",
    titulo: "text-rose-900",
    eyebrow: "text-rose-500",
  },
  sugestao: {
    card: "border-brand/20 bg-gradient-to-br from-brand/5 to-white",
    iconWrap: "bg-brand/10 text-brand ring-1 ring-inset ring-brand/20",
    titulo: "text-slate-900",
    eyebrow: "text-brand",
  },
  neutro: {
    card: "border-emerald-200 bg-gradient-to-br from-emerald-50 to-white",
    iconWrap: "bg-emerald-100 text-emerald-600 ring-1 ring-inset ring-emerald-200",
    titulo: "text-emerald-900",
    eyebrow: "text-emerald-600",
  },
};

function ProximaAcao({ acao }: { acao: Acao }) {
  const estilo = ACAO_ESTILO[acao.tom];
  return (
    <Card className={cn("mb-5 flex items-start gap-4 border p-5", estilo.card)}>
      <span className={cn("flex h-11 w-11 shrink-0 items-center justify-center rounded-xl", estilo.iconWrap)} aria-hidden="true">
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
        <div className={cn("text-[11px] font-semibold uppercase tracking-wide", estilo.eyebrow)}>Próxima ação</div>
        <p className={cn("mt-1 text-lg font-semibold leading-tight", estilo.titulo)}>{acao.titulo}</p>
        <p className="mt-1 text-sm text-slate-600">{acao.descricao}</p>
      </div>
    </Card>
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
    <div className="flex shrink-0 items-center gap-3 text-xs tabular-nums text-slate-500 sm:gap-4">
      <span className="hidden sm:inline">
        <span className="font-semibold text-slate-700">{m.enviados}</span> env.
      </span>
      <span className="hidden sm:inline">
        <span className="font-semibold text-slate-700">{m.respondidos}</span> resp.
      </span>
      <span className="inline-flex items-center rounded-full bg-brand/5 px-2 py-0.5 font-semibold text-brand ring-1 ring-inset ring-brand/10">
        {taxa(m.respondidos, m.enviados)}%
      </span>
      <span className="hidden text-slate-400 md:inline">SLA {m.sla_medio != null ? `${m.sla_medio}m` : "—"}</span>
    </div>
  );
}

function Chevron({ aberto }: { aberto: boolean }) {
  return (
    <svg
      className={cn("h-3.5 w-3.5 shrink-0 text-slate-400 transition-transform duration-150", aberto && "rotate-90")}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="m9 18 6-6-6-6" />
    </svg>
  );
}

function Arvore({ arvore }: { arvore: NoEdicao[] }) {
  const [abertos, setAbertos] = useState<Record<string, boolean>>({});
  const toggle = (k: string) => setAbertos((s) => ({ ...s, [k]: !s[k] }));

  if (arvore.length === 0) {
    return (
      <EmptyState
        title="Nenhum disparo ainda"
        description="Quando você fizer um disparo, o detalhamento por edição e template aparece aqui."
        icon={
          <svg className="h-9 w-9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M3 7v10a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-6l-2-2H5a2 2 0 0 0-2 2Z" />
          </svg>
        }
      />
    );
  }

  return (
    <Card className="divide-y divide-slate-100 overflow-hidden text-sm">
      {arvore.map((ed) => {
        const ke = `e:${ed.edicao_ht}`;
        const abertoE = !!abertos[ke];
        return (
          <div key={ke || "sem-edicao"}>
            <button
              onClick={() => toggle(ke)}
              className={cn(
                "flex w-full items-center gap-2.5 px-4 py-3 text-left transition hover:bg-slate-50",
                abertoE && "bg-slate-50/70",
              )}
            >
              <Chevron aberto={abertoE} />
              <EdicaoBadge edicao={ed.edicao_ht || null} />
              <div className="flex-1" />
              <Metricas m={ed} />
            </button>

            {abertoE && (
              <div className="border-t border-slate-100 bg-slate-50/40">
                {ed.templates.map((tpl) => {
                  const kt = `${ke}|t:${tpl.template}`;
                  const abertoT = !!abertos[kt];
                  return (
                    <div key={kt} className="border-l-2 border-slate-200 ml-5">
                      <button
                        onClick={() => toggle(kt)}
                        className="flex w-full items-center gap-2.5 py-2.5 pl-4 pr-4 text-left transition hover:bg-slate-100/70"
                      >
                        <Chevron aberto={abertoT} />
                        <span className="font-medium text-slate-700">{tpl.template}</span>
                        <div className="flex-1" />
                        <Metricas m={tpl} />
                      </button>

                      {abertoT && (
                        <div className="border-l-2 border-brand/20 ml-4 bg-white">
                          {tpl.disparos.map((dp) => (
                            <div
                              key={dp.id}
                              className="flex items-center gap-2.5 border-t border-slate-100 py-2.5 pl-6 pr-4"
                            >
                              <span className="text-xs tabular-nums text-slate-500">{fmt(dp.iniciado_em)}</span>
                              <StatusBadge status={dp.status} />
                              <div className="flex-1" />
                              <Metricas m={dp} />
                            </div>
                          ))}
                          {tpl.disparos.length === 0 && (
                            <div className="border-t border-slate-100 py-2.5 pl-6 pr-4 text-xs text-slate-400">
                              Sem disparos.
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
                {ed.templates.length === 0 && (
                  <div className="py-2.5 pl-9 pr-4 text-xs text-slate-400">Sem templates.</div>
                )}
              </div>
            )}
          </div>
        );
      })}
    </Card>
  );
}

function Atividades({ itens }: { itens: Atividade[] }) {
  if (itens.length === 0) {
    return (
      <EmptyState
        title="Sem atividade recente"
        description="Os disparos mais recentes aparecem aqui assim que começarem a ser enviados."
        icon={
          <svg className="h-9 w-9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M22 12h-4l-3 9L9 3l-3 9H2" />
          </svg>
        }
      />
    );
  }
  return (
    <Card className="overflow-hidden">
      <ul className="divide-y divide-slate-100">
        {itens.map((a) => (
          <li key={a.id} className="flex flex-wrap items-center gap-x-3 gap-y-1.5 px-4 py-3 text-sm transition hover:bg-slate-50/70">
            <span className="w-24 shrink-0 text-xs tabular-nums text-slate-500">{fmt(a.iniciado_em)}</span>
            <StatusBadge status={a.status} />
            <span className="font-medium text-slate-700">{a.template || "—"}</span>
            <EdicaoBadge edicao={a.edicao_ht || null} />
            <div className="flex-1" />
            <span className="text-xs tabular-nums text-slate-500">
              <span className="font-semibold text-slate-700">{a.enviados}</span> env. ·{" "}
              <span className="font-semibold text-slate-700">{a.respondidos}</span> resp. ·{" "}
              <span className="font-semibold text-brand">{taxa(a.respondidos, a.enviados)}%</span>
            </span>
          </li>
        ))}
      </ul>
    </Card>
  );
}

const KPI_TOM: Record<string, { iconWrap: string; valor: string }> = {
  blue: { iconWrap: "bg-blue-50 text-blue-600 ring-blue-100", valor: "text-slate-900" },
  emerald: { iconWrap: "bg-emerald-50 text-emerald-600 ring-emerald-100", valor: "text-slate-900" },
  brand: { iconWrap: "bg-brand/10 text-brand ring-brand/15", valor: "text-brand" },
  amber: { iconWrap: "bg-amber-50 text-amber-600 ring-amber-100", valor: "text-slate-900" },
};

function Kpi({
  titulo,
  valor,
  tom,
  icone,
}: {
  titulo: string;
  valor: string;
  tom: keyof typeof KPI_TOM;
  icone: ReactNode;
}) {
  const t = KPI_TOM[tom];
  return (
    <Card className="p-4 transition hover:shadow-soft">
      <div className="flex items-start justify-between gap-2">
        <div className="text-xs font-medium uppercase tracking-wide text-slate-400">{titulo}</div>
        <span className={cn("flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ring-1 ring-inset", t.iconWrap)} aria-hidden="true">
          <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            {icone}
          </svg>
        </span>
      </div>
      <div className={cn("mt-3 text-3xl font-semibold tabular-nums", t.valor)}>{valor}</div>
    </Card>
  );
}
