"use client";

import { useCallback, useEffect, useState } from "react";
import { Card, Spinner, cn } from "@/app/_components/ui";
import { SecaoTitulo } from "@/app/_components/kpi";
import { usePortal } from "@/app/_components/use-portal";

type Perfil = {
  total: number; com_acao: number;
  resp_wa: number; resp_em: number; resp_li: number;
  engajado_multi: number; so_wa: number; so_em: number; so_li: number; frio: number; sem_acao: number;
};

const pct = (n: number, d: number) => (d > 0 ? Math.round((n / d) * 100) : 0);
const fmt = (n: number) => n.toLocaleString("pt-BR");

// Retrato do lead pela resposta a cada canal: perfis humanos de engajamento +
// quanto o público responde por canal. Entra na aba "Clientes". Por evento/edição.
export function PerfilCanais({ edicao }: { edicao?: string }) {
  const { evento, nome } = usePortal();
  const [p, setP] = useState<Perfil | null>(null);
  const [carregando, setCarregando] = useState(true);

  const carregar = useCallback(async () => {
    const params = new URLSearchParams({ evento });
    if (edicao) params.set("edicao", edicao);
    try {
      const r = await fetch(`/api/comportamento/perfil?${params.toString()}`);
      const d = await r.json();
      if (d.ok) setP(d.perfil);
    } catch {
      /* mantém anterior */
    } finally {
      setCarregando(false);
    }
  }, [evento, edicao]);

  useEffect(() => { carregar(); }, [carregar]);

  if (carregando) {
    return <div className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white p-4 text-sm text-slate-400 dark:border-slate-800 dark:bg-slate-900"><Spinner /> Traçando o perfil dos leads…</div>;
  }
  if (!p || p.total === 0) return null;

  // Base de quem recebeu alguma ação (perfis se referem a esses).
  const base = p.com_acao || 1;

  // Perfis humanos, ordenados do mais "quente" ao mais frio.
  const perfis = [
    { chave: "multi", titulo: "Engajado (vários canais)", qtd: p.engajado_multi, desc: "responde em 2+ canais", cor: "emerald", emoji: "🔥" },
    { chave: "wa", titulo: "Responde no WhatsApp", qtd: p.so_wa, desc: "engaja só pelo WhatsApp", cor: "emerald", emoji: "💬" },
    { chave: "li", titulo: "Atende ligação", qtd: p.so_li, desc: "engaja só por telefone", cor: "violet", emoji: "📞" },
    { chave: "em", titulo: "Abre e-mail", qtd: p.so_em, desc: "abre/clica, mas não responde os outros", cor: "sky", emoji: "✉️" },
    { chave: "frio", titulo: "Frio", qtd: p.frio, desc: "recebeu ação, não respondeu em nada", cor: "rose", emoji: "🧊" },
  ] as const;

  const TOM: Record<string, string> = {
    emerald: "text-emerald-600 dark:text-emerald-400",
    violet: "text-violet-600 dark:text-violet-400",
    sky: "text-sky-600 dark:text-sky-400",
    rose: "text-rose-600 dark:text-rose-400",
  };

  const canais = [
    { label: "WhatsApp", resp: p.resp_wa, cor: "bg-emerald-500" },
    { label: "E-mail", resp: p.resp_em, cor: "bg-sky-500" },
    { label: "Ligação", resp: p.resp_li, cor: "bg-violet-500" },
  ];

  return (
    <div className="mb-6 space-y-4">
      <SecaoTitulo cor="brand">Perfil dos leads · como respondem às nossas ações</SecaoTitulo>

      {/* Perfis de engajamento */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        {perfis.map((perf) => (
          <Card key={perf.chave} className="p-4">
            <div className="text-lg" aria-hidden>{perf.emoji}</div>
            <div className={cn("mt-1 text-2xl font-semibold tabular-nums", TOM[perf.cor])}>{fmt(perf.qtd)}</div>
            <div className="text-xs font-medium text-slate-700 dark:text-slate-200">{perf.titulo}</div>
            <div className="mt-0.5 text-[11px] text-slate-400 dark:text-slate-500">{pct(perf.qtd, base)}% · {perf.desc}</div>
          </Card>
        ))}
      </div>

      {/* Engajamento por canal */}
      <Card className="p-4">
        <div className="mb-3 flex items-center justify-between">
          <span className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Engajamento por canal</span>
          <span className="text-[11px] text-slate-400 dark:text-slate-500">{fmt(p.com_acao)} de {fmt(p.total)} leads do {nome} já receberam alguma ação</span>
        </div>
        <div className="space-y-2.5">
          {canais.map((c) => {
            const t = pct(c.resp, base);
            return (
              <div key={c.label} className="flex items-center gap-3">
                <span className="w-20 shrink-0 text-sm text-slate-600 dark:text-slate-300">{c.label}</span>
                <div className="h-2.5 flex-1 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
                  <div className={cn("h-full rounded-full", c.cor)} style={{ width: `${Math.max(2, t)}%` }} />
                </div>
                <span className="w-24 shrink-0 text-right text-sm tabular-nums text-slate-600 dark:text-slate-300">
                  <span className="font-semibold">{t}%</span> <span className="text-xs text-slate-400">({fmt(c.resp)})</span>
                </span>
              </div>
            );
          })}
        </div>
        <p className="mt-2 text-[11px] text-slate-400 dark:text-slate-500">
          WhatsApp = respondeu o disparo · E-mail = abriu ou clicou · Ligação = atendeu. % sobre quem recebeu ação.
        </p>
      </Card>
    </div>
  );
}
