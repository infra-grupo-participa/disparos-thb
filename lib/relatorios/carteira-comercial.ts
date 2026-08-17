import { carteiraHm } from "@/lib/services/hm-carteira";
import { brl, dtBr } from "@/lib/relatorios/fmt";
import type { ContextoRelatorio, DefinicaoRelatorio, ResultadoRelatorio, Secao } from "@/lib/relatorios/tipos";

// Reusa carteiraHm() por inteiro — nenhum SELECT aqui (lei §4.1 de tipos.ts). A função já
// aplica escopoVisibilidade(sessao) por dentro (lib/services/hm-carteira.ts:207), então este
// gerador herda o recorte de quem gerou sem precisar repeti-lo.

async function gerar(ctx: ContextoRelatorio): Promise<ResultadoRelatorio> {
  const { resumo, alunos, hoje } = await carteiraHm({ produto: ctx.produto }, ctx.sessao);

  const totalAlunos = alunos.length;
  const quitados = alunos.filter((a) => a.status === "quitado").length;
  const recebido = resumo.reduce((s, r) => s + r.recebido, 0);
  const aReceber = resumo.reduce((s, r) => s + r.a_receber, 0);
  const saldoMovel = alunos.filter((a) => (a.credito_ciclo_anterior ?? 0) > 0);

  const secaoResumo: Secao = {
    titulo: "Resumo por carteira",
    chamada: "Quanto cada pessoa do comercial tem sob responsabilidade — recebido no ciclo e o que falta cobrar.",
    colunas: [
      { chave: "pessoa", rotulo: "Comercial", tipo: "texto", fonte: "cs.vw_hm_carteira.carteira_nome" },
      { chave: "alunos", rotulo: "Alunos", tipo: "numero", fonte: "cs.vw_hm_carteira (contagem por carteira)" },
      { chave: "quitados", rotulo: "Quitados", tipo: "numero", fonte: "cs.vw_hm_carteira.status" },
      { chave: "pagando", rotulo: "Pagando", tipo: "numero", fonte: "cs.vw_hm_carteira.status" },
      { chave: "so_entrada", rotulo: "Só entrada", tipo: "numero", fonte: "cs.vw_hm_carteira.status" },
      { chave: "recebido", rotulo: "Recebido no ciclo", tipo: "dinheiro", fonte: "cs.vw_hm_carteira.pago_no_ciclo (soma)" },
      { chave: "a_receber", rotulo: "A receber", tipo: "dinheiro", fonte: "cs.vw_hm_financeiro.saldo_a_perseguir (soma)" },
      { chave: "conferir", rotulo: "Conferir", tipo: "numero", fonte: "lib/services/hm-carteira.ts:conferirDe" },
    ],
    linhas: resumo.map((r) => ({
      pessoa: r.pessoa,
      alunos: r.alunos,
      quitados: r.quitados,
      pagando: r.pagando,
      so_entrada: r.so_entrada,
      recebido: brl(r.recebido),
      a_receber: brl(r.a_receber),
      conferir: r.conferir,
    })),
    totais: { alunos: totalAlunos, recebido: brl(recebido), a_receber: brl(aReceber) },
  };

  // Ordem literal pedida pela Kelly (diário 08/08, citada no plano do arquiteto §4.6).
  const secaoDetalhe: Secao = {
    titulo: "Detalhe por aluno",
    chamada: "Quem é, quanto pagou, quando pagou e por que o valor dele não é R$ 15.000,00.",
    colunas: [
      { chave: "aluno", rotulo: "Aluno", tipo: "texto", fonte: "cs.vw_hm_carteira.nome" },
      { chave: "situacao", rotulo: "Situação", tipo: "selo", fonte: "cs.vw_hm_carteira.status" },
      { chave: "pagou_restante", rotulo: "Pagou o restante?", tipo: "selo", fonte: "pago_no_ciclo × pacote_efetivo" },
      { chave: "quanto_pagou", rotulo: "Quanto pagou", tipo: "dinheiro", fonte: "cs.vw_hm_carteira.pago_no_ciclo" },
      { chave: "quando_pagou", rotulo: "Quando pagou", tipo: "data", fonte: "cs.vw_hm_carteira.ultimo_pagamento_apos_entrada" },
      { chave: "valor_que_paga", rotulo: "Valor que ele paga", tipo: "dinheiro", fonte: "cs.vw_hm_carteira.pacote_efetivo" },
      { chave: "porque_nao_15k", rotulo: "Por que não é R$ 15.000", tipo: "texto", fonte: "lib/services/hm-carteira.ts:porqueOValor" },
      { chave: "falta_pagar", rotulo: "Falta pagar", tipo: "dinheiro", fonte: "cs.vw_hm_carteira.falta_pagar" },
      { chave: "quando_paga", rotulo: "Quando ele paga", tipo: "texto", fonte: "lib/services/hm-carteira.ts:cobrancaDe" },
    ],
    linhas: alunos.map((a) => ({
      aluno: a.nome,
      situacao: a.status,
      pagou_restante:
        a.status === "quitado" ? "Sim" : a.status === "cancelado" || a.status === "entrada_estornada" ? "—" : "Não",
      quanto_pagou: brl(a.pago_no_ciclo),
      quando_pagou: dtBr(a.ultimo_pagamento_em),
      valor_que_paga: brl(a.pacote),
      porque_nao_15k: a.porque_o_valor || "—",
      falta_pagar: brl(a.falta_pagar),
      quando_paga: a.cobranca,
    })),
  };

  return {
    titulo: "Carteira de clientes — Comercial",
    subtitulo: `${ctx.produto ?? "HM"} · emitido em ${dtBr(hoje)} · ${ctx.protocolo}`,
    destaques: [
      { rotulo: "Alunos na carteira", valor: String(totalAlunos) },
      {
        rotulo: "Quitados",
        valor: String(quitados),
        auxiliar: totalAlunos ? `${Math.round((quitados / totalAlunos) * 100)}%` : undefined,
      },
      { rotulo: "Recebido no ciclo", valor: brl(recebido) },
      { rotulo: "A receber", valor: brl(aReceber) },
    ],
    secoes: [secaoResumo, secaoDetalhe],
    ressalvas: [
      // Frase validada com o João em 03:00 de 16/08 (plano do arquiteto §4.6) — literal.
      "É um retrato de acompanhamento e de dinheiro por carteira. Não é apuração de comissionamento: atendimento por WhatsApp, ligação e reunião não passa pela ficha.",
      saldoMovel.length > 0
        ? `O saldo a receber de ${saldoMovel.length} pessoa(s) usa crédito pró-rata que anda com a data de hoje (cs.fn_hm_prorata) — este número vale para ${dtBr(hoje)}. Reabrir este protocolo depois mostra este MESMO número, mesmo que o saldo real tenha mudado (é o motivo de o relatório emitido ser congelado).`
        : "Nenhuma pessoa desta carteira depende de crédito pró-rata móvel neste recorte.",
      "\"Sem dono identificado\" agrupa quem ainda não tem carteira resolvida (carteira_usuario_id nulo) — não é erro, é fila.",
    ],
    fontes: ["cs.vw_hm_carteira (0240→0245)", "cs.vw_hm_financeiro", "lib/services/hm-carteira.ts:carteiraHm"],
  };
}

export const carteiraComercial: DefinicaoRelatorio = {
  id: "carteira-comercial",
  nome: "Carteira de clientes do comercial",
  descricao: "Quem é de cada pessoa do comercial, quanto já pagou, quanto falta e quando paga.",
  params: ["produto"],
  portais: ["HM", "AURUM", "ETHB"],
  gerar,
};
