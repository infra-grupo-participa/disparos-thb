"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Button, cn, fieldClass, Spinner } from "@/app/_components/ui";
import { corAvatar, inicial, Avatar } from "@/app/_components/avatar";

// Checkout Hotmart do saldo do HM (R$ 14.700 de 15.000) — oferta 2vibw97m.
// No próprio checkout o cliente escolhe à vista ou parcelado.
const SALDO_CHECKOUT = "https://pay.hotmart.com/L97981750T?off=2vibw97m";
const SALDO_VALOR = "R$ 14.700";

type Contato = {
  comprador_id: string; nome: string; email: string | null; telefone: string | null;
  turma: string | null; plano: string | null; categoria_entrada: string | null;
  estagio_chave: string | null; estagio_nome: string | null; estagio_aba: string | null;
  responsavel: string | null;
  reuniao_em: string | null; reuniao_resultado: string | null;
  entrevista_em: string | null; entrevista_resultado: string | null;
  pagamento_forma: string | null; pagamento_parcelas: number | null; pagamento_em: string | null;
  apto_ativacao: boolean; tags: string[] | null; observacoes: string | null; criado_em: string | null;
};
type Interacao = { tipo: string; descricao: string | null; autor: string | null; criado_em: string };
type Formulario = { tipo: string; respostas: Record<string, string> | null; pontuacao: number | string | null; respondido_em: string | null };
type Estagio = { chave: string; nome: string; aba: string | null };

function fmt(iso: string | null) {
  return iso ? new Date(iso).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "—";
}
// ISO → valor de <input type="datetime-local"> (hora local do navegador).
function toLocalInput(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
function fromLocalInput(v: string): string | null {
  if (!v) return null;
  const d = new Date(v);
  return isNaN(d.getTime()) ? null : d.toISOString();
}

const TL_ICONE: Record<string, { path: string; wrap: string }> = {
  resposta: { path: "M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z", wrap: "bg-emerald-50 text-emerald-600 ring-emerald-200 dark:bg-emerald-500/15 dark:text-emerald-400 dark:ring-emerald-500/30" },
  nota: { path: "M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7 M18.5 2.5a2.1 2.1 0 0 1 3 3L12 15l-4 1 1-4Z", wrap: "bg-amber-50 text-amber-600 ring-amber-200 dark:bg-amber-500/15 dark:text-amber-400 dark:ring-amber-500/30" },
  mudanca_estagio: { path: "M16 3h5v5 M21 3l-7 7 M8 21H3v-5 M3 21l7-7", wrap: "bg-violet-50 text-violet-600 ring-violet-200 dark:bg-violet-500/15 dark:text-violet-400 dark:ring-violet-500/30" },
  sistema: { path: "M13 2 3 14h9l-1 8 10-12h-9l1-8z", wrap: "bg-slate-100 text-slate-500 ring-slate-200 dark:bg-slate-800/60 dark:text-slate-400 dark:ring-slate-700" },
};

export default function HmFichaPage({ params }: { params: { id: string } }) {
  const compradorId = params.id;
  const [c, setC] = useState<Contato | null>(null);
  const [timeline, setTimeline] = useState<Interacao[]>([]);
  const [formularios, setFormularios] = useState<Formulario[]>([]);
  const [estagios, setEstagios] = useState<Estagio[]>([]);
  const [responsaveis, setResponsaveis] = useState<string[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [salvando, setSalvando] = useState(false);
  const [nota, setNota] = useState("");
  const [aba, setAba] = useState<"resumo" | "forms" | "historico">("resumo");
  const [reuniaoLocal, setReuniaoLocal] = useState("");
  const [entrevistaLocal, setEntrevistaLocal] = useState("");
  const [pgForma, setPgForma] = useState<"avista" | "parcelado">("avista");
  const [pgParcelas, setPgParcelas] = useState(12);

  const recarregar = useCallback(async () => {
    const r = await fetch(`/api/hm/contato/${compradorId}`);
    const d = await r.json();
    if (d.ok) {
      setC(d.contato);
      setTimeline(d.timeline ?? []);
      setFormularios(d.formularios ?? []);
      setReuniaoLocal(toLocalInput(d.contato.reuniao_em));
      setEntrevistaLocal(toLocalInput(d.contato.entrevista_em));
    }
    setCarregando(false);
  }, [compradorId]);

  useEffect(() => { recarregar(); }, [recarregar]);
  useEffect(() => {
    fetch("/api/hm/estagios").then((r) => r.json()).then((d) => { if (d.ok) setEstagios(d.estagios); }).catch(() => {});
    fetch("/api/usuarios").then((r) => r.json()).then((d) => { if (d.ok) setResponsaveis(d.usuarios.filter((u: { ativo: boolean }) => u.ativo).map((u: { nome: string }) => u.nome)); }).catch(() => {});
  }, []);

  async function patch(payload: Record<string, unknown>) {
    setSalvando(true);
    try {
      await fetch(`/api/hm/contato/${compradorId}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      await recarregar();
    } finally {
      setSalvando(false);
    }
  }

  if (carregando) return <div className="flex items-center justify-center gap-3 py-24 text-slate-400"><Spinner className="h-6 w-6" /> Carregando ficha…</div>;
  if (!c) return <div className="py-24 text-center text-slate-500">Aluno não encontrado. <Link href="/hm/kanban" className="text-brand underline">Voltar à esteira</Link></div>;

  const tags = c.tags ?? [];
  const jaPagou = !!c.pagamento_em;

  return (
    <div className="mx-auto max-w-3xl">
      <Link href="/hm/kanban" className="mb-4 inline-flex items-center gap-1.5 text-sm text-slate-500 transition hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200">
        <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M19 12H5M12 19l-7-7 7-7" /></svg>
        Esteira HM
      </Link>

      {/* Cabeçalho */}
      <div className="mb-5 flex items-start gap-4 rounded-xl border border-slate-200 bg-white p-5 shadow-card dark:border-slate-800 dark:bg-slate-900">
        <span className={cn("flex h-14 w-14 shrink-0 items-center justify-center rounded-full text-lg font-semibold", corAvatar(c.nome))}>{inicial(c.nome)}</span>
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-xl font-semibold text-slate-900 dark:text-slate-100">{c.nome}</h1>
          <p className="mt-0.5 truncate text-sm text-slate-500 dark:text-slate-400">{c.telefone || "sem telefone"}{c.email ? ` · ${c.email}` : ""}</p>
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            {c.turma && <Badge cls="bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300">{c.turma}</Badge>}
            {c.estagio_nome && <Badge cls="bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300">{c.estagio_nome}</Badge>}
            {c.apto_ativacao && <Badge cls="bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300">Apto para ativação</Badge>}
          </div>
        </div>
        {c.telefone && (
          <a href={`https://wa.me/${c.telefone.replace(/\D/g, "").replace(/^(?!55)/, "55")}`} target="_blank" rel="noreferrer" className="shrink-0">
            <Button variant="secondary" size="sm">WhatsApp</Button>
          </a>
        )}
      </div>

      {/* Abas */}
      <div className="mb-4 flex gap-1 border-b border-slate-200 dark:border-slate-800">
        {([["resumo", "Resumo"], ["forms", `Formulários${formularios.length ? ` (${formularios.length})` : ""}`], ["historico", "Histórico"]] as const).map(([k, label]) => (
          <button key={k} onClick={() => setAba(k)} className={cn("relative px-3 py-2.5 text-sm font-medium transition-colors", aba === k ? "text-brand dark:text-brand-300" : "text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200")}>
            {label}
            {aba === k && <span className="absolute inset-x-2 -bottom-px h-0.5 rounded-full bg-brand dark:bg-brand-400" />}
          </button>
        ))}
      </div>

      {aba === "resumo" && (
        <div className="space-y-5">
          {/* Plano contratado + etapa + responsável */}
          <Secao titulo="Contratação">
            <div className="grid gap-4 sm:grid-cols-2">
              <Campo label="Plano contratado (oferta)">
                <input defaultValue={c.plano ?? ""} onBlur={(e) => e.target.value !== (c.plano ?? "") && patch({ plano: e.target.value })} className={fieldClass} placeholder="Ex.: HM 15k" />
              </Campo>
              <Campo label="Etapa da jornada">
                <select value={c.estagio_chave ?? ""} onChange={(e) => patch({ estagio_chave: e.target.value })} className={fieldClass}>
                  {estagios.map((s) => <option key={s.chave} value={s.chave}>{s.aba === "ativacao" ? "Ativação · " : "Comercial · "}{s.nome}</option>)}
                </select>
              </Campo>
              <Campo label="Responsável (CS)">
                <div className="flex items-center gap-2">
                  {c.responsavel && <Avatar nome={c.responsavel} className="h-8 w-8 text-xs" />}
                  <select value={c.responsavel ?? ""} onChange={(e) => patch({ responsavel: e.target.value || null })} className={fieldClass}>
                    <option value="">— Sem responsável —</option>
                    {c.responsavel && !responsaveis.includes(c.responsavel) && <option value={c.responsavel}>{c.responsavel}</option>}
                    {responsaveis.map((r) => <option key={r} value={r}>{r}</option>)}
                  </select>
                </div>
              </Campo>
              {c.categoria_entrada && (
                <Campo label="Entrada">
                  <p className="pt-2 text-sm text-slate-600 dark:text-slate-300">{c.categoria_entrada === "sinal" ? "Sinalização" : "Compra cheia"}</p>
                </Campo>
              )}
            </div>
          </Secao>

          {/* Pagamento do saldo (14.700) */}
          <Secao titulo={`Pagamento do saldo — ${SALDO_VALOR} (de R$ 15.000)`}>
            {jaPagou ? (
              <div className="flex items-center gap-2 rounded-lg bg-emerald-50 px-3 py-2.5 text-sm font-medium text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300">
                <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5" /></svg>
                Pagamento registrado {c.pagamento_forma === "parcelado" ? `(parcelado${c.pagamento_parcelas ? ` em ${c.pagamento_parcelas}x` : ""})` : "(à vista)"} em {fmt(c.pagamento_em)}
              </div>
            ) : (
              <div className="space-y-3">
                <div className="flex flex-wrap items-end gap-3">
                  <Campo label="Forma">
                    <select value={pgForma} onChange={(e) => setPgForma(e.target.value as "avista" | "parcelado")} className={cn(fieldClass, "w-auto")}>
                      <option value="avista">À vista</option>
                      <option value="parcelado">Parcelado</option>
                    </select>
                  </Campo>
                  {pgForma === "parcelado" && (
                    <Campo label="Parcelas">
                      <input type="number" min={1} max={24} value={pgParcelas} onChange={(e) => setPgParcelas(Number(e.target.value))} className={cn(fieldClass, "w-24")} />
                    </Campo>
                  )}
                  <Button variant="primary" disabled={salvando} onClick={() => patch({ pagamento_forma: pgForma, pagamento_parcelas: pgForma === "parcelado" ? pgParcelas : null, marcar_pagamento: true })}>
                    Registrar pagamento realizado
                  </Button>
                </div>
                <a href={SALDO_CHECKOUT} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 text-sm font-medium text-brand transition hover:underline dark:text-brand-300">
                  <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M15 3h6v6M10 14 21 3M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" /></svg>
                  Abrir checkout do saldo na Hotmart
                </a>
                <p className="text-xs text-slate-400 dark:text-slate-500">Ao registrar, o card vai automaticamente para a Ativação (Entrevista Agendada) marcado como apto.</p>
              </div>
            )}
          </Secao>

          {/* Reunião (Comercial) */}
          <Secao titulo="Reunião comercial">
            <div className="grid gap-4 sm:grid-cols-2">
              <Campo label="Data e hora">
                <div className="flex items-center gap-2">
                  <input type="datetime-local" value={reuniaoLocal} onChange={(e) => setReuniaoLocal(e.target.value)} className={fieldClass} />
                  <Button variant="secondary" size="sm" disabled={salvando} onClick={() => patch({ reuniao_em: fromLocalInput(reuniaoLocal) })}>Salvar</Button>
                </div>
              </Campo>
              <Campo label="Resultado">
                <input defaultValue={c.reuniao_resultado ?? ""} onBlur={(e) => e.target.value !== (c.reuniao_resultado ?? "") && patch({ reuniao_resultado: e.target.value })} className={fieldClass} placeholder="Ex.: interessado, remarcar…" />
              </Campo>
            </div>
          </Secao>

          {/* Entrevista (Ativação) */}
          <Secao titulo="Entrevista de ativação">
            <div className="grid gap-4 sm:grid-cols-2">
              <Campo label="Data e hora">
                <div className="flex items-center gap-2">
                  <input type="datetime-local" value={entrevistaLocal} onChange={(e) => setEntrevistaLocal(e.target.value)} className={fieldClass} />
                  <Button variant="secondary" size="sm" disabled={salvando} onClick={() => patch({ entrevista_em: fromLocalInput(entrevistaLocal) })}>Salvar</Button>
                </div>
              </Campo>
              <Campo label="Resultado">
                <input defaultValue={c.entrevista_resultado ?? ""} onBlur={(e) => e.target.value !== (c.entrevista_resultado ?? "") && patch({ entrevista_resultado: e.target.value })} className={fieldClass} placeholder="Ex.: aprovado, pendências…" />
              </Campo>
            </div>
          </Secao>

          {/* Tags + observações + nota */}
          <Secao titulo="Anotações">
            <div className="space-y-3">
              <div className="flex flex-wrap items-center gap-1.5">
                {tags.map((t) => (
                  <span key={t} className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                    {t}
                    <button onClick={() => patch({ tags: tags.filter((x) => x !== t) })} className="opacity-60 hover:opacity-100">×</button>
                  </span>
                ))}
                <input
                  placeholder="+ tag"
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      const v = (e.target as HTMLInputElement).value.trim();
                      if (v && !tags.includes(v)) { patch({ tags: [...tags, v] }); (e.target as HTMLInputElement).value = ""; }
                    }
                  }}
                  className="w-20 rounded-full border border-dashed border-slate-300 bg-transparent px-2 py-0.5 text-xs outline-none placeholder:text-slate-400 focus:border-brand dark:border-slate-600 dark:text-slate-200"
                />
              </div>
              <textarea defaultValue={c.observacoes ?? ""} onBlur={(e) => e.target.value !== (c.observacoes ?? "") && patch({ observacoes: e.target.value })} rows={2} className={fieldClass} placeholder="Observações internas…" />
              <div className="flex items-end gap-2">
                <textarea value={nota} onChange={(e) => setNota(e.target.value)} rows={2} className={fieldClass} placeholder="Adicionar nota à timeline…" />
                <Button variant="secondary" disabled={!nota.trim() || salvando} onClick={() => { patch({ nota }); setNota(""); }}>Anotar</Button>
              </div>
            </div>
          </Secao>
        </div>
      )}

      {aba === "forms" && (
        formularios.length === 0 ? (
          <p className="py-4 text-sm text-slate-400 dark:text-slate-500">Nenhum formulário respondido (Respondi) por este aluno ainda.</p>
        ) : (
          <div className="space-y-4">
            {formularios.map((f, i) => {
              const respostas = f.respostas && typeof f.respostas === "object" ? Object.entries(f.respostas) : [];
              return (
                <div key={i} className="rounded-lg border border-slate-200 p-4 dark:border-slate-800">
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <h4 className="text-sm font-semibold text-slate-800 dark:text-slate-100">{f.tipo}</h4>
                    {f.pontuacao != null && f.pontuacao !== "" && <span className="rounded-full bg-brand/10 px-2 py-0.5 text-xs font-semibold text-brand dark:bg-brand-400/15 dark:text-brand-300">{f.pontuacao} pts</span>}
                  </div>
                  <dl className="space-y-2">
                    {respostas.map(([q, a]) => (
                      <div key={q}>
                        <dt className="text-xs text-slate-400 dark:text-slate-500">{q}</dt>
                        <dd className="text-sm font-medium text-slate-700 dark:text-slate-200">{String(a).trim() || "—"}</dd>
                      </div>
                    ))}
                    {respostas.length === 0 && <p className="text-sm text-slate-400">Sem respostas.</p>}
                  </dl>
                  {f.respondido_em && <p className="mt-3 border-t border-slate-100 pt-2 text-xs text-slate-400 dark:border-slate-800 dark:text-slate-500">Respondido em {fmt(f.respondido_em)}</p>}
                </div>
              );
            })}
          </div>
        )
      )}

      {aba === "historico" && (
        timeline.length === 0 ? (
          <p className="py-4 text-sm text-slate-400 dark:text-slate-500">Sem interações ainda.</p>
        ) : (
          <ul className="space-y-3">
            {timeline.slice(0, 100).map((it, i) => {
              const ic = TL_ICONE[it.tipo] || TL_ICONE.sistema;
              return (
                <li key={i} className="flex gap-2.5">
                  <span className={cn("flex h-7 w-7 shrink-0 items-center justify-center rounded-full ring-1 ring-inset", ic.wrap)}>
                    <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d={ic.path} /></svg>
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm text-slate-700 dark:text-slate-200">{it.descricao || it.tipo}</p>
                    <p className="text-[11px] tabular-nums text-slate-400 dark:text-slate-500">{fmt(it.criado_em)}{it.autor ? ` · ${it.autor}` : ""}</p>
                  </div>
                </li>
              );
            })}
          </ul>
        )
      )}
    </div>
  );
}

function Secao({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-card dark:border-slate-800 dark:bg-slate-900">
      <h3 className="mb-3 text-sm font-semibold text-slate-800 dark:text-slate-100">{titulo}</h3>
      {children}
    </section>
  );
}
function Campo({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">{label}</label>
      {children}
    </div>
  );
}
function Badge({ cls, children }: { cls: string; children: React.ReactNode }) {
  return <span className={cn("inline-flex items-center rounded px-1.5 py-0.5 text-[11px] font-semibold", cls)}>{children}</span>;
}
