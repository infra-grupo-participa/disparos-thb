/**
 * Verifica que as colunas de dinheiro/data do XLSX da esteira saem como NÚMERO/DATA
 * ou vazias — nunca como o texto "—".
 *
 * Motivo: um traço numa coluna de valor faz o Excel tratar a coluna inteira como
 * texto. SOMA() devolve total parcial em silêncio, a ordenação vira alfabética e o
 * AutoFilter oferece filtro de texto. Era a causa do "dados quebrados" reportado —
 * o Resumo (números limpos) não batia com as abas de detalhe.
 *
 * Roda sem banco: monta linhas sintéticas cobrindo o caso cheio e o caso todo-nulo,
 * gera o arquivo de verdade e relê célula a célula.
 *
 *   npx tsx scripts/verifica-xlsx-tipos.ts
 */
import ExcelJS from "exceljs";
import { relatorioHmParaXlsx } from "../lib/export/hm-esteira-xlsx";
import type { RelatorioHm, LinhaEsteira } from "../lib/services/hm-relatorio";

// Colunas que precisam ser numéricas/data ou vazias.
const COLUNAS_NUMERICAS = [
  "Dias na etapa", "Valor do sinal", "Reuniões remarcadas", "Entrevistas remarcadas",
  "Não compareceu (vezes)", "Saldo a pagar", "Parcelas pagas", "Parcelas contratadas",
  "Valor da parcela", "Crédito pró-rata", "Valor total", "Valor pago", "Sócios",
];
const COLUNAS_DATA = [
  "Sinal pago em", "Reunião", "Entrevista", "Previsão de pagamento",
  "Link do saldo enviado em", "Último pagamento", "Pagamento em", "Cancelamento",
];

// numeric do Postgres chega como STRING no driver pg — de propósito aqui.
const linhaCheia = {
  contato_hm_id: "1", comprador_id: "c1", nome: "Fulano Cheio", telefone: "11999999999",
  email: "cheio@teste.com", estagio_chave: "hm_comprou", estagio_nome: "Comprou",
  estagio_aba: "comercial", dias_na_etapa: 5, responsavel: "Alguém",
  categoria_entrada: "sinal", sinal_pago_em: new Date("2026-07-27T15:40:13Z"),
  sinal_valor: "697.00", turma_origem: "HT12", reuniao_em: new Date("2026-08-01T14:00:00Z"),
  reuniao_resultado: "compareceu", reunioes_remarcadas: 2,
  entrevista_em: new Date("2026-08-02T14:00:00Z"), entrevista_resultado: "aprovado",
  entrevistas_remarcadas: 1, nao_comparecimentos: 0, pagamento_meio: "PIX",
  pagamento_previsto_em: new Date("2026-08-15T00:00:00Z"), acordo: "3x",
  link_saldo_enviado_em: new Date("2026-08-03T10:00:00Z"),
  saldo_a_perseguir: "14303.00", saldo_a_pagar: "14303.00", situacao_financeira: "saldo_parado",
  parcelas_pagas: 3, parcelas_contratadas: 12, valor_parcela: "1191.92",
  ultimo_pagamento_em: new Date("2026-08-11T00:05:57Z"), credito: "0",
  valor_total: "15000.00", valor_pago: "697.00",
  pagamento_em: new Date("2026-08-11T00:05:57Z"), apto_ativacao: true,
  ativ_searchie: true, ativ_comunidade: false, ativ_grupo: true, ativ_pesquisa: false,
  pendencia: null, nao_contatar: false, revisar: false, socios: 2,
  cancelamento_em: null, cancelamento_motivo: null, aluno_id: "a1", tags: ["HT12"],
} as unknown as LinhaEsteira;

// O caso que quebrava: tudo nulo. Antes virava "—" em 16 colunas.
const linhaVazia = {
  contato_hm_id: "2", comprador_id: "c2", nome: "Ciclano Vazio", telefone: null,
  email: "vazio@teste.com", estagio_chave: "hm_comprou", estagio_nome: "Comprou",
  estagio_aba: "comercial", dias_na_etapa: null, responsavel: null,
  categoria_entrada: null, sinal_pago_em: null, sinal_valor: null, turma_origem: null,
  reuniao_em: null, reuniao_resultado: null, reunioes_remarcadas: null,
  entrevista_em: null, entrevista_resultado: null, entrevistas_remarcadas: null,
  nao_comparecimentos: null, pagamento_meio: null, pagamento_previsto_em: null,
  acordo: null, link_saldo_enviado_em: null, saldo_a_perseguir: null,
  saldo_a_pagar: null, situacao_financeira: null, parcelas_pagas: null,
  parcelas_contratadas: null, valor_parcela: null, ultimo_pagamento_em: null,
  credito: null, valor_total: null, valor_pago: null, pagamento_em: null,
  apto_ativacao: null, ativ_searchie: null, ativ_comunidade: null, ativ_grupo: null,
  ativ_pesquisa: null, pendencia: null, nao_contatar: null, revisar: null,
  socios: null, cancelamento_em: null, cancelamento_motivo: null, aluno_id: null, tags: null,
} as unknown as LinhaEsteira;

const relatorio = {
  filtros: { estagio: null },
  colunas: [{ chave: "hm_comprou", nome: "Comprou", aba: "comercial" }],
  linhas: [linhaCheia, linhaVazia],
  socios: [],
} as unknown as RelatorioHm;

const agora = new Date("2026-08-11T12:00:00Z");

async function main() {
  const buf = await relatorioHmParaXlsx(relatorio, agora);

  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf as unknown as ArrayBuffer);

  let falhas = 0;
  let checadas = 0;

  for (const ws of wb.worksheets) {
    if (ws.name === "Resumo" || ws.name === "Sócios") continue;

    // acha a linha de cabeçalho
    let headerRow = 0;
    ws.eachRow((row, i) => {
      if (!headerRow && String(row.getCell(1).value ?? "") === "Nome") headerRow = i;
    });
    if (!headerRow) continue;

    const headers: Record<number, string> = {};
    ws.getRow(headerRow).eachCell((cel, i) => { headers[i] = String(cel.value ?? ""); });

    for (let r = headerRow + 1; r <= ws.rowCount; r++) {
      const row = ws.getRow(r);
      if (!row.getCell(1).value) continue;

      for (const [idxStr, header] of Object.entries(headers)) {
        const idx = Number(idxStr);
        const v = row.getCell(idx).value;
        const ehNumerica = COLUNAS_NUMERICAS.includes(header);
        const ehData = COLUNAS_DATA.includes(header);
        if (!ehNumerica && !ehData) continue;

        checadas++;
        const vazia = v === null || v === undefined || v === "";
        const okNum = ehNumerica && typeof v === "number";
        const okData = ehData && v instanceof Date;

        if (!vazia && !okNum && !okData) {
          falhas++;
          console.error(
            `✗ [${ws.name}] linha ${r} · "${header}" = ${JSON.stringify(v)} (${typeof v}) ` +
            `— esperado ${ehNumerica ? "número" : "Date"} ou vazio`,
          );
        }
      }
    }
  }

  console.log(`\n${checadas} células de dinheiro/data verificadas em ${wb.worksheets.length} abas.`);
  if (falhas) {
    console.error(`${falhas} célula(s) com tipo errado — o Excel não vai somar essas colunas.`);
    process.exit(1);
  }
  console.log("✓ Toda coluna de dinheiro/data saiu como número/data ou vazia.");

}

main().catch((e) => { console.error(e); process.exit(1); });
