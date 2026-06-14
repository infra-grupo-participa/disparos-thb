"use client";

import type React from "react";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { EdicaoBadge } from "@/app/_components/edicao-badge";
import { Button, Card, Spinner, cn, fieldClass } from "@/app/_components/ui";
import { CardLigacoes } from "@/app/_components/ligacao";
import { Reveal, AnimNum } from "@/app/_components/anim";
import { usePortal } from "@/app/_components/use-portal";

type Estagio = { chave: string; nome: string; cor: string | null };
type Contato = {
  comprador_id: string; nome: string; email: string; telefone: string | null;
  edicao: string | null; ultima_compra_ht: string | null;
  estagio_chave: string | null; estagio_nome: string | null;
  proxima_acao_em: string | null; proxima_acao_nota: string | null;
  observacoes: string | null; ultima_resposta_em: string | null;
  edicao_ht: string | null;
  legado_ativado: boolean | null;
  legado_sla_h: number | null;
  legado_ativacao_em: string | null;
  legado_no_grupo: boolean | null;
  legado_pesquisa: boolean | null;
  legado_ja_ht: boolean | null;
  legado_qtd_ht: number | null;
  legado_ja_hm: boolean | null;
  legado_e_aluno: boolean | null;
  legado_instrucao: string | null;
  primeiro_contato_em: string | null;
  legado_t_primeiro_contato_h: number | null;
  legado_t_ativacao_h: number | null;
  tags: string[] | null;
};
type Interacao = { tipo: string; descricao: string | null; autor: string | null; criado_em: string };
type Formulario = { tipo: string; respostas: Record<string, string> | null; pontuacao: number | string | null; respondido_em: string | null };
type Metricas = { disparos_recebidos: number; disparos_respondidos: number; sla_medio: number | null; ultima_resposta_disparo: string | null };

function nivelLead(score: number) {
  if (score >= 60) return { label: "Quente", txt: "text-emerald-600 dark:text-emerald-400", bar: "bg-emerald-500", ring: "ring-emerald-200 dark:ring-emerald-500/30", bg: "bg-emerald-50 dark:bg-emerald-500/10" };
  if (score >= 30) return { label: "Morno", txt: "text-amber-600 dark:text-amber-400", bar: "bg-amber-500", ring: "ring-amber-200 dark:ring-amber-500/30", bg: "bg-amber-50 dark:bg-amber-500/10" };
  return { label: "Frio", txt: "text-sky-600 dark:text-sky-400", bar: "bg-sky-500", ring: "ring-sky-200 dark:ring-sky-500/30", bg: "bg-sky-50 dark:bg-sky-500/10" };
}
function Termometro({ score }: { score: number }) {
  const n = nivelLead(score);
  return (
    <div className={cn("w-44 shrink-0 rounded-xl px-4 py-3 ring-1 ring-inset", n.bg, n.ring)}>
      <div className="flex items-center justify-between gap-2">
        <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">Termômetro</span>
        <span className={cn("text-xs font-bold", n.txt)}>{n.label}</span>
      </div>
      <div className="mt-0.5 flex items-baseline gap-1">
        <AnimNum value={score} className="text-3xl font-bold text-slate-900 dark:text-white" />
        <span className="text-sm text-slate-400 dark:text-slate-500">/ 100</span>
      </div>
      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-slate-200/70 dark:bg-slate-700/50">
        <div className={cn("js-bar h-full rounded-full", n.bar)} style={{ width: `${Math.max(2, score)}%` }} />
      </div>
    </div>
  );
}
function Sinal({ on, label }: { on: boolean; label: string }) {
  return (
    <span className={cn("inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium ring-1 ring-inset",
      on ? "bg-emerald-50 text-emerald-700 ring-emerald-200 dark:bg-emerald-500/15 dark:text-emerald-300 dark:ring-emerald-500/30"
         : "bg-slate-50 text-slate-400 ring-slate-200 dark:bg-slate-800/50 dark:text-slate-500 dark:ring-slate-700")}>
      <svg className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
        <path d={on ? "M20 6 9 17l-5-5" : "M18 6 6 18 M6 6l12 12"} />
      </svg>
      {label}
    </span>
  );
}

const FORM_TITULO: Record<string, string> = { matricula: "Qualificação", ficha_hm: "Ficha de Interesse HM" };

// Cor da tag por natureza: edição (HT##), grupo, formulário, demais.
function tagStyle(tag: string): string {
  if (/^HT\d+$/i.test(tag)) return "bg-violet-100 text-violet-700 ring-violet-200 dark:bg-violet-500/15 dark:text-violet-300 dark:ring-violet-500/30";
  if (tag === "No grupo") return "bg-emerald-100 text-emerald-700 ring-emerald-200 dark:bg-emerald-500/15 dark:text-emerald-300 dark:ring-emerald-500/30";
  if (/respondeu/i.test(tag)) return "bg-blue-100 text-blue-700 ring-blue-200 dark:bg-blue-500/15 dark:text-blue-300 dark:ring-blue-500/30";
  return "bg-slate-100 text-slate-600 ring-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:ring-slate-700";
}
function TagChip({ tag }: { tag: string }) {
  return <span className={cn("rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset", tagStyle(tag))}>{tag}</span>;
}

const ICONE_TL: Record<string, { path: string; wrap: string }> = {
  disparo: { path: "m22 2-7 20-4-9-9-4Z M22 2 11 13", wrap: "bg-blue-50 text-blue-600 ring-blue-200 dark:bg-blue-500/15 dark:text-blue-400 dark:ring-blue-500/30" },
  resposta: { path: "M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z", wrap: "bg-emerald-50 text-emerald-600 ring-emerald-200 dark:bg-emerald-500/15 dark:text-emerald-400 dark:ring-emerald-500/30" },
  nota: { path: "M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7 M18.5 2.5a2.1 2.1 0 0 1 3 3L12 15l-4 1 1-4Z", wrap: "bg-amber-50 text-amber-600 ring-amber-200 dark:bg-amber-500/15 dark:text-amber-400 dark:ring-amber-500/30" },
  mudanca_estagio: { path: "M16 3h5v5 M21 3l-7 7 M8 21H3v-5 M3 21l7-7", wrap: "bg-violet-50 text-violet-600 ring-violet-200 dark:bg-violet-500/15 dark:text-violet-400 dark:ring-violet-500/30" },
  ligacao: { path: "M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.96.36 1.9.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.91.34 1.85.57 2.81.7A2 2 0 0 1 22 16.92Z", wrap: "bg-teal-50 text-teal-600 ring-teal-200 dark:bg-teal-500/15 dark:text-teal-400 dark:ring-teal-500/30" },
  sistema: { path: "M13 2 3 14h9l-1 8 10-12h-9l1-8z", wrap: "bg-slate-100 text-slate-500 ring-slate-200 dark:bg-slate-800/60 dark:text-slate-400 dark:ring-slate-700" },
};
function fmt(iso: string | null) {
  return iso ? new Date(iso).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", year: "2-digit", hour: "2-digit", minute: "2-digit" }) : "—";
}
function fmtData(iso: string | null) {
  return iso ? new Date(iso).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" }) : "—";
}
function fmtNum(n: number | null) {
  return n == null ? "—" : n.toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
}
function fmtBool(b: boolean | null) {
  return b == null ? null : b ? "Sim" : "Não";
}
function LegadoLinha({ rotulo, valor }: { rotulo: string; valor: React.ReactNode }) {
  if (valor === null || valor === undefined || valor === "") return null;
  return (
    <div className="flex justify-between gap-2 border-b border-slate-100 py-1.5 text-sm last:border-0 dark:border-slate-800">
      <span className="text-slate-500 dark:text-slate-400">{rotulo}</span>
      <span className="text-right font-medium text-slate-800 dark:text-slate-200">{valor}</span>
    </div>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">{children}</h3>;
}

function FormularioCard({ f }: { f: Formulario }) {
  const titulo = FORM_TITULO[f.tipo] || f.tipo;
  const respostas = f.respostas && typeof f.respostas === "object" ? Object.entries(f.respostas) : [];
  return (
    <Card className="p-4">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h4 className="text-sm font-semibold text-slate-800 dark:text-slate-100">{titulo}</h4>
        {f.pontuacao != null && f.pontuacao !== "" && (
          <span className="shrink-0 rounded-full bg-brand/10 px-2.5 py-1 text-xs font-semibold tabular-nums text-brand dark:bg-brand-400/15 dark:text-brand-300">
            {f.pontuacao} pts
          </span>
        )}
      </div>
      <dl className="space-y-2.5">
        {respostas.map(([q, a]) => (
          <div key={q}>
            <dt className="text-xs text-slate-400 dark:text-slate-500">{q}</dt>
            <dd className="text-sm font-medium text-slate-700 dark:text-slate-200">{String(a).trim() || "—"}</dd>
          </div>
        ))}
        {respostas.length === 0 && <p className="text-sm text-slate-400 dark:text-slate-500">Sem respostas registradas.</p>}
      </dl>
      {f.respondido_em && <p className="mt-3 border-t border-slate-100 pt-2 text-xs text-slate-400 dark:border-slate-800 dark:text-slate-500">Respondido em {fmtData(f.respondido_em)}</p>}
    </Card>
  );
}

export default function ContatoDetalhe({ params }: { params: { id: string } }) {
  const id = params.id;
  const { evento, base } = usePortal();
  const [estagios, setEstagios] = useState<Estagio[]>([]);
  const [contato, setContato] = useState<Contato | null>(null);
  const [timeline, setTimeline] = useState<Interacao[]>([]);
  const [formularios, setFormularios] = useState<Formulario[]>([]);
  const [score, setScore] = useState(0);
  const [metricas, setMetricas] = useState<Metricas | null>(null);
  const [nota, setNota] = useState("");
  const [obs, setObs] = useState("");
  const [proxData, setProxData] = useState("");
  const [proxNota, setProxNota] = useState("");

  const carregar = useCallback(async () => {
    const r = await fetch(`/api/contato/${id}`);
    const d = await r.json();
    if (d.ok) {
      setContato(d.contato);
      setTimeline(d.timeline);
      setFormularios(d.formularios || []);
      setScore(d.score ?? 0);
      setMetricas(d.metricas ?? null);
      setObs(d.contato.observacoes || "");
      setProxNota(d.contato.proxima_acao_nota || "");
      setProxData(d.contato.proxima_acao_em ? d.contato.proxima_acao_em.slice(0, 16) : "");
    }
  }, [id]);

  useEffect(() => {
    fetch(`/api/estagios?evento=${evento}`).then((r) => r.json()).then((d) => d.ok && setEstagios(d.estagios)).catch(() => {});
    carregar();
  }, [carregar, evento]);

  async function patch(payload: Record<string, unknown>) {
    await fetch(`/api/contato/${id}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload),
    });
    await carregar();
  }

  if (!contato) {
    return (
      <div className="flex items-center gap-2 text-slate-400 dark:text-slate-500">
        <Spinner /> Carregando…
      </div>
    );
  }

  return (
    <div className="pb-12">
      <Link href={`${base}/contatos`} className="text-sm text-slate-500 transition-colors hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200">
        ← Contatos
      </Link>

      {/* Painel 360° — identidade, termômetro, sinais e ações num relance */}
      <Reveal>
      <Card className="js-reveal mt-2 p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-2xl font-semibold tracking-tight text-slate-900 dark:text-slate-100">{contato.nome}</h1>
              <EdicaoBadge edicao={contato.edicao_ht ?? contato.edicao} />
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-slate-500 dark:text-slate-400">
              <span className="inline-flex items-center gap-1.5"><span className="text-slate-400 dark:text-slate-500">E-mail:</span>{contato.email}</span>
              <span className="inline-flex items-center gap-1.5">
                <span className="text-slate-400 dark:text-slate-500">Telefone:</span>
                {contato.telefone || <span className="text-rose-500 dark:text-rose-400">sem telefone</span>}
              </span>
              {contato.telefone && (
                <a
                  href={`https://wa.me/${(contato.telefone || "").replace(/\D/g, "")}`}
                  target="_blank" rel="noreferrer"
                  className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2.5 py-0.5 text-xs font-medium text-emerald-700 ring-1 ring-inset ring-emerald-200 transition-colors hover:bg-emerald-100 dark:bg-emerald-500/15 dark:text-emerald-300 dark:ring-emerald-500/30"
                >
                  <svg className="h-3 w-3" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2a10 10 0 0 0-8.5 15.3L2 22l4.8-1.5A10 10 0 1 0 12 2Z" /></svg>
                  WhatsApp
                </a>
              )}
            </div>
            {(contato.tags?.length ?? 0) > 0 && (
              <div className="mt-3 flex flex-wrap gap-1.5">{contato.tags!.map((t) => <TagChip key={t} tag={t} />)}</div>
            )}
          </div>
          <Termometro score={score} />
        </div>

        {/* Sinais-chave reunidos */}
        <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-slate-100 pt-4 dark:border-slate-800">
          <Sinal on={!!(contato.tags?.includes("No grupo") || contato.legado_no_grupo)} label="No grupo" />
          <Sinal on={formularios.some((f) => f.tipo === "matricula")} label="Matrícula" />
          <Sinal on={formularios.some((f) => f.tipo === "ficha_hm")} label="Ficha HM" />
          <Sinal on={!!contato.legado_ativado} label="Ativado" />
          {metricas && metricas.disparos_recebidos > 0 && (
            <span className="ml-auto text-xs text-slate-400 dark:text-slate-500">
              {metricas.disparos_respondidos}/{metricas.disparos_recebidos} disparos respondidos
            </span>
          )}
        </div>
      </Card>
      </Reveal>

      <div className="mt-6 grid gap-6 lg:grid-cols-[1fr_380px]">
        {/* Coluna principal — Formulários + Timeline */}
        <div>
          {formularios.length > 0 && (
            <div className="mb-6">
              <SectionTitle>Formulários</SectionTitle>
              <div className="grid gap-4 sm:grid-cols-2">
                {formularios.map((f, i) => <FormularioCard key={i} f={f} />)}
              </div>
            </div>
          )}
          <SectionTitle>Timeline</SectionTitle>
          <div className="space-y-2">
            {timeline.map((i, idx) => (
              <Card key={idx} className="flex gap-3 p-3 text-sm">
                <span
                  className={cn(
                    "flex h-9 w-9 flex-none items-center justify-center rounded-full ring-1 ring-inset",
                    (ICONE_TL[i.tipo] || ICONE_TL.sistema).wrap,
                  )}
                  aria-hidden="true"
                >
                  <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d={(ICONE_TL[i.tipo] || ICONE_TL.sistema).path} /></svg>
                </span>
                <div className="flex-1">
                  <div className="text-slate-700 dark:text-slate-200">{i.descricao}</div>
                  <div className="mt-0.5 text-xs text-slate-400 dark:text-slate-500">{fmt(i.criado_em)} · {i.autor || "—"}</div>
                </div>
              </Card>
            ))}
            {timeline.length === 0 && (
              <Card className="px-4 py-8 text-center text-sm text-slate-400 dark:text-slate-500">Sem interações ainda.</Card>
            )}
          </div>
        </div>

        {/* Painel de CS */}
        <div className="space-y-5">
          {/* Ligações */}
          <CardLigacoes compradorId={id} telefone={contato.telefone} onRegistrado={carregar} />

          {/* Estágio */}
          <Card className="p-4">
            <SectionTitle>Estágio</SectionTitle>
            <select
              value={contato.estagio_chave || ""}
              onChange={(e) => patch({ estagio_chave: e.target.value })}
              className={fieldClass}
            >
              {estagios.map((e) => <option key={e.chave} value={e.chave}>{e.nome}</option>)}
            </select>
            {contato.ultima_resposta_em && (
              <p className="mt-2 text-xs font-medium text-emerald-600 dark:text-emerald-400">
                Última resposta: {fmt(contato.ultima_resposta_em)}
              </p>
            )}
          </Card>

          {/* Próxima ação */}
          <Card className="p-4">
            <SectionTitle>Próxima ação (follow-up)</SectionTitle>
            <input
              type="datetime-local"
              value={proxData}
              onChange={(e) => setProxData(e.target.value)}
              className={fieldClass}
            />
            <input
              placeholder="O que fazer…"
              value={proxNota}
              onChange={(e) => setProxNota(e.target.value)}
              className={cn(fieldClass, "mt-2")}
            />
            <Button
              variant="primary"
              className="mt-3 w-full"
              onClick={() => patch({ proxima_acao_em: proxData, proxima_acao_nota: proxNota })}
            >
              Salvar follow-up
            </Button>
          </Card>

          {/* Observações */}
          <Card className="p-4">
            <SectionTitle>Observações</SectionTitle>
            <textarea
              value={obs}
              onChange={(e) => setObs(e.target.value)}
              rows={3}
              className={fieldClass}
            />
            <Button
              variant="secondary"
              className="mt-3 w-full"
              onClick={() => patch({ observacoes: obs })}
            >
              Salvar observações
            </Button>
          </Card>

          {/* Adicionar nota */}
          <Card className="p-4">
            <SectionTitle>Adicionar nota à timeline</SectionTitle>
            <input
              value={nota}
              onChange={(e) => setNota(e.target.value)}
              placeholder="Ex: ligou pedindo nota fiscal"
              className={fieldClass}
            />
            <Button
              variant="secondary"
              className="mt-3 w-full"
              onClick={async () => { await patch({ nota }); setNota(""); }}
              disabled={!nota.trim()}
            >
              Adicionar nota
            </Button>
          </Card>

          {/* Histórico CS (planilha) */}
          <Card className="p-4">
            <SectionTitle>Histórico CS (planilha)</SectionTitle>
            <div className="space-y-0">
              <LegadoLinha rotulo="Ativado" valor={fmtBool(contato.legado_ativado)} />
              <LegadoLinha rotulo="SLA (h)" valor={contato.legado_sla_h != null ? fmtNum(contato.legado_sla_h) : null} />
              <LegadoLinha rotulo="Ativação" valor={contato.legado_ativacao_em ? fmtData(contato.legado_ativacao_em) : null} />
              <LegadoLinha rotulo="1º contato" valor={contato.primeiro_contato_em ? fmtData(contato.primeiro_contato_em) : null} />
              <LegadoLinha rotulo="No grupo" valor={fmtBool(contato.legado_no_grupo)} />
              <LegadoLinha rotulo="Já HT?" valor={fmtBool(contato.legado_ja_ht)} />
              <LegadoLinha rotulo="Qtd HT" valor={contato.legado_qtd_ht != null ? contato.legado_qtd_ht : null} />
              <LegadoLinha rotulo="Já HM?" valor={fmtBool(contato.legado_ja_hm)} />
              <LegadoLinha rotulo="É aluno?" valor={fmtBool(contato.legado_e_aluno)} />
              <LegadoLinha rotulo="Instrução" valor={contato.legado_instrucao || null} />
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}
