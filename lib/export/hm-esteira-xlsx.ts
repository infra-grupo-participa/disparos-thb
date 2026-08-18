import ExcelJS from "exceljs";
import type { ColunaHm, LinhaEsteira, RelatorioHm, SocioEsteira } from "@/lib/services/hm-relatorio";

// Relatório da esteira HM. Duas leituras no mesmo arquivo:
//   1) "Resumo" — a esteira de cima: quantos em cada etapa, há quantos dias estão
//      parados e quanto dinheiro está represado ali. É o que responde "onde está
//      o gargalo".
//   2) uma aba POR COLUNA + uma com todos — a esteira de dentro: a linha completa
//      de cada aluno, com o que o card não mostra (acordo, saldo, checklist).
// Exportar só uma coluna (relatorioHm com `estagio`) devolve o mesmo arquivo, com
// o resumo e a aba daquela etapa apenas.

const LARANJA = "FFF97316";
const LARANJA_CLARO = "FFFDE8D7";
const CINZA = "FFF1F5F9";

type Col = { header: string; width: number; get: (l: LinhaEsteira) => unknown; fmt?: "data" | "dinheiro" };

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
const sn = (v: unknown) => (v === true ? "Sim" : v === false ? "Não" : "—");
const txt = (v: unknown) => (v === null || v === undefined || v === "" ? "—" : Array.isArray(v) ? v.join(", ") : (v as string));

// ⚠️ Célula de dinheiro e de data é NÚMERO/DATA ou VAZIA — nunca "—".
// Um traço numa coluna de valor faz o Excel tratar a coluna inteira como texto:
// SOMA() devolve total parcial em silêncio, a ordenação fica alfabética e o
// AutoFilter oferece filtro de texto. Era por isso que o Resumo (que usa números
// limpos) não batia com as abas de detalhe. `null` vira célula vazia no ExcelJS,
// que é o que soma e ordena certo. Mesma regra que hm-financeiro-xlsx.ts já segue.

// A ordem das colunas segue a da ficha: quem é → onde está → o que foi combinado
// → quanto → o que falta ativar. Ninguém deveria caçar o telefone no meio do
// financeiro.
const COLUNAS: Col[] = [
  { header: "Nome", width: 28, get: (l) => txt(l.nome) },
  { header: "Telefone", width: 16, get: (l) => txt(l.telefone) },
  { header: "E-mail", width: 28, get: (l) => txt(l.email) },
  { header: "Etapa", width: 22, get: (l) => txt(l.estagio_nome) },
  { header: "Esteira", width: 12, get: (l) => (l.estagio_aba === "ativacao" ? "Ativação" : "Comercial") },
  { header: "Dias na etapa", width: 13, get: (l) => n(l.dias_na_etapa) },
  { header: "Responsável", width: 18, get: (l) => txt(l.responsavel) },
  { header: "Entrada", width: 14, get: (l) => (l.categoria_entrada === "sinal" ? "Sinal" : l.categoria_entrada === "compra_cheia" ? "Compra cheia" : txt(l.categoria_entrada)) },
  { header: "Sinal pago em", width: 17, get: (l) => d(l.sinal_pago_em), fmt: "data" },
  { header: "Valor do sinal", width: 13, get: (l) => n(l.sinal_valor), fmt: "dinheiro" },
  { header: "Turma de origem", width: 15, get: (l) => txt(l.turma_origem) },
  { header: "Reunião", width: 17, get: (l) => d(l.reuniao_em), fmt: "data" },
  { header: "Resultado da reunião", width: 20, get: (l) => txt(l.reuniao_resultado) },
  // Quem remarca sem parar e quem não aparece: o sinal que a planilha antiga não
  // guardava, porque a nova data simplesmente apagava a anterior.
  { header: "Reuniões remarcadas", width: 14, get: (l) => n(l.reunioes_remarcadas) ?? 0 },
  { header: "Entrevista", width: 17, get: (l) => d(l.entrevista_em), fmt: "data" },
  { header: "Resultado da entrevista", width: 20, get: (l) => txt(l.entrevista_resultado) },
  { header: "Entrevistas remarcadas", width: 15, get: (l) => n(l.entrevistas_remarcadas) ?? 0 },
  { header: "Não compareceu (vezes)", width: 15, get: (l) => n(l.nao_comparecimentos) ?? 0 },
  { header: "Meio de pagamento", width: 18, get: (l) => txt(l.pagamento_meio) },
  { header: "Previsão de pagamento", width: 18, get: (l) => d(l.pagamento_previsto_em), fmt: "data" },
  { header: "Acordo", width: 40, get: (l) => txt(l.acordo) },
  { header: "Link do saldo enviado em", width: 18, get: (l) => d(l.link_saldo_enviado_em), fmt: "data" },
  // O saldo que ainda falta: pacote − TUDO o que já foi pago (inclusive as
  // mensalidades). Cobre lead novo e aluno da base — antes só saía para quem tinha
  // crédito pró-rata, e o lead novo vinha em branco na planilha do financeiro.
  { header: "Saldo a pagar", width: 14, get: (l) => n(l.saldo_a_perseguir) ?? n(l.saldo_a_pagar), fmt: "dinheiro" },
  { header: "Situação", width: 20, get: (l) => txt(l.situacao_financeira) },
  // Pagas (fato, do razão) sobre contratadas (o que a pessoa assinou). A diferença
  // entre as duas é a inadimplência — por isso vão juntas, nunca só o total.
  // Eram uma coluna de texto "3/12", que o Excel não soma nem filtra por faixa;
  // viraram duas colunas numéricas, como já fazia hm-financeiro-xlsx.ts.
  { header: "Parcelas pagas", width: 13, get: (l) => n(l.parcelas_pagas) },
  { header: "Parcelas contratadas", width: 15, get: (l) => n(l.parcelas_contratadas) },
  { header: "Valor da parcela", width: 14, get: (l) => n(l.valor_parcela), fmt: "dinheiro" },
  { header: "Último pagamento", width: 18, get: (l) => d(l.ultimo_pagamento_em), fmt: "data" },
  { header: "Crédito pró-rata", width: 14, get: (l) => n(l.credito), fmt: "dinheiro" },
  { header: "Valor total", width: 13, get: (l) => n(l.valor_total), fmt: "dinheiro" },
  { header: "Valor pago", width: 13, get: (l) => n(l.valor_pago), fmt: "dinheiro" },
  { header: "Pagamento em", width: 17, get: (l) => d(l.pagamento_em), fmt: "data" },
  { header: "Apto à ativação", width: 14, get: (l) => sn(l.apto_ativacao) },
  { header: "Searchie", width: 10, get: (l) => sn(l.ativ_searchie) },
  { header: "Comunidade", width: 12, get: (l) => sn(l.ativ_comunidade) },
  { header: "Grupo", width: 10, get: (l) => sn(l.ativ_grupo) },
  { header: "Pesquisa", width: 10, get: (l) => sn(l.ativ_pesquisa) },
  { header: "GPS", width: 10, get: (l) => sn(l.ativ_gps) },
  { header: "Pendência", width: 32, get: (l) => txt(l.pendencia) },
  { header: "Não contatar", width: 13, get: (l) => sn(l.nao_contatar) },
  { header: "Revisar", width: 10, get: (l) => sn(l.revisar) },
  { header: "Sócios", width: 8, get: (l) => n(l.socios) ?? 0 },
  { header: "Cancelamento", width: 17, get: (l) => d(l.cancelamento_em), fmt: "data" },
  { header: "Motivo do cancelamento", width: 32, get: (l) => txt(l.cancelamento_motivo) },
  { header: "Na base THB", width: 12, get: (l) => (l.aluno_id ? "Sim" : "Não") },
  { header: "Tags", width: 34, get: (l) => txt(l.tags) },
];

// `produto` entra no nome porque o arquivo circula solto (WhatsApp, e-mail): sem
// isso, a esteira do Aurum e a do HM baixam com nome idêntico e se confundem.
export function nomeArquivoRelatorio(coluna: ColunaHm | null, agora: Date, produto = "HM"): string {
  const alvo = coluna
    ? coluna.nome.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-zA-Z0-9 ]/g, "").trim().replace(/\s+/g, "-")
    : "Geral";
  return `Esteira-${produto}-${alvo}-${agora.toISOString().slice(0, 10)}.xlsx`;
}

export async function relatorioHmParaXlsx(r: RelatorioHm, agora: Date): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "CS · Grupo Participa";
  wb.created = agora;

  const porColuna = (chave: string) => r.linhas.filter((l) => l.estagio_chave === chave);

  // ---------------------------------------------------------------- aba Resumo
  const ws = wb.addWorksheet("Resumo", { views: [{ state: "frozen", ySplit: 4 }] });
  ws.columns = [
    { width: 26 }, { width: 12 }, { width: 9 }, { width: 14 },
    { width: 16 }, { width: 13 }, { width: 13 }, { width: 18 },
  ];

  ws.mergeCells("A1:H1");
  const t = ws.getCell("A1");
  t.value = r.filtros.estagio
    ? `Esteira HM · ${r.colunas[0]?.nome ?? "etapa"}`
    : "Esteira HM · relatório geral";
  t.font = { bold: true, size: 14, color: { argb: "FFFFFFFF" } };
  t.fill = { type: "pattern", pattern: "solid", fgColor: { argb: LARANJA } };
  t.alignment = { vertical: "middle" };
  ws.getRow(1).height = 26;

  // Um relatório filtrado que não diz que está filtrado é uma armadilha: quem
  // abre depois acha que está vendo a esteira inteira.
  const filtros = [
    r.filtros.responsavel?.length && `responsável: ${r.filtros.responsavel.join(" ou ")}`,
    r.filtros.canal?.length && `canal: ${r.filtros.canal.join(" ou ")}`,
    r.filtros.turma?.length && `turma: ${r.filtros.turma.join(" ou ")}`,
  ].filter(Boolean);
  ws.mergeCells("A2:H2");
  const s = ws.getCell("A2");
  s.value = `${r.linhas.length} aluno(s) · exportado em ${agora.toLocaleString("pt-BR")}${filtros.length ? ` · filtros — ${filtros.join(" · ")}` : " · sem filtros (esteira inteira)"}`;
  s.font = { italic: true, color: { argb: "FF64748B" } };
  s.fill = { type: "pattern", pattern: "solid", fgColor: { argb: CINZA } };

  ws.addRow([]);
  const cab = ws.addRow([
    "Etapa", "Esteira", "Alunos", "Dias médios",
    "Sem responsável", "Com acordo", "Link enviado", "Saldo a receber",
  ]);
  cab.font = { bold: true, color: { argb: "FFFFFFFF" } };
  cab.fill = { type: "pattern", pattern: "solid", fgColor: { argb: LARANJA } };
  cab.height = 20;

  let totalSaldo = 0;
  for (const col of r.colunas) {
    const linhas = porColuna(col.chave);
    const dias = linhas.map((l) => n(l.dias_na_etapa)).filter((x): x is number => x !== null);
    // Só soma quem ainda deve: o saldo de quem quitou é história, não cobrança.
    const saldo = linhas
      .filter((l) => !l.quitado && !l.apto_ativacao)
      .reduce((acc, l) => acc + (n(l.saldo_a_perseguir) ?? n(l.saldo_a_pagar) ?? 0), 0);
    totalSaldo += saldo;
    const linha = ws.addRow([
      col.nome,
      col.aba === "ativacao" ? "Ativação" : "Comercial",
      linhas.length,
      dias.length ? Math.round(dias.reduce((a, b) => a + b, 0) / dias.length) : 0,
      linhas.filter((l) => !l.responsavel).length,
      linhas.filter((l) => l.acordo).length,
      linhas.filter((l) => l.link_saldo_enviado_em).length,
      saldo,
    ]);
    linha.getCell(8).numFmt = 'R$ #,##0.00';
    // A etapa vazia não é ruído: é informação (ninguém chegou lá).
    if (linhas.length === 0) linha.font = { color: { argb: "FF94A3B8" } };
  }

  const total = ws.addRow([
    "TOTAL", "", r.linhas.length, "",
    r.linhas.filter((l) => !l.responsavel).length,
    r.linhas.filter((l) => l.acordo).length,
    r.linhas.filter((l) => l.link_saldo_enviado_em).length,
    totalSaldo,
  ]);
  total.font = { bold: true };
  total.fill = { type: "pattern", pattern: "solid", fgColor: { argb: LARANJA_CLARO } };
  total.getCell(8).numFmt = 'R$ #,##0.00';

  // -------------------------------------------------------------- aba Sócios
  // O sócio convidado não é card financeiro, então tem aba própria — do mesmo
  // jeito que no board ele é um card à parte. Sem isso, exportar a Ativação
  // perdia justamente a coluna que mais tem sócio. Só aparece se houver algum
  // (no relatório de uma coluna do Comercial, `r.socios` vem vazio).
  if (r.socios.length) tabelaSocios(wb, r.socios);

  // ----------------------------------------------- aba com todos (só no geral)
  if (!r.filtros.estagio) tabela(wb, "Todos os alunos", r.linhas);

  // ------------------------------------------------------------ uma por coluna
  // O Excel proíbe nomes repetidos e limita a 31 caracteres — e "Contato Inicial"
  // existe nas DUAS esteiras. O número da etapa resolve os dois problemas de uma
  // vez, e mantém as abas na ordem do board.
  r.colunas.forEach((col, i) => {
    const nome = `${i + 1}. ${col.nome}`.slice(0, 31);
    tabela(wb, nome, porColuna(col.chave));
  });

  const buf = await wb.xlsx.writeBuffer();
  return Buffer.from(buf);
}

function tabela(wb: ExcelJS.Workbook, nome: string, linhas: LinhaEsteira[]) {
  const ws = wb.addWorksheet(nome, { views: [{ state: "frozen", xSplit: 1, ySplit: 1 }] });
  ws.columns = COLUNAS.map((c) => ({ header: c.header, width: c.width }));

  const cab = ws.getRow(1);
  cab.font = { bold: true, color: { argb: "FFFFFFFF" } };
  cab.fill = { type: "pattern", pattern: "solid", fgColor: { argb: LARANJA } };
  cab.height = 20;
  cab.alignment = { vertical: "middle" };

  for (const l of linhas) {
    const linha = ws.addRow(COLUNAS.map((c) => c.get(l)));
    COLUNAS.forEach((c, i) => {
      const cel = linha.getCell(i + 1);
      if (c.fmt === "dinheiro" && typeof cel.value === "number") cel.numFmt = 'R$ #,##0.00';
      if (c.fmt === "data" && cel.value instanceof Date) cel.numFmt = "dd/mm/yyyy hh:mm";
    });
  }

  if (linhas.length === 0) {
    const l = ws.addRow(["Nenhum aluno nesta etapa."]);
    l.getCell(1).font = { italic: true, color: { argb: "FF94A3B8" } };
    return;
  }

  // O filtro do Excel na primeira linha: o relatório precisa continuar utilizável
  // depois de baixado (ordenar por dias parados, achar quem não tem responsável).
  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: COLUNAS.length } };
}

// A aba dos sócios: quem é, de quem é sócio, os 3 acessos e — o que fechava o
// gargalo — se ele já está na base mestre THB. "Fora da base" é o sócio cujo
// titular já pagou mas que o GPS ainda não enxerga.
const STATUS_SOCIO: Record<SocioEsteira["status"], string> = {
  nao_iniciado: "Não iniciado",
  em_ativacao: "Em ativação",
  ativado: "Ativado",
  sem_acesso: "Sem acesso (titular cancelou)",
};
function naBaseTxt(s: SocioEsteira): string {
  if (s.na_base) return "Sim";
  return s.titular_na_base ? "Não — provisionar" : "Aguarda o titular pagar";
}

const COLUNAS_SOCIO: { header: string; width: number; get: (s: SocioEsteira) => unknown }[] = [
  { header: "Sócio", width: 28, get: (s) => txt(s.nome) },
  { header: "Sócio de (titular)", width: 28, get: (s) => txt(s.titular_nome) },
  { header: "Turma do titular", width: 15, get: (s) => txt(s.titular_origem ?? s.titular_turma) },
  { header: "Telefone", width: 16, get: (s) => txt(s.telefone) },
  { header: "E-mail", width: 28, get: (s) => txt(s.email) },
  { header: "Searchie", width: 10, get: (s) => sn(s.ativ_searchie) },
  { header: "Comunidade", width: 12, get: (s) => sn(s.ativ_comunidade) },
  { header: "Grupo", width: 10, get: (s) => sn(s.ativ_grupo) },
  { header: "Status", width: 26, get: (s) => STATUS_SOCIO[s.status] },
  { header: "Na base THB", width: 20, get: (s) => naBaseTxt(s) },
];

function tabelaSocios(wb: ExcelJS.Workbook, socios: SocioEsteira[]) {
  const ws = wb.addWorksheet("Sócios", { views: [{ state: "frozen", xSplit: 1, ySplit: 1 }] });
  ws.columns = COLUNAS_SOCIO.map((c) => ({ header: c.header, width: c.width }));

  const cab = ws.getRow(1);
  cab.font = { bold: true, color: { argb: "FFFFFFFF" } };
  cab.fill = { type: "pattern", pattern: "solid", fgColor: { argb: LARANJA } };
  cab.height = 20;
  cab.alignment = { vertical: "middle" };

  for (const s of socios) ws.addRow(COLUNAS_SOCIO.map((c) => c.get(s)));

  if (socios.length === 0) {
    const l = ws.addRow(["Nenhum sócio nesta etapa."]);
    l.getCell(1).font = { italic: true, color: { argb: "FF94A3B8" } };
    return;
  }
  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: COLUNAS_SOCIO.length } };
}
