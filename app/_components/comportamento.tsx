"use client";

import { useCallback, useEffect, useState } from "react";
import { Button, Card, Spinner, cn } from "@/app/_components/ui";

// Seção executiva de Inteligência de Comportamento dos leads. Lê /api/comportamento
// (base sincronizada da Unnichat) e renderiza: ciclo de vida, conversas por assunto,
// categorias de resposta, sentimento, horário de pico, funil e palavras-chave.
// O botão "Sincronizar" puxa o histórico da Unnichat em lotes até concluir.

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

const COR_ASSUNTO: Record<string, string> = {
  risco_churn: "bg-rose-500", financeiro_cobranca: "bg-orange-500", financiamento: "bg-amber-500",
  acesso_login: "bg-yellow-500", tecnico: "bg-red-400", desafio_trilha: "bg-blue-500",
  prova_social: "bg-emerald-500", duvida: "bg-sky-500", aula_live: "bg-indigo-500",
  video: "bg-violet-500", grupo_comunidade: "bg-teal-500", compromisso: "bg-cyan-500",
  elogio: "bg-fuchsia-500", afetivo: "bg-pink-500", saudacao: "bg-slate-400",
};

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
      // Puxa o histórico em lotes até não restarem contatos pendentes (cap de segurança).
      for (let i = 0; i < 12; i++) {
        const r = await fetch(`/api/sync-conversas?limite=60`, { method: "POST" });
        const d = await r.json();
        if (!d.ok) { setProgresso("Falha ao sincronizar."); break; }
        totalNovas += d.mensagens_novas || 0;
        setProgresso(`${totalNovas} mensagens novas · ${d.restantes} contatos restantes`);
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
      <div className="mb-3 mt-8 flex flex-wrap items-center gap-3">
        <h2 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
          <span className="h-3.5 w-1 rounded-full bg-brand/60" aria-hidden="true" />
          Inteligência de comportamento dos leads
        </h2>
        <div className="flex-1" />
        {progresso && <span className="text-xs text-slate-500">{progresso}</span>}
        <span className="hidden text-xs text-slate-400 sm:inline">
          Sync: {fmtData(dados?.sync.ultima ?? null)}
          {dados && dados.sync.pendentes > 0 ? ` · ${dados.sync.pendentes} a sincronizar` : ""}
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

      {/* Ciclo de vida: Onboarding x Ongoing */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <CicloCard
          titulo="Onboarding" sub="Compraram há ≤ 30 dias" tom="brand"
          valor={dados?.ciclo.onboarding ?? 0} total={dados?.ciclo.total ?? 0}
        />
        <CicloCard
          titulo="Ongoing" sub="Compraram há > 30 dias" tom="cyan"
          valor={dados?.ciclo.ongoing ?? 0} total={dados?.ciclo.total ?? 0}
        />
      </div>

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
            <p className="mt-1 text-sm text-slate-500">Clique em <strong>Sincronizar conversas</strong> para puxar o histórico da Unnichat e gerar a inteligência de comportamento.</p>
          </div>
          <Button variant="primary" onClick={sincronizar} disabled={sincronizando}>
            {sincronizando ? "Sincronizando…" : "Sincronizar agora"}
          </Button>
        </Card>
      ) : dados ? (
        <>
          {/* Resumo da base analisada */}
          <p className="mt-3 text-xs text-slate-400">
            Base analisada: <strong className="text-slate-600">{dados.totalConversas}</strong> conversas ·{" "}
            <strong className="text-slate-600">{dados.totalMensagens}</strong> mensagens de leads
          </p>

          <div className="mt-3 grid grid-cols-1 gap-4 lg:grid-cols-3">
            {/* Conversas por assunto — ocupa 2 colunas */}
            <Card className="p-5 lg:col-span-2">
              <CardTitulo>Conversas por assunto</CardTitulo>
              <p className="mb-4 text-xs text-slate-400">Cada conversa é classificada pelo assunto dominante (prioridade: risco → financeiro → técnico → dúvida → … → elogio).</p>
              <BarrasAssunto itens={dados.conversasPorAssunto} />
            </Card>

            {/* Coluna lateral: sentimento + categorias */}
            <div className="flex flex-col gap-4">
              <Card className="p-5">
                <CardTitulo>Sentimento das respostas</CardTitulo>
                <Sentimento s={dados.sentimentos} />
              </Card>
              <Card className="p-5">
                <CardTitulo>Tipos de resposta</CardTitulo>
                <Categorias itens={dados.categoriasResp} />
              </Card>
            </div>
          </div>

          <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
            {/* Horário do dia */}
            <Card className="p-5">
              <CardTitulo>Quando os leads respondem</CardTitulo>
              <p className="mb-4 text-xs text-slate-400">
                Pico às <strong className="text-brand">{String(dados.melhorHora).padStart(2, "0")}h</strong> — melhor janela para disparar.
              </p>
              <Horarios horas={dados.horas} pico={dados.melhorHora} />
            </Card>

            {/* Funil */}
            <Card className="p-5">
              <CardTitulo>Movimentação no funil</CardTitulo>
              <Funil estagios={dados.funil} />
            </Card>
          </div>

          {/* Palavras-chave que colaram */}
          <Card className="mt-4 p-5">
            <CardTitulo>Palavras que mais colaram (respostas positivas e de engajamento)</CardTitulo>
            <p className="mb-4 text-xs text-slate-400">Vocabulário recorrente de quem reagiu bem — use na copy dos próximos disparos.</p>
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

function CicloCard({ titulo, sub, valor, total, tom }: { titulo: string; sub: string; valor: number; total: number; tom: "brand" | "cyan" }) {
  const pct = total ? Math.round((valor / total) * 1000) / 10 : 0;
  return (
    <Card className="p-5">
      <div className="flex items-baseline justify-between">
        <span className="text-sm font-semibold text-slate-800">{titulo}</span>
        <span className={cn("text-xs font-medium", tom === "brand" ? "text-brand" : "text-cyan-600")}>{pct}%</span>
      </div>
      <p className="text-xs text-slate-400">{sub}</p>
      <div className={cn("mt-3 text-4xl font-semibold tabular-nums", tom === "brand" ? "text-brand" : "text-cyan-600")}>{valor}</div>
      <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-slate-100">
        <div className={cn("h-full rounded-full", tom === "brand" ? "bg-brand" : "bg-cyan-500")} style={{ width: `${pct}%` }} />
      </div>
    </Card>
  );
}

function BarrasAssunto({ itens }: { itens: Assunto[] }) {
  if (itens.length === 0) return <p className="text-sm text-slate-400">Sem conversas classificadas.</p>;
  const max = Math.max(...itens.map((i) => i.conversas), 1);
  return (
    <div className="space-y-2.5">
      {itens.map((it) => (
        <div key={it.chave} className="flex items-center gap-3">
          <div className="flex w-44 shrink-0 items-center gap-1.5 text-sm text-slate-700">
            <span aria-hidden>{it.emoji}</span>
            <span className="truncate">{it.label}</span>
          </div>
          <div className="relative h-6 flex-1 overflow-hidden rounded-md bg-slate-100">
            <div
              className={cn("flex h-full items-center justify-end rounded-md px-2 text-[11px] font-semibold text-white transition-all", COR_ASSUNTO[it.chave] || "bg-slate-400")}
              style={{ width: `${Math.max((it.conversas / max) * 100, 8)}%` }}
            >
              {it.pct}%
            </div>
          </div>
          <span className="w-12 shrink-0 text-right text-xs tabular-nums text-slate-400">{it.conversas} conv.</span>
        </div>
      ))}
    </div>
  );
}

function Sentimento({ s }: { s: { positivo: number; neutro: number; negativo: number } }) {
  const total = s.positivo + s.neutro + s.negativo || 1;
  const seg = [
    { k: "positivo", v: s.positivo, cor: "bg-emerald-500", label: "Positivo" },
    { k: "neutro", v: s.neutro, cor: "bg-slate-300", label: "Neutro" },
    { k: "negativo", v: s.negativo, cor: "bg-rose-500", label: "Negativo" },
  ];
  return (
    <div>
      <div className="mt-2 flex h-3 overflow-hidden rounded-full">
        {seg.map((x) => x.v > 0 && (
          <div key={x.k} className={x.cor} style={{ width: `${(x.v / total) * 100}%` }} title={`${x.label}: ${x.v}`} />
        ))}
      </div>
      <div className="mt-3 space-y-1.5">
        {seg.map((x) => (
          <div key={x.k} className="flex items-center gap-2 text-xs">
            <span className={cn("h-2.5 w-2.5 rounded-full", x.cor)} />
            <span className="text-slate-600">{x.label}</span>
            <span className="ml-auto font-semibold tabular-nums text-slate-700">{x.v}</span>
            <span className="w-10 text-right tabular-nums text-slate-400">{Math.round((x.v / total) * 100)}%</span>
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
    <div className="space-y-2">
      {itens.map((c) => (
        <div key={c.chave} className="flex items-center gap-2 text-xs">
          <span className="w-24 shrink-0 text-slate-600">{c.label}</span>
          <div className="h-2 flex-1 overflow-hidden rounded-full bg-slate-100">
            <div className="h-full rounded-full bg-brand/70" style={{ width: `${(c.qtd / max) * 100}%` }} />
          </div>
          <span className="w-7 text-right font-semibold tabular-nums text-slate-700">{c.qtd}</span>
        </div>
      ))}
    </div>
  );
}

function Horarios({ horas, pico }: { horas: number[]; pico: number }) {
  const max = Math.max(...horas, 1);
  return (
    <div>
      <div className="flex h-28 items-end gap-[3px]">
        {horas.map((q, h) => (
          <div key={h} className="group relative flex-1" title={`${String(h).padStart(2, "0")}h: ${q}`}>
            <div
              className={cn("w-full rounded-t transition-all", h === pico ? "bg-brand" : q > 0 ? "bg-brand/35" : "bg-slate-100")}
              style={{ height: `${Math.max((q / max) * 100, 3)}%` }}
            />
          </div>
        ))}
      </div>
      <div className="mt-1.5 flex justify-between text-[10px] tabular-nums text-slate-400">
        <span>00h</span><span>06h</span><span>12h</span><span>18h</span><span>23h</span>
      </div>
    </div>
  );
}

function Funil({ estagios }: { estagios: FunilEstagio[] }) {
  const max = Math.max(...estagios.map((e) => e.qtd), 1);
  return (
    <div className="space-y-2.5">
      {estagios.map((e) => (
        <div key={e.chave} className="flex items-center gap-3">
          <span className="w-32 shrink-0 truncate text-sm text-slate-700">{e.nome}</span>
          <div className="h-6 flex-1 overflow-hidden rounded-md bg-slate-100">
            <div
              className="flex h-full items-center justify-end rounded-md px-2 text-[11px] font-semibold text-white"
              style={{ width: `${Math.max((e.qtd / max) * 100, 6)}%`, backgroundColor: e.cor || "#94a3b8" }}
            >
              {e.qtd}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

function PalavrasChave({ itens }: { itens: { palavra: string; qtd: number }[] }) {
  if (itens.length === 0) return <p className="text-sm text-slate-400">Sem dados suficientes ainda.</p>;
  const max = Math.max(...itens.map((i) => i.qtd), 1);
  return (
    <div className="flex flex-wrap gap-2">
      {itens.map((p) => {
        const escala = 0.8 + (p.qtd / max) * 0.9; // 0.8rem → 1.7rem
        const forte = p.qtd / max > 0.5;
        return (
          <span
            key={p.palavra}
            className={cn("inline-flex items-center rounded-full px-3 py-1 font-medium", forte ? "bg-brand/10 text-brand" : "bg-slate-100 text-slate-600")}
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
