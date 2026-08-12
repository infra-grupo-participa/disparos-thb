"use client";

import { useCallback, useEffect, useState } from "react";
import { Button, Card, PageHeader, Spinner, cn } from "@/app/_components/ui";
import { PageFade } from "@/app/_components/anim";
// Do arquivo PURO, nunca do service: o service importa lib/db (pg) e isto é
// client component — o bundle do navegador não pode puxar o driver do Postgres.
import { EXPLICACAO, type Alerta, type CancelamentoHotmart } from "@/lib/alertas-catalogo";

// Saúde do dinheiro (11/08). O monitor cs.hm_alertas existia desde a 0188 e não
// tinha tela: os alertas nasciam no banco e ninguém via. Esta página é a casa deles
// — e do registro dos cancelamentos que a Hotmart manda, que até então só existiam
// como carimbo dentro do card.
//
// A régua é: aqui só entra o que EXIGE uma pessoa. Alerta que o sistema consegue
// verificar sozinho se fecha sozinho (catalogar a oferta baixa o oferta_orfa).

function quando(v: string): string {
  const d = new Date(v);
  if (isNaN(d.getTime())) return "—";
  return d.toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
}

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
            <span className="text-slate-500 dark:text-slate-400">{avisos.length} aviso{avisos.length === 1 ? "" : "s"}</span>
            <button onClick={carregar} className="text-xs text-slate-400 underline hover:text-slate-600">atualizar</button>
          </div>

          <div className="space-y-2">
            {[...criticos, ...avisos].map((a) => {
              const ex = EXPLICACAO[a.tipo];
              const critico = a.severidade === "critico";
              return (
                <Card
                  key={a.id}
                  className={cn("p-3.5", critico && "border-rose-300 dark:border-rose-900/70")}
                >
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className={cn(
                          "rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
                          critico
                            ? "bg-rose-100 text-rose-700 dark:bg-rose-950 dark:text-rose-300"
                            : "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300",
                        )}>
                          {critico ? "crítico" : "aviso"}
                        </span>
                        <h2 className="text-sm font-semibold text-slate-800 dark:text-slate-100">
                          {ex?.titulo ?? a.tipo}
                        </h2>
                        {a.chave && (
                          <code className="rounded bg-slate-100 px-1.5 py-0.5 text-[11px] text-slate-600 dark:bg-slate-800 dark:text-slate-300">{a.chave}</code>
                        )}
                        <span className="text-[11px] text-slate-400">{quando(a.detectado_em)}</span>
                      </div>
                      <p className="mt-1.5 text-xs text-slate-600 dark:text-slate-300">{a.detalhe}</p>
                      {ex && <p className="mt-1 text-xs text-slate-500 dark:text-slate-400"><strong>O que fazer:</strong> {ex.acao}</p>}
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
            {alertas.length === 0 && (
              <Card className="p-6 text-center text-sm text-slate-500 dark:text-slate-400">
                Nada pendente. Todo pagamento que entrou achou o card dele.
              </Card>
            )}
          </div>

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
