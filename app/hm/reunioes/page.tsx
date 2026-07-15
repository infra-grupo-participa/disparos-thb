"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Card, Spinner, cn } from "@/app/_components/ui";
import { MarcaPortal } from "@/app/_components/marca";
import { HmVisao } from "@/app/hm/_components/hm-visao";

// Relatório de reuniões (C1). Vincula as marcações de reunião (Comercial) e
// entrevista (Ativação) de todos os cards numa lista só: quando, com quem,
// responsável, resultado, quantas vezes remarcou e — o que faltava — o link da
// gravação. Sai da MESMA leitura da tabela e do XLSX (relatorioHm), então nunca
// conta uma história diferente delas.

type Linha = {
  comprador_id: string; nome: string; responsavel: string | null;
  reuniao_em: string | null; reuniao_resultado: string | null; reuniao_gravacao_url: string | null; reunioes_remarcadas: number | null;
  entrevista_em: string | null; entrevista_resultado: string | null; entrevista_gravacao_url: string | null; entrevistas_remarcadas: number | null;
};
type Reuniao = {
  comprador_id: string; nome: string; responsavel: string | null;
  tipo: "Reunião" | "Entrevista"; quando: string; resultado: string | null; gravacao: string | null; remarcadas: number;
};

function dt(v: string | null): Date | null {
  if (!v) return null;
  const d = new Date(v);
  return isNaN(d.getTime()) ? null : d;
}
function hora(d: Date): string {
  return d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
}
// Rótulo do dia para o cabeçalho da agenda: "Hoje", "Amanhã", "Ontem" ou a data.
function diaLabel(d: Date | null): string {
  if (!d) return "Sem data marcada";
  const hoje = new Date(); hoje.setHours(0, 0, 0, 0);
  const dia = new Date(d); dia.setHours(0, 0, 0, 0);
  const diff = Math.round((dia.getTime() - hoje.getTime()) / 86400000);
  if (diff === 0) return "Hoje";
  if (diff === 1) return "Amanhã";
  if (diff === -1) return "Ontem";
  const s = d.toLocaleDateString("pt-BR", { weekday: "long", day: "2-digit", month: "long", year: "numeric" });
  return s.charAt(0).toUpperCase() + s.slice(1);
}
function diaKey(d: Date | null): string {
  return d ? d.toISOString().slice(0, 10) : "sem-data";
}

type Quando = "proximas" | "passadas" | "todas";

export default function HmReunioesPage() {
  const [linhas, setLinhas] = useState<Linha[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [quando, setQuando] = useState<Quando>("proximas");
  const [tipo, setTipo] = useState<"todos" | "Reunião" | "Entrevista">("todos");

  const carregar = useCallback(async () => {
    setCarregando(true);
    try {
      const r = await fetch("/api/hm/tabela");
      const d = await r.json();
      if (d.ok) setLinhas(d.linhas);
    } finally {
      setCarregando(false);
    }
  }, []);
  useEffect(() => { carregar(); }, [carregar]);

  // Uma linha por marcação: um card pode ter reunião E entrevista.
  const reunioes = useMemo<Reuniao[]>(() => {
    const out: Reuniao[] = [];
    for (const l of linhas) {
      if (l.reuniao_em) out.push({
        comprador_id: l.comprador_id, nome: l.nome, responsavel: l.responsavel, tipo: "Reunião",
        quando: l.reuniao_em, resultado: l.reuniao_resultado, gravacao: l.reuniao_gravacao_url, remarcadas: l.reunioes_remarcadas ?? 0,
      });
      if (l.entrevista_em) out.push({
        comprador_id: l.comprador_id, nome: l.nome, responsavel: l.responsavel, tipo: "Entrevista",
        quando: l.entrevista_em, resultado: l.entrevista_resultado, gravacao: l.entrevista_gravacao_url, remarcadas: l.entrevistas_remarcadas ?? 0,
      });
    }
    return out;
  }, [linhas]);

  const agora = Date.now();
  const filtradas = useMemo(() => {
    return reunioes
      .filter((r) => tipo === "todos" || r.tipo === tipo)
      .filter((r) => {
        const t = dt(r.quando)?.getTime() ?? 0;
        if (quando === "proximas") return t >= agora - 3600_000; // inclui a última hora
        if (quando === "passadas") return t < agora;
        return true;
      })
      // Próximas: a mais perto primeiro; passadas/todas: a mais recente primeiro.
      .sort((a, b) => {
        const ta = dt(a.quando)?.getTime() ?? 0, tb = dt(b.quando)?.getTime() ?? 0;
        return quando === "proximas" ? ta - tb : tb - ta;
      });
  }, [reunioes, tipo, quando, agora]);

  // A agenda agrupada por dia — cada dia é um cabeçalho, com suas marcações
  // embaixo. É o que dá cara de agenda à lista (mais visual que a tabela plana).
  const agenda = useMemo(() => {
    const out: Array<{ kind: "dia"; label: string; key: string; n: number } | { kind: "reuniao"; r: Reuniao }> = [];
    let ultimo = "";
    let idxDia = -1;
    for (const r of filtradas) {
      const d = dt(r.quando);
      const k = diaKey(d);
      if (k !== ultimo) { out.push({ kind: "dia", label: diaLabel(d), key: k, n: 0 }); idxDia = out.length - 1; ultimo = k; }
      const cab = out[idxDia];
      if (cab.kind === "dia") cab.n += 1;
      out.push({ kind: "reuniao", r });
    }
    return out;
  }, [filtradas]);

  const abas: Array<{ id: Quando; label: string }> = [
    { id: "proximas", label: "Próximas" }, { id: "passadas", label: "Passadas" }, { id: "todas", label: "Todas" },
  ];
  const tipos: Array<"todos" | "Reunião" | "Entrevista"> = ["todos", "Reunião", "Entrevista"];

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="flex items-center gap-2.5">
            <MarcaPortal portal="hm" altura="h-7" comNome={false} />
            <h1 className="text-xl font-semibold tracking-tight text-slate-900 dark:text-slate-100">Reuniões · Holding Masters</h1>
          </div>
          <p className="mt-0.5 text-sm text-slate-500 dark:text-slate-400">
            As reuniões e entrevistas em uma lista — com responsável, resultado, remarcações e a gravação.
          </p>
        </div>
        <HmVisao atual="reunioes" filtros={{}} />
      </div>

      <div className="mb-3 flex flex-wrap items-center gap-2 rounded-xl border border-slate-200 bg-white p-2 dark:border-slate-800 dark:bg-slate-900">
        <div className="inline-flex shrink-0 rounded-lg bg-slate-100 p-0.5 dark:bg-slate-800/80">
          {abas.map((a) => (
            <button key={a.id} onClick={() => setQuando(a.id)}
              className={cn("rounded-md px-3 py-1.5 text-sm font-medium transition",
                quando === a.id ? "bg-white text-slate-900 shadow-card dark:bg-slate-700 dark:text-slate-100"
                                : "text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200")}>
              {a.label}
            </button>
          ))}
        </div>
        <div className="inline-flex shrink-0 rounded-lg bg-slate-100 p-0.5 dark:bg-slate-800/80">
          {tipos.map((t) => (
            <button key={t} onClick={() => setTipo(t)}
              className={cn("rounded-md px-3 py-1.5 text-sm font-medium transition capitalize",
                tipo === t ? "bg-white text-slate-900 shadow-card dark:bg-slate-700 dark:text-slate-100"
                           : "text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200")}>
              {t === "todos" ? "Todos" : t + "s"}
            </button>
          ))}
        </div>
      </div>

      <Card className="overflow-hidden">
        {carregando ? (
          <div className="flex items-center justify-center gap-2 p-10 text-sm text-slate-400"><Spinner /> carregando…</div>
        ) : filtradas.length === 0 ? (
          <p className="p-10 text-center text-sm text-slate-400">Nenhuma reunião neste recorte.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-left text-xs uppercase tracking-wide text-slate-400 dark:border-slate-800 dark:text-slate-500">
                  <th className="px-4 py-2.5 font-medium">Quando</th>
                  <th className="px-3 py-2.5 font-medium">Tipo</th>
                  <th className="px-3 py-2.5 font-medium">Aluno</th>
                  <th className="px-3 py-2.5 font-medium">Responsável</th>
                  <th className="px-3 py-2.5 font-medium">Resultado</th>
                  <th className="px-3 py-2.5 text-center font-medium" title="Quantas vezes remarcou">Remarc.</th>
                  <th className="px-4 py-2.5 text-right font-medium">Gravação</th>
                </tr>
              </thead>
              <tbody>
                {agenda.map((item, i) => {
                  if (item.kind === "dia") {
                    return (
                      <tr key={`dia-${item.key}`} className="bg-slate-50/80 dark:bg-slate-800/40">
                        <td colSpan={7} className="px-4 py-1.5">
                          <span className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">{item.label}</span>
                          <span className="ml-2 text-[11px] font-normal text-slate-400 dark:text-slate-500">{item.n} {item.n === 1 ? "marcação" : "marcações"}</span>
                        </td>
                      </tr>
                    );
                  }
                  const r = item.r;
                  const d = dt(r.quando);
                  const futura = (d?.getTime() ?? 0) >= agora;
                  return (
                    <tr key={`${r.comprador_id}-${r.tipo}-${i}`} className="border-b border-slate-100 last:border-0 hover:bg-slate-50 dark:border-slate-800/60 dark:hover:bg-slate-800/40">
                      <td className="whitespace-nowrap px-4 py-2.5 tabular-nums">
                        <span className={cn(futura ? "font-semibold text-slate-900 dark:text-white" : "text-slate-600 dark:text-slate-300")}>{d ? hora(d) : "—"}</span>
                      </td>
                      <td className="px-3 py-2.5">
                        <span className={cn("rounded px-1.5 py-0.5 text-[11px] font-medium",
                          r.tipo === "Reunião" ? "bg-sky-100 text-sky-700 dark:bg-sky-500/15 dark:text-sky-300"
                                                : "bg-violet-100 text-violet-700 dark:bg-violet-500/15 dark:text-violet-300")}>{r.tipo}</span>
                      </td>
                      <td className="px-3 py-2.5 font-medium text-slate-800 dark:text-slate-100">{r.nome}</td>
                      <td className="px-3 py-2.5 text-slate-600 dark:text-slate-300">{r.responsavel || <span className="text-slate-300 dark:text-slate-600">—</span>}</td>
                      <td className="px-3 py-2.5 text-slate-600 dark:text-slate-300">{r.resultado || <span className="text-slate-300 dark:text-slate-600">—</span>}</td>
                      <td className="px-3 py-2.5 text-center tabular-nums">
                        {r.remarcadas > 0 ? <span className="font-semibold text-amber-600 dark:text-amber-400" title={`Remarcou ${r.remarcadas}x`}>{r.remarcadas}</span> : <span className="text-slate-300 dark:text-slate-600">—</span>}
                      </td>
                      <td className="px-4 py-2.5 text-right">
                        {r.gravacao
                          ? <a href={r.gravacao} target="_blank" rel="noreferrer" className="font-medium text-brand hover:underline dark:text-brand-300">▶ Ver</a>
                          : <span className="text-slate-300 dark:text-slate-600">—</span>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
