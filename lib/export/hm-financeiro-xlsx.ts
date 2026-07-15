import ExcelJS from "exceljs";
import type { LinhaEsteira } from "@/lib/services/hm-relatorio";
import type { PagamentoHm, RelatorioFinanceiroHm } from "@/lib/services/hm-financeiro";

// A planilha do financeiro. Cinco leituras do mesmo dinheiro:
//
//   Resumo         — quanto entrou, quanto falta, e o que está fora do lugar.
//   Carteira       — a posição de cada aluno: pacote, recebido, saldo, parcelas.
//   A receber      — só quem deve, do maior saldo para o menor. É a lista de cobrança.
//   Pagamentos     — o razão: cada real que entrou, um por linha. É o que se concilia.
//   Cancelamentos  — o confronto: nós dissemos que cancelou; a Hotmart confirmou?
//
// Regra que vale para o arquivo inteiro: célula de dinheiro é NÚMERO ou vazia,
// nunca "—". Um traço em coluna de valor quebra a soma do Excel — e quem abre a
// planilha vai somar. Vazio também não é zero: é "o sistema não sabe" (o saldo
// de quem não tem crédito pró-rata informado), e a aba "A receber" diz isso em
// letras, na coluna ao lado.

const LARANJA = "FFF97316";
const LARANJA_CLARO = "FFFDE8D7";
const CINZA = "FFF1F5F9";
const AMBAR_CLARO = "FFFEF3C7";

const DINHEIRO = 'R$ #,##0.00';
const DATA = "dd/mm/yyyy";
const DATA_HORA = "dd/mm/yyyy hh:mm";

function n(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const x = typeof v === "string" ? Number(v) : (v as number);
  return Number.isFinite(x) ? x : null;
}
function d(v: unknown): Date | null {
  if (!v) return null;
  const x = new Date(v as string);
  return isNaN(x.getTime()) ? null : x;
}
const txt = (v: unknown) => (v === null || v === undefined || v === "" ? "—" : Array.isArray(v) ? v.join(", ") : (v as string));
const sn = (v: unknown) => (v === true ? "Sim" : v === false ? "Não" : "—");

// O que a pessoa ainda deve. Mesma regra da tela (app/hm/tabela): o saldo da
// régua já desconta tudo o que entrou; o da fn_hm_prorata é só a reserva.
// Null = incalculável — e isso NÃO é zero.
const saldoDe = (l: LinhaEsteira): number | null => n(l.saldo_a_perseguir) ?? n(l.saldo_a_pagar);
// Quem ainda é cobrança: não quitou, não foi liberado para ativação e não cancelou.
const devendo = (l: LinhaEsteira): boolean =>
  !l.quitado && !l.apto_ativacao && !l.cancelamento_efetivado_em && !l.hotmart_cancelado_em;

// O saldo a receber de um grupo, com a distinção que importa:
//   ninguém ali deve             → 0   (os quitados: não há nada a receber, é fato)
//   devem, mas nenhum é calculável → null (o sistema não sabe quanto — e zero seria
//                                    a mentira exata: são os que ninguém está cobrando)
function somaSaldo(ls: LinhaEsteira[]): number | null {
  const devedores = ls.filter(devendo);
  if (devedores.length === 0) return 0;
  const vals = devedores.map(saldoDe).filter((x): x is number => x !== null);
  return vals.length ? vals.reduce((a, b) => a + b, 0) : null;
}

const CATEGORIA: Record<string, string> = {
  sinal: "Sinal",
  saldo: "Saldo",
  mensalidade: "Mensalidade",
  compra_cheia: "Compra cheia",
};
const SITUACAO: Record<string, string> = {
  quitado: "Quitado",
  mensalidade_em_curso: "Mensalidade em curso",
  oferta_enviada: "Oferta enviada",
  saldo_parado: "Saldo parado",
  incalculavel: "Saldo incalculável",
  cancelado: "Cancelado",
};
const PUBLICO: Record<string, string> = {
  lead_novo: "Lead novo",
  aluno_base: "Aluno da base",
  nao_classificado: "Não classificado",
};
// Reembolso e chargeback acabam os dois em "aluno sem acesso", mas para o
// financeiro são coisas MUITO diferentes: um é devolução combinada, o outro é o
// cliente contestando na operadora do cartão (e há taxa, e há prazo).
const EVENTO: Record<string, string> = {
  PURCHASE_REFUNDED: "Reembolso",
  PURCHASE_CHARGEBACK: "Chargeback",
  PURCHASE_PROTEST: "Protesto",
  PURCHASE_CANCELED: "Compra cancelada",
  SUBSCRIPTION_CANCELLATION: "Assinatura cancelada",
};
// A situação da compra HM na Hotmart (0094) — o fato do dinheiro.
const STATUS_HM: Record<string, string> = {
  APPROVED: "Aprovada", COMPLETE: "Concluída", COMPLETED: "Concluída",
  PRINTED_BILLET: "Boleto impresso", BILLET_PRINTED: "Boleto impresso",
  WAITING_PAYMENT: "Aguardando pagamento", EXPIRED: "Expirada",
  REFUNDED: "Reembolsada", CHARGEBACK: "Chargeback", PROTESTED: "Protestada", CANCELED: "Cancelada",
};

type Col<T> = { header: string; width: number; get: (x: T) => unknown; fmt?: "data" | "datahora" | "dinheiro" | "pct" };

export function nomeArquivoFinanceiro(agora: Date): string {
  return `Financeiro-HM-${agora.toISOString().slice(0, 10)}.xlsx`;
}

export async function financeiroHmParaXlsx(r: RelatorioFinanceiroHm, agora: Date): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "CS · Grupo Participa";
  wb.created = agora;

  resumo(wb, r, agora);
  tabela(wb, "Carteira", COLS_CARTEIRA, r.linhas, { totais: ["Recebido", "Saldo a pagar", "Crédito pró-rata"] });

  // A cobrança: maior saldo primeiro. Quem o sistema não sabe quanto deve vai
  // para o fim — não some da lista (é justamente quem ninguém está cobrando).
  const aCobrar = r.linhas.filter(devendo)
    .sort((a, b) => (saldoDe(b) ?? -1) - (saldoDe(a) ?? -1));
  tabela(wb, "A receber", COLS_A_RECEBER, aCobrar, { totais: ["Saldo a pagar", "Recebido"] });

  tabela(wb, "Pagamentos", COLS_PAGAMENTOS, r.pagamentos, { totais: ["Valor"] });

  const cancelados = r.linhas.filter(
    (l) => l.cancelamento_em || l.cancelamento_efetivado_em || l.hotmart_cancelado_em,
  );
  tabela(wb, "Cancelamentos", COLS_CANCELAMENTOS, cancelados, { totais: ["Recebido"] });

  const buf = await wb.xlsx.writeBuffer();
  return Buffer.from(buf);
}

// ------------------------------------------------------------------- Resumo

function resumo(wb: ExcelJS.Workbook, r: RelatorioFinanceiroHm, agora: Date) {
  const ws = wb.addWorksheet("Resumo", { views: [{ state: "frozen", ySplit: 2 }] });
  ws.columns = [{ width: 34 }, { width: 14 }, { width: 18 }, { width: 18 }, { width: 40 }];

  ws.mergeCells("A1:E1");
  const t = ws.getCell("A1");
  t.value = "Financeiro · Holding Masters";
  t.font = { bold: true, size: 14, color: { argb: "FFFFFFFF" } };
  t.fill = { type: "pattern", pattern: "solid", fgColor: { argb: LARANJA } };
  t.alignment = { vertical: "middle" };
  ws.getRow(1).height = 26;

  // Uma planilha filtrada que não diz que está filtrada é uma armadilha: quem a
  // abre depois soma achando que é a carteira inteira.
  const filtros = [
    r.filtros.responsavel?.length && `responsável: ${r.filtros.responsavel.join(" ou ")}`,
    r.filtros.canal?.length && `canal: ${r.filtros.canal.join(" ou ")}`,
    r.filtros.turma?.length && `turma: ${r.filtros.turma.join(" ou ")}`,
    r.filtros.estagio && `etapa: ${r.filtros.estagio}`,
  ].filter(Boolean);
  ws.mergeCells("A2:E2");
  const s = ws.getCell("A2");
  s.value = `${r.linhas.length} aluno(s) · exportado em ${agora.toLocaleString("pt-BR")}`
    + `${filtros.length ? ` · filtros — ${filtros.join(" · ")}` : " · sem filtros (a carteira inteira)"}`;
  s.font = { italic: true, color: { argb: "FF64748B" } };
  s.fill = { type: "pattern", pattern: "solid", fgColor: { argb: CINZA } };

  // ----- o que entrou (o razão é o fato) -----
  // A quebra por categoria vem dos pagamentos, não dos totais do card: é o razão
  // que sabe se os R$ 186 mil de saldo vieram de 16 pagamentos ou de um só.
  const cats = Array.from(new Set(r.pagamentos.map((p) => p.categoria ?? "—")));
  const entrou = r.pagamentos.reduce((a, p) => a + (n(p.valor) ?? 0), 0);
  secao(ws, "O QUE ENTROU (razão de pagamentos)", ["Categoria", "Pagamentos", "Total"], [
    ...cats.map((c) => {
      const ps = r.pagamentos.filter((p) => (p.categoria ?? "—") === c);
      return [CATEGORIA[c] ?? c, ps.length, ps.reduce((a, p) => a + (n(p.valor) ?? 0), 0)];
    }),
    ["TOTAL RECEBIDO", r.pagamentos.length, entrou],
  ], { dinheiro: [3], destacarUltima: true });

  // ----- o que falta entrar -----
  const aCobrar = r.linhas.filter(devendo);
  const comSaldo = aCobrar.filter((l) => saldoDe(l) !== null);
  const semSaldo = aCobrar.length - comSaldo.length;
  const aReceber = comSaldo.reduce((a, l) => a + (saldoDe(l) ?? 0), 0);
  secao(ws, "O QUE FALTA ENTRAR", ["", "Alunos", "Valor"], [
    ["Devendo, com saldo calculado", comSaldo.length, aReceber],
    // Sem repetir a contagem: a média é do mesmo grupo da linha de cima, e um "136"
    // aqui se leria como outros 136 alunos.
    ["Ticket médio do saldo", "", comSaldo.length ? aReceber / comSaldo.length : null],
    // Estes DEVEM — o sistema é que não sabe quanto (falta o crédito pró-rata na
    // ficha). Somem da conta e a carteira parece menor do que é.
    ["⚠ Devendo, sem saldo calculável", semSaldo, null],
  ], { dinheiro: [3], alertaSe: (i) => i === 2 && semSaldo > 0 });

  // ----- a carteira por situação -----
  const sits = Array.from(new Set(r.linhas.map((l) => l.situacao_financeira ?? "—")));
  secao(ws, "A CARTEIRA POR SITUAÇÃO", ["Situação", "Alunos", "Saldo a receber"], sits.map((x) => {
    const ls = r.linhas.filter((l) => (l.situacao_financeira ?? "—") === x);
    return [SITUACAO[x] ?? x, ls.length, somaSaldo(ls)];
  }), { dinheiro: [3] });

  // ----- por público -----
  // Lead novo e aluno da base pagam pacotes diferentes (o da base tem crédito
  // pró-rata abatido). Misturá-los no total esconde as duas realidades.
  const pubs = Array.from(new Set(r.linhas.map((l) => l.publico ?? "nao_classificado")));
  secao(ws, "POR PÚBLICO", ["Público", "Alunos", "Recebido", "Saldo a receber"], pubs.map((x) => {
    const ls = r.linhas.filter((l) => (l.publico ?? "nao_classificado") === x);
    return [
      PUBLICO[x] ?? x,
      ls.length,
      ls.reduce((a, l) => a + (n(l.valor_pago) ?? 0), 0),
      somaSaldo(ls),
    ];
  }), { dinheiro: [3, 4] });

  // ----- por canal de aquisição (B1) -----
  // "Quanto de quanto": total de vendas e o que entrou, por onde a pessoa entrou.
  // O canal é a tag "pelo fato" (0052), materializada na view (0094) — nunca o
  // texto da oferta. Quem não tem canal classificado aparece (não some do total).
  const canais = Array.from(new Set(r.linhas.map((l) => l.canal_aquisicao ?? "não identificado")));
  const totalRecebido = r.linhas.reduce((a, l) => a + (n(l.valor_pago) ?? 0), 0);
  secao(ws, "POR CANAL DE AQUISIÇÃO", ["Canal", "Vendas", "Recebido", "% do recebido"], canais
    .map((c) => {
      const ls = r.linhas.filter((l) => (l.canal_aquisicao ?? "não identificado") === c);
      const receb = ls.reduce((a, l) => a + (n(l.valor_pago) ?? 0), 0);
      return [c, ls.length, receb, totalRecebido ? receb / totalRecebido : null] as unknown[];
    })
    .sort((a, b) => (b[2] as number) - (a[2] as number)),
    { dinheiro: [3], pct: [4] });

  // ----- parcelamento -----
  // Contratadas é o que a pessoa assinou; pagas é o que entrou. A diferença é a
  // inadimplência — por isso as duas andam juntas, nunca só o total.
  const parcelados = r.linhas.filter((l) => (l.parcelas_contratadas ?? 0) > 0);
  const pagas = parcelados.reduce((a, l) => a + (l.parcelas_pagas ?? 0), 0);
  const contratadas = parcelados.reduce((a, l) => a + (l.parcelas_contratadas ?? 0), 0);
  secao(ws, "PARCELAMENTO", ["", "Alunos", "Parcelas"], [
    ["Alunos com parcelamento", parcelados.length, contratadas],
    // A contagem de alunos é a mesma das três linhas — repeti-la faria parecer que
    // são grupos diferentes. Só a linha de cima a mostra.
    ["Parcelas já pagas", "", pagas],
    ["Parcelas a vencer ou em atraso", "", Math.max(0, contratadas - pagas)],
  ], {});

  // ----- cancelamentos: o confronto -----
  const cancHm = r.linhas.filter((l) => l.hotmart_cancelado_em);
  const semConfirma = r.linhas.filter((l) => l.cancelamento_efetivado_em && !l.hotmart_cancelado_em);
  const soHotmart = r.linhas.filter((l) => l.hotmart_cancelado_em && !l.cancelamento_efetivado_em);
  const eventos = Array.from(new Set(cancHm.map((l) => l.hotmart_cancelamento_evento ?? "—")));
  secao(ws, "CANCELAMENTOS", ["", "Alunos", "Já tinha entrado", "Observação"], [
    ...eventos.map((e) => {
      const ls = cancHm.filter((l) => (l.hotmart_cancelamento_evento ?? "—") === e);
      return [
        EVENTO[e] ?? e,
        ls.length,
        ls.reduce((a, l) => a + (n(l.valor_pago) ?? 0), 0),
        "Confirmado pela Hotmart — o dinheiro voltou.",
      ];
    }),
    [
      "⚠ Confirmamos, a Hotmart não",
      semConfirma.length,
      semConfirma.reduce((a, l) => a + (n(l.valor_pago) ?? 0), 0),
      "Ou o reembolso não saiu (o dinheiro ainda é nosso), ou marcamos por engano e tiramos o acesso de quem paga.",
    ],
    [
      "⚠ Hotmart cancelou, o card não registrou",
      soHotmart.length,
      soHotmart.reduce((a, l) => a + (n(l.valor_pago) ?? 0), 0),
      "O dinheiro voltou e o aluno pode seguir com acesso.",
    ],
  ], {
    dinheiro: [3],
    alertaSe: (i) => (i === eventos.length && semConfirma.length > 0)
      || (i === eventos.length + 1 && soHotmart.length > 0),
  });
}

// Um bloco do resumo: título em faixa, cabeçalho e linhas. Existe para que os
// seis blocos acima não virem seiscentas linhas de addRow com estilo repetido.
function secao(
  ws: ExcelJS.Worksheet,
  titulo: string,
  cabecalho: string[],
  linhas: unknown[][],
  opts: { dinheiro?: number[]; pct?: number[]; destacarUltima?: boolean; alertaSe?: (i: number) => boolean },
) {
  ws.addRow([]);
  const t = ws.addRow([titulo]);
  t.font = { bold: true, size: 11, color: { argb: "FF9A3412" } };
  t.getCell(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: LARANJA_CLARO } };

  const cab = ws.addRow(cabecalho);
  cab.font = { bold: true, color: { argb: "FFFFFFFF" } };
  for (let i = 1; i <= cabecalho.length; i++) {
    cab.getCell(i).fill = { type: "pattern", pattern: "solid", fgColor: { argb: LARANJA } };
  }

  linhas.forEach((vals, i) => {
    const linha = ws.addRow(vals);
    for (const c of opts.dinheiro ?? []) {
      const cel = linha.getCell(c);
      if (typeof cel.value === "number") cel.numFmt = DINHEIRO;
    }
    for (const c of opts.pct ?? []) {
      const cel = linha.getCell(c);
      if (typeof cel.value === "number") cel.numFmt = "0.0%";
    }
    if (opts.destacarUltima && i === linhas.length - 1) {
      linha.font = { bold: true };
      for (let c = 1; c <= vals.length; c++) {
        linha.getCell(c).fill = { type: "pattern", pattern: "solid", fgColor: { argb: LARANJA_CLARO } };
      }
    }
    // A linha que pede ação fica marcada: quem abre a planilha tem de bater o
    // olho e ver o problema, não descobri-lo somando.
    if (opts.alertaSe?.(i)) {
      linha.font = { bold: true, color: { argb: "FF92400E" } };
      for (let c = 1; c <= Math.max(vals.length, cabecalho.length); c++) {
        linha.getCell(c).fill = { type: "pattern", pattern: "solid", fgColor: { argb: AMBAR_CLARO } };
      }
    }
  });
}

// ------------------------------------------------------------------- Colunas

const COLS_CARTEIRA: Col<LinhaEsteira>[] = [
  { header: "Nome", width: 28, get: (l) => txt(l.nome) },
  { header: "Telefone", width: 16, get: (l) => txt(l.telefone) },
  { header: "E-mail", width: 28, get: (l) => txt(l.email) },
  { header: "Turma", width: 14, get: (l) => txt(l.turma) },
  { header: "Público", width: 15, get: (l) => PUBLICO[l.publico ?? "nao_classificado"] ?? "—" },
  { header: "Canal de aquisição", width: 20, get: (l) => txt(l.canal_aquisicao) },
  { header: "Situação Hotmart", width: 16, get: (l) => (l.hotmart_status ? STATUS_HM[l.hotmart_status] ?? l.hotmart_status : "—") },
  { header: "Etapa", width: 22, get: (l) => txt(l.estagio_nome) },
  { header: "Responsável", width: 16, get: (l) => txt(l.responsavel) },
  { header: "Situação", width: 20, get: (l) => SITUACAO[l.situacao_financeira ?? ""] ?? txt(l.situacao_financeira) },
  { header: "Entrada", width: 13, get: (l) => (l.categoria_entrada === "sinal" ? "Sinal" : l.categoria_entrada === "compra_cheia" ? "Compra cheia" : txt(l.categoria_entrada)) },
  { header: "Sinal pago em", width: 13, get: (l) => d(l.sinal_pago_em), fmt: "data" },
  { header: "Valor do sinal", width: 13, get: (l) => n(l.sinal_valor), fmt: "dinheiro" },
  { header: "Crédito pró-rata", width: 14, get: (l) => n(l.credito), fmt: "dinheiro" },
  // Cravado = o pacote que foi FECHADO com a pessoa. Pela régua = o que o sistema
  // deduziu. Os dois na planilha, e a diferença ao lado: uma dedução não é acordo.
  { header: "Pacote cravado", width: 14, get: (l) => n(l.valor_total), fmt: "dinheiro" },
  { header: "Pacote pela régua", width: 15, get: (l) => n(l.pacote_regra), fmt: "dinheiro" },
  {
    header: "Divergência (cravado − régua)", width: 18, fmt: "dinheiro",
    get: (l) => {
      const c = n(l.valor_total), reg = n(l.pacote_regra);
      return c !== null && reg !== null ? c - reg : null;
    },
  },
  { header: "Recebido", width: 14, get: (l) => n(l.valor_pago), fmt: "dinheiro" },
  { header: "% pago", width: 9, get: (l) => (n(l.pago_pct) !== null ? (n(l.pago_pct) as number) / 100 : null), fmt: "pct" },
  // Vazio aqui não é zero: é "não dá para calcular" (falta o crédito pró-rata).
  // Quem quitou também vem vazio — não deve nada.
  { header: "Saldo a pagar", width: 14, get: (l) => (devendo(l) ? saldoDe(l) : null), fmt: "dinheiro" },
  { header: "Parcelas pagas", width: 12, get: (l) => l.parcelas_pagas ?? 0 },
  { header: "Parcelas contratadas", width: 14, get: (l) => l.parcelas_contratadas ?? 0 },
  { header: "Valor da parcela", width: 13, get: (l) => n(l.valor_parcela), fmt: "dinheiro" },
  { header: "Último pagamento", width: 15, get: (l) => d(l.ultimo_pagamento_em), fmt: "data" },
  { header: "Último abatimento", width: 15, get: (l) => d(l.ultimo_abatimento_em), fmt: "data" },
  { header: "Valor do abatimento", width: 14, get: (l) => n(l.ultimo_abatimento_valor), fmt: "dinheiro" },
  { header: "Meio de pagamento", width: 16, get: (l) => txt(l.pagamento_meio) },
  { header: "Previsão de pagamento", width: 16, get: (l) => d(l.pagamento_previsto_em), fmt: "data" },
  { header: "Acordo", width: 40, get: (l) => txt(l.acordo) },
  { header: "Oferta do saldo", width: 14, get: (l) => txt(l.oferta_saldo_codigo) },
  { header: "Link enviado em", width: 15, get: (l) => d(l.link_saldo_enviado_em), fmt: "data" },
  { header: "Quitado", width: 9, get: (l) => sn(l.quitado) },
  { header: "Cancelamos em", width: 15, get: (l) => d(l.cancelamento_efetivado_em), fmt: "data" },
  { header: "Hotmart cancelou em", width: 16, get: (l) => d(l.hotmart_cancelado_em), fmt: "data" },
  { header: "Evento na Hotmart", width: 18, get: (l) => EVENTO[l.hotmart_cancelamento_evento ?? ""] ?? txt(l.hotmart_cancelamento_evento) },
  { header: "Na base THB", width: 11, get: (l) => (l.aluno_id ? "Sim" : "Não") },
];

const COLS_A_RECEBER: Col<LinhaEsteira>[] = [
  { header: "Nome", width: 28, get: (l) => txt(l.nome) },
  { header: "Telefone", width: 16, get: (l) => txt(l.telefone) },
  { header: "E-mail", width: 28, get: (l) => txt(l.email) },
  { header: "Turma", width: 14, get: (l) => txt(l.turma) },
  { header: "Responsável", width: 16, get: (l) => txt(l.responsavel) },
  { header: "Etapa", width: 22, get: (l) => txt(l.estagio_nome) },
  { header: "Situação", width: 20, get: (l) => SITUACAO[l.situacao_financeira ?? ""] ?? txt(l.situacao_financeira) },
  { header: "Saldo a pagar", width: 14, get: (l) => saldoDe(l), fmt: "dinheiro" },
  // A coluna que impede o "—" de ser lido como zero. Quem cai aqui DEVE; o que
  // falta é o insumo (crédito pró-rata na ficha), não a dívida.
  {
    header: "Por que sem saldo?", width: 46,
    get: (l) => (saldoDe(l) === null
      ? "Sem crédito pró-rata na ficha (valor pago e data da compra anterior). Ele deve; o sistema é que não sabe quanto."
      : ""),
  },
  { header: "Recebido", width: 14, get: (l) => n(l.valor_pago), fmt: "dinheiro" },
  { header: "Parcelas pagas", width: 12, get: (l) => l.parcelas_pagas ?? 0 },
  { header: "Parcelas contratadas", width: 14, get: (l) => l.parcelas_contratadas ?? 0 },
  { header: "Último pagamento", width: 15, get: (l) => d(l.ultimo_pagamento_em), fmt: "data" },
  { header: "Meio de pagamento", width: 16, get: (l) => txt(l.pagamento_meio) },
  { header: "Previsão de pagamento", width: 16, get: (l) => d(l.pagamento_previsto_em), fmt: "data" },
  { header: "Acordo", width: 40, get: (l) => txt(l.acordo) },
  { header: "Oferta do saldo", width: 14, get: (l) => txt(l.oferta_saldo_codigo) },
  { header: "Link enviado em", width: 15, get: (l) => d(l.link_saldo_enviado_em), fmt: "data" },
];

const COLS_PAGAMENTOS: Col<PagamentoHm>[] = [
  { header: "Pago em", width: 17, get: (p) => d(p.pago_em), fmt: "datahora" },
  { header: "Nome", width: 28, get: (p) => txt(p.nome) },
  { header: "E-mail", width: 28, get: (p) => txt(p.email) },
  { header: "Categoria", width: 14, get: (p) => CATEGORIA[p.categoria ?? ""] ?? txt(p.categoria) },
  { header: "Valor", width: 14, get: (p) => n(p.valor), fmt: "dinheiro" },
  { header: "Método", width: 14, get: (p) => txt(p.metodo_pagamento) },
  { header: "Parcela", width: 9, get: (p) => p.parcela ?? "" },
  { header: "Origem", width: 12, get: (p) => txt(p.origem) },
  { header: "Transação", width: 20, get: (p) => txt(p.transacao) },
  { header: "Oferta", width: 14, get: (p) => txt(p.oferta_codigo) },
  { header: "Observação", width: 34, get: (p) => txt(p.obs) },
  { header: "Lançado por", width: 14, get: (p) => txt(p.autor) },
];

const COLS_CANCELAMENTOS: Col<LinhaEsteira>[] = [
  { header: "Nome", width: 28, get: (l) => txt(l.nome) },
  { header: "E-mail", width: 28, get: (l) => txt(l.email) },
  { header: "Turma", width: 14, get: (l) => txt(l.turma) },
  // A coluna que resume o confronto. É por ela que o financeiro filtra.
  {
    header: "Confere?", width: 34,
    get: (l) => {
      if (l.hotmart_cancelado_em && l.cancelamento_efetivado_em) return "Sim — nós e a Hotmart";
      if (l.cancelamento_efetivado_em) return "⚠ Só nós — a Hotmart não confirmou";
      if (l.hotmart_cancelado_em) return "⚠ Só a Hotmart — o card não registrou";
      return "Só o pedido — ninguém confirmou";
    },
  },
  { header: "Pediu em", width: 15, get: (l) => d(l.cancelamento_em), fmt: "data" },
  { header: "Cancelamos em", width: 15, get: (l) => d(l.cancelamento_efetivado_em), fmt: "data" },
  { header: "Quem confirmou aqui", width: 16, get: (l) => txt(l.cancelamento_origem) },
  { header: "Hotmart confirmou em", width: 16, get: (l) => d(l.hotmart_cancelado_em), fmt: "data" },
  { header: "Evento na Hotmart", width: 18, get: (l) => EVENTO[l.hotmart_cancelamento_evento ?? ""] ?? txt(l.hotmart_cancelamento_evento) },
  { header: "Transação", width: 20, get: (l) => txt(l.hotmart_cancelamento_transacao) },
  // O dinheiro que esta pessoa já tinha pagado — é o que está em jogo no reembolso.
  { header: "Recebido", width: 14, get: (l) => n(l.valor_pago), fmt: "dinheiro" },
  { header: "Motivo", width: 40, get: (l) => txt(l.cancelamento_motivo) },
  { header: "Acessos revogados em", width: 17, get: (l) => d(l.acessos_revogados_em), fmt: "data" },
  { header: "Revogados por", width: 14, get: (l) => txt(l.acessos_revogados_por) },
];

// ------------------------------------------------------------------- Tabelas

function tabela<T>(
  wb: ExcelJS.Workbook,
  nome: string,
  cols: Col<T>[],
  itens: T[],
  opts: { totais?: string[] },
) {
  const ws = wb.addWorksheet(nome, { views: [{ state: "frozen", xSplit: 1, ySplit: 1 }] });
  ws.columns = cols.map((c) => ({ header: c.header, width: c.width }));

  const cab = ws.getRow(1);
  cab.font = { bold: true, color: { argb: "FFFFFFFF" } };
  cab.fill = { type: "pattern", pattern: "solid", fgColor: { argb: LARANJA } };
  cab.height = 20;
  cab.alignment = { vertical: "middle", wrapText: true };

  for (const item of itens) {
    const linha = ws.addRow(cols.map((c) => c.get(item)));
    cols.forEach((c, i) => {
      const cel = linha.getCell(i + 1);
      if (c.fmt === "dinheiro" && typeof cel.value === "number") cel.numFmt = DINHEIRO;
      if (c.fmt === "pct" && typeof cel.value === "number") cel.numFmt = "0%";
      if (c.fmt === "data" && cel.value instanceof Date) cel.numFmt = DATA;
      if (c.fmt === "datahora" && cel.value instanceof Date) cel.numFmt = DATA_HORA;
    });
  }

  if (itens.length === 0) {
    const l = ws.addRow(["Ninguém nesta lista."]);
    l.getCell(1).font = { italic: true, color: { argb: "FF94A3B8" } };
    return;
  }

  // A linha de TOTAL soma pela fórmula, não pelo número que eu calculei aqui:
  // assim ela continua certa depois que alguém filtrar, ordenar ou apagar uma
  // linha na mão — que é o que sempre acontece com a planilha do financeiro.
  if (opts.totais?.length) {
    const fim = itens.length + 1; // +1 pelo cabeçalho
    const total = ws.addRow([]);
    total.getCell(1).value = "TOTAL";
    cols.forEach((c, i) => {
      if (!opts.totais?.includes(c.header)) return;
      const letra = ws.getColumn(i + 1).letter;
      const cel = total.getCell(i + 1);
      cel.value = { formula: `SUBTOTAL(109,${letra}2:${letra}${fim})` };
      cel.numFmt = DINHEIRO;
    });
    total.font = { bold: true };
    for (let i = 1; i <= cols.length; i++) {
      total.getCell(i).fill = { type: "pattern", pattern: "solid", fgColor: { argb: LARANJA_CLARO } };
    }
  }

  // O filtro do Excel: a planilha precisa continuar utilizável depois de baixada
  // (achar quem deve mais, filtrar por responsável, isolar os chargebacks).
  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: cols.length } };
}
