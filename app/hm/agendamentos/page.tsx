"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Button, cn, fieldClass, fieldCompactClass, Spinner } from "@/app/_components/ui";
import { Avatar } from "@/app/_components/avatar";
import { TagChip } from "@/app/_components/tags";

type Agendamento = {
  comprador_id: string; nome: string; email: string | null; telefone: string | null; plano: string | null;
  responsavel: string | null; estagio_nome: string | null; estagio_aba: string | null;
  tags: string[] | null; turma: string | null; turma_origem: string | null;
  acordo: string | null; pagamento_meio: string | null; pagamento_previsto_em: string | null;
  link_saldo_enviado_em: string | null;
  nao_contatar: boolean; nao_contatar_motivo: string | null;
  revisar: boolean; revisar_motivo: string | null;
  pendencia: string | null; apto_ativacao: boolean; observacoes: string | null;
  ativ_searchie: boolean; ativ_comunidade: boolean; ativ_grupo: boolean; ativ_pesquisa: boolean;
  tipo: "reuniao" | "entrevista"; quando: string | null; resultado: string | null;
};

// Duas esteiras, duas cores — o mesmo par usado no board (Comercial azul,
// Ativação laranja da marca). É o que permite bater o olho na grade e saber
// de quem é o dia.
const TIPOS = {
  reuniao: {
    label: "Reunião comercial",
    chip: "bg-blue-600 text-white hover:bg-blue-700",
    ponto: "bg-blue-600",
    leve: "bg-blue-50 text-blue-700 dark:bg-blue-500/15 dark:text-blue-300",
  },
  entrevista: {
    label: "Entrevista de ativação",
    chip: "bg-orange-500 text-white hover:bg-orange-600",
    ponto: "bg-orange-500",
    leve: "bg-orange-50 text-orange-700 dark:bg-orange-500/15 dark:text-orange-300",
  },
} as const;

const DIAS = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];
const MESES = ["Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho", "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"];

const DIA_MS = 86_400_000;

function chaveDia(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
function ehHoje(d: Date): boolean {
  return chaveDia(d) === chaveDia(new Date());
}
function somaDias(d: Date, n: number): Date {
  return new Date(d.getTime() + n * DIA_MS);
}
// Domingo da semana do dia — origem tanto da grade do mês quanto da da semana.
function inicioSemana(d: Date): Date {
  const base = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  return somaDias(base, -base.getDay());
}
// A hora 00:00 é o placeholder de "dia marcado, horário a definir" (foi como
// os agendamentos vieram da planilha do comercial). Nesse caso o chip mostra só
// o nome — anunciar "00:00" seria afirmar um horário que ninguém combinou.
function horaCurta(iso: string): string | null {
  const d = new Date(iso);
  if (d.getHours() === 0 && d.getMinutes() === 0) return null;
  return d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
}
function fmtLongo(iso: string): string {
  return new Date(iso).toLocaleString("pt-BR", { weekday: "long", day: "2-digit", month: "long", hour: "2-digit", minute: "2-digit" });
}

export default function HmAgendamentosPage() {
  const [rows, setRows] = useState<Agendamento[]>([]);
  const [tipo, setTipo] = useState("");
  const [vista, setVista] = useState<"mes" | "semana">("mes");
  const [cursor, setCursor] = useState(() => new Date());
  const [carregando, setCarregando] = useState(true);
  const [diaAberto, setDiaAberto] = useState<string | null>(null);
  const [aberto, setAberto] = useState<Agendamento | null>(null);   // modal do evento

  const carregar = useCallback(async () => {
    setCarregando(true);
    try {
      const params = new URLSearchParams();
      if (tipo) params.set("tipo", tipo);
      const r = await fetch(`/api/hm/agendamentos?${params.toString()}`);
      const d = await r.json();
      if (d.ok) setRows(d.agendamentos);
    } finally {
      setCarregando(false);
    }
  }, [tipo]);

  useEffect(() => { carregar(); }, [carregar]);

  // Indexa por dia uma vez — a grade só faz lookup.
  const porDia = useMemo(() => {
    const m = new Map<string, Agendamento[]>();
    for (const r of rows) {
      if (!r.quando) continue;
      const k = chaveDia(new Date(r.quando));
      const lista = m.get(k);
      if (lista) lista.push(r); else m.set(k, [r]);
    }
    for (const lista of m.values()) {
      lista.sort((a, b) => (a.quando ?? "").localeCompare(b.quando ?? ""));
    }
    return m;
  }, [rows]);

  // Mês: sempre 6 semanas (42 células), como no Google — a grade não "pula" de
  // altura ao trocar de mês. Semana: os 7 dias da semana do cursor.
  const celulas = useMemo(() => {
    if (vista === "semana") {
      const dom = inicioSemana(cursor);
      return Array.from({ length: 7 }, (_, i) => somaDias(dom, i));
    }
    const primeiro = new Date(cursor.getFullYear(), cursor.getMonth(), 1);
    const origem = inicioSemana(primeiro);
    return Array.from({ length: 42 }, (_, i) => somaDias(origem, i));
  }, [cursor, vista]);

  const titulo = vista === "mes"
    ? `${MESES[cursor.getMonth()]} de ${cursor.getFullYear()}`
    : (() => {
        const dom = inicioSemana(cursor);
        const sab = somaDias(dom, 6);
        const mesmoMes = dom.getMonth() === sab.getMonth();
        return mesmoMes
          ? `${dom.getDate()} – ${sab.getDate()} de ${MESES[dom.getMonth()]} de ${dom.getFullYear()}`
          : `${dom.getDate()} de ${MESES[dom.getMonth()]} – ${sab.getDate()} de ${MESES[sab.getMonth()]} de ${sab.getFullYear()}`;
      })();

  function navegar(passo: number) {
    setCursor((c) =>
      vista === "mes"
        ? new Date(c.getFullYear(), c.getMonth() + passo, 1)
        : somaDias(c, passo * 7),
    );
  }

  const doDiaAberto = diaAberto ? (porDia.get(diaAberto) ?? []) : [];

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-slate-900 dark:text-slate-100">Agenda · Holding Masters</h1>
          <p className="mt-0.5 text-sm text-slate-500 dark:text-slate-400">
            Reuniões comerciais e entrevistas de ativação — T39. {rows.length} agendamento(s).
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={() => setCursor(new Date())}
            className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm font-medium text-slate-700 transition hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
          >
            Hoje
          </button>
          <div className="flex items-center">
            <button onClick={() => navegar(-1)} aria-label="Anterior" className="rounded-full p-1.5 text-slate-500 transition hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800">
              <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m15 18-6-6 6-6" /></svg>
            </button>
            <button onClick={() => navegar(1)} aria-label="Próximo" className="rounded-full p-1.5 text-slate-500 transition hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800">
              <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m9 18 6-6-6-6" /></svg>
            </button>
          </div>
          <span className="min-w-[13rem] text-base font-semibold capitalize text-slate-800 dark:text-slate-100">{titulo}</span>

          <select value={tipo} onChange={(e) => setTipo(e.target.value)} className={fieldCompactClass}>
            <option value="">Reuniões e entrevistas</option>
            <option value="reuniao">Só reuniões</option>
            <option value="entrevista">Só entrevistas</option>
          </select>

          <div className="inline-flex rounded-lg border border-slate-200 bg-slate-50 p-0.5 dark:border-slate-800 dark:bg-slate-900/60">
            {(["mes", "semana"] as const).map((v) => (
              <button
                key={v}
                onClick={() => setVista(v)}
                className={cn(
                  "rounded-md px-3 py-1 text-sm font-medium transition",
                  vista === v
                    ? "bg-white text-slate-900 shadow-card dark:bg-slate-800 dark:text-slate-100"
                    : "text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200",
                )}
              >
                {v === "mes" ? "Mês" : "Semana"}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Legenda */}
      <div className="mb-3 flex flex-wrap items-center gap-4">
        {(Object.keys(TIPOS) as (keyof typeof TIPOS)[]).map((k) => (
          <span key={k} className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-500 dark:text-slate-400">
            <span className={cn("h-2.5 w-2.5 rounded-full", TIPOS[k].ponto)} />
            {TIPOS[k].label}
          </span>
        ))}
      </div>

      {carregando && rows.length === 0 ? (
        <div className="flex items-center justify-center gap-3 py-20 text-slate-400"><Spinner className="h-6 w-6" /> Carregando agenda…</div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
          {/* Cabeçalho dos dias da semana */}
          <div className="grid grid-cols-7 border-b border-slate-200 dark:border-slate-800">
            {celulas.slice(0, 7).map((d, i) => (
              <div key={i} className="px-2 py-2 text-center text-[11px] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">
                {DIAS[d.getDay()]}
              </div>
            ))}
          </div>

          <div className={cn("grid grid-cols-7", vista === "mes" ? "grid-rows-6" : "grid-rows-1")}>
            {celulas.map((dia) => {
              const k = chaveDia(dia);
              const eventos = porDia.get(k) ?? [];
              const foraDoMes = vista === "mes" && dia.getMonth() !== cursor.getMonth();
              const hoje = ehHoje(dia);
              // No mês, 3 chips cabem sem estourar a célula; o resto vira "+N".
              const limite = vista === "mes" ? 3 : eventos.length;
              const visiveis = eventos.slice(0, limite);
              const ocultos = eventos.length - visiveis.length;

              return (
                <div
                  key={k}
                  className={cn(
                    "flex flex-col gap-1 border-b border-r border-slate-100 p-1.5 dark:border-slate-800",
                    vista === "mes" ? "min-h-[7rem]" : "min-h-[22rem]",
                    foraDoMes && "bg-slate-50/60 dark:bg-slate-900/40",
                  )}
                >
                  <div className="flex justify-center">
                    <span
                      className={cn(
                        "flex h-6 min-w-[1.5rem] items-center justify-center rounded-full px-1 text-xs font-semibold tabular-nums",
                        hoje
                          ? "bg-blue-600 text-white"
                          : foraDoMes
                            ? "text-slate-300 dark:text-slate-600"
                            : "text-slate-600 dark:text-slate-300",
                      )}
                    >
                      {dia.getDate()}
                    </span>
                  </div>

                  {visiveis.map((ev, i) => {
                    const t = TIPOS[ev.tipo];
                    const hora = ev.quando ? horaCurta(ev.quando) : null;
                    return (
                      <button
                        key={`${ev.comprador_id}-${ev.tipo}-${i}`}
                        onClick={() => setAberto(ev)}
                        title={`${t.label} · ${ev.nome}${ev.quando ? ` · ${fmtLongo(ev.quando)}` : ""}`}
                        className={cn("flex items-center gap-1 truncate rounded px-1.5 py-0.5 text-left text-[11px] font-medium transition", t.chip)}
                      >
                        {/* A trava tem que aparecer NA AGENDA: quem vai para a
                            reunião precisa saber antes de ligar, não depois. */}
                        {(ev.nao_contatar || ev.revisar) && <span aria-hidden>⚠</span>}
                        <span className="truncate">{hora ? `${hora} · ` : ""}{ev.nome}</span>
                      </button>
                    );
                  })}

                  {ocultos > 0 && (
                    <button
                      onClick={() => setDiaAberto(k)}
                      className="rounded px-1.5 py-0.5 text-left text-[11px] font-semibold text-slate-500 transition hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800"
                    >
                      mais {ocultos}
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Detalhe do dia — o "mais N" do Google */}
      {diaAberto && (
        <>
          <div className="fixed inset-0 z-40 bg-slate-900/40 backdrop-blur-sm" onClick={() => setDiaAberto(null)} />
          <div className="fixed left-1/2 top-1/2 z-50 w-full max-w-md -translate-x-1/2 -translate-y-1/2 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-pop dark:border-slate-800 dark:bg-slate-900">
            <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3 dark:border-slate-800">
              <h2 className="text-sm font-semibold text-slate-800 dark:text-slate-100">
                {new Date(`${diaAberto}T12:00:00`).toLocaleDateString("pt-BR", { weekday: "long", day: "2-digit", month: "long" })}
              </h2>
              <button onClick={() => setDiaAberto(null)} className="rounded-lg p-1 text-slate-400 transition hover:bg-slate-100 dark:hover:bg-slate-800">
                <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M18 6 6 18M6 6l12 12" /></svg>
              </button>
            </div>
            <div className="max-h-[60vh] overflow-y-auto">
              {doDiaAberto.map((ev, i) => (
                <button
                  key={`${ev.comprador_id}-${ev.tipo}-${i}`}
                  onClick={() => { setDiaAberto(null); setAberto(ev); }}
                  className="flex w-full items-center gap-3 border-b border-slate-100 px-4 py-3 text-left transition last:border-0 hover:bg-slate-50 dark:border-slate-800 dark:hover:bg-slate-800/40"
                >
                  <span className={cn("shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold", TIPOS[ev.tipo].leve)}>
                    {ev.tipo === "reuniao" ? "Reunião" : "Entrevista"}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold text-slate-800 dark:text-slate-100">{ev.nome}</p>
                    <p className="truncate text-xs text-slate-400 dark:text-slate-500">
                      {ev.quando ? (horaCurta(ev.quando) ?? "horário a definir") : "—"}
                      {ev.resultado ? ` · ${ev.resultado}` : ""}
                    </p>
                  </div>
                  {ev.responsavel && <Avatar nome={ev.responsavel} className="h-6 w-6 shrink-0 text-[10px]" />}
                </button>
              ))}
            </div>
          </div>
        </>
      )}

      {aberto && <ModalEvento ev={aberto} onClose={() => setAberto(null)} />}
    </div>
  );
}

// Detalhe do compromisso — o briefing de quem vai entrar na reunião. Reúne o que
// está espalhado pelo card: quem é a pessoa, o que já foi combinado, o que trava
// e (na entrevista) o que falta da ativação. Sem isso, o evento da agenda é só um
// nome numa data e alguém teria que abrir o kanban para saber do que se trata.
function ModalEvento({ ev, onClose }: { ev: Agendamento; onClose: () => void }) {
  const t = TIPOS[ev.tipo];
  const checklist = [
    ["Searchie/Óbvio", ev.ativ_searchie],
    ["Comunidade THB", ev.ativ_comunidade],
    ["Grupo de informes", ev.ativ_grupo],
    ["Pesquisa", ev.ativ_pesquisa],
  ] as const;
  const feitos = checklist.filter(([, v]) => v).length;
  const wa = ev.telefone ? `https://wa.me/${ev.telefone.replace(/\D/g, "").replace(/^(?!55)/, "55")}` : null;

  return (
    <>
      <div className="fixed inset-0 z-40 bg-slate-900/40 backdrop-blur-sm" onClick={onClose} />
      <div className="fixed left-1/2 top-1/2 z-50 max-h-[85vh] w-full max-w-lg -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-xl border border-slate-200 bg-white shadow-pop dark:border-slate-800 dark:bg-slate-900">
        <div className="flex items-start gap-3 border-b border-slate-100 p-4 dark:border-slate-800">
          <span className={cn("mt-0.5 h-2.5 w-2.5 shrink-0 rounded-full", t.ponto)} />
          <div className="min-w-0 flex-1">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">{t.label}</p>
            <h2 className="truncate text-lg font-semibold text-slate-900 dark:text-slate-100">{ev.nome}</h2>
            <p className="mt-0.5 text-sm text-slate-500 dark:text-slate-400">
              {ev.quando ? fmtLongo(ev.quando) : "sem data"}
              {ev.quando && !horaCurta(ev.quando) && " · horário a definir"}
            </p>
          </div>
          <button onClick={onClose} className="rounded-lg p-1 text-slate-400 transition hover:bg-slate-100 dark:hover:bg-slate-800">
            <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M18 6 6 18M6 6l12 12" /></svg>
          </button>
        </div>

        <div className="space-y-3 p-4">
          {ev.nao_contatar && (
            <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm dark:border-rose-500/30 dark:bg-rose-500/10">
              <p className="font-semibold text-rose-700 dark:text-rose-300">Não entrar em contato</p>
              {ev.nao_contatar_motivo && <p className="mt-0.5 text-xs text-rose-600 dark:text-rose-400">{ev.nao_contatar_motivo}</p>}
            </div>
          )}
          {ev.revisar && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm dark:border-amber-500/30 dark:bg-amber-500/10">
              <p className="font-semibold text-amber-800 dark:text-amber-300">Revisar antes de tratar</p>
              {ev.revisar_motivo && <p className="mt-0.5 text-xs text-amber-700 dark:text-amber-400">{ev.revisar_motivo}</p>}
            </div>
          )}

          {/* Quem é a pessoa: as tags dizem se é aluno THB, Aurum ou lead novo,
              e por qual canal entrou. */}
          {ev.tags && ev.tags.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {ev.tags.map((tag) => <TagChip key={tag} tag={tag} mini />)}
            </div>
          )}

          <dl className="grid grid-cols-2 gap-x-3 gap-y-2 text-sm">
            <Info rotulo="Etapa" valor={ev.estagio_nome} />
            <Info rotulo="Responsável" valor={ev.responsavel} />
            <Info rotulo="Status" valor={ev.resultado} />
            <Info rotulo="Turma" valor={ev.turma_origem ? `${ev.turma ?? "—"} (veio da ${ev.turma_origem})` : ev.turma} />
          </dl>

          {/* Só faz sentido no comercial: o que foi combinado sobre o saldo. */}
          {(ev.acordo || ev.pagamento_meio || ev.pagamento_previsto_em || ev.link_saldo_enviado_em) && (
            <div className="rounded-lg bg-slate-50 p-3 dark:bg-slate-800/60">
              <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">Acordo do saldo</p>
              {ev.acordo && <p className="text-sm text-slate-700 dark:text-slate-200">{ev.acordo}</p>}
              <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                {ev.pagamento_meio ? `Meio: ${ev.pagamento_meio.replace("_", " ")}` : "Meio a combinar"}
                {ev.pagamento_previsto_em && ` · paga em ${new Date(`${ev.pagamento_previsto_em.slice(0, 10)}T12:00:00`).toLocaleDateString("pt-BR")}`}
                {ev.link_saldo_enviado_em && ` · link enviado ${new Date(ev.link_saldo_enviado_em).toLocaleDateString("pt-BR")}`}
              </p>
            </div>
          )}

          {/* Na entrevista, o que importa é o que falta para concluir a ativação. */}
          {ev.tipo === "entrevista" && (
            <div className="rounded-lg bg-slate-50 p-3 dark:bg-slate-800/60">
              <div className="mb-1.5 flex items-center justify-between">
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">Ativação</p>
                <span className={cn(
                  "rounded-full px-2 py-0.5 text-[11px] font-semibold tabular-nums",
                  feitos === 4 ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300"
                               : "bg-slate-200 text-slate-600 dark:bg-slate-700 dark:text-slate-300",
                )}>{feitos}/4</span>
              </div>
              <ul className="space-y-0.5 text-sm">
                {checklist.map(([label, ok]) => (
                  <li key={label} className={cn("flex items-center gap-1.5", ok ? "text-slate-700 dark:text-slate-200" : "text-slate-400 dark:text-slate-500")}>
                    <span>{ok ? "✓" : "○"}</span> {label}
                  </li>
                ))}
              </ul>
              {ev.pendencia && <p className="mt-1.5 text-xs text-slate-500 dark:text-slate-400">Pendente: {ev.pendencia}</p>}
            </div>
          )}
        </div>

        <div className="sticky bottom-0 flex gap-2 border-t border-slate-100 bg-white p-3 dark:border-slate-800 dark:bg-slate-900">
          <Link href={`/hm/contatos/${ev.comprador_id}`} className="flex-1">
            <Button variant="secondary" className="w-full">Abrir ficha</Button>
          </Link>
          {wa && !ev.nao_contatar && (
            <a href={wa} target="_blank" rel="noreferrer" className="flex-1">
              <Button variant="primary" className="w-full">WhatsApp</Button>
            </a>
          )}
        </div>
      </div>
    </>
  );
}

function Info({ rotulo, valor }: { rotulo: string; valor: string | null }) {
  return (
    <div>
      <dt className="text-[11px] font-medium uppercase tracking-wide text-slate-400 dark:text-slate-500">{rotulo}</dt>
      <dd className="truncate text-sm text-slate-700 dark:text-slate-200">{valor || "—"}</dd>
    </div>
  );
}
