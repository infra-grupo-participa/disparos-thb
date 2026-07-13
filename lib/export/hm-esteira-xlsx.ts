import ExcelJS from "exceljs";
import type { ColunaHm, LinhaEsteira, RelatorioHm } from "@/lib/services/hm-relatorio";

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

// A ordem das colunas segue a da ficha: quem é → onde está → o que foi combinado
// → quanto → o que falta ativar. Ninguém deveria caçar o telefone no meio do
// financeiro.
const COLUNAS: Col[] = [
  { header: "Nome", width: 28, get: (l) => txt(l.nome) },
  { header: "Telefone", width: 16, get: (l) => txt(l.telefone) },
  { header: "E-mail", width: 28, get: (l) => txt(l.email) },
  { header: "Etapa", width: 22, get: (l) => txt(l.estagio_nome) },
  { header: "Esteira", width: 12, get: (l) => (l.estagio_aba === "ativacao" ? "Ativação" : "Comercial") },
  { header: "Dias na etapa", width: 13, get: (l) => n(l.dias_na_etapa) ?? "—" },
  { header: "Responsável", width: 18, get: (l) => txt(l.responsavel) },
  { header: "Entrada", width: 14, get: (l) => (l.categoria_entrada === "sinal" ? "Sinal" : l.categoria_entrada === "compra_cheia" ? "Compra cheia" : txt(l.categoria_entrada)) },
  { header: "Turma de origem", width: 15, get: (l) => txt(l.turma_origem) },
  { header: "Reunião", width: 17, get: (l) => d(l.reuniao_em) ?? "—", fmt: "data" },
  { header: "Resultado da reunião", width: 20, get: (l) => txt(l.reuniao_resultado) },
  { header: "Entrevista", width: 17, get: (l) => d(l.entrevista_em) ?? "—", fmt: "data" },
  { header: "Resultado da entrevista", width: 20, get: (l) => txt(l.entrevista_resultado) },
  { header: "Meio de pagamento", width: 18, get: (l) => txt(l.pagamento_meio) },
  { header: "Previsão de pagamento", width: 18, get: (l) => d(l.pagamento_previsto_em) ?? "—", fmt: "data" },
  { header: "Acordo", width: 40, get: (l) => txt(l.acordo) },
  { header: "Link do saldo enviado em", width: 18, get: (l) => d(l.link_saldo_enviado_em) ?? "—", fmt: "data" },
  { header: "Saldo a pagar", width: 14, get: (l) => n(l.saldo_a_pagar) ?? "—", fmt: "dinheiro" },
  { header: "Crédito pró-rata", width: 14, get: (l) => n(l.credito) ?? "—", fmt: "dinheiro" },
  { header: "Valor total", width: 13, get: (l) => n(l.valor_total) ?? "—", fmt: "dinheiro" },
  { header: "Valor pago", width: 13, get: (l) => n(l.valor_pago) ?? "—", fmt: "dinheiro" },
  { header: "Pagamento em", width: 17, get: (l) => d(l.pagamento_em) ?? "—", fmt: "data" },
  { header: "Apto à ativação", width: 14, get: (l) => sn(l.apto_ativacao) },
  { header: "Searchie", width: 10, get: (l) => sn(l.ativ_searchie) },
  { header: "Comunidade", width: 12, get: (l) => sn(l.ativ_comunidade) },
  { header: "Grupo", width: 10, get: (l) => sn(l.ativ_grupo) },
  { header: "Pesquisa", width: 10, get: (l) => sn(l.ativ_pesquisa) },
  { header: "Pendência", width: 32, get: (l) => txt(l.pendencia) },
  { header: "Não contatar", width: 13, get: (l) => sn(l.nao_contatar) },
  { header: "Revisar", width: 10, get: (l) => sn(l.revisar) },
  { header: "Sócios", width: 8, get: (l) => n(l.socios) ?? 0 },
  { header: "Cancelamento", width: 17, get: (l) => d(l.cancelamento_em) ?? "—", fmt: "data" },
  { header: "Motivo do cancelamento", width: 32, get: (l) => txt(l.cancelamento_motivo) },
  { header: "Na base THB", width: 12, get: (l) => (l.aluno_id ? "Sim" : "Não") },
  { header: "Tags", width: 34, get: (l) => txt(l.tags) },
];

export function nomeArquivoRelatorio(coluna: ColunaHm | null, agora: Date): string {
  const alvo = coluna
    ? coluna.nome.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-zA-Z0-9 ]/g, "").trim().replace(/\s+/g, "-")
    : "Geral";
  return `Esteira-HM-${alvo}-${agora.toISOString().slice(0, 10)}.xlsx`;
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
    r.filtros.responsavel && `responsável: ${r.filtros.responsavel}`,
    r.filtros.canal && `canal: ${r.filtros.canal}`,
    r.filtros.turma && `turma: ${r.filtros.turma}`,
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
    const saldo = linhas.reduce((acc, l) => acc + (n(l.saldo_a_pagar) ?? 0), 0);
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
