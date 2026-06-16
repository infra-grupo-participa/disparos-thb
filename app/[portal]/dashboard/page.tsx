"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";

import { EdicaoBadge } from "@/app/_components/edicao-badge";
import { Button, Card, EmptyState, PageHeader, cn, fieldClass } from "@/app/_components/ui";
import { AnimNum, Reveal } from "@/app/_components/anim";
import Comportamento from "@/app/_components/comportamento";
import { SaudeDisparo } from "@/app/_components/saude-disparo";
import { MetricasEmail } from "@/app/_components/metricas-email";
import { MetricasLigacoes } from "@/app/_components/metricas-ligacoes";
import { VisaoGeralCanais } from "@/app/_components/visao-geral-canais";
import { Campeoes } from "@/app/_components/campeoes";
import { Operadores } from "@/app/_components/operadores";
import { usePortal } from "@/app/_components/use-portal";

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
  const { evento, nome: eventoNome, ehHT } = usePortal();
  const [kpis, setKpis] = useState<Kpis | null>(null);
  const [arvore, setArvore] = useState<NoEdicao[]>([]);
  const [atividade, setAtividade] = useState<Atividade[]>([]);
  const [edicoes, setEdicoes] = useState<string[]>([]);

  // Filtros (seção 6.3 do projeto): período + edição do HT.
  const [desde, setDesde] = useState("");
  const [ate, setAte] = useState("");
  const [edicao, setEdicao] = useState("");

  const [atualizadoEm, setAtualizadoEm] = useState<Date | null>(null);
  const [aba, setAba] = useState<"geral" | "disparos" | "email" | "ligacoes" | "campeoes" | "operadores" | "comportamento">("geral");
  const carregandoRef = useRef(false);

  const carregar = useCallback(async () => {
    if (carregandoRef.current) return; // evita sobreposição de polls
    carregandoRef.current = true;
    try {
      const params = new URLSearchParams();
      params.set("evento", evento);
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
  }, [desde, ate, edicao, evento]);

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
        title={ehHT ? "Dashboard" : `Dashboard · ${eventoNome}`}
        actions={
          <div className="flex items-center gap-3">
            {atualizadoEm && (
              <span className="hidden items-center gap-1.5 text-xs text-slate-400 dark:text-slate-500 sm:inline-flex">
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
            <label className="mb-1 block text-xs font-medium text-slate-500 dark:text-slate-400">De</label>
            <input type="date" value={desde} onChange={(e) => setDesde(e.target.value)} className={fieldClass} />
          </div>
          <div className="min-w-[9rem] flex-1 sm:flex-none">
            <label className="mb-1 block text-xs font-medium text-slate-500 dark:text-slate-400">Até</label>
            <input type="date" value={ate} onChange={(e) => setAte(e.target.value)} className={fieldClass} />
          </div>
          <div className="min-w-[9rem] flex-1 sm:flex-none">
            <label className="mb-1 block text-xs font-medium text-slate-500 dark:text-slate-400">{ehHT ? "Edição HT" : "Turma"}</label>
            <select value={edicao} onChange={(e) => setEdicao(e.target.value)} className={fieldClass}>
              <option value="">Todas</option>
              {edicoes.map((ed) => <option key={ed} value={ed}>{ed}</option>)}
            </select>
          </div>
          {temFiltro && (
            <button
              onClick={limparFiltros}
              className="ml-auto inline-flex items-center gap-1 self-end py-2 text-sm font-medium text-slate-500 transition hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-100 sm:ml-0"
            >
              <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M18 6 6 18M6 6l12 12" />
              </svg>
              Limpar filtros
            </button>
          )}
        </div>
      </Card>

      {/* Abas em dois grupos: Resumo (visões cross-canal) e Canais (cada canal). */}
      <div className="mb-5 space-y-1.5">
        {([
          ["Resumo", [["geral", "Visão geral"], ["campeoes", "Campeões"], ["operadores", "Operadores"], ["comportamento", "Clientes"]]],
          ["Canais", [["disparos", "WhatsApp"], ["email", "E-mail"], ["ligacoes", "Ligações"]]],
        ] as const).map(([grupo, abas]) => (
          <div key={grupo} className="flex items-center gap-3">
            <span className="w-14 shrink-0 text-[10px] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">{grupo}</span>
            <div className="flex flex-1 gap-1 border-b border-slate-200 dark:border-slate-800">
              {abas.map(([k, label]) => (
                <button
                  key={k}
                  onClick={() => setAba(k)}
                  className={cn(
                    "relative px-3.5 py-2.5 text-sm font-medium transition-colors sm:px-4",
                    aba === k ? "text-brand dark:text-brand-300" : "text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200",
                  )}
                >
                  {label}
                  {aba === k && <span className="absolute inset-x-2 -bottom-px h-0.5 rounded-full bg-brand dark:bg-brand-400" />}
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>

      {aba === "geral" && (
        <>
          <SectionTitle>Visão geral · proporção e resultados por canal</SectionTitle>
          <VisaoGeralCanais desde={desde} ate={ate} edicao={edicao} />
        </>
      )}

      {aba === "disparos" && (
        <>
      <Reveal id="dash-disparos">
      <ProximaAcao acao={proximaAcao} />

      <div data-testid="kpis" className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Kpi
          titulo="Enviados"
          valor={env.toString()}
          valorNum={env}
          animKey="kpi-enviados"
          tom="blue"
          icone={
            <path d="m22 2-7 20-4-9-9-4Z M22 2 11 13" />
          }
        />
        <Kpi
          titulo="Respondidos"
          valor={resp.toString()}
          valorNum={resp}
          animKey="kpi-respondidos"
          tom="emerald"
          sub={`de ${env} enviados`}
          icone={
            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
          }
        />
        <Kpi
          titulo="Taxa de resposta"
          valor={`${taxa(resp, env)}%`}
          valorNum={taxa(resp, env)}
          sufixo="%"
          animKey="kpi-taxa"
          tom="brand"
          barra={taxa(resp, env)}
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
          valorNum={kpis?.sla_medio ?? undefined}
          sufixo=" min"
          animKey="kpi-sla"
          tom="amber"
          icone={
            <>
              <circle cx="12" cy="12" r="9" />
              <path d="M12 7v5l3 2" />
            </>
          }
        />
      </div>
      </Reveal>

      <SectionTitle>Saúde do disparo · anti-ban Meta</SectionTitle>
      <SaudeDisparo />

      <SectionTitle>Detalhamento · Edição → Template → Disparo</SectionTitle>
      <Arvore arvore={arvore} />

      <SectionTitle>Atividade de disparos</SectionTitle>
      <Atividades itens={atividade} />
        </>
      )}

      {aba === "email" && (
        <>
          <SectionTitle>Métricas de e-mail · ActiveCampaign</SectionTitle>
          <MetricasEmail desde={desde} ate={ate} />
        </>
      )}

      {aba === "ligacoes" && (
        <>
          <SectionTitle>Produtividade do comercial · ligações (Atende Simples)</SectionTitle>
          <MetricasLigacoes desde={desde} ate={ate} />
        </>
      )}

      {aba === "campeoes" && (
        <>
          <SectionTitle>Campeões · o que mais engaja, por canal</SectionTitle>
          <Campeoes desde={desde} ate={ate} edicao={edicao} />
        </>
      )}

      {aba === "operadores" && (
        <>
          <SectionTitle>Operadores · controle de ações</SectionTitle>
          <Operadores desde={desde} ate={ate} />
        </>
      )}

      {aba === "comportamento" && <Comportamento edicao={edicao} />}
    </div>
  );
}

function SectionTitle({ children }: { children: ReactNode }) {
  return (
    <h2 className="mb-3 mt-8 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
      <span className="h-3.5 w-1 rounded-full bg-brand/60 dark:bg-brand-400/70" aria-hidden="true" />
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
    card: "border-rose-200 bg-gradient-to-br from-rose-50 to-white dark:border-rose-500/30 dark:from-rose-500/10 dark:to-slate-900",
    iconWrap: "bg-rose-100 text-rose-600 ring-1 ring-inset ring-rose-200 dark:bg-rose-500/15 dark:text-rose-400 dark:ring-rose-500/30",
    titulo: "text-rose-900 dark:text-rose-200",
    eyebrow: "text-rose-500 dark:text-rose-400",
  },
  sugestao: {
    card: "border-brand/20 bg-gradient-to-br from-brand/5 to-white dark:border-brand-400/25 dark:from-brand-400/10 dark:to-slate-900",
    iconWrap: "bg-brand/10 text-brand ring-1 ring-inset ring-brand/20 dark:bg-brand-400/15 dark:text-brand-300 dark:ring-brand-400/25",
    titulo: "text-slate-900 dark:text-slate-100",
    eyebrow: "text-brand dark:text-brand-300",
  },
  neutro: {
    card: "border-emerald-200 bg-gradient-to-br from-emerald-50 to-white dark:border-emerald-500/30 dark:from-emerald-500/10 dark:to-slate-900",
    iconWrap: "bg-emerald-100 text-emerald-600 ring-1 ring-inset ring-emerald-200 dark:bg-emerald-500/15 dark:text-emerald-400 dark:ring-emerald-500/30",
    titulo: "text-emerald-900 dark:text-emerald-200",
    eyebrow: "text-emerald-600 dark:text-emerald-400",
  },
};

function ProximaAcao({ acao }: { acao: Acao }) {
  const estilo = ACAO_ESTILO[acao.tom];
  return (
    <Card className={cn("js-reveal mb-5 flex items-start gap-4 border p-5", estilo.card)}>
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
        <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">{acao.descricao}</p>
      </div>
    </Card>
  );
}

const STATUS_CLASSE: Record<string, string> = {
  concluido: "bg-emerald-100 text-emerald-700 ring-emerald-300 dark:bg-emerald-500/15 dark:text-emerald-300 dark:ring-emerald-500/30",
  concluído: "bg-emerald-100 text-emerald-700 ring-emerald-300 dark:bg-emerald-500/15 dark:text-emerald-300 dark:ring-emerald-500/30",
  enviado: "bg-emerald-100 text-emerald-700 ring-emerald-300 dark:bg-emerald-500/15 dark:text-emerald-300 dark:ring-emerald-500/30",
  em_andamento: "bg-blue-100 text-blue-700 ring-blue-300 dark:bg-blue-500/15 dark:text-blue-300 dark:ring-blue-500/30",
  enviando: "bg-blue-100 text-blue-700 ring-blue-300 dark:bg-blue-500/15 dark:text-blue-300 dark:ring-blue-500/30",
  agendado: "bg-amber-100 text-amber-800 ring-amber-300 dark:bg-amber-500/15 dark:text-amber-300 dark:ring-amber-500/30",
  erro: "bg-rose-100 text-rose-700 ring-rose-300 dark:bg-rose-500/15 dark:text-rose-300 dark:ring-rose-500/30",
  falha: "bg-rose-100 text-rose-700 ring-rose-300 dark:bg-rose-500/15 dark:text-rose-300 dark:ring-rose-500/30",
};

function StatusBadge({ status }: { status: string }) {
  const cor = STATUS_CLASSE[status?.toLowerCase()] || "bg-slate-100 text-slate-600 ring-slate-300 dark:bg-slate-800 dark:text-slate-300 dark:ring-slate-700";
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold ring-1 ring-inset ${cor}`}>
      {status || "—"}
    </span>
  );
}

function Metricas({ m }: { m: Metricas }) {
  return (
    <div className="flex shrink-0 items-center gap-3 text-xs tabular-nums text-slate-500 dark:text-slate-400 sm:gap-4">
      <span className="hidden sm:inline">
        <span className="font-semibold text-slate-700 dark:text-slate-200">{m.enviados}</span> env.
      </span>
      <span className="hidden sm:inline">
        <span className="font-semibold text-slate-700 dark:text-slate-200">{m.respondidos}</span> resp.
      </span>
      <span className="inline-flex items-center rounded-full bg-brand/5 px-2 py-0.5 font-semibold text-brand ring-1 ring-inset ring-brand/10 dark:bg-brand-400/10 dark:text-brand-300 dark:ring-brand-400/20">
        {taxa(m.respondidos, m.enviados)}%
      </span>
      <span className="hidden text-slate-400 dark:text-slate-500 md:inline">SLA {m.sla_medio != null ? `${m.sla_medio}m` : "—"}</span>
    </div>
  );
}

function Chevron({ aberto }: { aberto: boolean }) {
  return (
    <svg
      className={cn("h-3.5 w-3.5 shrink-0 text-slate-400 transition-transform duration-150 dark:text-slate-500", aberto && "rotate-90")}
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
    <Card className="divide-y divide-slate-100 overflow-hidden text-sm dark:divide-slate-800">
      {arvore.map((ed) => {
        const ke = `e:${ed.edicao_ht}`;
        const abertoE = !!abertos[ke];
        return (
          <div key={ke || "sem-edicao"}>
            <button
              onClick={() => toggle(ke)}
              className={cn(
                "flex w-full items-center gap-2.5 px-4 py-3 text-left transition hover:bg-slate-50 dark:hover:bg-slate-800/60",
                abertoE && "bg-slate-50/70 dark:bg-slate-800/40",
              )}
            >
              <Chevron aberto={abertoE} />
              <EdicaoBadge edicao={ed.edicao_ht || null} />
              <div className="flex-1" />
              <Metricas m={ed} />
            </button>

            {abertoE && (
              <div className="border-t border-slate-100 bg-slate-50/40 dark:border-slate-800 dark:bg-slate-800/20">
                {ed.templates.map((tpl) => {
                  const kt = `${ke}|t:${tpl.template}`;
                  const abertoT = !!abertos[kt];
                  return (
                    <div key={kt} className="border-l-2 border-slate-200 ml-5 dark:border-slate-700">
                      <button
                        onClick={() => toggle(kt)}
                        className="flex w-full items-center gap-2.5 py-2.5 pl-4 pr-4 text-left transition hover:bg-slate-100/70 dark:hover:bg-slate-800"
                      >
                        <Chevron aberto={abertoT} />
                        <span className="font-medium text-slate-700 dark:text-slate-200">{tpl.template}</span>
                        <div className="flex-1" />
                        <Metricas m={tpl} />
                      </button>

                      {abertoT && (
                        <div className="border-l-2 border-brand/20 ml-4 bg-white dark:border-brand-400/20 dark:bg-slate-900">
                          {tpl.disparos.map((dp) => (
                            <div
                              key={dp.id}
                              className="flex items-center gap-2.5 border-t border-slate-100 py-2.5 pl-6 pr-4 dark:border-slate-800"
                            >
                              <span className="text-xs tabular-nums text-slate-500 dark:text-slate-400">{fmt(dp.iniciado_em)}</span>
                              <StatusBadge status={dp.status} />
                              <div className="flex-1" />
                              <Metricas m={dp} />
                            </div>
                          ))}
                          {tpl.disparos.length === 0 && (
                            <div className="border-t border-slate-100 py-2.5 pl-6 pr-4 text-xs text-slate-400 dark:border-slate-800 dark:text-slate-500">
                              Sem disparos.
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
                {ed.templates.length === 0 && (
                  <div className="py-2.5 pl-9 pr-4 text-xs text-slate-400 dark:text-slate-500">Sem templates.</div>
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
      <ul className="divide-y divide-slate-100 dark:divide-slate-800">
        {itens.map((a) => (
          <li key={a.id} className="flex flex-wrap items-center gap-x-3 gap-y-1.5 px-4 py-3 text-sm transition hover:bg-slate-50/70 dark:hover:bg-slate-800/40">
            <span className="w-24 shrink-0 text-xs tabular-nums text-slate-500 dark:text-slate-400">{fmt(a.iniciado_em)}</span>
            <StatusBadge status={a.status} />
            <span className="font-medium text-slate-700 dark:text-slate-200">{a.template || "—"}</span>
            <EdicaoBadge edicao={a.edicao_ht || null} />
            <div className="flex-1" />
            <span className="text-xs tabular-nums text-slate-500 dark:text-slate-400">
              <span className="font-semibold text-slate-700 dark:text-slate-200">{a.enviados}</span> env. ·{" "}
              <span className="font-semibold text-slate-700 dark:text-slate-200">{a.respondidos}</span> resp. ·{" "}
              <span className="font-semibold text-brand dark:text-brand-300">{taxa(a.respondidos, a.enviados)}%</span>
            </span>
          </li>
        ))}
      </ul>
    </Card>
  );
}

const KPI_TOM: Record<string, { iconWrap: string; valor: string; bar: string }> = {
  blue: { iconWrap: "bg-blue-50 text-blue-600 ring-blue-100 dark:bg-blue-500/15 dark:text-blue-400 dark:ring-blue-500/20", valor: "text-slate-900 dark:text-white", bar: "bg-blue-500 dark:bg-blue-400" },
  emerald: { iconWrap: "bg-emerald-50 text-emerald-600 ring-emerald-100 dark:bg-emerald-500/15 dark:text-emerald-400 dark:ring-emerald-500/20", valor: "text-slate-900 dark:text-white", bar: "bg-emerald-500 dark:bg-emerald-400" },
  brand: { iconWrap: "bg-brand/10 text-brand ring-brand/15 dark:bg-brand-400/15 dark:text-brand-300 dark:ring-brand-400/20", valor: "text-brand dark:text-brand-300", bar: "bg-brand dark:bg-brand-400" },
  amber: { iconWrap: "bg-amber-50 text-amber-600 ring-amber-100 dark:bg-amber-500/15 dark:text-amber-400 dark:ring-amber-500/20", valor: "text-slate-900 dark:text-white", bar: "bg-amber-500 dark:bg-amber-400" },
};

function Kpi({
  titulo,
  valor,
  tom,
  icone,
  barra,
  sub,
  valorNum,
  sufixo,
  animKey,
}: {
  titulo: string;
  valor: string;
  tom: keyof typeof KPI_TOM;
  icone: ReactNode;
  barra?: number;
  sub?: string;
  valorNum?: number;
  sufixo?: string;
  animKey?: string;
}) {
  const t = KPI_TOM[tom];
  return (
    <Card className="js-reveal p-4 transition hover:shadow-soft">
      <div className="flex items-start justify-between gap-2">
        <div className="text-xs font-medium uppercase tracking-wide text-slate-400 dark:text-slate-500">{titulo}</div>
        <span className={cn("flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ring-1 ring-inset", t.iconWrap)} aria-hidden="true">
          <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            {icone}
          </svg>
        </span>
      </div>
      <div className={cn("mt-3 text-3xl font-semibold tabular-nums", t.valor)}>
        {valorNum != null ? <AnimNum value={valorNum} suffix={sufixo ?? ""} animKey={animKey} /> : valor}
      </div>
      {barra != null && (
        <div className="mt-2.5 h-1.5 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
          <div className={cn("js-bar h-full rounded-full", t.bar)} style={{ width: `${Math.max(2, Math.min(100, barra))}%` }} />
        </div>
      )}
      {sub && <div className="mt-2 text-xs text-slate-400 dark:text-slate-500">{sub}</div>}
    </Card>
  );
}
