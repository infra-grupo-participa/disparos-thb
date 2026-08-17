"use client";

import { useEffect, useMemo, useState } from "react";
import { MarcaPortal } from "@/app/_components/marca";
import { useProdutoHm } from "@/app/hm/_components/use-produto";
import { Card, EmptyState, Spinner, cn, fieldCompactClass } from "@/app/_components/ui";
import { msgErroPermissao } from "@/app/_components/use-me";

// CARTEIRA — a tela que responde "de quem é cada aluno, quanto ele deve e quando ele paga".
//
// Pedido do João (16/08/2026): "o dashboard está com muita informação que a gente não
// consegue metrificar; quero a visão dinâmica e a detalhada, e entender a situação da
// carteira de cada pessoa do comercial".
//
// O desenho segue o que a operação faz de verdade: primeiro o dinheiro do board, depois um
// cartão por pessoa do comercial, e o detalhe abre por clique — ninguém rola 242 linhas para
// achar a pessoa que ele quer cobrar.
//
// ── TRÊS DECISÕES QUE NÃO SÃO ESTÉTICAS ─────────────────────────────────────────────
// 1. A fila de cobrança é a ordenação padrão da lista. Quem parou de pagar aparece primeiro,
//    e "já pagou tudo" por último. A tela é uma fila de trabalho, não um relatório.
// 2. "Quitado" é só quem não deve mais nada. Quem pagou parte do saldo aparece azul, nunca
//    verde — foi exatamente o erro que o João pegou no Mário Sérgio, que devia R$ 13.143 e
//    a planilha dava como pago.
// 3. Quem paga menos de R$ 15.000 carrega a explicação junto (crédito do programa anterior e
//    turma de onde veio), porque a pergunta "por que esse não é 15 mil?" chega em toda
//    apresentação.

type Status = "quitado" | "parcelando" | "pagando_parcial" | "so_entrada" | "cancelado" | "entrada_estornada";

type Aluno = {
  contato_hm_id: string; nome: string; email: string | null; telefone: string | null;
  status: Status; perfil: string | null; turma: string | null; turma_origem: string | null;
  entrada_valor: number | null; entrada_pago_em: string | null;
  pago_apos_entrada: number; pago_no_ciclo: number | null; credito_ciclo_anterior: number | null;
  pacote: number | null; falta_pagar: number | null; pct_pago: number | null;
  proximo_pagamento: string | null; ultimo_pagamento_em: string | null; parcelas: number;
  cobranca: string; urgencia: 0 | 1 | 2 | 3 | 9; porque_o_valor: string; conferir: string | null;
  carteira_nome: string | null; carteira_usuario_id: string | null;
  carteira_origem: string; carteira_lastro: string; carteira_confirmada: boolean;
};

type Resumo = {
  usuario_id: string | null; pessoa: string; identificada: boolean;
  alunos: number; quitados: number; pagando: number; so_entrada: number; cancelados: number;
  recebido: number; a_receber: number;
  parou_de_pagar: number; combinou_e_nao_pagou: number; sem_data: number; conferir: number;
};

const SITUACAO: Record<Status, { rotulo: string; ponto: string; chip: string }> = {
  quitado:            { rotulo: "Quitado",              ponto: "bg-emerald-500", chip: "bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300" },
  parcelando:         { rotulo: "Pagando em parcelas",  ponto: "bg-sky-500",     chip: "bg-sky-50 text-sky-700 dark:bg-sky-500/10 dark:text-sky-300" },
  pagando_parcial:    { rotulo: "Pagou parte do saldo", ponto: "bg-sky-500",     chip: "bg-sky-50 text-sky-700 dark:bg-sky-500/10 dark:text-sky-300" },
  so_entrada:         { rotulo: "Só o sinal",           ponto: "bg-rose-500",    chip: "bg-rose-50 text-rose-700 dark:bg-rose-500/10 dark:text-rose-300" },
  cancelado:          { rotulo: "Cancelado",            ponto: "bg-slate-400",   chip: "bg-slate-100 text-slate-600 dark:bg-slate-700/40 dark:text-slate-300" },
  entrada_estornada:  { rotulo: "Sinal reembolsado",    ponto: "bg-slate-400",   chip: "bg-slate-100 text-slate-600 dark:bg-slate-700/40 dark:text-slate-300" },
};

const PERFIL: Record<string, string> = {
  aluno_base: "Já era aluno da casa",
  lead_novo: "Aluno novo",
  nao_classificado: "A classificar",
};

const moeda = (v: number | null | undefined) =>
  (v ?? 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });
const moedaExata = (v: number | null | undefined) =>
  (v ?? 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const dataBr = (iso: string | null) => (iso ? iso.slice(0, 10).split("-").reverse().join("/") : "—");

// As filas são as mesmas do serviço (a frase de cobrança começa com o rótulo da fila) — a tela
// não reclassifica nada, só filtra pelo que o servidor já decidiu.
const FILAS = [
  { id: "acao",    rotulo: "Precisa de ação",  teste: (a: Aluno) => a.urgencia === 0 },
  { id: "combinar",rotulo: "Sem data para pagar", teste: (a: Aluno) => a.cobranca.startsWith("Sem data") },
  { id: "emdia",   rotulo: "Em dia",           teste: (a: Aluno) => a.cobranca.startsWith("Em dia") || a.cobranca.startsWith("Combinado") },
  { id: "quitado", rotulo: "Já pagou tudo",    teste: (a: Aluno) => a.status === "quitado" },
  { id: "conferir",rotulo: "Conferir",         teste: (a: Aluno) => Boolean(a.conferir) },
] as const;
type FilaId = (typeof FILAS)[number]["id"];

export default function CarteiraPage() {
  const { produto, portal, nome: nomePortal } = useProdutoHm();
  const [dados, setDados] = useState<{ resumo: Resumo[]; alunos: Aluno[] } | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [aberta, setAberta] = useState<string | null>(null);   // chave da carteira aberta
  const [fila, setFila] = useState<FilaId | null>(null);
  const [busca, setBusca] = useState("");

  useEffect(() => {
    let cancelado = false;
    setDados(null); setErro(null);
    fetch(`/api/hm/carteira?produto=${produto}`)
      .then((r) => r.json())
      .then((d) => {
        if (cancelado) return;
        if (!d.ok) { setErro(msgErroPermissao(d.reason) ?? "Não foi possível carregar a carteira."); return; }
        setDados({ resumo: d.resumo, alunos: d.alunos });
      })
      .catch(() => { if (!cancelado) setErro("Sem conexão com o servidor."); });
    return () => { cancelado = true; };
  }, [produto]);

  const totais = useMemo(() => {
    const r = dados?.resumo ?? [];
    return {
      alunos: r.reduce((s, x) => s + x.alunos, 0),
      recebido: r.reduce((s, x) => s + x.recebido, 0),
      aReceber: r.reduce((s, x) => s + x.a_receber, 0),
      acao: r.reduce((s, x) => s + x.parou_de_pagar + x.combinou_e_nao_pagou, 0),
      semData: r.reduce((s, x) => s + x.sem_data, 0),
      conferir: r.reduce((s, x) => s + x.conferir, 0),
    };
  }, [dados]);

  const chaveDe = (a: Aluno) => a.carteira_usuario_id ?? a.carteira_nome ?? "__sem_dono__";
  const chaveResumo = (r: Resumo) => r.usuario_id ?? (r.identificada ? r.pessoa : "__sem_dono__");

  const lista = useMemo(() => {
    if (!dados) return [];
    const termo = busca.trim().toLowerCase();
    return dados.alunos
      .filter((a) => (aberta ? chaveDe(a) === aberta : true))
      .filter((a) => (fila ? FILAS.find((f) => f.id === fila)!.teste(a) : true))
      .filter((a) => (termo ? `${a.nome} ${a.email ?? ""} ${a.telefone ?? ""}`.toLowerCase().includes(termo) : true))
      .sort((a, b) => (a.urgencia - b.urgencia) || ((b.falta_pagar ?? 0) - (a.falta_pagar ?? 0)));
  }, [dados, aberta, fila, busca]);

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="flex items-center gap-2.5">
            <MarcaPortal portal={portal} altura="h-7" comNome={false} />
            <h1 className="text-xl font-semibold tracking-tight text-slate-900 dark:text-slate-100">
              Carteira · {nomePortal}
            </h1>
          </div>
          <p className="mt-0.5 text-sm text-slate-500 dark:text-slate-400">
            Quem entrou pelo sinal do programa, de quem é cada aluno, quanto falta e quando ele paga.
          </p>
        </div>
      </div>

      {erro && (
        <Card className="mb-3 border-rose-200 p-4 text-sm text-rose-700 dark:border-rose-900/50 dark:text-rose-300">{erro}</Card>
      )}

      {!dados && !erro && (
        <div className="flex items-center gap-2 py-16 text-sm text-slate-400"><Spinner /> carregando a carteira…</div>
      )}

      {dados && (
        <>
          {/* ---- o dinheiro do board, antes de qualquer recorte ---- */}
          <div className="mb-4 grid grid-cols-2 gap-2.5 lg:grid-cols-4">
            <Kpi titulo="Alunos com sinal pago" valor={String(totais.alunos)} />
            <Kpi titulo="Já recebido" valor={moeda(totais.recebido)} tom="emerald" />
            <Kpi titulo="Ainda a receber" valor={moeda(totais.aReceber)} tom="amber" />
            <Kpi
              titulo="Precisam de cobrança"
              valor={String(totais.acao)}
              rodape={totais.semData > 0 ? `+ ${totais.semData} sem data combinada` : undefined}
              tom="rose"
            />
          </div>

          {/* ---- uma pessoa do comercial por cartão ---- */}
          <div className="mb-4 grid grid-cols-1 gap-2.5 md:grid-cols-2 xl:grid-cols-3">
            {dados.resumo.map((r) => {
              const chave = chaveResumo(r);
              const ativa = aberta === chave;
              const total = r.quitados + r.pagando + r.so_entrada || 1;
              return (
                <button
                  key={chave}
                  type="button"
                  onClick={() => { setAberta(ativa ? null : chave); setFila(null); }}
                  aria-pressed={ativa}
                  className={cn(
                    "rounded-xl border p-4 text-left transition",
                    ativa
                      ? "border-slate-900 bg-white shadow-card dark:border-slate-300 dark:bg-slate-800"
                      : "border-slate-200 bg-white hover:border-slate-300 dark:border-slate-800 dark:bg-slate-900/40 dark:hover:border-slate-700",
                  )}
                >
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="truncate text-sm font-semibold text-slate-900 dark:text-slate-100">
                      {r.pessoa}
                    </span>
                    <span className="shrink-0 text-xs text-slate-500 dark:text-slate-400">{r.alunos} alunos</span>
                  </div>

                  {/* barra do funil: quitado · pagando · só o sinal */}
                  <div className="mt-2.5 flex h-2 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
                    <span className="bg-emerald-500" style={{ width: `${(r.quitados / total) * 100}%` }} />
                    <span className="bg-sky-500" style={{ width: `${(r.pagando / total) * 100}%` }} />
                    <span className="bg-rose-400" style={{ width: `${(r.so_entrada / total) * 100}%` }} />
                  </div>
                  <p className="mt-1.5 text-[11px] text-slate-500 dark:text-slate-400">
                    {r.quitados} quitados · {r.pagando} pagando · {r.so_entrada} só com o sinal
                    {r.cancelados > 0 && ` · ${r.cancelados} cancelados`}
                  </p>

                  <div className="mt-3 flex items-end justify-between gap-2 border-t border-slate-100 pt-2.5 dark:border-slate-800">
                    <div>
                      <p className="text-[11px] text-slate-500 dark:text-slate-400">recebido</p>
                      <p className="text-sm font-semibold text-emerald-700 dark:text-emerald-300">{moeda(r.recebido)}</p>
                    </div>
                    <div className="text-right">
                      <p className="text-[11px] text-slate-500 dark:text-slate-400">a receber</p>
                      <p className="text-sm font-semibold text-amber-700 dark:text-amber-300">{moeda(r.a_receber)}</p>
                    </div>
                  </div>

                  {(r.parou_de_pagar + r.combinou_e_nao_pagou > 0 || r.conferir > 0) && (
                    <p className="mt-2 text-[11px] font-medium text-rose-700 dark:text-rose-300">
                      {r.parou_de_pagar + r.combinou_e_nao_pagou > 0 && `${r.parou_de_pagar + r.combinou_e_nao_pagou} para cobrar hoje`}
                      {r.parou_de_pagar + r.combinou_e_nao_pagou > 0 && r.conferir > 0 && " · "}
                      {r.conferir > 0 && `${r.conferir} para conferir`}
                    </p>
                  )}
                  <p className="mt-2 text-[11px] text-slate-400 dark:text-slate-500">
                    {ativa ? "▾ mostrando os alunos" : "▸ ver os alunos"}
                  </p>
                </button>
              );
            })}
          </div>

          {/* ---- filtros da lista ---- */}
          <Card className="mb-3 p-3">
            <div className="flex flex-wrap items-center gap-2">
              <input
                value={busca}
                onChange={(e) => setBusca(e.target.value)}
                placeholder="Buscar aluno por nome, e-mail ou telefone…"
                className={cn(fieldCompactClass, "min-w-[240px] flex-1")}
              />
              {FILAS.map((f) => {
                const n = (dados.alunos.filter((a) => (aberta ? chaveDe(a) === aberta : true)).filter(f.teste)).length;
                if (n === 0) return null;
                const ativa = fila === f.id;
                return (
                  <button
                    key={f.id}
                    type="button"
                    onClick={() => setFila(ativa ? null : f.id)}
                    className={cn(
                      "alvo-toque rounded-lg px-3 py-1.5 text-xs font-medium transition",
                      ativa
                        ? "bg-slate-900 text-white dark:bg-slate-200 dark:text-slate-900"
                        : "bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700",
                    )}
                  >
                    {f.rotulo} <span className="opacity-60">{n}</span>
                  </button>
                );
              })}
              {(aberta || fila || busca) && (
                <button
                  type="button"
                  onClick={() => { setAberta(null); setFila(null); setBusca(""); }}
                  className="text-xs text-slate-500 underline-offset-2 hover:underline dark:text-slate-400"
                >
                  limpar
                </button>
              )}
            </div>
          </Card>

          {/* ---- a lista ---- */}
          {lista.length === 0 ? (
            <EmptyState title="Nenhum aluno com esses filtros" description="Contagem zero também é informação." />
          ) : (
            <div className="space-y-2">
              {lista.map((a) => <LinhaAluno key={a.contato_hm_id} a={a} mostrarDono={!aberta} />)}
            </div>
          )}

          <p className="mt-4 text-xs text-slate-400 dark:text-slate-500">
            Só entra quem pagou a entrada do programa (R$ 300 ou R$ 697). Renovação, acesso avulso e AURUM ficam de fora.
            A carteira é reconstruída pelo histórico de cada card — é retrato de acompanhamento e de dinheiro, não apuração de comissionamento.
          </p>
        </>
      )}
    </div>
  );
}

function Kpi({ titulo, valor, rodape, tom }: { titulo: string; valor: string; rodape?: string; tom?: "emerald" | "amber" | "rose" }) {
  const cor = tom === "emerald" ? "text-emerald-700 dark:text-emerald-300"
    : tom === "amber" ? "text-amber-700 dark:text-amber-300"
    : tom === "rose" ? "text-rose-700 dark:text-rose-300"
    : "text-slate-900 dark:text-slate-100";
  return (
    <Card className="p-4">
      <p className="text-xs text-slate-500 dark:text-slate-400">{titulo}</p>
      <p className={cn("mt-1 text-2xl font-semibold tracking-tight", cor)}>{valor}</p>
      {rodape && <p className="mt-0.5 text-[11px] text-slate-400 dark:text-slate-500">{rodape}</p>}
    </Card>
  );
}

function LinhaAluno({ a, mostrarDono }: { a: Aluno; mostrarDono: boolean }) {
  const [aberto, setAberto] = useState(false);
  const s = SITUACAO[a.status];
  const urgente = a.urgencia === 0;

  return (
    <Card className={cn("overflow-hidden p-0", urgente && "border-rose-200 dark:border-rose-900/40")}>
      <button type="button" onClick={() => setAberto(!aberto)} className="flex w-full flex-wrap items-center gap-x-4 gap-y-2 p-3 text-left">
        <span className={cn("h-2 w-2 shrink-0 rounded-full", s.ponto)} aria-hidden="true" />

        <span className="min-w-[180px] flex-1 truncate text-sm font-medium text-slate-900 dark:text-slate-100">
          {a.nome}
          {mostrarDono && a.carteira_nome && (
            <span className="ml-2 text-xs font-normal text-slate-400 dark:text-slate-500">{a.carteira_nome}</span>
          )}
        </span>

        <span className={cn("shrink-0 rounded-md px-2 py-0.5 text-[11px] font-medium", s.chip)}>{s.rotulo}</span>

        <span className={cn(
          "min-w-[220px] flex-1 truncate text-xs",
          urgente ? "font-semibold text-rose-700 dark:text-rose-300"
          : a.urgencia === 1 ? "text-amber-700 dark:text-amber-300"
          : a.cobranca.startsWith("Em dia") ? "text-emerald-700 dark:text-emerald-300"
          : "text-slate-500 dark:text-slate-400",
        )}>
          {a.cobranca}
        </span>

        <span className="shrink-0 text-right">
          <span className="block text-sm font-semibold text-slate-900 dark:text-slate-100">{moeda(a.falta_pagar)}</span>
          <span className="block text-[11px] text-slate-400 dark:text-slate-500">a receber</span>
        </span>

        <span className="hidden w-24 shrink-0 sm:block" aria-hidden="true">
          <span className="block h-1.5 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
            <span className="block h-full rounded-full bg-emerald-500" style={{ width: `${a.pct_pago ?? 0}%` }} />
          </span>
          <span className="mt-0.5 block text-right text-[10px] text-slate-400 dark:text-slate-500">{a.pct_pago ?? 0}% pago</span>
        </span>
      </button>

      {a.conferir && (
        <p className="border-t border-rose-100 bg-rose-50 px-3 py-1.5 text-[11px] font-medium text-rose-800 dark:border-rose-900/40 dark:bg-rose-500/10 dark:text-rose-300">
          Conferir: {a.conferir}
        </p>
      )}

      {aberto && (
        <div className="border-t border-slate-100 bg-slate-50/60 px-3 py-3 text-xs dark:border-slate-800 dark:bg-slate-800/20">
          <div className="grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-4">
            <Dado rotulo="Perfil" valor={PERFIL[a.perfil ?? ""] ?? "—"} />
            <Dado rotulo="Turma" valor={a.turma ?? "—"} sub={a.turma_origem ? `veio da ${a.turma_origem}` : undefined} />
            <Dado rotulo="Valor que ele paga" valor={moedaExata(a.pacote)} />
            <Dado rotulo="Crédito que já tinha" valor={a.credito_ciclo_anterior ? moedaExata(a.credito_ciclo_anterior) : "—"} />
            <Dado rotulo="Sinal" valor={moedaExata(a.entrada_valor)} sub={dataBr(a.entrada_pago_em)} />
            <Dado rotulo="Pago depois do sinal" valor={moedaExata(a.pago_apos_entrada)} sub={a.parcelas > 0 ? `${a.parcelas} parcela(s)` : undefined} />
            <Dado rotulo="Total pago" valor={moedaExata(a.pago_no_ciclo)} />
            <Dado rotulo="Último pagamento" valor={dataBr(a.ultimo_pagamento_em)} />
            <Dado rotulo="Data combinada" valor={dataBr(a.proximo_pagamento)} />
            <Dado rotulo="E-mail" valor={a.email ?? "—"} />
            <Dado rotulo="Telefone" valor={a.telefone ?? "—"} />
            <Dado rotulo="Carteira" valor={a.carteira_nome ?? "sem dono"} sub={a.carteira_confirmada ? undefined : "sem registro forte"} />
          </div>

          {a.porque_o_valor && (
            <p className="mt-3 rounded-lg bg-white px-3 py-2 text-[11px] text-slate-600 dark:bg-slate-900/60 dark:text-slate-300">
              {a.porque_o_valor}
            </p>
          )}
          <p className="mt-2 text-[11px] text-slate-400 dark:text-slate-500">De quem é: {a.carteira_lastro}</p>
        </div>
      )}
    </Card>
  );
}

function Dado({ rotulo, valor, sub }: { rotulo: string; valor: string; sub?: string }) {
  return (
    <div className="min-w-0">
      <p className="text-[11px] text-slate-400 dark:text-slate-500">{rotulo}</p>
      <p className="truncate font-medium text-slate-800 dark:text-slate-200">{valor}</p>
      {sub && <p className="truncate text-[10px] text-slate-400 dark:text-slate-500">{sub}</p>}
    </div>
  );
}
