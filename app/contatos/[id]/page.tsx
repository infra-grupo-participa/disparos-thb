"use client";

import type React from "react";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { EdicaoBadge } from "@/app/_components/edicao-badge";
import { Button, Card, Spinner, cn, fieldClass } from "@/app/_components/ui";

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
};
type Interacao = { tipo: string; descricao: string | null; autor: string | null; criado_em: string };

const ICONE_TL: Record<string, { path: string; wrap: string }> = {
  disparo: { path: "m22 2-7 20-4-9-9-4Z M22 2 11 13", wrap: "bg-blue-50 text-blue-600 ring-blue-200 dark:bg-blue-500/15 dark:text-blue-400 dark:ring-blue-500/30" },
  resposta: { path: "M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z", wrap: "bg-emerald-50 text-emerald-600 ring-emerald-200 dark:bg-emerald-500/15 dark:text-emerald-400 dark:ring-emerald-500/30" },
  nota: { path: "M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7 M18.5 2.5a2.1 2.1 0 0 1 3 3L12 15l-4 1 1-4Z", wrap: "bg-amber-50 text-amber-600 ring-amber-200 dark:bg-amber-500/15 dark:text-amber-400 dark:ring-amber-500/30" },
  mudanca_estagio: { path: "M16 3h5v5 M21 3l-7 7 M8 21H3v-5 M3 21l7-7", wrap: "bg-violet-50 text-violet-600 ring-violet-200 dark:bg-violet-500/15 dark:text-violet-400 dark:ring-violet-500/30" },
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

export default function ContatoDetalhe({ params }: { params: { id: string } }) {
  const id = params.id;
  const [estagios, setEstagios] = useState<Estagio[]>([]);
  const [contato, setContato] = useState<Contato | null>(null);
  const [timeline, setTimeline] = useState<Interacao[]>([]);
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
      setObs(d.contato.observacoes || "");
      setProxNota(d.contato.proxima_acao_nota || "");
      setProxData(d.contato.proxima_acao_em ? d.contato.proxima_acao_em.slice(0, 16) : "");
    }
  }, [id]);

  useEffect(() => {
    fetch("/api/estagios").then((r) => r.json()).then((d) => d.ok && setEstagios(d.estagios)).catch(() => {});
    carregar();
  }, [carregar]);

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
      <Link href="/contatos" className="text-sm text-slate-500 transition-colors hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200">
        ← Contatos
      </Link>

      {/* Cabeçalho do contato */}
      <Card className="mt-2 p-5">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900 dark:text-slate-100">{contato.nome}</h1>
          <EdicaoBadge edicao={contato.edicao_ht ?? contato.edicao} />
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-slate-500 dark:text-slate-400">
          <span className="inline-flex items-center gap-1.5">
            <span className="text-slate-400 dark:text-slate-500">E-mail:</span>{contato.email}
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="text-slate-400 dark:text-slate-500">Telefone:</span>
            {contato.telefone || <span className="text-rose-500 dark:text-rose-400">sem telefone</span>}
          </span>
        </div>
      </Card>

      <div className="mt-6 grid gap-6 lg:grid-cols-[1fr_380px]">
        {/* Coluna principal — Timeline */}
        <div>
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
