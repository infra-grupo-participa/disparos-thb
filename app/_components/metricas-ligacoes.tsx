"use client";

import { useCallback, useEffect, useState } from "react";
import { Card, EmptyState, Spinner, cn } from "@/app/_components/ui";
import { Kpi, SecaoTitulo } from "@/app/_components/kpi";
import { usePortal } from "@/app/_components/use-portal";

type Totais = {
  total: number; feitas: number; recebidas: number; atendidas: number;
  abandonadas: number; recusadas: number; nao_atendidas: number; falhou: number;
  dur_total_seg: number; dur_media_seg: number | null;
  compradores_distintos: number; compradores_atendidos: number;
};
type Atendente = { atendente: string; total: number; atendidas: number; feitas: number; dur_total_seg: number };
type DiaSerie = { dia: string; total: number; atendidas: number; atendentes: { operador: string; qtd: number }[] };
type HoraSerie = { hora: number; total: number; atendidas: number };
type CanalSerie = { canal: string; total: number; atendidas: number };

const CANAL_LABEL: Record<string, string> = {
  ligacao: "📞 Ligação", whatsapp: "💬 WhatsApp", presencial: "🤝 Presencial", outro: "• Outro",
};

const taxa = (n: number, d: number) => (d > 0 ? Math.round((n / d) * 100) : 0);
const fmt = (n: number) => n.toLocaleString("pt-BR");
function dur(seg: number | null) {
  if (!seg) return "—";
  const m = Math.floor(seg / 60), s = seg % 60;
  if (m >= 60) return `${Math.floor(m / 60)}h${m % 60}min`;
  return m > 0 ? `${m}min${s ? ` ${s}s` : ""}` : `${s}s`;
}

// Produtividade do comercial nos ATENDIMENTOS (ligação, WhatsApp, presencial),
// por evento. Dados de /api/ligacoes/metricas. Espelha o painel de e-mail.
//
// O que entra aqui é o que o operador registra. O histórico das chamadas do
// Atende Simples continua contando, mas ninguém mais escreve por lá.
export function MetricasLigacoes({ desde, ate }: { desde?: string; ate?: string }) {
  const { evento, nome } = usePortal();
  const [totais, setTotais] = useState<Totais | null>(null);
  const [semVinculo, setSemVinculo] = useState(0);
  const [serie, setSerie] = useState<DiaSerie[]>([]);
  const [porHora, setPorHora] = useState<HoraSerie[]>([]);
  const [porAtendente, setPorAtendente] = useState<Atendente[]>([]);
  const [porCanal, setPorCanal] = useState<CanalSerie[]>([]);
  const [carregando, setCarregando] = useState(true);

  const carregar = useCallback(async () => {
    const params = new URLSearchParams({ evento });
    if (desde) params.set("desde", new Date(`${desde}T00:00:00`).toISOString());
    if (ate) params.set("ate", new Date(`${ate}T23:59:59`).toISOString());
    try {
      const r = await fetch(`/api/ligacoes/metricas?${params.toString()}`);
      const d = await r.json();
      if (d.ok) {
        setTotais(d.totais);
        setSemVinculo(d.sem_vinculo ?? 0);
        setPorAtendente(d.porAtendente);
        setSerie(d.serie ?? []);
        setPorHora(d.porHora ?? []);
        setPorCanal(d.porCanal ?? []);
      }
    } catch {
      /* mantém dados anteriores */
    } finally {
      setCarregando(false);
    }
  }, [evento, desde, ate]);

  useEffect(() => { carregar(); }, [carregar]);

  if (carregando) {
    return <div className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white p-4 text-sm text-slate-400 dark:border-slate-800 dark:bg-slate-900"><Spinner /> Carregando ligações…</div>;
  }
  if (!totais || totais.total === 0) {
    return (
      <EmptyState
        title={`Nenhum atendimento a compradores do ${nome}`}
        description={semVinculo > 0
          ? `Há ${fmt(semVinculo)} registro(s) no período sem contato vinculado — em geral chamadas antigas para números que não são de compradores.`
          : "Os atendimentos aparecem aqui conforme o time registra em Meu dia ou na ficha do contato."}
        icon={
          <svg className="h-9 w-9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.96.36 1.9.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.91.34 1.85.57 2.81.7A2 2 0 0 1 22 16.92Z" />
          </svg>
        }
      />
    );
  }

  const t = totais;
  return (
    <div className="space-y-5">
      <p className="text-xs text-slate-400 dark:text-slate-500">
        Atendimentos a compradores do <span className="font-medium text-slate-500 dark:text-slate-400">{nome}</span> · {fmt(t.total)} registro(s)
        {semVinculo > 0 && <> · {fmt(semVinculo)} sem contato vinculado (fora do escopo)</>}
      </p>

      {/* KPIs — só compradores do evento: conversa, tempo, volume e alcance. */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi titulo="Conversas" valor={fmt(t.atendidas)} sub={`${taxa(t.atendidas, t.total)}% dos ${fmt(t.total)} toques`} />
        <Kpi titulo="Tempo falado" valor={dur(t.dur_total_seg)} sub={`média ${dur(t.dur_media_seg)} por conversa`} />
        <Kpi titulo="Toques" valor={fmt(t.total)} sub={`${fmt(t.feitas)} feitos · ${fmt(t.recebidas)} recebidos`} />
        <Kpi titulo="Compradores alcançados" valor={fmt(t.compradores_distintos)} sub={`${fmt(t.compradores_atendidos)} conversaram`} />
      </div>

      {/* Por canal — revela se o time só liga, ou se também usa WhatsApp. */}
      {porCanal.length > 1 && (
        <Card className="p-4">
          <SecaoTitulo cor="sky">Por canal</SecaoTitulo>
          <div className="mt-2 grid gap-2 sm:grid-cols-3">
            {porCanal.map((c) => (
              <div key={c.canal} className="rounded-lg border border-slate-100 px-3 py-2 dark:border-slate-800">
                <p className="text-xs text-slate-500 dark:text-slate-400">{CANAL_LABEL[c.canal] ?? c.canal}</p>
                <p className="mt-0.5 text-lg font-semibold tabular-nums text-slate-800 dark:text-slate-100">{fmt(c.total)}</p>
                <p className="text-xs text-emerald-600 dark:text-emerald-400">{fmt(c.atendidas)} conversas · {taxa(c.atendidas, c.total)}%</p>
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* Série por dia — volume + atendidas */}
      {serie.length > 0 && (
        <Card className="p-4">
          <SecaoTitulo cor="violet">Ligações por dia</SecaoTitulo>
          <SerieDia serie={serie} />
        </Card>
      )}

      {/* Melhor horário — atendimento por faixa do dia */}
      {porHora.length > 0 && (
        <Card className="p-4">
          <SecaoTitulo cor="emerald">Melhor horário para ligar <span className="ml-1 font-normal normal-case text-slate-400">(Brasília · barra = volume, verde = atendidas)</span></SecaoTitulo>
          <MelhorHorario porHora={porHora} />
        </Card>
      )}

      {/* Ranking por atendente */}
      <Card className="overflow-hidden">
        <div className="border-b border-slate-100 px-4 py-3 dark:border-slate-800">
          <SecaoTitulo cor="slate">Produtividade por atendente</SecaoTitulo>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500 dark:bg-slate-800/60 dark:text-slate-400">
              <tr>
                <th className="px-4 py-2.5 font-semibold">Atendente</th>
                <th className="px-4 py-2.5 font-semibold">Tentativas</th>
                <th className="px-4 py-2.5 font-semibold">Atendidas</th>
                <th className="px-4 py-2.5 font-semibold">Tempo falado</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {porAtendente.map((a) => (
                <tr key={a.atendente} className="transition hover:bg-slate-50/60 dark:hover:bg-slate-800/60">
                  <td className="px-4 py-2.5 font-medium text-slate-800 dark:text-slate-200">{a.atendente}</td>
                  <td className="px-4 py-2.5 tabular-nums text-slate-600 dark:text-slate-300">{fmt(a.total)}</td>
                  <td className="px-4 py-2.5 tabular-nums">
                    <span className="font-semibold text-emerald-600 dark:text-emerald-400">{fmt(a.atendidas)}</span>
                    <span className="text-slate-400"> · {taxa(a.atendidas, a.total)}%</span>
                  </td>
                  <td className="px-4 py-2.5 tabular-nums text-slate-600 dark:text-slate-300">{dur(a.dur_total_seg)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}

function SerieDia({ serie }: { serie: DiaSerie[] }) {
  const max = Math.max(1, ...serie.map((d) => d.total));
  const fmtDia = (iso: string) => { const [, m, d] = iso.split("-"); return `${d}/${m}`; };
  return (
    <>
      <div className="mt-3 flex items-end gap-1.5 overflow-x-auto pb-1">
        {serie.map((d) => {
          const h = Math.max(4, Math.round((d.total / max) * 84));
          const hAt = d.total > 0 ? Math.round((d.atendidas / d.total) * h) : 0;
          // Tooltip sutil: quem ligou naquele dia e quanto (produtividade).
          const quem = d.atendentes.map((a) => `${a.operador}: ${a.qtd}`).join("\n");
          const title = `${fmtDia(d.dia)} · ${d.total} ligações · ${d.atendidas} atendidas${quem ? `\n\n${quem}` : ""}`;
          return (
            <div key={d.dia} className="flex shrink-0 flex-col items-center gap-1" title={title}>
              <div className="flex w-6 flex-col justify-end rounded-t bg-slate-200 dark:bg-slate-700" style={{ height: h }}>
                <div className="w-full rounded-t bg-violet-500" style={{ height: hAt }} />
              </div>
              <span className="text-[9px] tabular-nums text-slate-400 dark:text-slate-500">{fmtDia(d.dia)}</span>
            </div>
          );
        })}
      </div>
      <div className="mt-1 flex items-center gap-3 text-[11px] text-slate-400 dark:text-slate-500">
        <span className="inline-flex items-center gap-1.5"><span className="h-2 w-2 rounded-sm bg-violet-500" /> atendidas</span>
        <span className="inline-flex items-center gap-1.5"><span className="h-2 w-2 rounded-sm bg-slate-200 dark:bg-slate-700" /> não atendidas</span>
      </div>
    </>
  );
}

function MelhorHorario({ porHora }: { porHora: HoraSerie[] }) {
  const maxTotal = Math.max(1, ...porHora.map((h) => h.total));
  // "Melhor faixa" só entre horas com volume e em horário comercial (7h–21h),
  // para não recomendar madrugada (testes/aquecimento do discador distorcem).
  const comercial = porHora.filter((h) => h.total >= 10 && h.hora >= 7 && h.hora <= 21);
  const melhor = comercial.length
    ? comercial.reduce((a, b) => (b.atendidas / b.total > a.atendidas / a.total ? b : a))
    : null;
  return (
    <>
      <div className="mt-3 flex items-end gap-1 overflow-x-auto pb-1">
        {porHora.map((h) => {
          const alt = Math.max(4, Math.round((h.total / maxTotal) * 72));
          const altAt = h.total > 0 ? Math.round((h.atendidas / h.total) * alt) : 0;
          const ehMelhor = melhor?.hora === h.hora;
          return (
            <div key={h.hora} className="flex shrink-0 flex-col items-center gap-1" title={`${h.hora}h · ${h.total} ligações · ${h.atendidas} atendidas (${taxa(h.atendidas, h.total)}%)`}>
              <div className={cn("flex w-6 flex-col justify-end rounded-t bg-slate-200 dark:bg-slate-700", ehMelhor && "ring-2 ring-emerald-400")} style={{ height: alt }}>
                <div className="w-full rounded-t bg-emerald-500" style={{ height: altAt }} />
              </div>
              <span className="text-[9px] tabular-nums text-slate-400 dark:text-slate-500">{h.hora}h</span>
            </div>
          );
        })}
      </div>
      {melhor ? (
        <p className="mt-1 text-xs text-emerald-600 dark:text-emerald-400">
          Melhor faixa (comercial): <strong>{melhor.hora}h</strong> — {taxa(melhor.atendidas, melhor.total)}% atendidas em {fmt(melhor.total)} ligações.
        </p>
      ) : (
        <p className="mt-1 text-xs text-slate-400 dark:text-slate-500">Volume insuficiente em horário comercial para recomendar uma faixa.</p>
      )}
    </>
  );
}

