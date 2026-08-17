import { carteiraHm } from "@/lib/services/hm-carteira";
import { atividadeHm, atividadeAutomaticaHm, type EscopoAtividade } from "@/lib/services/hm-atividade";
import { painelHm, type KpiPainel } from "@/lib/services/hm-painel";
import { podeVerTudo } from "@/lib/papeis";
import { brl } from "@/lib/relatorios/fmt";
import type { ContextoRelatorio, DefinicaoRelatorio, ResultadoRelatorio, Secao } from "@/lib/relatorios/tipos";

// Fonte da série: `painelHm` (lib/services/hm-painel.ts, bloco B2) — os MESMOS 5 KPIs da tela
// {base}/painel, mesma régua de comparação com o período anterior e mesmo snapshot
// (cs.hm_fechamento_diario) para "a receber"/"precisam de ação". Painel e relatório saem da
// MESMA função — é a lei §4.1 de tipos.ts aplicada de novo: divergir entre a tela e o PDF
// deixa de ser possível por construção.

// `podeVerTudo` (não `nivelDe(...) === "master"`, achado INFO do pentester 16/08): o gerente
// distribuidor enxerga a esteira inteira mesmo sem ser master — ver o mesmo comentário em
// lib/relatorios/acoes-do-comercial.ts.
function escopoAtividadeDe(ctx: ContextoRelatorio): EscopoAtividade {
  if (podeVerTudo(ctx.sessao)) return { modo: "tudo" };
  if (ctx.sessao.equipe_id) return { modo: "equipe", equipeId: ctx.sessao.equipe_id };
  return { modo: "operador", nome: (ctx.sessao as { nome?: string | null }).nome || "" };
}

const KPIS_MONETARIOS = new Set(["recebido", "a_receber"]);
const fmtKpiValor = (k: KpiPainel): string =>
  k.valor === null ? "—" : KPIS_MONETARIOS.has(k.chave) ? brl(k.valor) : String(k.valor);
const fmtKpiVariacao = (k: KpiPainel): string | undefined => {
  if (k.variacao_pct === null || k.variacao_absoluta === null) return undefined;
  const sinal = k.variacao_absoluta >= 0 ? "+" : "";
  return `${sinal}${k.variacao_pct}% vs. período anterior`;
};

async function gerar(ctx: ContextoRelatorio): Promise<ResultadoRelatorio> {
  const escopo = escopoAtividadeDe(ctx);
  const [{ resumo, alunos }, atividade, automatica, painel] = await Promise.all([
    carteiraHm({ produto: ctx.produto }, ctx.sessao),
    atividadeHm({ de: ctx.de, ate: ctx.ate, produto: ctx.produto }, escopo),
    atividadeAutomaticaHm({ de: ctx.de, ate: ctx.ate, produto: ctx.produto }),
    painelHm({ periodo: "livre", de: ctx.de, ate: ctx.ate, granularidade: null, produto: ctx.produto }, ctx.sessao),
  ]);

  const totalAcoesHumanas = atividade.colaboradores.reduce((s, c) => s + c.total, 0);
  const quitados = alunos.filter((a) => a.status === "quitado").length;
  const cancelados = alunos.filter((a) => a.status === "cancelado" || a.status === "entrada_estornada").length;

  const secaoPainel: Secao = {
    titulo: "Como estamos no período — comparado ao anterior",
    chamada: "Mesmos 5 indicadores da tela Painel: fluxo somado no período (Recebido/Entraram/Quitaram) e foto do agora comparada ao snapshot do dia anterior (A receber/Precisam de ação).",
    colunas: [
      { chave: "kpi", rotulo: "Indicador", tipo: "texto", fonte: "lib/services/hm-painel.ts:painelHm" },
      { chave: "valor", rotulo: "No período", tipo: "texto", fonte: "cs.vw_hm_carteira / cs.hm_pagamentos / cs.hm_fechamento_diario" },
      { chave: "anterior", rotulo: "Período anterior", tipo: "texto", fonte: "mesma janela, duração anterior imediata" },
      { chave: "variacao", rotulo: "Variação", tipo: "texto", fonte: "lib/services/hm-painel.ts:variacao" },
    ],
    linhas: painel.kpis.map((k) => ({
      kpi: k.rotulo,
      valor: fmtKpiValor(k),
      anterior: k.valor_anterior === null ? "sem dado" : KPIS_MONETARIOS.has(k.chave) ? brl(k.valor_anterior) : String(k.valor_anterior),
      variacao: fmtKpiVariacao(k) ?? "sem base de comparação",
    })),
  };

  const secaoCarteira: Secao = {
    titulo: "Onde está o dinheiro, por carteira",
    chamada: "Retrato de agora, por pessoa do comercial.",
    colunas: [
      { chave: "pessoa", rotulo: "Comercial", tipo: "texto", fonte: "cs.vw_hm_carteira.carteira_nome" },
      { chave: "alunos", rotulo: "Alunos", tipo: "numero", fonte: "cs.vw_hm_carteira (contagem)" },
      { chave: "recebido", rotulo: "Recebido no ciclo", tipo: "dinheiro", fonte: "cs.vw_hm_carteira.pago_no_ciclo (soma)" },
      { chave: "a_receber", rotulo: "A receber", tipo: "dinheiro", fonte: "cs.vw_hm_financeiro.saldo_a_perseguir (soma)" },
    ],
    linhas: resumo.map((r) => ({ pessoa: r.pessoa, alunos: r.alunos, recebido: brl(r.recebido), a_receber: brl(r.a_receber) })),
  };

  const secaoAtividade: Secao = {
    titulo: "Atividade do comercial no período",
    chamada: "Ações registradas no sistema por pessoa — o detalhe por tipo está no relatório \"Ações do comercial\".",
    colunas: [
      { chave: "colaborador", rotulo: "Colaborador", tipo: "texto", fonte: "cs.interacoes.autor" },
      { chave: "total", rotulo: "Ações", tipo: "numero", fonte: "cs.interacoes (contagem)" },
    ],
    linhas: atividade.colaboradores.map((c) => ({ colaborador: c.colaborador, total: c.total })),
    totais: { total: totalAcoesHumanas },
  };

  const destaques: ResultadoRelatorio["destaques"] = painel.kpis.map((k) => ({
    rotulo: k.rotulo,
    valor: fmtKpiValor(k),
    auxiliar: fmtKpiVariacao(k),
  }));
  destaques.push({ rotulo: "Ações do time no período", valor: String(totalAcoesHumanas) });
  destaques.push({ rotulo: "Eventos automáticos", valor: String(automatica.total), auxiliar: "não soma ao total do time" });

  return {
    titulo: "Visão geral",
    subtitulo: `${ctx.produto ?? "HM"} · ${ctx.de ?? "início"} a ${ctx.ate ?? "hoje"} · ${ctx.protocolo}`,
    destaques,
    secoes: [secaoPainel, secaoCarteira, secaoAtividade],
    ressalvas: [
      painel.serie_estado_comeca_em
        ? `"A receber" e "Precisam de ação" comparam com o snapshot diário, que começa em ${painel.serie_estado_comeca_em}. Período anterior a essa data aparece como "sem dado", nunca como zero — não é um dia sem trabalho, é ausência de medição.`
        : "O snapshot diário (cs.hm_fechamento_diario) ainda não tem nenhum dia fechado nesta base — \"A receber\" e \"Precisam de ação\" aparecem sem comparação com o período anterior até o primeiro fechamento do cron.",
      `Alunos: ${alunos.length} no total, ${quitados} quitados, ${cancelados} cancelados/estornados — retrato do momento da emissão.`,
      "Ações medem o que foi registrado no sistema, não o resultado comercial. Eventos automáticos (webhook/automação) aparecem à parte, nunca somados ao trabalho do time.",
      "Não existe interação nenhuma antes de 08/06/2026 — período que cruza essa data reflete ausência de registro, não ausência de trabalho.",
    ],
    fontes: [
      "cs.vw_hm_carteira",
      "cs.vw_hm_financeiro",
      "cs.hm_fechamento_diario",
      "cs.hm_pagamentos",
      "cs.interacoes",
      "lib/services/hm-painel.ts:painelHm",
      "lib/services/hm-carteira.ts:carteiraHm",
      "lib/services/hm-atividade.ts:atividadeHm",
      "lib/services/hm-atividade.ts:atividadeAutomaticaHm",
    ],
  };
}

export const visaoGeral: DefinicaoRelatorio = {
  id: "visao-geral",
  nome: "Visão geral",
  descricao: "Retrato consolidado: os 5 indicadores do Painel, onde está o dinheiro por carteira e a atividade do comercial no período.",
  params: ["periodo", "produto"],
  portais: ["HM", "AURUM", "ETHB"],
  gerar,
};
