"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Button, Card, PageHeader, Spinner, cn } from "@/app/_components/ui";
import { PageFade } from "@/app/_components/anim";
// Do arquivo PURO, nunca do service: o service importa lib/db (pg) e isto é
// client component — o bundle do navegador não pode puxar o driver do Postgres.
import { EXPLICACAO, type Alerta, type CancelamentoHotmart, type CategoriaAlerta } from "@/lib/alertas-catalogo";

// Saúde do dinheiro (11/08). O monitor cs.hm_alertas existia desde a 0188 e não
// tinha tela: os alertas nasciam no banco e ninguém via. Esta página é a casa deles
// — e do registro dos cancelamentos que a Hotmart manda, que até então só existiam
// como carimbo dentro do card.
//
// A régua é: aqui só entra o que EXIGE uma pessoa. Alerta que o sistema consegue
// verificar sozinho se fecha sozinho (catalogar a oferta baixa o oferta_orfa).
//
// Redesenho de 13/08 (pedido do Marcio: "bater o olho e já entender, não bater o
// olho e ficar tentando entender"). O que mudou: 105 cards planos viraram 3
// críticos (item a item — cada um é uma decisão diferente) + blocos por tipo
// para os avisos (mesma explicação repetida 74 e 27 vezes não é 101
// informações, é 2). Identificador técnico (chave, tabela, uuid) some da
// primeira leitura e mora num "detalhes técnicos" que abre sob demanda.

function quando(v: string): string {
  const d = new Date(v);
  if (isNaN(d.getTime())) return "—";
  return d.toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
}

// ---- Ícones por categoria (13/08: "bota ícones para indicar as coisas") ----
// Mesma família visual do resto do sistema — traço, sem preenchimento, sem lib
// externa (ver app/_components/ajuda.tsx, copiavel.tsx). Não é severidade: é
// "que tipo de coisa é essa" — dinheiro, cadastro, integração ou pessoa.
function IconeDinheiro({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <line x1="12" y1="2" x2="12" y2="22" />
      <path d="M17 6.5H9.5a3 3 0 0 0 0 6h5a3 3 0 0 1 0 6H6" />
    </svg>
  );
}
function IconeCadastro({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M20.59 13.41 12.42 21.58a2 2 0 0 1-2.83 0L2 14V2h12l6.59 6.59a2 2 0 0 1 0 2.82z" />
      <circle cx="7.5" cy="7.5" r="1.5" />
    </svg>
  );
}
function IconeIntegracao({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M13 2 3 14h7l-1 8 11-13h-8l1-7z" />
    </svg>
  );
}
function IconePessoa({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
      <circle cx="12" cy="7" r="4" />
    </svg>
  );
}
const ICONE: Record<CategoriaAlerta, (props: { className?: string }) => React.JSX.Element> = {
  dinheiro: IconeDinheiro,
  cadastro: IconeCadastro,
  integracao: IconeIntegracao,
  pessoa: IconePessoa,
};

function Seta({ className }: { className?: string }) {
  return (
    <svg className={cn("h-4 w-4 shrink-0 text-slate-400 transition-transform group-open:rotate-180", className)} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="m6 9 6 6 6-6" />
    </svg>
  );
}

// Selo de "detalhes técnicos" — tabela, chave, id. O suporte precisa, o
// operador não; por isso mora atrás de um toggle, não na primeira leitura.
function DetalhesTecnicos({ chave, tipo }: { chave: string | null; tipo: string }) {
  if (!chave) return null;
  return (
    <details className="group/tec mt-1.5">
      <summary className="alvo-toque inline-flex cursor-pointer list-none items-center gap-1 text-[11px] text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 [&::-webkit-details-marker]:hidden">
        <svg className="h-3 w-3 shrink-0 transition-transform group-open/tec:rotate-180" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="m6 9 6 6 6-6" />
        </svg>
        detalhes técnicos
      </summary>
      <div className="mt-1 flex flex-wrap items-center gap-1.5">
        <code className="rounded bg-slate-100 px-1.5 py-0.5 text-[11px] text-slate-600 dark:bg-slate-800 dark:text-slate-300">{chave}</code>
        <span className="text-[11px] text-slate-400">tipo: {tipo}</span>
      </div>
    </details>
  );
}

const badgeCritico = "rounded-full bg-rose-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-rose-700 dark:bg-rose-950 dark:text-rose-300";
const badgeAviso = "rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-800 dark:bg-amber-950 dark:text-amber-300";

export default function AlertasPage() {
  const [alertas, setAlertas] = useState<Alerta[]>([]);
  const [cancelamentos, setCancelamentos] = useState<CancelamentoHotmart[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [baixando, setBaixando] = useState<string | null>(null);

  const carregar = useCallback(async () => {
    setCarregando(true);
    setErro(null);
    try {
      const r = await fetch("/api/hm/alertas");
      // 0195: separar "servidor respondeu erro" de "não deu para falar com o
      // servidor". O catch único fazia todo 500 virar "sem conexão" e custava tempo
      // de diagnóstico.
      if (!r.ok) { setErro(`O servidor recusou (${r.status}).`); return; }
      const d = await r.json();
      if (!d.ok) { setErro("O servidor respondeu, mas sem os dados."); return; }
      setAlertas(d.alertas ?? []);
      setCancelamentos(d.cancelamentos ?? []);
    } catch {
      setErro("Sem conexão com o servidor.");
    } finally {
      setCarregando(false);
    }
  }, []);
  useEffect(() => { carregar(); }, [carregar]);

  async function baixar(id: string) {
    setBaixando(id);
    try {
      const r = await fetch("/api/hm/alertas", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });
      if (r.ok) setAlertas((a) => a.filter((x) => x.id !== id));
    } finally {
      setBaixando(null);
    }
  }

  const criticos = alertas.filter((a) => a.severidade === "critico");
  const avisos = alertas.filter((a) => a.severidade !== "critico");

  // Um tipo de problema = um bloco, não N cards (13/08). 74 "sem_canal" e 27
  // "compra_fora_do_razao" repetiam a mesma explicação; agrupado, a explicação
  // aparece uma vez e o que muda por item (o `detalhe`, vindo do banco) fica
  // na lista que abre sob demanda. Maior contagem primeiro — problema mais
  // espalhado primeiro.
  const gruposAviso = useMemo(() => {
    const porTipo = new Map<string, Alerta[]>();
    for (const a of avisos) {
      const arr = porTipo.get(a.tipo);
      if (arr) arr.push(a); else porTipo.set(a.tipo, [a]);
    }
    return [...porTipo.entries()]
      .map(([tipo, itens]) => ({ tipo, itens }))
      .sort((a, b) => b.itens.length - a.itens.length);
  }, [avisos]);

  return (
    <PageFade>
      <PageHeader
        title="Saúde do dinheiro"
        description="O que o sistema detectou sozinho e depende de uma pessoa para resolver — mais os cancelamentos que a Hotmart mandou nos últimos 30 dias."
      />

      {erro && (
        <Card className="mb-4 border-rose-300 bg-rose-50 p-3 text-sm text-rose-700 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-300">
          {erro} <button onClick={carregar} className="underline">tentar de novo</button>
        </Card>
      )}

      {carregando ? (
        <div className="flex justify-center py-16"><Spinner /></div>
      ) : (
        <>
          <div className="mb-4 flex flex-wrap items-baseline gap-x-4 gap-y-1 text-sm">
            <span className={cn("font-semibold", criticos.length > 0 ? "text-rose-600 dark:text-rose-400" : "text-emerald-600 dark:text-emerald-400")}>
              {criticos.length === 0 ? "Nenhum alerta crítico" : `${criticos.length} crítico${criticos.length > 1 ? "s" : ""}`}
            </span>
            <span className="text-slate-500 dark:text-slate-400">
              {avisos.length} aviso{avisos.length === 1 ? "" : "s"}
              {gruposAviso.length > 1 && ` em ${gruposAviso.length} tipos`}
            </span>
            <button onClick={carregar} className="text-xs text-slate-400 underline hover:text-slate-600">atualizar</button>
          </div>

          {/* Críticos: item a item — cada um é uma decisão diferente, e são só 3. */}
          {criticos.length > 0 && (
            <div className="mb-3 space-y-2">
              {criticos.map((a) => {
                const ex = EXPLICACAO[a.tipo];
                const Icone = ex ? ICONE[ex.categoria] : null;
                return (
                  <Card key={a.id} className="border-rose-300 p-3.5 dark:border-rose-900/70">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="flex min-w-0 flex-1 items-start gap-3">
                        <span className="mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-rose-100 text-rose-700 dark:bg-rose-500/15 dark:text-rose-300">
                          {Icone ? <Icone className="h-4 w-4" /> : null}
                        </span>
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className={badgeCritico}>crítico</span>
                            <h2 className="text-sm font-semibold text-slate-800 dark:text-slate-100">
                              {ex?.titulo ?? a.tipo}
                            </h2>
                            <span className="text-[11px] text-slate-400">{quando(a.detectado_em)}</span>
                          </div>
                          <p className="mt-1.5 text-xs text-slate-600 dark:text-slate-300">{a.detalhe}</p>
                          {ex && <p className="mt-1 text-xs text-slate-500 dark:text-slate-400"><strong>O que fazer:</strong> {ex.acao}</p>}
                          <DetalhesTecnicos chave={a.chave} tipo={a.tipo} />
                        </div>
                      </div>
                      <Button
                        variant="secondary"
                        onClick={() => baixar(a.id)}
                        disabled={baixando === a.id}
                        title="Marcar como resolvido — some da lista"
                        className="alvo-toque shrink-0 text-xs"
                      >
                        {baixando === a.id ? "…" : "Resolvido"}
                      </Button>
                    </div>
                  </Card>
                );
              })}
            </div>
          )}

          {/* Avisos: um bloco por tipo. Abre para ver os itens; a explicação
              (que era repetida em cada card) aparece uma vez no cabeçalho. */}
          {gruposAviso.length > 0 && (
            <div className="space-y-2">
              {gruposAviso.map(({ tipo, itens }) => {
                const ex = EXPLICACAO[tipo];
                const Icone = ex ? ICONE[ex.categoria] : null;
                return (
                  <details key={tipo} className="group overflow-hidden rounded-xl border border-amber-200/70 bg-white shadow-card dark:border-amber-900/40 dark:bg-slate-900">
                    <summary className="alvo-toque flex cursor-pointer list-none items-start gap-3 p-3.5 [&::-webkit-details-marker]:hidden">
                      <span className="mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300">
                        {Icone ? <Icone className="h-4 w-4" /> : null}
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className={badgeAviso}>aviso</span>
                          <h2 className="text-sm font-semibold text-slate-800 dark:text-slate-100">
                            {ex?.titulo ?? tipo}
                          </h2>
                          <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-semibold text-amber-700 dark:bg-amber-500/10 dark:text-amber-300">
                            {itens.length}×
                          </span>
                        </div>
                        {ex && <p className="mt-1 text-xs text-slate-500 dark:text-slate-400"><strong>O que fazer:</strong> {ex.acao}</p>}
                      </div>
                      <Seta className="mt-1.5" />
                    </summary>
                    <div className="space-y-1.5 border-t border-amber-100 px-3.5 pb-3 pt-2.5 dark:border-amber-900/30">
                      {itens.map((a) => (
                        <div
                          key={a.id}
                          className="flex flex-wrap items-start justify-between gap-2 rounded-lg bg-amber-50/60 px-2.5 py-2 dark:bg-amber-500/5"
                        >
                          <div className="min-w-0 flex-1">
                            <p className="text-xs text-slate-600 dark:text-slate-300">{a.detalhe}</p>
                            <div className="mt-1 flex flex-wrap items-center gap-2">
                              {a.chave && (
                                <code className="rounded bg-slate-100 px-1.5 py-0.5 text-[11px] text-slate-600 dark:bg-slate-800 dark:text-slate-300">{a.chave}</code>
                              )}
                              <span className="text-[11px] text-slate-400">{quando(a.detectado_em)}</span>
                            </div>
                          </div>
                          <Button
                            variant="secondary"
                            size="sm"
                            onClick={() => baixar(a.id)}
                            disabled={baixando === a.id}
                            title="Marcar como resolvido — some da lista"
                            className="alvo-toque shrink-0"
                          >
                            {baixando === a.id ? "…" : "Resolvido"}
                          </Button>
                        </div>
                      ))}
                    </div>
                  </details>
                );
              })}
            </div>
          )}

          {alertas.length === 0 && (
            <Card className="p-6 text-center text-sm text-slate-500 dark:text-slate-400">
              Nada pendente. Todo pagamento que entrou achou o card dele.
            </Card>
          )}

          <h2 className="mb-2 mt-8 text-sm font-semibold text-slate-700 dark:text-slate-200">
            Cancelamentos vindos da Hotmart <span className="font-normal text-slate-400">(30 dias)</span>
          </h2>
          <Card className="overflow-x-auto p-0">
            <table className="w-full min-w-[640px] text-left text-xs">
              <thead className="border-b border-slate-200 text-[11px] uppercase tracking-wide text-slate-500 dark:border-slate-800 dark:text-slate-400">
                <tr>
                  <th className="px-3 py-2 font-medium">Pessoa</th>
                  <th className="px-3 py-2 font-medium">Board</th>
                  <th className="px-3 py-2 font-medium">Evento</th>
                  <th className="px-3 py-2 font-medium">Etapa agora</th>
                  <th className="px-3 py-2 font-medium">Quando</th>
                </tr>
              </thead>
              <tbody>
                {cancelamentos.map((c) => (
                  <tr key={c.contato_hm_id + c.cancelado_em} className="border-b border-slate-100 last:border-0 dark:border-slate-800/60">
                    <td className="px-3 py-2">
                      <div className="font-medium text-slate-800 dark:text-slate-100">{c.nome}</div>
                      <div className="text-[11px] text-slate-400">{c.email}</div>
                    </td>
                    <td className="px-3 py-2 text-slate-600 dark:text-slate-300">{c.produto ?? "—"}</td>
                    <td className="px-3 py-2 text-slate-600 dark:text-slate-300">{c.evento ?? "—"}</td>
                    <td className="px-3 py-2 text-slate-600 dark:text-slate-300">{c.etapa ?? "—"}</td>
                    <td className="px-3 py-2 whitespace-nowrap text-slate-500 dark:text-slate-400">{quando(c.cancelado_em)}</td>
                  </tr>
                ))}
                {cancelamentos.length === 0 && (
                  <tr><td colSpan={5} className="px-3 py-6 text-center text-slate-400">Nenhum cancelamento nos últimos 30 dias.</td></tr>
                )}
              </tbody>
            </table>
          </Card>
        </>
      )}
    </PageFade>
  );
}
