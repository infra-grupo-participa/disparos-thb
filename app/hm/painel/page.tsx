"use client";

import { useEffect, useState } from "react";
import { MarcaPortal } from "@/app/_components/marca";
import { useProdutoHm } from "@/app/hm/_components/use-produto";
import { AtividadeDesempenho } from "@/app/_components/atividade-desempenho";
import { Card, Spinner, cn, fieldCompactClass } from "@/app/_components/ui";
import { Callout, KpiComparado, SectionTitle, type SeriePontoUi } from "@/app/_components/ui-base";
import { msgErroPermissao } from "@/app/_components/use-me";
import { GRANULARIDADES, PERIODOS_ATALHO, type Granularidade, type PeriodoAtalho } from "@/lib/validators";

// PAINEL — "como estamos no período", separado do "o que eu faço agora"
// (Jornada/Agenda/Atividade). Pedido do Marcio, 16/08, literal: "a nave está
// muito confusa (...) misturado com as atividades do sistema (...) não
// consigo analisar no longo prazo." Consome /api/hm/painel (B2) —
// lib/services/hm-painel.ts documenta o porquê de FLUXO e ESTADO serem
// tratados como espécies diferentes de número; aqui só se lê o contrato.
//
// F3 (16/08): o painel `AtividadeDesempenho` SAI de /atividade (o "carro-chefe"
// que estava misturado com registro de atividade operacional) e passa a viver
// só aqui — não duplicado. Ver app/hm/atividade/page.tsx.

type KpiPainel = {
  chave: "recebido" | "a_receber" | "entraram" | "quitaram" | "precisam_de_acao";
  rotulo: string;
  tipo: "fluxo" | "estado";
  valor: number | null;
  variacao_absoluta: number | null;
  variacao_pct: number | null;
  serie: SeriePontoUi[];
};

type PainelResposta = {
  ok: boolean;
  periodo: { de: string; ate: string };
  periodo_anterior: { de: string; ate: string };
  serie_estado_comeca_em: string | null;
  kpis: KpiPainel[];
  reason?: string;
};

const RÓTULO_PERIODO: Record<PeriodoAtalho, string> = {
  hoje: "Hoje", "7d": "7 dias", "30d": "30 dias", mes: "Mês", livre: "Intervalo",
};
const ATALHOS_PERIODO: { id: PeriodoAtalho; label: string }[] = PERIODOS_ATALHO.map((id) => ({ id, label: RÓTULO_PERIODO[id] }));

const RÓTULO_GRANULARIDADE: Record<Granularidade, string> = { dia: "Dia", semana: "Semana", mes: "Mês" };

// Formato + sentido de cada KPI — vem daqui, não do servidor: a API devolve
// número, quem decide "dinheiro ou contagem" e "mais é melhor ou menos é
// melhor" é a tela (o mesmo dado poderia render diferente em outro lugar).
const FORMATO_KPI: Record<KpiPainel["chave"], "numero" | "dinheiro"> = {
  recebido: "dinheiro", a_receber: "dinheiro", entraram: "numero", quitaram: "numero", precisam_de_acao: "numero",
};
const INVERTIDO_KPI: Record<KpiPainel["chave"], boolean> = {
  recebido: false, entraram: false, quitaram: false, a_receber: true, precisam_de_acao: true,
};

function isoHoje(): string { return new Date().toISOString().slice(0, 10); }
function isoDiasAtras(n: number): string { const d = new Date(); d.setDate(d.getDate() - n); return d.toISOString().slice(0, 10); }
function dataBr(iso: string | null): string { return iso ? iso.slice(0, 10).split("-").reverse().join("/") : "—"; }

export default function PainelPage() {
  const { produto, portal, nome: nomePortal } = useProdutoHm();
  const [periodo, setPeriodo] = useState<PeriodoAtalho>("30d");
  const [de, setDe] = useState(() => isoDiasAtras(29));
  const [ate, setAte] = useState(isoHoje());
  const [granularidade, setGranularidade] = useState<Granularidade>("dia");
  const [dados, setDados] = useState<PainelResposta | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    let cancelado = false;
    setDados(null);
    setErro(null);
    const p = new URLSearchParams({ periodo, produto, granularidade });
    if (periodo === "livre") { p.set("de", de); p.set("ate", ate); }
    fetch(`/api/hm/painel?${p.toString()}`)
      .then((r) => r.json())
      .then((d: PainelResposta) => {
        if (cancelado) return;
        if (!d.ok) { setErro(msgErroPermissao(d.reason) ?? "Não foi possível carregar o painel."); return; }
        setDados(d);
      })
      .catch(() => { if (!cancelado) setErro("Sem conexão com o servidor."); });
    return () => { cancelado = true; };
  }, [produto, periodo, de, ate, granularidade]);

  const kpiPorChave = (chave: KpiPainel["chave"]): KpiPainel | null => dados?.kpis.find((k) => k.chave === chave) ?? null;
  const CHAVES_FLUXO: KpiPainel["chave"][] = ["recebido", "entraram", "quitaram"];
  const CHAVES_ESTADO: KpiPainel["chave"][] = ["a_receber", "precisam_de_acao"];
  const fluxo = CHAVES_FLUXO.map(kpiPorChave).filter((k): k is KpiPainel => k !== null);
  const estado = CHAVES_ESTADO.map(kpiPorChave).filter((k): k is KpiPainel => k !== null);

  // Honestidade da série de ESTADO (regra do plano, item 3): o pró-rata usa
  // CURRENT_DATE, então "quanto faltava antes de 16/08" é um número que nunca
  // existiu — a tela diz isso na cara, nunca desenha uma linha reta em zero
  // fingindo histórico.
  const notaEstado = !dados
    ? undefined
    : dados.serie_estado_comeca_em
      ? `Sem dado antes de ${dataBr(dados.serie_estado_comeca_em)}.`
      : "Ainda sem nenhum fechamento diário registrado.";

  const endpointDesempenho = `/api/hm/atividade/desempenho?produto=${produto}`;

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="flex items-center gap-2.5">
            <MarcaPortal portal={portal} altura="h-7" comNome={false} />
            <h1 className="text-xl font-semibold tracking-tight text-slate-900 dark:text-slate-100">Painel · {nomePortal}</h1>
          </div>
          <p className="mt-0.5 text-sm text-slate-500 dark:text-slate-400">
            Como estamos no período — separado do que se faz agora (Jornada, Agenda, Atividade).
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="inline-flex shrink-0 rounded-lg bg-slate-100 p-0.5 dark:bg-slate-800/80">
            {ATALHOS_PERIODO.map((a) => (
              <button
                key={a.id}
                type="button"
                onClick={() => setPeriodo(a.id)}
                aria-pressed={periodo === a.id}
                className={cn(
                  "alvo-toque rounded-md px-3 py-1.5 text-sm font-medium transition",
                  periodo === a.id
                    ? "bg-white text-slate-900 shadow-card dark:bg-slate-700 dark:text-slate-100"
                    : "text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200",
                )}
              >
                {a.label}
              </button>
            ))}
          </div>
          {periodo === "livre" && (
            <div className="flex items-center gap-1.5">
              <label className="sr-only" htmlFor="painel-de">Data inicial</label>
              <input id="painel-de" type="date" value={de} max={ate} onChange={(e) => setDe(e.target.value)} className={fieldCompactClass} />
              <span className="text-xs text-slate-400 dark:text-slate-500" aria-hidden="true">até</span>
              <label className="sr-only" htmlFor="painel-ate">Data final</label>
              <input id="painel-ate" type="date" value={ate} min={de} max={isoHoje()} onChange={(e) => setAte(e.target.value)} className={fieldCompactClass} />
            </div>
          )}
        </div>
      </div>

      {erro && (
        <Card className="mb-3 border-rose-200 p-4 text-sm text-rose-700 dark:border-rose-900/50 dark:text-rose-300">{erro}</Card>
      )}

      {!dados && !erro && (
        <div className="flex items-center gap-2 py-16 text-sm text-slate-400"><Spinner /> carregando o painel…</div>
      )}

      {dados && (
        <>
          {/* ===== FLUXO — reconstruível para qualquer janela do passado ===== */}
          <div className="mb-5">
            <SectionTitle
              acao={
                <div className="inline-flex shrink-0 rounded-lg bg-slate-100 p-0.5 dark:bg-slate-800/80">
                  {GRANULARIDADES.map((g) => (
                    <button
                      key={g}
                      type="button"
                      onClick={() => setGranularidade(g)}
                      aria-pressed={granularidade === g}
                      className={cn(
                        "alvo-toque rounded-md px-2.5 py-1 text-xs font-medium transition",
                        granularidade === g
                          ? "bg-white text-slate-900 shadow-card dark:bg-slate-700 dark:text-slate-100"
                          : "text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200",
                      )}
                    >
                      {RÓTULO_GRANULARIDADE[g]}
                    </button>
                  ))}
                </div>
              }
            >
              Fluxo no período — {dataBr(dados.periodo.de)} a {dataBr(dados.periodo.ate)}
            </SectionTitle>
            <p className="-mt-1 mb-2 text-[11px] text-slate-400 dark:text-slate-500">
              Comparado com {dataBr(dados.periodo_anterior.de)} a {dataBr(dados.periodo_anterior.ate)}, o período imediatamente anterior de mesma duração.
            </p>
            <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-3">
              {fluxo.map((k) => (
                <KpiComparado
                  key={k.chave}
                  rotulo={k.rotulo}
                  valor={k.valor}
                  variacaoAbsoluta={k.variacao_absoluta}
                  variacaoPct={k.variacao_pct}
                  serie={k.serie}
                  formato={FORMATO_KPI[k.chave]}
                  invertido={INVERTIDO_KPI[k.chave]}
                />
              ))}
            </div>
          </div>

          {/* ===== ESTADO — foto do agora, sempre ao vivo ===== */}
          <div className="mb-5">
            <SectionTitle>Estado agora — ao vivo, bate com a Carteira no mesmo minuto</SectionTitle>
            <Callout tom="contexto" titulo="A série de estado só existe a partir de 16/08/2026" className="mb-2.5">
              O saldo a receber muda todo dia por pró-rata — &ldquo;quanto faltava&rdquo; antes do primeiro fechamento diário é um
              número que nunca existiu, então o gráfico não inventa um. {notaEstado}
            </Callout>
            <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
              {estado.map((k) => (
                <KpiComparado
                  key={k.chave}
                  rotulo={k.rotulo}
                  valor={k.valor}
                  variacaoAbsoluta={k.variacao_absoluta}
                  variacaoPct={k.variacao_pct}
                  serie={k.serie}
                  formato={FORMATO_KPI[k.chave]}
                  invertido={INVERTIDO_KPI[k.chave]}
                  auxiliar={k.chave === "a_receber" ? "Creditado por cs.vw_hm_carteira (a linha do tempo da ficha) — não pelo campo \"responsável comercial\"." : undefined}
                  nota={notaEstado}
                />
              ))}
            </div>
          </div>

          {/* ===== Desempenho comercial × ativação — mudou de casa (F3) ===== */}
          <SectionTitle>Desempenho comercial × ativação</SectionTitle>
          <Callout tom="contexto" className="mb-2.5">
            Passou a creditar pela carteira reconstruída (a mesma que a tela Carteira usa), não mais pelo campo
            &ldquo;responsável comercial&rdquo; da ficha — os dois critérios divergiam em 174 pessoas. Se este número mudou em
            relação a um print antigo, é o critério corrigido, não um erro novo.
          </Callout>
          <AtividadeDesempenho endpoint={endpointDesempenho} />
        </>
      )}
    </div>
  );
}
