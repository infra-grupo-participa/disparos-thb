/**
 * Leads por operador — XLSX.
 *
 * Responde "quem está com quem": a carteira de cada operador, o que ela vale e
 * onde está travada. Roda direto contra o banco, sem passar pela aplicação.
 *
 *   npx tsx scripts/leads-por-operador.ts
 *   npx tsx scripts/leads-por-operador.ts --produto=AURUM
 *   npx tsx scripts/leads-por-operador.ts --operador="Jusy Machado" --operador=Kelly
 *   npx tsx scripts/leads-por-operador.ts --incluir-cancelados
 *
 * Abas:
 *   1. Por operador   — uma linha por operador: carteira, saldo, onde está parado
 *   2. Operador x etapa — o cruzamento (a matriz que mostra o gargalo de cada um)
 *   3. Leads          — a lista nominal, um aluno por linha, com o operador
 *
 * ⚠️ Célula de dinheiro/data é NÚMERO/DATA ou VAZIA — nunca "—". Um traço em
 * coluna de valor faz o Excel tratar a coluna inteira como texto e o SOMA()
 * devolver total parcial em silêncio. Mesma regra de lib/export/*-xlsx.ts,
 * coberta por scripts/verifica-xlsx-tipos.ts.
 */
import ExcelJS from "exceljs";
import pg from "pg";
import fs from "node:fs";

const LARANJA = "FFF97316";
const LARANJA_CLARO = "FFFDE8D7";
const CINZA = "FFF1F5F9";

const SEM_RESP = "(sem responsável)";

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
const txt = (v: unknown) =>
  v === null || v === undefined || v === "" ? "—" : Array.isArray(v) ? v.join(", ") : String(v);

// ---------------------------------------------------------------- argumentos
const argv = process.argv.slice(2);
const arg = (nome: string) =>
  argv.filter((a) => a.startsWith(`--${nome}=`)).map((a) => a.slice(nome.length + 3));
const produtoArg = (arg("produto")[0] || "").toUpperCase();
const produto = produtoArg === "AURUM" || produtoArg === "ETHB" ? produtoArg : produtoArg === "TODOS" ? null : "HM";
const operadores = arg("operador");
const incluirCancelados = argv.includes("--incluir-cancelados");

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("DATABASE_URL ausente. Rode com: node --env-file=.env.local, ou exporte a variável.");
    process.exit(1);
  }
  const db = new pg.Client({ connectionString: url });
  await db.connect();

  // Uma consulta só; os recortes são feitos em memória. A carteira inteira do HM
  // tem ~250 linhas — não vale pagar três varreduras (e o egress) por isso.
  const { rows } = await db.query<Record<string, unknown>>(
    `select coalesce(k.responsavel, $1)          as operador,
            k.responsavel_id,
            k.equipe_nome,
            k.produto,
            k.nome, k.email, k.telefone,
            k.estagio_nome, k.estagio_aba, k.estagio_chave,
            k.turma_origem, k.canal_aquisicao, k.categoria_entrada,
            k.sinal_valor, k.sinal_pago_em,
            k.aguardando_pagamento, k.aguardando_pagamento_em,
            k.criado_em, k.atualizado_em,
            k.reuniao_em, k.entrevista_em, k.pagamento_previsto_em,
            k.cancelamento_efetivado_em,
            k.apto_ativacao, k.nao_contatar, k.pendencia,
            f.situacao, f.pacote_regra, f.pago, f.saldo_a_perseguir,
            f.ultimo_pagamento_em,
            extract(day from now() - k.atualizado_em)::int as dias_parado
       from cs.contatos_hm_kanban k
       left join cs.vw_hm_financeiro f on f.contato_hm_id = k.contato_hm_id
      where ($2::text   is null or k.produto = $2)
        and ($3::text[] is null or coalesce(k.responsavel, $1) = any($3))
        and ($4::boolean or k.cancelamento_efetivado_em is null)
      order by operador, k.estagio_nome, k.nome`,
    [SEM_RESP, produto, operadores.length ? operadores : null, incluirCancelados],
  );
  await db.end();

  if (!rows.length) {
    console.error("Nenhuma linha para esse recorte. Confira --produto / --operador.");
    process.exit(1);
  }

  const agora = new Date();
  const wb = new ExcelJS.Workbook();
  wb.creator = "CS · Grupo Participa";
  wb.created = agora;

  const cabecalho = (ws: ExcelJS.Worksheet, titulo: string, larguras: number[], cols: string[]) => {
    ws.columns = larguras.map((width) => ({ width }));
    ws.mergeCells(1, 1, 1, cols.length);
    const t = ws.getCell(1, 1);
    t.value = titulo;
    t.font = { bold: true, size: 14, color: { argb: "FFFFFFFF" } };
    t.fill = { type: "pattern", pattern: "solid", fgColor: { argb: LARANJA } };
    t.alignment = { vertical: "middle" };
    ws.getRow(1).height = 26;

    const recorte = [
      `Produto: ${produto ?? "todos"}`,
      operadores.length ? `Operadores: ${operadores.join(", ")}` : "Operadores: todos",
      incluirCancelados ? "Inclui cancelados" : "Sem cancelados",
      `Gerado em ${agora.toLocaleString("pt-BR")}`,
    ].join("  ·  ");
    ws.mergeCells(2, 1, 2, cols.length);
    const sub = ws.getCell(2, 1);
    sub.value = recorte;
    sub.font = { size: 9, color: { argb: "FF64748B" } };

    const h = ws.addRow([]);
    void h;
    const hr = ws.addRow(cols);
    hr.eachCell((c) => {
      c.font = { bold: true, color: { argb: "FF9A3412" } };
      c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: LARANJA_CLARO } };
      c.alignment = { vertical: "middle", wrapText: true };
    });
    ws.views = [{ state: "frozen", ySplit: 4 }];
    return 4;
  };

  const zebra = (ws: ExcelJS.Worksheet, primeira: number) => {
    for (let r = primeira + 1; r <= ws.rowCount; r++) {
      if ((r - primeira) % 2 === 0) {
        ws.getRow(r).eachCell((c) => {
          c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: CINZA } };
        });
      }
    }
  };

  // ------------------------------------------------------- aba 1: por operador
  const porOperador = new Map<string, Record<string, unknown>[]>();
  for (const l of rows) {
    const k = String(l.operador);
    (porOperador.get(k) ?? porOperador.set(k, []).get(k)!).push(l);
  }

  const ws1 = wb.addWorksheet("Por operador");
  const h1 = cabecalho(
    ws1,
    "Leads por operador",
    [26, 12, 10, 12, 12, 14, 16, 16, 16, 13],
    ["Operador", "Equipe", "Leads", "Comercial", "Ativação", "Aguardando boleto",
     "Saldo a perseguir", "Já pago", "Sem mexer há +14 dias", "Dias parado (méd.)"],
  );

  const ordenados = [...porOperador.entries()].sort((a, b) => b[1].length - a[1].length);
  for (const [operador, linhas] of ordenados) {
    const dias = linhas.map((l) => n(l.dias_parado) ?? 0);
    ws1.addRow([
      operador,
      txt(linhas[0].equipe_nome),
      linhas.length,
      linhas.filter((l) => l.estagio_aba === "comercial").length,
      linhas.filter((l) => l.estagio_aba === "ativacao").length,
      linhas.filter((l) => l.aguardando_pagamento === true).length,
      linhas.reduce((s, l) => s + (n(l.saldo_a_perseguir) ?? 0), 0),
      linhas.reduce((s, l) => s + (n(l.pago) ?? 0), 0),
      linhas.filter((l) => (n(l.dias_parado) ?? 0) > 14).length,
      dias.length ? Math.round(dias.reduce((a, b) => a + b, 0) / dias.length) : null,
    ]);
  }
  // TOTAL por SUBTOTAL: respeita o filtro do Excel, ao contrário de SOMA fixa.
  const totalRow = ws1.addRow(["TOTAL", "", { formula: `SUBTOTAL(109,C${h1 + 1}:C${ws1.rowCount})` }]);
  totalRow.getCell(1).font = { bold: true };
  ["C", "D", "E", "F", "G", "H", "I"].forEach((col) => {
    totalRow.getCell(col).value = { formula: `SUBTOTAL(109,${col}${h1 + 1}:${col}${ws1.rowCount - 1})` };
    totalRow.getCell(col).font = { bold: true };
  });
  ws1.eachRow((row, i) => {
    if (i <= h1) return;
    ["G", "H"].forEach((c) => (row.getCell(c).numFmt = 'R$ #,##0.00'));
  });
  zebra(ws1, h1);
  ws1.autoFilter = { from: { row: h1, column: 1 }, to: { row: ws1.rowCount - 1, column: 10 } };

  // -------------------------------------------------- aba 2: operador x etapa
  const ws2 = wb.addWorksheet("Operador x etapa");
  const etapas = [...new Set(rows.map((l) => String(l.estagio_nome)))].sort();
  const h2 = cabecalho(
    ws2,
    "Operador × etapa (onde a carteira de cada um está parada)",
    [26, ...etapas.map(() => 15), 12],
    ["Operador", ...etapas, "Total"],
  );
  for (const [operador, linhas] of ordenados) {
    const celulas = etapas.map((e) => linhas.filter((l) => l.estagio_nome === e).length || null);
    ws2.addRow([operador, ...celulas, linhas.length]);
  }
  zebra(ws2, h2);

  // -------------------------------------------------------------- aba 3: leads
  const ws3 = wb.addWorksheet("Leads");
  const colsLead = [
    "Operador", "Equipe", "Produto", "Nome", "E-mail", "Telefone", "Etapa", "Esteira",
    "Entrada", "Valor da entrada", "Entrada paga em", "Aguardando boleto",
    "Situação", "Pacote", "Já pago", "Saldo a perseguir", "Último pagamento",
    "Turma de origem", "Canal", "Reunião", "Entrevista", "Dias parado",
    "Apto à ativação", "Não contatar", "Pendência", "Cancelado em",
  ];
  const h3 = cabecalho(
    ws3,
    "Leads — lista nominal",
    [22, 12, 9, 28, 28, 16, 20, 11, 13, 14, 16, 15, 18, 13, 13, 15, 16, 14, 16, 16, 16, 11, 13, 12, 28, 16],
    colsLead,
  );
  for (const l of rows) {
    ws3.addRow([
      String(l.operador),
      txt(l.equipe_nome),
      txt(l.produto),
      txt(l.nome),
      txt(l.email),
      txt(l.telefone),
      txt(l.estagio_nome),
      l.estagio_aba === "ativacao" ? "Ativação" : "Comercial",
      l.categoria_entrada === "sinal" ? "Sinal" : l.categoria_entrada === "compra_cheia" ? "Compra cheia" : txt(l.categoria_entrada),
      n(l.sinal_valor),
      d(l.sinal_pago_em),
      l.aguardando_pagamento === true ? "SIM — não pagou" : "",
      txt(l.situacao),
      n(l.pacote_regra),
      n(l.pago),
      n(l.saldo_a_perseguir),
      d(l.ultimo_pagamento_em),
      txt(l.turma_origem),
      txt(l.canal_aquisicao),
      d(l.reuniao_em),
      d(l.entrevista_em),
      n(l.dias_parado),
      l.apto_ativacao === true ? "Sim" : l.apto_ativacao === false ? "Não" : "—",
      l.nao_contatar === true ? "Sim" : "—",
      txt(l.pendencia),
      d(l.cancelamento_efetivado_em),
    ]);
  }
  ws3.eachRow((row, i) => {
    if (i <= h3) return;
    ["J", "N", "O", "P"].forEach((c) => (row.getCell(c).numFmt = 'R$ #,##0.00'));
    ["K", "Q", "T", "U", "Z"].forEach((c) => (row.getCell(c).numFmt = "dd/mm/yyyy hh:mm"));
    // Quem gerou boleto e não pagou fica em vermelho: é o dinheiro que ainda não entrou.
    if (row.getCell("L").value) {
      row.getCell("L").font = { bold: true, color: { argb: "FFB91C1C" } };
    }
  });
  zebra(ws3, h3);
  ws3.autoFilter = { from: { row: h3, column: 1 }, to: { row: ws3.rowCount, column: colsLead.length } };

  const sufixo = [
    produto ?? "todos",
    operadores.length ? operadores.map((o) => o.split(" ")[0]).join("-") : null,
  ].filter(Boolean).join("-");
  const arquivo = `Leads-por-operador-${sufixo}-${agora.toISOString().slice(0, 10)}.xlsx`;
  const buf = await wb.xlsx.writeBuffer();
  fs.writeFileSync(arquivo, Buffer.from(buf));

  console.log(`\n${arquivo}`);
  console.log(`${rows.length} leads · ${porOperador.size} operadores\n`);
  for (const [operador, linhas] of ordenados) {
    const saldo = linhas.reduce((s, l) => s + (n(l.saldo_a_perseguir) ?? 0), 0);
    console.log(
      `  ${operador.padEnd(22)} ${String(linhas.length).padStart(4)} leads  ` +
      `R$ ${saldo.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}`,
    );
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
