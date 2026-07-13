"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Button, cn, fieldClass, Spinner } from "@/app/_components/ui";
import { corAvatar, inicial, Avatar } from "@/app/_components/avatar";
import { DisparoModal } from "@/app/_components/disparo";
import { TagChip } from "@/app/_components/tags";
import { useMe } from "@/app/_components/use-me";

const SALDO_CHECKOUT = "https://pay.hotmart.com/L97981750T?off=2vibw97m";

type Estagio = { chave: string; nome: string; aba: string | null };
type Contato = {
  comprador_id: string; nome: string; email: string | null; telefone: string | null;
  turma: string | null; turma_origem: string | null; plano: string | null; categoria_entrada: string | null;
  estagio_chave: string | null; estagio_nome: string | null; estagio_aba: string | null; responsavel: string | null;
  reuniao_em: string | null; reuniao_resultado: string | null;
  entrevista_em: string | null; entrevista_resultado: string | null;
  pagamento_em: string | null; pagamento_forma: string | null; apto_ativacao: boolean; tags: string[] | null;
  // acordo do saldo
  pagamento_meio: string | null; pagamento_previsto_em: string | null; acordo: string | null;
  oferta_saldo_codigo: string | null; link_saldo_enviado_em: string | null;
  // travas
  nao_contatar: boolean; nao_contatar_motivo: string | null;
  revisar: boolean; revisar_motivo: string | null;
  // ativação
  ativ_searchie: boolean; ativ_comunidade: boolean; ativ_grupo: boolean; ativ_pesquisa: boolean;
  grupo_informes: string | null; pendencia: string | null; link_facebook: string | null;
  cancelamento_em: string | null; cancelamento_motivo: string | null;
};
type Interacao = { tipo: string; descricao: string | null; autor: string | null; criado_em: string };
// numeric do Postgres chega como string no driver pg — normalize antes de somar.
type Financeiro = {
  valor_total: string | null; valor_pago: string | null; aluno_id: string | null;
  categoria_entrada: string | null; sugestao_valor_total: string | null; hotmart_bruto: string | null;
};
type Prorata = {
  dias_usados: number; dias_restantes: number; valor_dia: string | null;
  consumido: string | null; credito: string | null; saldo_a_pagar: string | null;
};
type LinkSaldo = { codigo: string; valor: string; recorrente: boolean; link: string };
// O sócio tem checklist próprio — ele também é ativado, pendurado no titular.
// `aluno_id` preenchido = já foi provisionado na base THB.
type Socio = {
  id: string; nome: string; email: string | null; telefone: string | null; link_facebook: string | null;
  ativ_searchie: boolean; ativ_comunidade: boolean; ativ_grupo: boolean; aluno_id: string | null;
};

// Resultado da reunião comercial — os mesmos estados que a planilha usava, agora
// como campo (e não texto solto misturado com a data).
const RESULTADOS = ["Aguardando retorno", "Agendada", "Realizada", "Realizada/pago", "Reagendar", "Não respondeu"];

const MEIOS: { v: string; label: string }[] = [
  { v: "avista", label: "À vista" },
  { v: "pix", label: "Pix" },
  { v: "boleto", label: "Boleto parcelado" },
  { v: "cartao", label: "Cartão" },
  { v: "cartao_recorrente", label: "Cartão recorrente" },
];

const ITENS_CHECKLIST: { campo: keyof Contato; label: string }[] = [
  { campo: "ativ_searchie", label: "Acesso ao Searchie/Óbvio" },
  { campo: "ativ_comunidade", label: "Acesso à comunidade THB" },
  { campo: "ativ_grupo", label: "Grupo de informes" },
  { campo: "ativ_pesquisa", label: "Pesquisa" },
];

function num(v: string | number | null | undefined): number {
  const n = typeof v === "string" ? Number(v) : v ?? 0;
  return Number.isFinite(n) ? (n as number) : 0;
}
function brl(v: number): string {
  return v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function fmt(iso: string | null) {
  return iso ? new Date(iso).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) : "—";
}
function toLocalInput(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}
function fromLocalInput(v: string): string | null {
  if (!v) return null;
  const d = new Date(v);
  return isNaN(d.getTime()) ? null : d.toISOString();
}

// Painel rápido do card: mover etapa, agendar, pagamento e responsável sem sair
// do board. Edições persistem via /api/hm/contato/[id] e recarregam o board.
export function HmDrawer({
  compradorId, estagios, responsaveis, onClose, onChanged,
}: {
  compradorId: string; estagios: Estagio[]; responsaveis: string[];
  onClose: () => void; onChanged: () => void;
}) {
  const { me, podeDisparar } = useMe();
  const [c, setC] = useState<Contato | null>(null);
  const [timeline, setTimeline] = useState<Interacao[]>([]);
  const [salvando, setSalvando] = useState(false);
  const [reuniao, setReuniao] = useState("");
  const [entrevista, setEntrevista] = useState("");
  const [nota, setNota] = useState("");
  const [confirmarPagto, setConfirmarPagto] = useState(false);
  const [disparar, setDisparar] = useState(false);
  const [fin, setFin] = useState<Financeiro | null>(null);
  const [forma, setForma] = useState<"avista" | "parcelado">("avista");
  const [parcelas, setParcelas] = useState("12");
  const [valorTotal, setValorTotal] = useState("");
  const [valorPago, setValorPago] = useState("");
  // acordo do saldo + ativação (rascunho local; só grava no OK/blur)
  const [prorata, setProrata] = useState<Prorata | null>(null);
  const [links, setLinks] = useState<LinkSaldo[]>([]);
  const [acordo, setAcordo] = useState("");
  const [previsao, setPrevisao] = useState("");
  const [pendencia, setPendencia] = useState("");
  const [grupo, setGrupo] = useState("");
  const [copiado, setCopiado] = useState(false);
  const [socios, setSocios] = useState<Socio[]>([]);
  const [novoSocio, setNovoSocio] = useState({ nome: "", email: "", telefone: "" });

  const recarregar = useCallback(async () => {
    const r = await fetch(`/api/hm/contato/${compradorId}`);
    const d = await r.json();
    if (d.ok) {
      setC(d.contato);
      setTimeline(d.timeline ?? []);
      setReuniao(toLocalInput(d.contato.reuniao_em));
      setEntrevista(toLocalInput(d.contato.entrevista_em));
      setFin(d.financeiro ?? null);
      setProrata(d.prorata ?? null);
      setLinks(d.linksSaldo ?? []);
      setSocios(d.socios ?? []);
      setAcordo(d.contato.acordo ?? "");
      setPrevisao(d.contato.pagamento_previsto_em?.slice(0, 10) ?? "");
      setPendencia(d.contato.pendencia ?? "");
      setGrupo(d.contato.grupo_informes ?? "");
      // Pré-preenche o formulário de pagamento com a sugestão do servidor
      // (15.000 para quem entrou pelo sinal). À vista => pago = total.
      const sugestao = num(d.financeiro?.valor_total) || num(d.financeiro?.sugestao_valor_total);
      if (sugestao > 0) {
        setValorTotal(String(sugestao));
        setValorPago(String(num(d.financeiro?.valor_pago) || sugestao));
      }
    }
  }, [compradorId]);
  useEffect(() => { setC(null); recarregar(); }, [recarregar]);

  async function patch(payload: Record<string, unknown>) {
    setSalvando(true);
    try {
      await fetch(`/api/hm/contato/${compradorId}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      await recarregar();
      onChanged();
    } finally {
      setSalvando(false);
    }
  }

  // Sócios: rota própria porque o sócio é um registro (com checklist), não um
  // campo do card. Se o titular já é aluno, gravar um sócio o leva junto para a base.
  async function socioReq(method: "POST" | "PATCH" | "DELETE", body?: Record<string, unknown>, socioId?: string) {
    setSalvando(true);
    try {
      const url = `/api/hm/contato/${compradorId}/socios${socioId ? `?socioId=${socioId}` : ""}`;
      await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: body ? JSON.stringify(body) : undefined,
      });
      await recarregar();
      onChanged();
    } finally {
      setSalvando(false);
    }
  }

  const jaPagou = !!c?.pagamento_em;
  const temHistorico = timeline.some((it) => it.tipo === "mudanca_estagio");
  const feitos = c ? ITENS_CHECKLIST.filter((i) => !!c[i.campo]).length : 0;

  async function reverter() {
    await patch({ reverter: true });
  }

  return (
    <>
      <div className="fixed inset-0 z-40 bg-slate-900/40 backdrop-blur-sm" onClick={onClose} />
      <aside className="fixed inset-y-0 right-0 z-50 flex w-full max-w-md flex-col overflow-hidden border-l border-slate-200 bg-white shadow-pop animate-fade-in dark:border-slate-800 dark:bg-slate-900">
        {!c ? (
          <div className="flex flex-1 items-center justify-center gap-2 text-sm text-slate-400"><Spinner className="h-5 w-5" /> Carregando…</div>
        ) : (
          <>
            <div className="flex items-start gap-3 border-b border-slate-100 p-5 dark:border-slate-800">
              <span className={cn("flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-base font-semibold", corAvatar(c.nome))}>{inicial(c.nome)}</span>
              <div className="min-w-0 flex-1">
                <h2 className="truncate text-lg font-semibold text-slate-900 dark:text-slate-100">{c.nome}</h2>
                <p className="truncate text-xs text-slate-500 dark:text-slate-400">{c.telefone || "sem telefone"}{c.turma ? ` · ${c.turma}` : ""}</p>
                {c.plano && <p className="mt-0.5 truncate text-xs text-slate-400 dark:text-slate-500">{c.plano}</p>}
                {c.tags && c.tags.length > 0 && (
                  <div className="mt-1.5 flex flex-wrap gap-1">
                    {c.tags.map((t) => <TagChip key={t} tag={t} mini />)}
                  </div>
                )}
              </div>
              <button onClick={onClose} className="rounded-lg p-1.5 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800 dark:hover:text-slate-200">
                <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M18 6 6 18M6 6l12 12" /></svg>
              </button>
            </div>

            <div className="flex-1 space-y-4 overflow-y-auto p-5">
              {/* Travas primeiro: quem abre a ficha para ligar precisa ver isto
                  ANTES de qualquer outra coisa — era o "NÃO ENTRAR EM CONTATO NO
                  MOMENTO" que vivia perdido na coluna de observações da planilha. */}
              {c.nao_contatar && (
                <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 dark:border-rose-500/30 dark:bg-rose-500/10">
                  <p className="flex items-center gap-2 text-sm font-semibold text-rose-700 dark:text-rose-300">
                    <svg className="h-4 w-4 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="12" cy="12" r="10" /><path d="m4.9 4.9 14.2 14.2" /></svg>
                    Não entrar em contato
                  </p>
                  {c.nao_contatar_motivo && <p className="mt-0.5 text-xs text-rose-600 dark:text-rose-400">{c.nao_contatar_motivo}</p>}
                </div>
              )}
              {c.revisar && (
                <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 dark:border-amber-500/30 dark:bg-amber-500/10">
                  <p className="flex items-center gap-2 text-sm font-semibold text-amber-800 dark:text-amber-300">
                    <svg className="h-4 w-4 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M12 9v4M12 17h.01" /><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z" /></svg>
                    Revisar antes de tratar
                  </p>
                  {c.revisar_motivo && <p className="mt-0.5 text-xs text-amber-700 dark:text-amber-400">{c.revisar_motivo}</p>}
                </div>
              )}

              {c.apto_ativacao && (
                <div className="flex items-center gap-2 rounded-lg bg-emerald-50 px-3 py-2 text-sm font-medium text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300">
                  <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5" /></svg>
                  Pagamento do saldo confirmado{c.pagamento_em ? ` · pago ${fmt(c.pagamento_em)}` : ""}
                </div>
              )}

              <Campo label="Etapa">
                <select value={c.estagio_chave ?? ""} onChange={(e) => patch({ estagio_chave: e.target.value })} className={fieldClass} disabled={salvando}>
                  {estagios.map((s) => <option key={s.chave} value={s.chave}>{s.aba === "ativacao" ? "Ativação · " : "Comercial · "}{s.nome}</option>)}
                </select>
                {temHistorico && (
                  <button
                    type="button"
                    onClick={reverter}
                    disabled={salvando}
                    className="mt-1.5 inline-flex items-center gap-1.5 text-xs font-medium text-slate-500 transition hover:text-brand disabled:opacity-50 dark:text-slate-400 dark:hover:text-brand-300"
                    title="Desfazer o último movimento de etapa (miss click)"
                  >
                    <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 14 4 9l5-5" /><path d="M4 9h11a5 5 0 0 1 0 10h-1" /></svg>
                    Voltar ao estágio anterior
                  </button>
                )}
              </Campo>

              {/* Turma no HM: a atual do programa (T39) vem sozinha ao pagar.
                  O campo existe para a exceção — alguém que entra em outra turma. */}
              <Campo label="Turma no HM">
                <div className="flex items-center gap-2">
                  <input
                    defaultValue={c.turma ?? ""}
                    onBlur={(e) => { if (e.target.value.trim() && e.target.value !== (c.turma ?? "")) patch({ turma: e.target.value.trim() }); }}
                    placeholder="T39"
                    className={fieldClass}
                  />
                  {c.turma_origem && (
                    <span className="shrink-0 rounded bg-slate-100 px-2 py-1 text-[11px] font-medium text-slate-500 dark:bg-slate-800 dark:text-slate-400" title="Turma de onde ele veio">
                      veio da {c.turma_origem}
                    </span>
                  )}
                </div>
              </Campo>

              <Campo label="Responsável (CS)">
                <div className="flex items-center gap-2">
                  {c.responsavel && <Avatar nome={c.responsavel} className="h-8 w-8 text-xs" />}
                  <select value={c.responsavel ?? ""} onChange={(e) => patch({ responsavel: e.target.value || null })} className={fieldClass} disabled={salvando}>
                    <option value="">— Sem responsável —</option>
                    {c.responsavel && !responsaveis.includes(c.responsavel) && <option value={c.responsavel}>{c.responsavel}</option>}
                    {responsaveis.map((r) => <option key={r} value={r}>{r}</option>)}
                  </select>
                </div>
                {me?.nome && c.responsavel !== me.nome && (
                  <button
                    type="button"
                    onClick={() => patch({ responsavel: me.nome })}
                    disabled={salvando}
                    className="mt-1.5 inline-flex items-center gap-1.5 text-xs font-medium text-brand transition hover:underline disabled:opacity-50 dark:text-brand-300"
                    title={c.responsavel ? `Assumir de ${c.responsavel}` : "Assumir este aluno"}
                  >
                    <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M19 8v6M22 11h-6" /></svg>
                    {c.responsavel ? "Assumir para mim" : "Atribuir a mim"}
                  </button>
                )}
              </Campo>

              <Campo label="Reunião comercial (data e hora)">
                <div className="flex items-center gap-2">
                  <input type="datetime-local" value={reuniao} onChange={(e) => setReuniao(e.target.value)} className={fieldClass} />
                  <Button variant="secondary" size="sm" disabled={salvando} onClick={() => patch({ reuniao_em: fromLocalInput(reuniao) })}>OK</Button>
                </div>
                <select
                  value={c.reuniao_resultado ?? ""}
                  onChange={(e) => patch({ reuniao_resultado: e.target.value || null })}
                  className={cn(fieldClass, "mt-1.5")}
                  disabled={salvando}
                >
                  <option value="">— Status da reunião —</option>
                  {RESULTADOS.map((r) => <option key={r} value={r}>{r}</option>)}
                </select>
              </Campo>

              {/* ACORDO DO SALDO — o gargalo. Na planilha isto era "Como vai pagar
                  o saldo restante?" + "Link enviado" + "pagamento agendado 17/07",
                  três colunas de texto solto que ninguém conseguia filtrar. */}
              <div className="rounded-lg border border-slate-200 p-3 dark:border-slate-800">
                <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">
                  {jaPagou ? "Acordo do saldo (histórico)" : "Acordo do saldo"}
                </p>

                {/* Saldo e link só para quem ainda deve. Para quem já quitou, o
                    pró-rata é história: mostrar "saldo a pagar" seria mentir. */}
                {jaPagou ? (
                  <p className="mb-2 rounded bg-emerald-50 px-2 py-1.5 text-[11px] font-medium text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300">
                    Saldo quitado{c.pagamento_em ? ` em ${fmt(c.pagamento_em)}` : ""}.
                  </p>
                ) : prorata?.saldo_a_pagar ? (
                  <p className="mb-2 rounded bg-slate-50 px-2 py-1.5 text-[11px] text-slate-600 dark:bg-slate-800/60 dark:text-slate-300">
                    Crédito pró-rata: <strong>{brl(num(prorata.credito))}</strong> ({prorata.dias_restantes} dias não usados)
                    {" · "}saldo a pagar: <strong>{brl(num(prorata.saldo_a_pagar))}</strong>
                    <br />
                    <span className="text-slate-400 dark:text-slate-500">
                      O crédito encolhe a cada dia — o valor vale para hoje.
                    </span>
                  </p>
                ) : (
                  <p className="mb-2 text-[11px] text-slate-400 dark:text-slate-500">Saldo cheio: {brl(14700)}</p>
                )}

                <div className="grid grid-cols-2 gap-2">
                  <label className="text-[11px] font-medium text-slate-500 dark:text-slate-400">
                    Como vai pagar
                    <select
                      value={c.pagamento_meio ?? ""}
                      onChange={(e) => patch({ pagamento_meio: e.target.value || null })}
                      className={fieldClass}
                      disabled={salvando}
                    >
                      <option value="">— a combinar —</option>
                      {MEIOS.map((m) => <option key={m.v} value={m.v}>{m.label}</option>)}
                    </select>
                  </label>
                  <label className="text-[11px] font-medium text-slate-500 dark:text-slate-400">
                    Previsão de pagamento
                    <input
                      type="date"
                      value={previsao}
                      onChange={(e) => setPrevisao(e.target.value)}
                      onBlur={() => patch({ pagamento_previsto_em: previsao || null })}
                      className={fieldClass}
                    />
                  </label>
                </div>

                <label className="mt-2 block text-[11px] font-medium text-slate-500 dark:text-slate-400">
                  O combinado
                  <textarea
                    value={acordo}
                    onChange={(e) => setAcordo(e.target.value)}
                    onBlur={() => patch({ acordo: acordo || null })}
                    rows={2}
                    placeholder="12x no boleto, primeira parcela dia 15…"
                    className={fieldClass}
                  />
                </label>

                {/* Link de saldo: o sistema escolhe pelo valor (cada saldo tem sua
                    própria oferta na Hotmart) — antes isso era procurado à mão.
                    Some depois de quitado: não há mais o que cobrar. */}
                {!jaPagou && links.length > 0 && (
                  <div className="mt-2">
                    <p className="mb-1 text-[11px] font-medium text-slate-500 dark:text-slate-400">Link do saldo (sugerido pelo valor)</p>
                    <div className="flex flex-wrap items-center gap-1.5">
                      {links.map((l) => (
                        <button
                          key={l.codigo}
                          type="button"
                          onClick={async () => {
                            await navigator.clipboard.writeText(l.link);
                            setCopiado(true);
                            setTimeout(() => setCopiado(false), 1500);
                            patch({ oferta_saldo_codigo: l.codigo, link_saldo_enviado: true });
                          }}
                          className={cn(
                            "rounded-md border px-2 py-1 text-[11px] font-medium transition",
                            c.oferta_saldo_codigo === l.codigo
                              ? "border-brand bg-brand/10 text-brand dark:border-brand-400 dark:text-brand-300"
                              : "border-slate-200 text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800",
                          )}
                          title={`Copiar link e marcar como enviado — ${l.link}`}
                        >
                          {brl(num(l.valor))} {l.recorrente ? "recorrente" : "à vista"}
                        </button>
                      ))}
                    </div>
                    <p className="mt-1 text-[11px] text-slate-400 dark:text-slate-500">
                      {copiado
                        ? "Link copiado."
                        : c.link_saldo_enviado_em
                          ? `Link enviado em ${fmt(c.link_saldo_enviado_em)}`
                          : "Clique para copiar e marcar como enviado."}
                    </p>
                  </div>
                )}
              </div>

              <Campo label="Entrevista de ativação (data e hora)">
                <div className="flex items-center gap-2">
                  <input type="datetime-local" value={entrevista} onChange={(e) => setEntrevista(e.target.value)} className={fieldClass} />
                  <Button variant="secondary" size="sm" disabled={salvando} onClick={() => patch({ entrevista_em: fromLocalInput(entrevista) })}>OK</Button>
                </div>
              </Campo>

              {/* CHECKLIST DE ATIVAÇÃO — as 4 colunas TRUE/FALSE da planilha.
                  Juntas elas SÃO "ativado", e por isso travam a saída de
                  "Acesso Liberado" (o servidor recusa e diz o que falta). */}
              <div className="rounded-lg border border-slate-200 p-3 dark:border-slate-800">
                <div className="mb-2 flex items-center justify-between">
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">Checklist de ativação</p>
                  <span className={cn(
                    "rounded-full px-2 py-0.5 text-[11px] font-semibold tabular-nums",
                    feitos === ITENS_CHECKLIST.length
                      ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300"
                      : "bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400",
                  )}>
                    {feitos}/{ITENS_CHECKLIST.length}
                  </span>
                </div>

                <div className="space-y-1.5">
                  {ITENS_CHECKLIST.map((item) => (
                    <label key={item.campo} className="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-200">
                      <input
                        type="checkbox"
                        checked={!!c[item.campo]}
                        disabled={salvando}
                        onChange={(e) => patch({ [item.campo]: e.target.checked })}
                        className="h-4 w-4 rounded border-slate-300 text-brand focus:ring-brand dark:border-slate-600"
                      />
                      {item.label}
                    </label>
                  ))}
                </div>

                <label className="mt-2 block text-[11px] font-medium text-slate-500 dark:text-slate-400">
                  Qual grupo de informes
                  <input
                    value={grupo}
                    onChange={(e) => setGrupo(e.target.value)}
                    onBlur={() => patch({ grupo_informes: grupo || null })}
                    placeholder="THB #27"
                    className={fieldClass}
                  />
                </label>

                <label className="mt-2 block text-[11px] font-medium text-slate-500 dark:text-slate-400">
                  O que está pendente para conclusão
                  <textarea
                    value={pendencia}
                    onChange={(e) => setPendencia(e.target.value)}
                    onBlur={() => patch({ pendencia: pendencia || null })}
                    rows={2}
                    className={fieldClass}
                  />
                </label>

                <label className="mt-2 block text-[11px] font-medium text-slate-500 dark:text-slate-400">
                  Link do Facebook
                  <input
                    defaultValue={c.link_facebook ?? ""}
                    onBlur={(e) => { if (e.target.value !== (c.link_facebook ?? "")) patch({ link_facebook: e.target.value || null }); }}
                    placeholder="https://facebook.com/groups/…"
                    className={fieldClass}
                  />
                </label>
              </div>

              {/* SÓCIOS — a aba "SÓCIOS T39". O sócio é ativado também (tem o
                  próprio checklist) e, quando o titular vira aluno, ele vai junto
                  para a base: mesma turma, mesma validade, vinculado a ele. */}
              <div className="rounded-lg border border-slate-200 p-3 dark:border-slate-800">
                <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">
                  Sócios convidados{socios.length > 0 ? ` (${socios.length})` : ""}
                </p>

                {socios.map((s) => (
                  <div key={s.id} className="mb-2 rounded-md border border-slate-100 p-2 dark:border-slate-800">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold text-slate-800 dark:text-slate-100">{s.nome}</p>
                        <p className="truncate text-[11px] text-slate-400 dark:text-slate-500">
                          {[s.email, s.telefone].filter(Boolean).join(" · ") || "sem contato"}
                        </p>
                      </div>
                      <div className="flex shrink-0 items-center gap-1">
                        {s.aluno_id && (
                          <span className="rounded bg-emerald-100 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300" title="Já está na base de alunos">
                            na base
                          </span>
                        )}
                        <button
                          type="button"
                          disabled={salvando}
                          onClick={() => { if (window.confirm(`Remover o sócio ${s.nome} deste card?`)) socioReq("DELETE", undefined, s.id); }}
                          className="rounded p-1 text-slate-400 transition hover:bg-rose-50 hover:text-rose-600 dark:hover:bg-rose-500/10"
                          title="Remover sócio"
                        >
                          <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M18 6 6 18M6 6l12 12" /></svg>
                        </button>
                      </div>
                    </div>

                    <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1">
                      {([
                        ["ativ_searchie", "Searchie"],
                        ["ativ_comunidade", "Comunidade"],
                        ["ativ_grupo", "Grupo"],
                      ] as const).map(([campo, label]) => (
                        <label key={campo} className="flex items-center gap-1.5 text-[11px] text-slate-600 dark:text-slate-300">
                          <input
                            type="checkbox"
                            checked={s[campo]}
                            disabled={salvando}
                            onChange={(e) => socioReq("PATCH", { socioId: s.id, [campo]: e.target.checked })}
                            className="h-3.5 w-3.5 rounded border-slate-300 text-brand focus:ring-brand dark:border-slate-600"
                          />
                          {label}
                        </label>
                      ))}
                    </div>

                    <input
                      defaultValue={s.link_facebook ?? ""}
                      onBlur={(e) => { if (e.target.value !== (s.link_facebook ?? "")) socioReq("PATCH", { socioId: s.id, link_facebook: e.target.value || null }); }}
                      placeholder="Link do Facebook do sócio"
                      className={cn(fieldClass, "mt-1.5 text-[11px]")}
                    />
                  </div>
                ))}

                <div className="grid grid-cols-3 gap-1.5">
                  <input
                    value={novoSocio.nome}
                    onChange={(e) => setNovoSocio({ ...novoSocio, nome: e.target.value })}
                    placeholder="Nome do sócio"
                    className={cn(fieldClass, "text-[11px]")}
                  />
                  <input
                    value={novoSocio.email}
                    onChange={(e) => setNovoSocio({ ...novoSocio, email: e.target.value })}
                    placeholder="E-mail"
                    className={cn(fieldClass, "text-[11px]")}
                  />
                  <input
                    value={novoSocio.telefone}
                    onChange={(e) => setNovoSocio({ ...novoSocio, telefone: e.target.value })}
                    placeholder="Telefone"
                    className={cn(fieldClass, "text-[11px]")}
                  />
                </div>
                <Button
                  variant="secondary"
                  size="sm"
                  className="mt-1.5"
                  disabled={salvando || novoSocio.nome.trim().length < 2}
                  onClick={async () => {
                    await socioReq("POST", {
                      nome: novoSocio.nome.trim(),
                      email: novoSocio.email.trim() || null,
                      telefone: novoSocio.telefone.trim() || null,
                    });
                    setNovoSocio({ nome: "", email: "", telefone: "" });
                  }}
                >
                  Adicionar sócio
                </Button>
              </div>

              {!jaPagou && (
                <div className="rounded-lg border border-amber-200 bg-amber-50/60 p-3 dark:border-amber-500/30 dark:bg-amber-500/10">
                  <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-amber-700 dark:text-amber-300">Saldo — R$ 14.700</p>
                  {confirmarPagto ? (
                    <div>
                      <p className="mb-2 text-xs text-amber-800 dark:text-amber-200">
                        O card vai para a <strong>Ativação</strong> (Pendente de Liberação) e o aluno é criado/atualizado na
                        <strong> base THB</strong> com os valores abaixo.
                        {c.turma_origem
                          ? ` Ele é aluno da ${c.turma_origem} — mantém a turma e o acesso é renovado por 1 ano.`
                          : " Lead novo — entra na turma atual (T39)."}
                      </p>

                      <div className="mb-2 grid grid-cols-2 gap-2">
                        <label className="text-[11px] font-medium text-amber-800 dark:text-amber-200">
                          Valor total
                          <input type="number" min="0" step="0.01" value={valorTotal}
                            onChange={(e) => {
                              setValorTotal(e.target.value);
                              if (forma === "avista") setValorPago(e.target.value);
                            }}
                            className={fieldClass} />
                        </label>
                        <label className="text-[11px] font-medium text-amber-800 dark:text-amber-200">
                          Valor já pago
                          <input type="number" min="0" step="0.01" value={valorPago}
                            onChange={(e) => setValorPago(e.target.value)} className={fieldClass} />
                        </label>
                        <label className="text-[11px] font-medium text-amber-800 dark:text-amber-200">
                          Forma
                          <select value={forma} className={fieldClass}
                            onChange={(e) => {
                              const f = e.target.value as "avista" | "parcelado";
                              setForma(f);
                              if (f === "avista") setValorPago(valorTotal);
                            }}>
                            <option value="avista">À vista (quitado)</option>
                            <option value="parcelado">Parcelado</option>
                          </select>
                        </label>
                        {forma === "parcelado" && (
                          <label className="text-[11px] font-medium text-amber-800 dark:text-amber-200">
                            Parcelas
                            <input type="number" min="1" max="24" value={parcelas}
                              onChange={(e) => setParcelas(e.target.value)} className={fieldClass} />
                          </label>
                        )}
                      </div>

                      <p className="mb-2 text-[11px] text-amber-800 dark:text-amber-200">
                        Saldo devedor: <strong>{brl(Math.max(num(valorTotal) - num(valorPago), 0))}</strong>
                        {" · "}situação: <strong>{num(valorTotal) > 0 && num(valorTotal) - num(valorPago) <= 0 ? "quitado" : num(valorPago) > 0 ? "em andamento" : "só sinal"}</strong>
                      </p>
                      {num(fin?.hotmart_bruto) > 0 && (
                        <p className="mb-2 text-[11px] text-amber-700/80 dark:text-amber-300/70">
                          Referência: a Hotmart registra {brl(num(fin?.hotmart_bruto))} em compras aprovadas.
                          Em boleto parcelado esse número conta só a parcela paga — confira antes de confirmar.
                        </p>
                      )}

                      <div className="flex flex-wrap items-center gap-2">
                        <Button variant="primary" size="sm" disabled={salvando || num(valorTotal) <= 0}
                          onClick={async () => {
                            await patch({
                              pagamento_forma: forma,
                              pagamento_parcelas: forma === "parcelado" ? Number(parcelas) || null : null,
                              valor_total: num(valorTotal),
                              valor_pago: num(valorPago),
                              marcar_pagamento: true,
                            });
                            setConfirmarPagto(false);
                          }}>
                          {salvando && <Spinner className="h-3.5 w-3.5" />}Confirmar e criar na base
                        </Button>
                        <Button variant="secondary" size="sm" disabled={salvando} onClick={() => setConfirmarPagto(false)}>Cancelar</Button>
                      </div>
                    </div>
                  ) : (
                    <div className="flex flex-wrap items-center gap-2">
                      <Button variant="primary" size="sm" disabled={salvando} onClick={() => setConfirmarPagto(true)}>Registrar pagamento</Button>
                      <a href={SALDO_CHECKOUT} target="_blank" rel="noreferrer" className="text-xs font-medium text-brand hover:underline dark:text-brand-300">Abrir checkout Hotmart</a>
                    </div>
                  )}
                </div>
              )}

              <Campo label="Nota rápida">
                <div className="flex items-end gap-2">
                  <textarea value={nota} onChange={(e) => setNota(e.target.value)} rows={2} className={fieldClass} placeholder="Anotar na timeline…" />
                  <Button variant="secondary" size="sm" disabled={!nota.trim() || salvando} onClick={() => { patch({ nota }); setNota(""); }}>Anotar</Button>
                </div>
              </Campo>

              {timeline.length > 0 && (
                <div>
                  <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">Últimas interações</p>
                  <ul className="space-y-1.5">
                    {timeline.slice(0, 6).map((it, i) => (
                      <li key={i} className="text-xs text-slate-500 dark:text-slate-400">
                        <span className="text-slate-700 dark:text-slate-200">{it.descricao || it.tipo}</span>
                        <span className="tabular-nums"> · {fmt(it.criado_em)}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>

            <div className="sticky bottom-0 flex flex-wrap gap-2 border-t border-slate-100 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
              <Link href={`/hm/contatos/${c.comprador_id}`} className="min-w-[7rem] flex-1">
                <Button variant="secondary" className="w-full">Ficha completa</Button>
              </Link>
              {/* Download direto (o servidor devolve o arquivo com Content-Disposition) */}
              <a href={`/api/hm/contato/${c.comprador_id}/export`} className="min-w-[7rem] flex-1" title="Baixar a ficha completa em Excel">
                <Button variant="secondary" className="w-full">Baixar .xlsx</Button>
              </a>
              {podeDisparar && c.telefone && (
                <Button variant="secondary" className="min-w-[7rem] flex-1" onClick={() => setDisparar(true)}>Disparar</Button>
              )}
              {c.telefone && (
                <a href={`https://wa.me/${c.telefone.replace(/\D/g, "").replace(/^(?!55)/, "55")}`} target="_blank" rel="noreferrer" className="w-full">
                  <Button variant="primary" className="w-full">WhatsApp</Button>
                </a>
              )}
            </div>
          </>
        )}
      </aside>

      {disparar && c && c.telefone && (
        <DisparoModal
          selecao={[{ comprador_id: c.comprador_id, nome: c.nome, telefone: c.telefone, edicao: null }]}
          onClose={() => { setDisparar(false); onChanged(); }}
        />
      )}
    </>
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
