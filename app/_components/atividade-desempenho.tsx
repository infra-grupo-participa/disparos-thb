"use client";

// Dashboard de desempenho comercial × ativação — o "carro-chefe" (pedido do
// Marcio, 12/08 à noite): "a gente bate o olho e pensa 'esse pessoal não tá
// performando bem, essa aqui tá bem'". Dados de /api/hm/atividade/desempenho
// (lib/services/hm-atividade.ts/desempenhoHm) — ver o cabeçalho daquela seção
// para o porquê dos dois eixos (comercial/ativação) nunca se somarem: o
// comercial fecha venda (KPI é dinheiro), a ativação libera acesso (KPI é
// "quantos alunos ela levou até a quitação", nunca R$).
//
// Cor é SEMPRE função do valor relativo ao TIME no período — nunca uma cor
// fixa (já houve regressão de SLA 0% pintado de verde, ver disparos-brain).
// Com 1 pessoa só no período não há "time" para comparar: fica neutro.

import { useEffect, useState } from "react";
import { Card, Spinner, cn } from "@/app/_components/ui";
import { msgErroPermissao } from "@/app/_components/use-me";

type DesempenhoComercial = {
  usuario_id: string | null;
  pessoa: string;
  cards: number;
  total_fechado: number;
  total_sinal: number;
  total_saldo: number;
  total_compra_cheia: number;
  total_mensalidade: number;
  n_saldos: number;
  n_saldos_com_prazo_valido: number;
  mediana_dias_ate_saldo: number | null;
};

type DesempenhoAtivacao = {
  usuario_id: string | null;
  pessoa: string;
  alunos_ativados: number;
  n_com_prazo_valido: number;
  mediana_dias_ate_quitacao: number | null;
};

type Resposta = { ok: boolean; comercial?: DesempenhoComercial[]; ativacao?: DesempenhoAtivacao[]; reason?: string };

// Abaixo disto uma mediana de dias não sustenta comparação — "sem dado
// suficiente" em vez de um número que o volume não aguenta (regra do Marcio:
// nunca afirmar o que o dado não sustenta).
const BASE_MINIMA_PRAZO = 3;

const moeda = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });
const mediana = (ns: number[]): number | null => {
  if (ns.length === 0) return null;
  const s = [...ns].sort((a, b) => a - b);
  const meio = Math.floor(s.length / 2);
  return s.length % 2 ? s[meio] : (s[meio - 1] + s[meio]) / 2;
};

// `maiorMelhor`: dinheiro/alunos-ativados → mais é melhor; dias-até-fechar →
// menos é melhor (o time mais RÁPIDO é o de cima, não o de número maior).
function selo(valor: number, medianaTime: number | null, nPessoas: number, maiorMelhor: boolean): { texto: string; tom: string } {
  if (nPessoas <= 1 || medianaTime === null) return { texto: "Único no período", tom: "text-slate-400 dark:text-slate-500" };
  const acima = maiorMelhor ? valor > medianaTime : valor < medianaTime;
  const igual = valor === medianaTime;
  if (igual) return { texto: "Na mediana do time", tom: "text-amber-700 dark:text-amber-300" };
  return acima
    ? { texto: "Acima da mediana do time", tom: "text-emerald-700 dark:text-emerald-300" }
    : { texto: "Abaixo da mediana do time", tom: "text-rose-700 dark:text-rose-300" };
}

function isoDia(offset = 0): string {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  return d.toISOString().slice(0, 10);
}

export function AtividadeDesempenho({ endpoint }: { endpoint: string /* "/api/hm/atividade/desempenho" (+ ?produto=) */ }) {
  const [de, setDe] = useState(isoDia(-30));
  const [ate, setAte] = useState(isoDia(0));
  const [comercial, setComercial] = useState<DesempenhoComercial[] | null>(null);
  const [ativacao, setAtivacao] = useState<DesempenhoAtivacao[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    let cancelado = false;
    setComercial(null);
    setAtivacao(null);
    setErro(null);
    const p = new URLSearchParams({ de, ate: (() => { const d = new Date(ate + "T00:00:00"); d.setDate(d.getDate() + 1); return d.toISOString().slice(0, 10); })() });
    fetch(`${endpoint}${endpoint.includes("?") ? "&" : "?"}${p.toString()}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(r)))
      .then((d: Resposta) => {
        if (cancelado) return;
        if (d.ok) { setComercial(d.comercial ?? []); setAtivacao(d.ativacao ?? []); }
        else { setComercial([]); setAtivacao([]); setErro(msgErroPermissao(d.reason) ?? "Não foi possível carregar o desempenho."); }
      })
      .catch(() => { if (!cancelado) { setComercial([]); setAtivacao([]); setErro("Falha de rede — tente atualizar."); } });
    return () => { cancelado = true; };
  }, [endpoint, de, ate]);

  const carregando = comercial === null || ativacao === null;
  // "Sem responsável comercial" NÃO é uma pessoa — é o dinheiro dos cards
  // vendidos antes de 12/08, quando responsavel_comercial_id passou a existir
  // (0211/0212). Medido em produção hoje: 92 cards e R$ 530.178,88 nessa
  // situação, contra R$ 23.124,90 da Kelly e R$ 3.696,99 da Jusy.
  //
  // Deixar essa linha no ranking faria a mediana do time subir para um patamar
  // que ninguém alcança e pintaria TODO MUNDO de vermelho -- a tela diria "a
  // equipe inteira está mal" quando o que existe é um buraco de instrumentação.
  // Sai da tabela, sai da mediana, e vira a nota de rodapé abaixo, que explica
  // o motivo. Não foi preenchido por backfill de propósito: 67 dos 94 cards em
  // ativação têm a Ana Camila como dona vigente, e ela é da ATIVAÇÃO -- copiar
  // o dono atual para o campo do comercial creditaria a ela 67 vendas que não
  // fez, bem no número que vai medir a equipe.
  const semDono = (comercial ?? []).find((c) => c.usuario_id === null) ?? null;
  const comercialRankeado = (comercial ?? []).filter((c) => c.usuario_id !== null);
  const medianaFechado = !carregando ? mediana(comercialRankeado.map((c) => c.total_fechado)) : null;
  const medianaPrazoSaldo = !carregando
    ? mediana(comercialRankeado.filter((c) => c.n_saldos_com_prazo_valido >= BASE_MINIMA_PRAZO && c.mediana_dias_ate_saldo !== null).map((c) => c.mediana_dias_ate_saldo as number))
    : null;
  const medianaAtivados = !carregando ? mediana((ativacao ?? []).map((a) => a.alunos_ativados)) : null;
  const medianaPrazoQuitacao = !carregando
    ? mediana((ativacao ?? []).filter((a) => a.n_com_prazo_valido >= BASE_MINIMA_PRAZO && a.mediana_dias_ate_quitacao !== null).map((a) => a.mediana_dias_ate_quitacao as number))
    : null;

  const atalhos: Array<{ label: string; de: number }> = [{ label: "7 dias", de: -7 }, { label: "30 dias", de: -30 }, { label: "90 dias", de: -90 }];

  return (
    <Card className="mb-3 overflow-hidden">
      <div className="flex flex-wrap items-end justify-between gap-3 border-b border-slate-200 p-4 dark:border-slate-800">
        <div>
          <h2 className="text-sm font-semibold text-slate-800 dark:text-slate-100">Desempenho comercial × ativação</h2>
          <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
            Comercial fecha venda (dinheiro). Ativação libera acesso (leva o aluno até a quitação). São eixos diferentes — nunca somados num número só.
          </p>
        </div>
        <div className="inline-flex shrink-0 rounded-lg bg-slate-100 p-0.5 dark:bg-slate-800/80">
          {atalhos.map((a) => {
            const ativo = de === isoDia(a.de) && ate === isoDia(0);
            return (
              <button
                key={a.label}
                onClick={() => { setDe(isoDia(a.de)); setAte(isoDia(0)); }}
                aria-pressed={ativo}
                className={cn("rounded-md px-3 py-1.5 text-sm font-medium transition",
                  ativo ? "bg-white text-slate-900 shadow-card dark:bg-slate-700 dark:text-slate-100"
                        : "text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200")}
              >
                {a.label}
              </button>
            );
          })}
        </div>
      </div>

      {carregando ? (
        <div className="flex items-center justify-center gap-2 p-10 text-sm text-slate-400"><Spinner /> carregando…</div>
      ) : erro ? (
        <p className="p-10 text-center text-sm text-rose-600 dark:text-rose-400">{erro}</p>
      ) : (
        <div className="divide-y divide-slate-200 dark:divide-slate-800">
          {/* ===== Comercial ===== */}
          <div className="p-4">
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">Comercial — quem fechou</h3>
            {comercialRankeado.length === 0 ? (
              <p className="py-6 text-center text-sm text-slate-400">Nenhum pagamento atribuído a um responsável comercial neste período.</p>
            ) : (
              // min-w força rolagem horizontal (não o texto espremendo em coluna de
              // 40px) abaixo de ~640px — sem isso "Acima da mediana do time" quebrava
              // em 5 linhas por célula no celular.
              <div className="overflow-x-auto">
                <table className="w-full min-w-[640px] text-sm">
                  <thead>
                    <tr className="border-b border-slate-200 text-left text-xs uppercase tracking-wide text-slate-400 dark:border-slate-800 dark:text-slate-500">
                      <th className="py-2 pr-3 font-medium">Quem</th>
                      <th className="px-3 py-2 text-right font-medium" title="Soma de sinal + saldo + compra cheia + mensalidade pagos no período, dos alunos que este comercial fechou">Total fechado</th>
                      <th className="px-3 py-2 text-right font-medium" title="Saldos (categoria 'saldo') pagos por quem já estava com este comercial — o pedido literal do Marcio">Saldos pagos</th>
                      <th className="px-3 py-2 text-right font-medium" title="Mediana de dias entre a entrada do aluno e o pagamento do saldo — mediana, não média, para não distorcer com um caso fora da curva">Tempo até o saldo</th>
                      <th className="py-2 pl-3 text-right font-medium">Como está</th>
                    </tr>
                  </thead>
                  <tbody>
                    {comercialRankeado.map((c) => {
                      const seloDinheiro = selo(c.total_fechado, medianaFechado, comercialRankeado.length, true);
                      const temPrazo = c.n_saldos_com_prazo_valido >= BASE_MINIMA_PRAZO && c.mediana_dias_ate_saldo !== null;
                      const seloPrazo = temPrazo ? selo(c.mediana_dias_ate_saldo as number, medianaPrazoSaldo, comercialRankeado.filter((x) => x.n_saldos_com_prazo_valido >= BASE_MINIMA_PRAZO).length, false) : null;
                      return (
                        <tr key={c.usuario_id ?? c.pessoa} className="border-b border-slate-100 last:border-0 hover:bg-slate-50 dark:border-slate-800/60 dark:hover:bg-slate-800/40">
                          <td className="py-2.5 pr-3 font-medium text-slate-800 dark:text-slate-100">{c.pessoa}</td>
                          <td className="px-3 py-2.5 text-right font-semibold tabular-nums text-slate-900 dark:text-white" title={`${c.cards} card(s) com pagamento no período`}>{moeda(c.total_fechado)}</td>
                          <td className="px-3 py-2.5 text-right tabular-nums text-slate-600 dark:text-slate-300">
                            {c.n_saldos > 0 ? moeda(c.total_saldo) : <span className="text-slate-400 dark:text-slate-500">Não calculado</span>}
                          </td>
                          <td className="px-3 py-2.5 text-right tabular-nums text-slate-600 dark:text-slate-300">
                            {temPrazo ? `${Math.round(c.mediana_dias_ate_saldo as number)} dia(s)` : <span className="text-slate-400 dark:text-slate-500" title={c.n_saldos_com_prazo_valido > 0 ? `${c.n_saldos_com_prazo_valido} saldo(s) — abaixo de ${BASE_MINIMA_PRAZO}, base insuficiente` : "Nenhum saldo com prazo computável no período"}>Sem dado suficiente</span>}
                          </td>
                          <td className="py-2.5 pl-3 text-right">
                            <div className={cn("text-[11px] font-semibold", seloDinheiro.tom)}>{seloDinheiro.texto}</div>
                            {seloPrazo && <div className={cn("text-[11px]", seloPrazo.tom)}>{seloPrazo.texto === "Único no período" ? "" : `Ritmo: ${seloPrazo.texto.toLowerCase()}`}</div>}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}

            {/* O BURACO, dito em voz alta. Sem esta linha, quem olha a tabela
                conclui que a equipe fechou R$ 27 mil no mês — quando o mês teve
                meio milhão e a maior parte não tem dono registrado. Número que
                omite o próprio limite mente mais do que número nenhum. */}
            {semDono && semDono.total_fechado > 0 && (
              <p className="mt-3 rounded-md border border-amber-200 bg-amber-50 px-2.5 py-2 text-[11px] leading-relaxed text-amber-900 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-200">
                <strong>Fora do ranking: {moeda(semDono.total_fechado)}</strong> em {semDono.cards} card(s)
                sem responsável comercial registrado. O campo que guarda quem vendeu passou a existir
                em 12/08 — venda anterior a isso não tem dono gravado, e o sistema não adivinha.
                Esse dinheiro não entra na conta de ninguém aqui, nem puxa a média do time para baixo.
                À medida que as vendas novas forem entrando, a distorção some sozinha.
              </p>
            )}
          </div>

          {/* ===== Ativação ===== */}
          <div className="p-4">
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">Ativação — quem tirou o aluno do papel</h3>
            <p className="mb-2 text-xs text-slate-400 dark:text-slate-500">Não é dinheiro: é quantos alunos esta pessoa levou até a quitação enquanto era a responsável pela ativação deles.</p>
            {(ativacao ?? []).length === 0 ? (
              <p className="py-6 text-center text-sm text-slate-400">Nenhum aluno quitou sob um responsável de ativação neste período.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[480px] text-sm">
                  <thead>
                    <tr className="border-b border-slate-200 text-left text-xs uppercase tracking-wide text-slate-400 dark:border-slate-800 dark:text-slate-500">
                      <th className="py-2 pr-3 font-medium">Quem</th>
                      <th className="px-3 py-2 text-right font-medium" title="Alunos que quitaram o saldo no período enquanto esta pessoa era a responsável de ativação">Alunos ativados</th>
                      <th className="px-3 py-2 text-right font-medium" title="Mediana de dias entre a entrada do aluno e a quitação">Tempo até quitar</th>
                      <th className="py-2 pl-3 text-right font-medium">Como está</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(ativacao ?? []).map((a) => {
                      const seloVolume = selo(a.alunos_ativados, medianaAtivados, (ativacao ?? []).length, true);
                      const temPrazo = a.n_com_prazo_valido >= BASE_MINIMA_PRAZO && a.mediana_dias_ate_quitacao !== null;
                      const seloPrazo = temPrazo ? selo(a.mediana_dias_ate_quitacao as number, medianaPrazoQuitacao, (ativacao ?? []).filter((x) => x.n_com_prazo_valido >= BASE_MINIMA_PRAZO).length, false) : null;
                      return (
                        <tr key={a.usuario_id ?? a.pessoa} className="border-b border-slate-100 last:border-0 hover:bg-slate-50 dark:border-slate-800/60 dark:hover:bg-slate-800/40">
                          <td className="py-2.5 pr-3 font-medium text-slate-800 dark:text-slate-100">{a.pessoa}</td>
                          <td className="px-3 py-2.5 text-right font-semibold tabular-nums text-slate-900 dark:text-white">{a.alunos_ativados}</td>
                          <td className="px-3 py-2.5 text-right tabular-nums text-slate-600 dark:text-slate-300">
                            {temPrazo ? `${Math.round(a.mediana_dias_ate_quitacao as number)} dia(s)` : <span className="text-slate-400 dark:text-slate-500" title={a.n_com_prazo_valido > 0 ? `${a.n_com_prazo_valido} caso(s) — abaixo de ${BASE_MINIMA_PRAZO}, base insuficiente` : "Nenhum caso com prazo computável no período"}>Sem dado suficiente</span>}
                          </td>
                          <td className="py-2.5 pl-3 text-right">
                            <div className={cn("text-[11px] font-semibold", seloVolume.tom)}>{seloVolume.texto}</div>
                            {seloPrazo && <div className={cn("text-[11px]", seloPrazo.tom)}>{seloPrazo.texto === "Único no período" ? "" : `Ritmo: ${seloPrazo.texto.toLowerCase()}`}</div>}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}
    </Card>
  );
}
