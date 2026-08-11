"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Button, cn, fieldClass, Spinner } from "@/app/_components/ui";
import { corAvatar, inicial, Avatar } from "@/app/_components/avatar";
import { useMe, msgErroPermissao } from "@/app/_components/use-me";
import { origemRecompra, SeloRecompra } from "@/app/hm/_components/card-sinais";
import { useProdutoHm } from "@/app/hm/_components/use-produto";

// Checkout Hotmart do saldo do HM — oferta 2vibw97m. É um link ÚNICO por trás de
// qualquer valor (o cliente escolhe à vista ou parcelado no próprio checkout);
// o VALOR exibido ao lado não é mais cravado aqui (0174) — vem de `saldoCheio`,
// que o servidor calcula pela oferta de entrada que a pessoa pagou.
const SALDO_CHECKOUT = "https://pay.hotmart.com/L97981750T?off=2vibw97m";

type Contato = {
  comprador_id: string; nome: string; email: string | null; telefone: string | null;
  turma: string | null; plano: string | null; categoria_entrada: string | null;
  estagio_chave: string | null; estagio_nome: string | null; estagio_aba: string | null;
  responsavel: string | null;
  // Dono por id + trava do admin (0142) — gating do operador. Opcionais: a rota
  // pode ainda não devolvê-los (em voo).
  responsavel_id?: string | null; atribuicao_admin?: boolean;
  reuniao_em: string | null; reuniao_resultado: string | null;
  entrevista_em: string | null; entrevista_resultado: string | null;
  pagamento_forma: string | null; pagamento_parcelas: number | null; pagamento_em: string | null;
  apto_ativacao: boolean; tags: string[] | null; observacoes: string | null; criado_em: string | null;
};
type Interacao = { tipo: string; descricao: string | null; autor: string | null; criado_em: string };
type Formulario = { tipo: string; respostas: Record<string, string> | null; pontuacao: number | string | null; respondido_em: string | null };
type Estagio = { chave: string; nome: string; aba: string | null };
// Saldo do Aurum ETHB SP (0158). `saldo_a_pagar` vem null nas exceções
// (gratuidade/cancelado/em revisão) — nesse caso mostra-se o rótulo, nunca um valor.
type AurumSaldo = {
  credito: number | string | null;
  situacao: string;
  excecao: boolean;
  excecao_motivo: string | null;
  obs: string | null;
  ultima_oferta: string | null;
  pacote_cheio: number | string;
  entrada_paga: number | string;
  base_saldo: number | string;
  saldo_a_pagar: number | string | null;
  rotulo_operador: string;
};

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
// numeric do Postgres chega como string no driver pg.
function numOu0(v: string | number | null | undefined): number {
  const n = typeof v === "string" ? Number(v) : v ?? 0;
  return Number.isFinite(n) ? (n as number) : 0;
}

// Valor em reais. Null vira travessão em vez de "R$ 0,00": no saldo do Aurum a
// ausência de valor é informação (exceção / sem crédito), não zero.
function brl(v: string | number | null | undefined): string {
  if (v === null || v === undefined || v === "") return "—";
  const n = typeof v === "string" ? Number(v) : v;
  if (!Number.isFinite(n)) return "—";
  return n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

const TL_ICONE: Record<string, { path: string; wrap: string }> = {
  resposta: { path: "M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z", wrap: "bg-emerald-50 text-emerald-600 ring-emerald-200 dark:bg-emerald-500/15 dark:text-emerald-400 dark:ring-emerald-500/30" },
  nota: { path: "M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7 M18.5 2.5a2.1 2.1 0 0 1 3 3L12 15l-4 1 1-4Z", wrap: "bg-amber-50 text-amber-600 ring-amber-200 dark:bg-amber-500/15 dark:text-amber-400 dark:ring-amber-500/30" },
  mudanca_estagio: { path: "M16 3h5v5 M21 3l-7 7 M8 21H3v-5 M3 21l7-7", wrap: "bg-violet-50 text-violet-600 ring-violet-200 dark:bg-violet-500/15 dark:text-violet-400 dark:ring-violet-500/30" },
  sistema: { path: "M13 2 3 14h9l-1 8 10-12h-9l1-8z", wrap: "bg-slate-100 text-slate-500 ring-slate-200 dark:bg-slate-800/60 dark:text-slate-400 dark:ring-slate-700" },
};

export default function HmFichaPage({ params }: { params: { id: string } }) {
  const compradorId = params.id;
  const { me, podeDistribuir, ehCardDeColega } = useMe();
  const { produto: produtoBoard } = useProdutoHm(); // 0164: qual card abrir
  const [c, setC] = useState<Contato | null>(null);
  // 403 no GET (ex.: link direto para um card cancelado — só o master acessa):
  // guarda o MOTIVO para a tela não mentir "aluno não encontrado".
  const [erroAcesso, setErroAcesso] = useState<string | null>(null);
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
  const [pgTotal, setPgTotal] = useState("");
  const [pgPago, setPgPago] = useState("");
  // Saldo do Aurum ETHB SP (0158). Só vem preenchido para quem está na planilha do
  // Victor — para o board HM fica null e o bloco nem aparece.
  const [aurum, setAurum] = useState<AurumSaldo | null>(null);
  // Saldo cheio do BOARD (0174): pacote da oferta de ENTRADA que a pessoa pagou,
  // menos o pago no ciclo — nunca mais um "R$ 14.700" cravado no componente.
  // Null quando a régua ainda não sabe calcular (aluno da base sem crédito
  // pró-rata) — a tela diz "saldo a definir" (vocabulário da 0165).
  const [saldoCheio, setSaldoCheio] = useState<string | null>(null);

  const recarregar = useCallback(async () => {
    // 0164: sem o produto, quem tem card em 2 boards abriria um deles ao acaso.
    const r = await fetch(`/api/hm/contato/${compradorId}?produto=${produtoBoard}`);
    const d = await r.json().catch(() => ({}));
    if (!d.ok) setErroAcesso(msgErroPermissao(d?.reason));
    if (d.ok) {
      setErroAcesso(null);
      setC(d.contato);
      setTimeline(d.timeline ?? []);
      setFormularios(d.formularios ?? []);
      setReuniaoLocal(toLocalInput(d.contato.reuniao_em));
      setEntrevistaLocal(toLocalInput(d.contato.entrevista_em));
      setAurum(d.aurumSaldo ?? null);
      setSaldoCheio(d.saldoCheio ?? null);
      // Sugestão do servidor para o bloco financeiro (15.000 quando a entrada
      // foi o sinal). O operador confere antes de confirmar.
      const sugestao = numOu0(d.financeiro?.valor_total) || numOu0(d.financeiro?.sugestao_valor_total);
      if (sugestao > 0) {
        setPgTotal(String(sugestao));
        setPgPago(String(numOu0(d.financeiro?.valor_pago) || sugestao));
      }
    }
    setCarregando(false);
  }, [compradorId, produtoBoard]);

  useEffect(() => { recarregar(); }, [recarregar]);
  useEffect(() => {
    fetch("/api/hm/estagios").then((r) => r.json()).then((d) => { if (d.ok) setEstagios(d.estagios); }).catch(() => {});
    fetch("/api/usuarios").then((r) => r.json()).then((d) => { if (d.ok) setResponsaveis(d.usuarios.filter((u: { ativo: boolean }) => u.ativo).map((u: { nome: string }) => u.nome)); }).catch(() => {});
  }, []);

  // Ficha de COLEGA (28/07): abre em LEITURA — o operador vê timeline,
  // formulários e histórico, mas não altera (a API recusa com 403
  // `card_de_outro_operador`). A regra é o escopoAcao de lib/papeis (via
  // useMe.ehCardDeColega), a MESMA do backend.
  const somenteLeitura = ehCardDeColega(c);

  async function patch(payload: Record<string, unknown>) {
    // Toda escrita da ficha passa por aqui — barrar no ponto único.
    if (somenteLeitura) { window.alert(msgErroPermissao("card_de_outro_operador")); return; }
    setSalvando(true);
    try {
      const r = await fetch(`/api/hm/contato/${compradorId}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      if (!r.ok) {
        // 403 de permissão vem com reason específico — a ficha diz o MOTIVO
        // em vez de recarregar em silêncio com o valor antigo.
        const d = await r.json().catch(() => ({}));
        const msg = msgErroPermissao(d?.reason);
        if (msg) window.alert(msg);
      }
      await recarregar();
    } finally {
      setSalvando(false);
    }
  }

  if (carregando) return <div className="flex items-center justify-center gap-3 py-24 text-slate-400"><Spinner className="h-6 w-6" /> Carregando ficha…</div>;
  // Acesso recusado (403 com reason — ex.: card cancelado, só o master): diz o
  // motivo real em vez do falso "não encontrado".
  if (!c && erroAcesso) {
    return (
      <div className="mx-auto max-w-md py-24 text-center">
        <span className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-rose-100 text-rose-600 dark:bg-rose-500/15 dark:text-rose-400">
          <svg className="h-6 w-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" /></svg>
        </span>
        <p className="text-sm text-slate-600 dark:text-slate-300">{erroAcesso}</p>
        <Link href="/hm/kanban" className="mt-3 inline-block text-sm font-medium text-brand underline dark:text-brand-300">Voltar à esteira</Link>
      </div>
    );
  }
  if (!c) return <div className="py-24 text-center text-slate-500">Lead não encontrado. <Link href="/hm/kanban" className="text-brand underline">Voltar à esteira</Link></div>;

  const tags = c.tags ?? [];
  // A marca de pago é apto_ativacao; pagamento_em é o histórico (fica mesmo quando
  // o card é devolvido ao Comercial e o pagamento é desfeito).
  const jaPagou = !!c.apto_ativacao;

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
            {c.apto_ativacao && <Badge cls="bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300">Saldo pago</Badge>}
            {/* Recompra (27/07): o mesmo selo do board/tabela/drawer. */}
            {origemRecompra(c.tags) && <SeloRecompra origem={origemRecompra(c.tags)!} />}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {/* A ficha inteira em uma planilha — o servidor devolve o arquivo pronto */}
          <a href={`/api/hm/contato/${c.comprador_id}/export`} title="Baixar a ficha completa em Excel">
            <Button variant="secondary" size="sm">Baixar .xlsx</Button>
          </a>
          {c.telefone && (
            <a href={`https://wa.me/${c.telefone.replace(/\D/g, "").replace(/^(?!55)/, "55")}`} target="_blank" rel="noreferrer">
              <Button variant="secondary" size="sm">WhatsApp</Button>
            </a>
          )}
        </div>
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
          {/* Ficha de colega: contexto, não erro — o mesmo aviso slate do drawer. */}
          {somenteLeitura && (
            <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600 dark:border-slate-700 dark:bg-slate-800/60 dark:text-slate-300">
              <strong className="text-slate-700 dark:text-slate-200">Card de {c.responsavel ?? "outro operador"}.</strong>{" "}
              Você pode ver a ficha, a timeline e o histórico, mas não alterar — só quem pode agir é o dono ou o gestor.
            </div>
          )}
          {/* Plano contratado + etapa + operador */}
          <Secao titulo="Contratação">
            <div className="grid gap-4 sm:grid-cols-2">
              <Campo label="Plano contratado (oferta)">
                <input defaultValue={c.plano ?? ""} disabled={somenteLeitura} onBlur={(e) => e.target.value !== (c.plano ?? "") && patch({ plano: e.target.value })} className={fieldClass} placeholder="Ex.: HM 15k" />
              </Campo>
              <Campo label="Etapa da jornada">
                <select value={c.estagio_chave ?? ""} disabled={somenteLeitura} onChange={(e) => patch({ estagio_chave: e.target.value })} className={fieldClass}>
                  {estagios.map((s) => <option key={s.chave} value={s.chave}>{s.aba === "ativacao" ? "Ativação · " : "Comercial · "}{s.nome}</option>)}
                </select>
              </Campo>
              <Campo label="Operador">
                {podeDistribuir() ? (
                  // MASTER/GESTOR distribuem pelo seletor (o backend barra destino
                  // fora da equipe do gestor e devolve o motivo).
                  <div className="flex items-center gap-2">
                    {c.responsavel && <Avatar nome={c.responsavel} className="h-8 w-8 text-xs" />}
                    <select value={c.responsavel ?? ""} onChange={(e) => patch({ responsavel: e.target.value || null })} className={fieldClass}>
                      <option value="">— Sem operador —</option>
                      {c.responsavel && !responsaveis.includes(c.responsavel) && <option value={c.responsavel}>{c.responsavel}</option>}
                      {responsaveis.map((r) => <option key={r} value={r}>{r}</option>)}
                    </select>
                  </div>
                ) : (
                  // OPERADOR: sem seletor — lê o dono; card do POOL (sem dono e sem
                  // trava do admin) ganha o botão de assumir para si.
                  <div className="flex flex-wrap items-center gap-2 pt-1">
                    {c.responsavel ? (
                      <>
                        <Avatar nome={c.responsavel} className="h-8 w-8 text-xs" />
                        <span className="text-sm font-medium text-slate-700 dark:text-slate-200">{c.responsavel}</span>
                      </>
                    ) : c.atribuicao_admin ? (
                      <span className="inline-flex items-center gap-1.5 rounded-lg bg-amber-50 px-2.5 py-1.5 text-xs font-medium text-amber-700 dark:bg-amber-500/15 dark:text-amber-300">
                        <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" /></svg>
                        Atribuição travada pelo administrador
                      </span>
                    ) : me?.id ? (
                      <button
                        type="button"
                        disabled={salvando}
                        onClick={() => patch({ responsavel_id: me.id })}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-dashed border-teal-400 px-2.5 py-1.5 text-xs font-medium text-teal-700 transition hover:bg-teal-50 disabled:opacity-50 dark:border-teal-500/50 dark:text-teal-300 dark:hover:bg-teal-500/10"
                        title="Card do pool — clique para assumir para você"
                      >
                        <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M19 8v6M22 11h-6" /></svg>
                        No pool — atribuir a mim
                      </button>
                    ) : (
                      <span className="text-sm text-slate-400">— Sem operador —</span>
                    )}
                  </div>
                )}
              </Campo>
              {c.categoria_entrada && (
                <Campo label="Entrada">
                  <p className="pt-2 text-sm text-slate-600 dark:text-slate-300">{c.categoria_entrada === "sinal" ? "Sinalização" : "Compra cheia"}</p>
                </Campo>
              )}
            </div>
          </Secao>

          {/* Saldo do Aurum ETHB SP (0158) — só aparece para quem está na planilha do
              Victor. É outra conta que a do HM: pacote de 60k com a entrada de 1k já
              paga, menos o crédito pró-rata calculado fora do banco. */}
          {aurum && (
            <Secao titulo="Situação de saldo — Aurum ETHB SP">
              {aurum.excecao ? (
                // Exceção não tem número: cobrar aqui seria erro grave (a Iara ganhou
                // gratuidade do Marcio; o Marcelo cancelou). Mostra o motivo e para.
                <div className="rounded-lg bg-amber-50 px-3 py-2.5 text-sm text-amber-800 dark:bg-amber-500/15 dark:text-amber-300">
                  <p className="font-medium">{aurum.rotulo_operador}</p>
                  {aurum.obs && <p className="mt-1 text-amber-700/80 dark:text-amber-300/80">{aurum.obs}</p>}
                </div>
              ) : (
                <div className="space-y-3">
                  <div className="rounded-lg bg-slate-50 px-3 py-2.5 dark:bg-slate-800/50">
                    <p className="text-xs uppercase tracking-wide text-slate-500 dark:text-slate-400">Saldo a pagar</p>
                    <p className="text-2xl font-semibold text-slate-800 dark:text-slate-100">{brl(aurum.saldo_a_pagar)}</p>
                    <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">{aurum.rotulo_operador}</p>
                  </div>
                  <dl className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-sm sm:grid-cols-4">
                    <div><dt className="text-xs text-slate-500 dark:text-slate-400">Pacote</dt><dd className="text-slate-700 dark:text-slate-200">{brl(aurum.pacote_cheio)}</dd></div>
                    <div><dt className="text-xs text-slate-500 dark:text-slate-400">Entrada paga</dt><dd className="text-slate-700 dark:text-slate-200">− {brl(aurum.entrada_paga)}</dd></div>
                    <div><dt className="text-xs text-slate-500 dark:text-slate-400">Crédito pró-rata</dt><dd className="text-slate-700 dark:text-slate-200">− {brl(aurum.credito)}</dd></div>
                    <div><dt className="text-xs text-slate-500 dark:text-slate-400">Base</dt><dd className="text-slate-700 dark:text-slate-200">{brl(aurum.base_saldo)}</dd></div>
                  </dl>
                  {aurum.obs && <p className="text-xs text-slate-500 dark:text-slate-400">{aurum.obs}</p>}
                </div>
              )}
            </Secao>
          )}

          {/* Pagamento do saldo. O título é do BOARD (10/08): no Aurum são 59.000 de
              saldo sobre um pacote de 60.000 — exibir "14.700 de 15.000" ali é número
              de outro produto. */}
          <Secao titulo={aurum
            ? `Pagamento do saldo — ${brl(aurum.base_saldo)} (de ${brl(aurum.pacote_cheio)})`
            // 0174: nada de "R$ 14.700" cravado — o valor vem da oferta de entrada
            // que a pessoa pagou. Sem dado (aluno da base sem crédito pró-rata
            // calculado), o título diz o que a 0165 já estabeleceu para o resto da
            // ficha, em vez de mentir um número.
            : `Pagamento do saldo — ${saldoCheio != null ? `${brl(saldoCheio)} (de R$ 15.000)` : "saldo a definir"}`}>
            {jaPagou ? (
              <div className="flex items-center gap-2 rounded-lg bg-emerald-50 px-3 py-2.5 text-sm font-medium text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300">
                <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5" /></svg>
                Pagamento registrado {c.pagamento_forma === "parcelado" ? `(parcelado${c.pagamento_parcelas ? ` em ${c.pagamento_parcelas}x` : ""})` : "(à vista)"} em {fmt(c.pagamento_em)}
              </div>
            ) : somenteLeitura ? (
              // Ficha de colega: registrar pagamento é agir — o formulário some.
              <p className="text-sm text-slate-400 dark:text-slate-500">Saldo em aberto — o registro do pagamento é do dono do card ou do gestor.</p>
            ) : (
              <div className="space-y-3">
                <div className="flex flex-wrap items-end gap-3">
                  <Campo label="Forma">
                    <select value={pgForma} className={cn(fieldClass, "w-auto")}
                      onChange={(e) => {
                        const f = e.target.value as "avista" | "parcelado";
                        setPgForma(f);
                        if (f === "avista") setPgPago(pgTotal);
                      }}>
                      <option value="avista">À vista</option>
                      <option value="parcelado">Parcelado</option>
                    </select>
                  </Campo>
                  {pgForma === "parcelado" && (
                    <Campo label="Parcelas">
                      <input type="number" min={1} max={24} value={pgParcelas} onChange={(e) => setPgParcelas(Number(e.target.value))} className={cn(fieldClass, "w-24")} />
                    </Campo>
                  )}
                  <Campo label="Valor total">
                    <input type="number" min={0} step="0.01" value={pgTotal}
                      onChange={(e) => { setPgTotal(e.target.value); if (pgForma === "avista") setPgPago(e.target.value); }}
                      className={cn(fieldClass, "w-32")} />
                  </Campo>
                  <Campo label="Valor já pago">
                    <input type="number" min={0} step="0.01" value={pgPago}
                      onChange={(e) => setPgPago(e.target.value)} className={cn(fieldClass, "w-32")} />
                  </Campo>
                  <Button variant="primary" disabled={salvando || numOu0(pgTotal) <= 0}
                    onClick={() => patch({
                      pagamento_forma: pgForma,
                      pagamento_parcelas: pgForma === "parcelado" ? pgParcelas : null,
                      valor_total: numOu0(pgTotal),
                      valor_pago: numOu0(pgPago),
                      marcar_pagamento: true,
                    })}>
                    Registrar pagamento realizado
                  </Button>
                </div>
                {/* 0165: SALDO_CHECKOUT é a oferta 2vibw97m, DO HM. No card do Aurum
                    mandaria o aluno pagar o saldo errado — some até haver link próprio
                    (mesma regra já aplicada no drawer). */}
                {!aurum && (
                  <a href={SALDO_CHECKOUT} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 text-sm font-medium text-brand transition hover:underline dark:text-brand-300">
                    <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M15 3h6v6M10 14 21 3M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" /></svg>
                    Abrir checkout do saldo na Hotmart
                  </a>
                )}
                <p className="text-xs text-slate-400 dark:text-slate-500">
                  {/* 0165: dizia "turma T39" — do HM. A turma sai do que a pessoa É
                      (lead novo entra na atual; aluno da base mantém a dele). */}
                  Ao registrar, o card vai para a Ativação (Pendente de Liberação) e o aluno é criado/atualizado na base THB com os valores acima.
                </p>
              </div>
            )}
          </Secao>

          {/* Reunião (Comercial) */}
          <Secao titulo="Reunião comercial">
            <div className="grid gap-4 sm:grid-cols-2">
              <Campo label="Data e hora">
                <div className="flex items-center gap-2">
                  <input type="datetime-local" value={reuniaoLocal} disabled={somenteLeitura} onChange={(e) => setReuniaoLocal(e.target.value)} className={fieldClass} />
                  <Button variant="secondary" size="sm" disabled={salvando || somenteLeitura} onClick={() => patch({ reuniao_em: fromLocalInput(reuniaoLocal) })}>Salvar</Button>
                </div>
              </Campo>
              <Campo label="Resultado">
                <input defaultValue={c.reuniao_resultado ?? ""} disabled={somenteLeitura} onBlur={(e) => e.target.value !== (c.reuniao_resultado ?? "") && patch({ reuniao_resultado: e.target.value })} className={fieldClass} placeholder="Ex.: interessado, remarcar…" />
              </Campo>
            </div>
          </Secao>

          {/* Entrevista (Ativação) */}
          <Secao titulo="Entrevista de ativação">
            <div className="grid gap-4 sm:grid-cols-2">
              <Campo label="Data e hora">
                <div className="flex items-center gap-2">
                  <input type="datetime-local" value={entrevistaLocal} disabled={somenteLeitura} onChange={(e) => setEntrevistaLocal(e.target.value)} className={fieldClass} />
                  <Button variant="secondary" size="sm" disabled={salvando || somenteLeitura} onClick={() => patch({ entrevista_em: fromLocalInput(entrevistaLocal) })}>Salvar</Button>
                </div>
              </Campo>
              <Campo label="Resultado">
                <input defaultValue={c.entrevista_resultado ?? ""} disabled={somenteLeitura} onBlur={(e) => e.target.value !== (c.entrevista_resultado ?? "") && patch({ entrevista_resultado: e.target.value })} className={fieldClass} placeholder="Ex.: aprovado, pendências…" />
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
                    {!somenteLeitura && <button onClick={() => patch({ tags: tags.filter((x) => x !== t) })} className="opacity-60 hover:opacity-100">×</button>}
                  </span>
                ))}
                <input
                  disabled={somenteLeitura}
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
              <textarea defaultValue={c.observacoes ?? ""} disabled={somenteLeitura} onBlur={(e) => e.target.value !== (c.observacoes ?? "") && patch({ observacoes: e.target.value })} rows={2} className={fieldClass} placeholder="Anotações internas…" />
              <div className="flex items-end gap-2">
                <textarea value={nota} disabled={somenteLeitura} onChange={(e) => setNota(e.target.value)} rows={2} className={fieldClass} placeholder="Adicionar nota à timeline…" />
                <Button variant="secondary" disabled={!nota.trim() || salvando || somenteLeitura} onClick={() => { patch({ nota }); setNota(""); }}>Anotar</Button>
              </div>
            </div>
          </Secao>
        </div>
      )}

      {aba === "forms" && (
        formularios.length === 0 ? (
          <p className="py-4 text-sm text-slate-400 dark:text-slate-500">Nenhum formulário respondido (Respondi) por este lead ainda.</p>
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
