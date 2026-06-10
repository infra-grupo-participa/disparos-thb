"use client";

import { useCallback, useEffect, useState } from "react";
import { Button, Card, Spinner, cn } from "@/app/_components/ui";

// Seção executiva de Inteligência de Comportamento. Lê /api/comportamento e
// renderiza visualizações intuitivas: o gestor entende a saúde do relacionamento
// pela COR (verde = positivo, azul = neutro, âmbar/vermelho = atenção), sem
// precisar ler números. Alimentada pela sincronização da Unnichat.

type Assunto = { chave: string; label: string; emoji: string; conversas: number; pct: number };
type Categoria = { chave: string; label: string; qtd: number };
type FunilEstagio = { chave: string; nome: string; cor: string | null; qtd: number };
type Dados = {
  ciclo: { onboarding: number; ongoing: number; total: number };
  funil: FunilEstagio[];
  totalConversas: number;
  totalMensagens: number;
  conversasPorAssunto: Assunto[];
  categoriasResp: Categoria[];
  sentimentos: { positivo: number; neutro: number; negativo: number };
  horas: number[];
  melhorHora: number;
  palavrasChave: { palavra: string; qtd: number }[];
  sync: { ultima: string | null; contatos: number; pendentes: number };
};

// Temperatura de cada assunto — define a cor. O gestor lê "saúde" pela cor:
// muito verde = relacionamento saudável; vermelho/âmbar = pontos de atenção.
type Temp = "positivo" | "neutro" | "atencao" | "risco";
const TEMP: Record<string, Temp> = {
  desafio_trilha: "positivo", prova_social: "positivo", elogio: "positivo", compromisso: "positivo", afetivo: "positivo",
  acesso_login: "neutro", duvida: "neutro", financiamento: "neutro", grupo_comunidade: "neutro", aula_live: "neutro", saudacao: "neutro",
  financeiro_cobranca: "atencao", tecnico: "atencao", video: "atencao",
  risco_churn: "risco",
};
const COR_TEMP: Record<Temp, { barra: string; texto: string }> = {
  positivo: { barra: "bg-emerald-500", texto: "text-emerald-600" },
  neutro: { barra: "bg-sky-500", texto: "text-sky-600" },
  atencao: { barra: "bg-amber-500", texto: "text-amber-600" },
  risco: { barra: "bg-rose-500", texto: "text-rose-600" },
};
const temp = (chave: string): Temp => TEMP[chave] ?? "neutro";

function fmtData(iso: string | null) {
  return iso ? new Date(iso).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) : "nunca";
}

export default function Comportamento({ edicao }: { edicao: string }) {
  const [dados, setDados] = useState<Dados | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [sincronizando, setSincronizando] = useState(false);
  const [progresso, setProgresso] = useState<string | null>(null);

  const carregar = useCallback(async () => {
    setCarregando(true);
    try {
      const params = new URLSearchParams();
      if (edicao) params.set("edicao", edicao);
      const r = await fetch(`/api/comportamento?${params.toString()}`);
      const d = await r.json();
      if (d.ok) setDados(d);
    } finally {
      setCarregando(false);
    }
  }, [edicao]);

  useEffect(() => { carregar(); }, [carregar]);

  async function sincronizar() {
    setSincronizando(true);
    setProgresso("Iniciando…");
    try {
      let totalNovas = 0;
      for (let i = 0; i < 12; i++) {
        const r = await fetch(`/api/sync-conversas?limite=60`, { method: "POST" });
        const d = await r.json();
        if (!d.ok) { setProgresso("Falha ao sincronizar."); break; }
        totalNovas += d.mensagens_novas || 0;
        setProgresso(`${totalNovas} novas · ${d.restantes} restantes`);
        if (d.restantes === 0) break;
      }
      await carregar();
    } finally {
      setSincronizando(false);
      setTimeout(() => setProgresso(null), 4000);
    }
  }

  const semDados = !dados || dados.totalConversas === 0;

  return (
    <div>
      <div className="mb-4 mt-8 flex flex-wrap items-center gap-3">
        <h2 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
          <span className="h-3.5 w-1 rounded-full bg-brand/60" aria-hidden="true" />
          Inteligência de comportamento dos leads
        </h2>
        <div className="flex-1" />
        {progresso && <span className="text-xs font-medium text-brand">{progresso}</span>}
        <span className="hidden text-xs text-slate-400 sm:inline">
          Sync: {fmtData(dados?.sync.ultima ?? null)}
          {dados && dados.sync.pendentes > 0 ? ` · ${dados.sync.pendentes} pendentes` : ""}
        </span>
        <Button variant="secondary" size="sm" onClick={sincronizar} disabled={sincronizando}>
          {sincronizando ? <Spinner className="h-3.5 w-3.5" /> : (
            <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M3 12a9 9 0 0 1 15-6.7L21 8M21 3v5h-5M21 12a9 9 0 0 1-15 6.7L3 16M3 21v-5h5" />
            </svg>
          )}
          {sincronizando ? "Sincronizando…" : "Sincronizar conversas"}
        </Button>
      </div>

      {/* Ciclo de vida — um card só, com proporção visual imediata */}
      <CicloVida ciclo={dados?.ciclo ?? { onboarding: 0, ongoing: 0, total: 0 }} />

      {carregando && !dados ? (
        <Card className="mt-4 flex items-center justify-center gap-3 py-12 text-slate-400">
          <Spinner className="h-6 w-6" /> <span className="text-sm">Carregando inteligência…</span>
        </Card>
      ) : semDados ? (
        <Card className="mt-4 flex flex-col items-center gap-3 px-6 py-12 text-center">
          <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-brand/10 text-brand">
            <svg className="h-6 w-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
            </svg>
          </span>
          <div>
            <p className="font-semibold text-slate-800">Ainda não há conversas analisadas</p>
            <p className="mt-1 text-sm text-slate-500">Clique em <strong>Sincronizar conversas</strong> para puxar o histórico da Unnichat e gerar a inteligência.</p>
          </div>
          <Button variant="primary" onClick={sincronizar} disabled={sincronizando}>
            {sincronizando ? "Sincronizando…" : "Sincronizar agora"}
          </Button>
        </Card>
      ) : dados ? (
        <>
          <p className="mt-3 text-xs text-slate-400">
            Base: <strong className="text-slate-600">{dados.totalConversas}</strong> conversas ·{" "}
            <strong className="text-slate-600">{dados.totalMensagens}</strong> mensagens de leads
          </p>

          <div className="mt-3 grid grid-cols-1 gap-4 lg:grid-cols-3">
            <Card className="p-5 lg:col-span-2">
              <CardTitulo>Conversas por assunto</CardTitulo>
              <Legenda />
              <BarrasAssunto itens={dados.conversasPorAssunto} />
            </Card>

            <Card className="flex flex-col gap-5 p-5">
              <div>
                <CardTitulo>Sentimento</CardTitulo>
                <Donut s={dados.sentimentos} />
              </div>
              <div className="border-t border-slate-100 pt-4">
                <CardTitulo>Como respondem</CardTitulo>
                <Categorias itens={dados.categoriasResp} />
              </div>
            </Card>
          </div>

          <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
            <Card className="p-5">
              <div className="flex items-baseline justify-between">
                <CardTitulo>Quando os leads respondem</CardTitulo>
                <span className="text-sm font-semibold text-brand">pico {String(dados.melhorHora).padStart(2, "0")}h</span>
              </div>
              <p className="mb-3 text-xs text-slate-400">Melhor janela para disparar.</p>
              <Horarios horas={dados.horas} pico={dados.melhorHora} />
            </Card>

            <Card className="p-5">
              <CardTitulo>Movimentação no funil</CardTitulo>
              <p className="mb-3 text-xs text-slate-400">Do primeiro contato à ativação.</p>
              <Funil estagios={dados.funil} />
            </Card>
          </div>

          <Card className="mt-4 p-5">
            <CardTitulo>Palavras que mais colaram</CardTitulo>
            <p className="mb-4 text-xs text-slate-400">Vocabulário de quem reagiu bem — use na copy dos próximos disparos.</p>
            <PalavrasChave itens={dados.palavrasChave} />
          </Card>
        </>
      ) : null}
    </div>
  );
}

function CardTitulo({ children }: { children: React.ReactNode }) {
  return <h3 className="text-sm font-semibold text-slate-800">{children}</h3>;
}

function Legenda() {
  const itens: { t: Temp; label: string }[] = [
    { t: "positivo", label: "Engajamento" }, { t: "neutro", label: "Dúvidas/operação" },
    { t: "atencao", label: "Atenção" }, { t: "risco", label: "Risco" },
  ];
  return (
    <div className="mb-4 mt-1 flex flex-wrap gap-x-4 gap-y-1">
      {itens.map((i) => (
        <span key={i.t} className="inline-flex items-center gap-1.5 text-[11px] text-slate-500">
          <span className={cn("h-2 w-2 rounded-full", COR_TEMP[i.t].barra)} />
          {i.label}
        </span>
      ))}
    </div>
  );
}

function CicloVida({ ciclo }: { ciclo: { onboarding: number; ongoing: number; total: number } }) {
  const total = ciclo.total || 1;
  const pOn = Math.round((ciclo.onboarding / total) * 100);
  const pOng = 100 - pOn;
  return (
    <Card className="mt-4 p-5">
      <div className="flex items-end justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 text-xs font-medium text-slate-500">
            <span className="h-2.5 w-2.5 rounded-full bg-brand" /> Onboarding
            <span className="text-slate-400">· compraram há ≤ 30 dias</span>
          </div>
          <div className="mt-1 text-4xl font-semibold tabular-nums text-brand">{ciclo.onboarding}</div>
        </div>
        <div className="text-right">
          <div className="flex items-center justify-end gap-2 text-xs font-medium text-slate-500">
            <span className="text-slate-400">compraram há &gt; 30 dias ·</span> Ongoing
            <span className="h-2.5 w-2.5 rounded-full bg-cyan-500" />
          </div>
          <div className="mt-1 text-4xl font-semibold tabular-nums text-cyan-600">{ciclo.ongoing}</div>
        </div>
      </div>
      <div className="mt-4 flex h-2.5 overflow-hidden rounded-full bg-slate-100">
        <div className="bg-brand" style={{ width: `${pOn}%` }} />
        <div className="bg-cyan-500" style={{ width: `${pOng}%` }} />
      </div>
      <div className="mt-1.5 flex justify-between text-[11px] font-medium tabular-nums text-slate-400">
        <span>{pOn}%</span><span>{pOng}%</span>
      </div>
    </Card>
  );
}

function BarrasAssunto({ itens }: { itens: Assunto[] }) {
  if (itens.length === 0) return <p className="text-sm text-slate-400">Sem conversas classificadas.</p>;
  const max = Math.max(...itens.map((i) => i.conversas), 1);
  return (
    <div className="space-y-2">
      {itens.map((it) => {
        const c = COR_TEMP[temp(it.chave)];
        return (
          <div key={it.chave} className="flex items-center gap-3">
            <div className="flex w-44 shrink-0 items-center gap-1.5 text-[13px] text-slate-600">
              <span aria-hidden>{it.emoji}</span>
              <span className="truncate">{it.label}</span>
            </div>
            <div className="relative h-7 flex-1 overflow-hidden rounded-lg bg-slate-50">
              <div
                className={cn("h-full rounded-lg transition-all", c.barra)}
                style={{ width: `${Math.max((it.conversas / max) * 100, 4)}%` }}
              />
              <span className="absolute inset-y-0 right-2.5 flex items-center text-[11px] font-semibold tabular-nums text-slate-500">
                {it.conversas} · {it.pct}%
              </span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function Donut({ s }: { s: { positivo: number; neutro: number; negativo: number } }) {
  const total = s.positivo + s.neutro + s.negativo;
  const pct = total ? Math.round((s.positivo / total) * 100) : 0;
  const r = 42, C = 2 * Math.PI * r;
  const segs = [
    { v: s.positivo, cor: "#10b981", label: "Positivo" },
    { v: s.neutro, cor: "#cbd5e1", label: "Neutro" },
    { v: s.negativo, cor: "#f43f5e", label: "Negativo" },
  ];
  let acc = 0;
  return (
    <div className="mt-2 flex items-center gap-4">
      <div className="relative h-28 w-28 shrink-0">
        <svg viewBox="0 0 120 120" className="h-full w-full -rotate-90">
          <circle cx="60" cy="60" r={r} fill="none" stroke="#f1f5f9" strokeWidth="14" />
          {total > 0 && segs.map((seg, i) => {
            const len = (seg.v / total) * C;
            const el = (
              <circle key={i} cx="60" cy="60" r={r} fill="none" stroke={seg.cor} strokeWidth="14"
                strokeDasharray={`${len} ${C - len}`} strokeDashoffset={-acc} strokeLinecap="butt" />
            );
            acc += len;
            return el;
          })}
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-2xl font-semibold tabular-nums text-emerald-600">{pct}%</span>
          <span className="text-[10px] font-medium uppercase tracking-wide text-slate-400">positivo</span>
        </div>
      </div>
      <div className="flex-1 space-y-1.5">
        {segs.map((seg) => (
          <div key={seg.label} className="flex items-center gap-2 text-xs">
            <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: seg.cor }} />
            <span className="text-slate-600">{seg.label}</span>
            <span className="ml-auto font-semibold tabular-nums text-slate-700">{seg.v}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function Categorias({ itens }: { itens: Categoria[] }) {
  if (itens.length === 0) return <p className="text-sm text-slate-400">Sem dados.</p>;
  const max = Math.max(...itens.map((i) => i.qtd), 1);
  return (
    <div className="mt-2 space-y-2">
      {itens.map((c) => (
        <div key={c.chave} className="flex items-center gap-2 text-xs">
          <span className="w-24 shrink-0 text-slate-600">{c.label}</span>
          <div className="h-2.5 flex-1 overflow-hidden rounded-full bg-slate-100">
            <div className="h-full rounded-full bg-brand/60" style={{ width: `${(c.qtd / max) * 100}%` }} />
          </div>
          <span className="w-6 text-right font-semibold tabular-nums text-slate-700">{c.qtd}</span>
        </div>
      ))}
    </div>
  );
}

function Horarios({ horas, pico }: { horas: number[]; pico: number }) {
  const max = Math.max(...horas, 1);
  return (
    <div>
      <div className="flex h-48 items-stretch gap-1">
        {horas.map((q, h) => {
          const ehPico = h === pico;
          return (
            <div key={h} className="group relative flex h-full flex-1 flex-col items-center justify-end" title={`${String(h).padStart(2, "0")}h — ${q} resp.`}>
              {ehPico && q > 0 && (
                <span className="mb-1 rounded bg-brand px-1 py-0.5 text-[9px] font-bold text-white">{q}</span>
              )}
              <div
                className={cn("w-full rounded-t transition-all", ehPico ? "bg-brand" : q > 0 ? "bg-brand/40 group-hover:bg-brand/60" : "bg-slate-100")}
                style={{ height: `${Math.max((q / max) * 100, 4)}%` }}
              />
            </div>
          );
        })}
      </div>
      <div className="mt-2 flex justify-between border-t border-slate-100 pt-1.5 text-[10px] tabular-nums text-slate-400">
        <span>00h</span><span>06h</span><span>12h</span><span>18h</span><span>23h</span>
      </div>
    </div>
  );
}

function Funil({ estagios }: { estagios: FunilEstagio[] }) {
  const max = Math.max(...estagios.map((e) => e.qtd), 1);
  return (
    <div className="space-y-2">
      {estagios.map((e) => {
        const w = Math.max((e.qtd / max) * 100, 3);
        return (
          <div key={e.chave} className="flex items-center gap-3">
            <span className="w-32 shrink-0 truncate text-[13px] text-slate-600">{e.nome}</span>
            <div className="h-7 flex-1 rounded-lg bg-slate-50">
              <div
                className="flex h-full items-center justify-end rounded-lg px-2.5 text-[11px] font-semibold text-white shadow-sm"
                style={{ width: `${w}%`, backgroundColor: e.cor || "#94a3b8" }}
              >
                {e.qtd}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function PalavrasChave({ itens }: { itens: { palavra: string; qtd: number }[] }) {
  if (itens.length === 0) return <p className="text-sm text-slate-400">Sem dados suficientes ainda.</p>;
  const max = Math.max(...itens.map((i) => i.qtd), 1);
  return (
    <div className="flex flex-wrap items-center gap-2">
      {itens.map((p) => {
        const escala = 0.8 + (p.qtd / max) * 0.85;
        const forte = p.qtd / max > 0.5;
        return (
          <span
            key={p.palavra}
            className={cn("inline-flex items-center rounded-full px-3 py-1 font-medium leading-none", forte ? "bg-brand/10 text-brand" : "bg-slate-100 text-slate-600")}
            style={{ fontSize: `${escala}rem` }}
            title={`${p.qtd} ocorrências`}
          >
            {p.palavra}
          </span>
        );
      })}
    </div>
  );
}
