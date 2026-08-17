"use client";

// A folha imprimível de UM relatório emitido (F5, 16/08). Render ÚNICO e GENÉRICO: recebe um
// `ResultadoRelatorio` (lib/relatorios/tipos.ts, contrato congelado) e desenha a partir dele —
// esta tela NÃO conhece nomes de coluna, id de relatório nem regra de negócio nenhuma. Um
// relatório novo (1 arquivo + 1 linha no registry do backend) imprime igual, sem tocar aqui.
//
// Rastreabilidade (exigência do João): toda coluna carrega `fonte` — de onde aquele número
// saiu. A folha imprime essa lista de fontes na última seção, junto das ressalvas.
import type { ReactNode } from "react";
import { MarcaCasa, MarcaPortal } from "@/app/_components/marca";
import { Button, cn } from "@/app/_components/ui";
import { theadClass, thClass, thNumClass, tdClass, tdNumClass } from "@/app/_components/ui-base";
import { dtHoraBr } from "@/lib/relatorios/fmt";
import type { PortalId } from "@/lib/marcas";
import type { ResultadoRelatorio, Coluna } from "@/lib/relatorios/tipos";

export type MetaRelatorio = { emitido_por: string; emitido_em: string; escopo: string };

function alinhamentoDe(tipo: Coluna["tipo"]): { th: string; td: string } {
  if (tipo === "dinheiro" || tipo === "numero") return { th: thNumClass, td: tdNumClass };
  return { th: thClass, td: tdClass };
}

// Selo genérico: borda + texto, nunca só cor. O renderer não sabe o que "Quitado" ou "Pendente"
// SIGNIFICA (seria a tela conhecendo relatório específico) — então nenhum TOM é escolhido aqui.
// É o que garante legibilidade em preto e branco: o significado está na palavra, não na tinta.
function CelulaSelo({ children }: { children: ReactNode }) {
  return (
    <span className="inline-flex items-center rounded-full border border-slate-300 px-2 py-0.5 text-[11px] font-medium text-slate-700 dark:border-slate-600 dark:text-slate-200">
      {children ?? "—"}
    </span>
  );
}

function valorCelula(v: unknown): ReactNode {
  if (v === null || v === undefined || v === "") return "—";
  return String(v);
}

export function RelatorioFolha({
  protocolo,
  resultado,
  meta,
  portalId,
}: {
  protocolo: string;
  resultado: ResultadoRelatorio;
  meta: MetaRelatorio;
  /** Derivado do prefixo do protocolo (HM-AAAAMMDD-NNNN → 'hm') pela página; null quando o
   *  prefixo não casa com portal nenhum conhecido — a folha não deixa de renderizar por isso. */
  portalId: PortalId | null;
}) {
  const semDadoAlgum = resultado.secoes.every((s) => s.linhas.length === 0);

  return (
    <div className="folha mx-auto max-w-[900px]">
      {/* Barra de ação — some inteira na impressão (@media print, globals.css). */}
      <div className="no-print mb-4 flex items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white px-4 py-2.5 shadow-card dark:border-slate-800 dark:bg-slate-900">
        <p className="text-xs text-slate-500 dark:text-slate-400">
          Folha imutável — reabrir este protocolo sempre mostra estes mesmos números.
        </p>
        <Button size="sm" onClick={() => window.print()}>Imprimir / Salvar em PDF</Button>
      </div>

      <article className="rounded-xl border border-slate-200 bg-white p-8 shadow-card print:rounded-none print:border-0 print:p-0 print:shadow-none dark:border-slate-800 dark:bg-slate-900 print:dark:bg-white">
        {/* Cabeçalho: marca do portal + Grupo Participa (lib/marcas.ts é a fonte única — sem
            arquivo oficial de marca do grupo, o ponto de troca é lá, não aqui). */}
        <header className="flex flex-wrap items-start justify-between gap-4 border-b border-slate-200 pb-5 dark:border-slate-800 print:border-slate-300">
          <div className="flex items-center gap-3">
            {portalId && <MarcaPortal portal={portalId} altura="h-9" comNome={false} />}
            <div>
              <MarcaCasa altura="h-6" className="mb-1" />
              <p className="text-[11px] uppercase tracking-wide text-slate-400 dark:text-slate-500 print:text-slate-500">
                Grupo Participa
              </p>
            </div>
          </div>
          <div className="text-right">
            <p className="text-[11px] uppercase tracking-wide text-slate-400 dark:text-slate-500 print:text-slate-500">Protocolo</p>
            <p className="font-mono text-sm font-semibold tabular-nums text-slate-800 dark:text-slate-100 print:text-slate-900">{protocolo}</p>
          </div>
        </header>

        <div className="mt-5">
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900 dark:text-slate-100 print:text-slate-900">{resultado.titulo}</h1>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400 print:text-slate-600">{resultado.subtitulo}</p>
          <p className="mt-2 text-xs text-slate-400 dark:text-slate-500 print:text-slate-500">
            Gerado por {meta.emitido_por} em {dtHoraBr(meta.emitido_em)}
          </p>
        </div>

        {semDadoAlgum && (
          <div className="mt-5 rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600 dark:border-slate-800 dark:bg-slate-800/40 dark:text-slate-300 print:border-slate-300 print:bg-transparent">
            Nenhum dado encontrado no recorte pedido. Não é erro — é o retrato correto deste período.
          </div>
        )}

        {resultado.destaques.length > 0 && (
          <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4 print:grid-cols-4">
            {resultado.destaques.map((d, i) => (
              <div key={i} className="rounded-lg border border-slate-200 px-3 py-2.5 dark:border-slate-800 print:border-slate-300">
                <p className="text-[11px] text-slate-400 dark:text-slate-500 print:text-slate-500">{d.rotulo}</p>
                <p className="mt-0.5 text-lg font-semibold tabular-nums text-slate-900 dark:text-slate-100 print:text-slate-900">{d.valor}</p>
                {d.auxiliar && <p className="mt-0.5 text-[11px] text-slate-500 dark:text-slate-400 print:text-slate-600">{d.auxiliar}</p>}
              </div>
            ))}
          </div>
        )}

        {resultado.secoes.map((secao, i) => (
          <section key={i} className="secao-relatorio mt-8">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-700 dark:text-slate-200 print:text-slate-800">
              {secao.titulo}
            </h2>
            <p className="mt-0.5 text-sm text-slate-500 dark:text-slate-400 print:text-slate-600">{secao.chamada}</p>

            {secao.linhas.length === 0 ? (
              <p className="mt-3 rounded-lg border border-dashed border-slate-300 px-3 py-4 text-center text-sm text-slate-400 dark:border-slate-700 dark:text-slate-500">
                Nenhum dado no período.
              </p>
            ) : (
              <div className="mt-3 overflow-x-auto">
                <table className="w-full border-collapse text-sm">
                  <thead className={theadClass}>
                    <tr>
                      {secao.colunas.map((c) => {
                        const al = alinhamentoDe(c.tipo);
                        return (
                          <th key={c.chave} scope="col" className={al.th} title={`Fonte: ${c.fonte}`}>
                            {c.rotulo}
                          </th>
                        );
                      })}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800 print:divide-slate-200">
                    {secao.linhas.map((linha, li) => (
                      <tr key={li} className="linha-relatorio">
                        {secao.colunas.map((c) => {
                          const al = alinhamentoDe(c.tipo);
                          const v = linha[c.chave];
                          return (
                            <td key={c.chave} className={cn(al.td, "text-slate-700 dark:text-slate-200 print:text-slate-800")}>
                              {c.tipo === "selo" ? <CelulaSelo>{valorCelula(v)}</CelulaSelo> : valorCelula(v)}
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                  {secao.totais && (
                    <tfoot>
                      <tr className="border-t-2 border-slate-300 font-semibold dark:border-slate-700 print:border-slate-400">
                        {secao.colunas.map((c, ci) => {
                          const al = alinhamentoDe(c.tipo);
                          const v = secao.totais?.[c.chave];
                          return (
                            <td key={c.chave} className={cn(al.td, "text-slate-900 dark:text-slate-100 print:text-slate-900")}>
                              {ci === 0 && v === undefined ? "Total" : valorCelula(v)}
                            </td>
                          );
                        })}
                      </tr>
                    </tfoot>
                  )}
                </table>
              </div>
            )}
          </section>
        ))}

        {/* Última folha, sempre: de onde vem cada número + o que este relatório não afirma
            (§4.5 do plano). `fontes` já é a lista de objetos de banco; `Coluna.fonte` some por
            coluna também vive acima, no title="" de cada <th> — aqui é o resumo consolidado. */}
        <footer className="secao-relatorio mt-10 border-t border-slate-200 pt-5 dark:border-slate-800 print:border-slate-300">
          <div className="grid gap-6 sm:grid-cols-2">
            <div>
              <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400 print:text-slate-600">
                De onde vem cada número
              </h2>
              <ul className="mt-2 space-y-1 text-xs text-slate-500 dark:text-slate-400 print:text-slate-600">
                {resultado.fontes.map((f, i) => <li key={i} className="font-mono">{f}</li>)}
              </ul>
            </div>
            <div>
              <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400 print:text-slate-600">
                O que este relatório não afirma
              </h2>
              <ul className="mt-2 list-disc space-y-1 pl-4 text-xs text-slate-500 dark:text-slate-400 print:text-slate-600">
                {resultado.ressalvas.map((r, i) => <li key={i}>{r}</li>)}
              </ul>
            </div>
          </div>
        </footer>
      </article>

      {/* Rodapé fixo SÓ na impressão — protocolo legível em toda página. */}
      <div className="print-rodape" aria-hidden="true">
        Grupo Participa · Protocolo {protocolo} · Documento oficial, não editável
      </div>
    </div>
  );
}
