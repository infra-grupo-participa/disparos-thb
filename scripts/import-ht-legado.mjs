// Importa os CSVs legados de compradores HT (por edição) para o overlay cs.contatos.
//
// Modelo (decisão do projeto): NÃO cria compras. Casa cada linha por e-mail e,
// como fallback, por telefone, com um comprador que JÁ existe (lido da view
// cs.contatos_ht). Preenche edição + métricas legadas em cs.contatos.
//
// Uso:
//   node scripts/import-ht-legado.mjs            # dry-run: só relatório, não grava
//   node scripts/import-ht-legado.mjs --apply    # grava os UPDATEs
//   HT_DIR=c:/tmp/ht-import node scripts/import-ht-legado.mjs
//
// Espera arquivos htNN-*.csv (ex.: ht21-ingressos.csv) no diretório HT_DIR.
// Pré-requisito do --apply: migration 0002 aplicada (colunas legado_* existem).

import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { Pool } = require("pg");
const { loadEnvConfig } = require("@next/env");

loadEnvConfig(process.cwd());

const DIR = process.env.HT_DIR || "c:/tmp/ht-import";
const APPLY = process.argv.includes("--apply");

// ---------- normalizadores ----------
const stripBom = (s) => s.replace(/^﻿/, "");
function fixMojibake(s) {
  // Se o arquivo veio do copy-paste (UTF-8 lido como Latin-1), reverte.
  if (/Ã.|Â.|ï»¿/.test(s)) {
    try { return Buffer.from(s, "latin1").toString("utf8"); } catch { return s; }
  }
  return s;
}
const normEmail = (s) => (s || "").trim().toLowerCase() || null;
function normPhone(s) {
  let d = String(s || "").replace(/\D/g, "");
  if (!d) return null;
  if (!d.startsWith("55") && (d.length === 10 || d.length === 11)) d = "55" + d;
  return d.length >= 12 && d.length <= 13 ? d : null;
}
function normBool(s) {
  const v = String(s || "").trim().toUpperCase();
  if (v === "SIM") return true;
  if (v === "NAO" || v === "NÃO") return false;
  return null; // vazio ou "-"
}
function normInt(s) {
  const v = String(s || "").trim();
  return /^\d+$/.test(v) ? parseInt(v, 10) : null;
}
function normNum(s) {
  const v = String(s || "").trim().replace(",", ".");
  if (!v || v === "-") return null;
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : null;
}
function normDate(s) {
  const m = String(s || "").trim().match(/(\d{2})\/(\d{2})\/(\d{4})(?:\s+(\d{1,2}):(\d{2}))?/);
  if (!m) return null;
  const [, d, mo, y, h = "00", mi = "00"] = m;
  return `${y}-${mo}-${d}T${h.padStart(2, "0")}:${mi}:00-03:00`; // horário de Brasília
}

// ---------- parser CSV simples (sem vírgulas embutidas nos dados) ----------
function parseCsv(text) {
  const linhas = stripBom(fixMojibake(text)).split(/\r?\n/).filter((l) => l.trim() !== "");
  const rows = linhas.slice(1).map((l) => l.split(","));
  return rows;
}

function edicaoDoArquivo(nome) {
  const m = nome.match(/ht\s*0*(\d+)/i);
  return m ? "HT" + m[1] : null;
}

// ---------- leitura dos CSVs ----------
let arquivos;
try {
  arquivos = readdirSync(DIR).filter((f) => /^ht.*\.csv$/i.test(f)).sort();
} catch {
  console.error(`Diretório não encontrado: ${DIR}\nSalve os CSVs lá ou aponte com HT_DIR=...`);
  process.exit(1);
}
if (arquivos.length === 0) { console.error(`Nenhum CSV ht*.csv em ${DIR}`); process.exit(1); }

const registros = []; // { edicao, nome, documento, email, telefone, ... }
let malformadas = 0;
for (const arq of arquivos) {
  const edicao = edicaoDoArquivo(arq);
  const rows = parseCsv(readFileSync(join(DIR, arq), "utf8"));
  for (const c of rows) {
    if (c.length < 18) { malformadas++; continue; }
    registros.push({
      edicao,
      nome: (c[1] || "").trim(),
      documento: (c[2] || "").trim() || null,
      email: normEmail(c[3]),
      telefone: normPhone(c[4]),
      no_grupo: normBool(c[5]),
      pesquisa: normBool(c[6]),
      ja_ht: normBool(c[7]),
      qtd_ht: normInt(c[8]),
      ja_hm: normBool(c[9]),
      e_aluno: normBool(c[10]),
      instrucao: (c[11] || "").trim() === "-" ? null : (c[11] || "").trim() || null,
      ativado: normBool(c[12]),
      primeiro_contato_em: normDate(c[13]),
      ativacao_em: normDate(c[14]),
      t_primeiro_contato_h: normNum(c[15]),
      t_ativacao_h: normNum(c[16]),
      sla_h: normNum(c[17]),
    });
  }
}

// Edições em ordem crescente; comprador recorrente fica com a edição mais recente
// (o último UPDATE vence). Por isso processamos da mais antiga para a mais nova.
registros.sort((a, b) => Number(a.edicao.slice(2)) - Number(b.edicao.slice(2)));

console.log(`\nArquivos: ${arquivos.join(", ")}`);
console.log(`Linhas lidas: ${registros.length}${malformadas ? `  (puladas malformadas: ${malformadas})` : ""}`);

// ---------- conexão + matching ----------
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

async function main() {
  const base = await pool.query(
    `select comprador_id, lower(email) as email, telefone from cs.contatos_ht`,
  );
  const porEmail = new Map();
  const porTel = new Map();
  for (const r of base.rows) {
    if (r.email) porEmail.set(r.email, r.comprador_id);
    if (r.telefone) porTel.set(r.telefone, r.comprador_id);
  }

  const stat = {}; // edicao -> { total, casadosEmail, casadosTel, naoCasados }
  const naoCasados = [];
  const updates = [];
  for (const r of registros) {
    const s = (stat[r.edicao] ??= { total: 0, email: 0, tel: 0, nao: 0 });
    s.total++;
    let id = r.email && porEmail.get(r.email);
    if (id) s.email++;
    if (!id && r.telefone) { id = porTel.get(r.telefone); if (id) s.tel++; }
    if (!id) { s.nao++; naoCasados.push(r); continue; }
    updates.push({ id, r });
  }

  // Relatório por edição (agregado — sem PII)
  console.log("\nEdição | linhas | match e-mail | match tel | sem match");
  for (const ed of Object.keys(stat).sort((a, b) => Number(a.slice(2)) - Number(b.slice(2)))) {
    const s = stat[ed];
    console.log(`${ed.padEnd(6)} | ${String(s.total).padStart(6)} | ${String(s.email).padStart(12)} | ${String(s.tel).padStart(9)} | ${String(s.nao).padStart(9)}`);
  }
  const totMatch = updates.length, totNao = naoCasados.length;
  console.log(`\nTOTAL: ${registros.length} linhas → ${totMatch} casadas, ${totNao} sem comprador na base.`);

  // Os não-casados vão para um arquivo (com PII) fora do stdout, para você revisar.
  if (naoCasados.length) {
    const out = join(DIR, "_nao-casados.csv");
    const head = "edicao,nome,documento,email,telefone\n";
    const body = naoCasados.map((r) => `${r.edicao},${r.nome},${r.documento ?? ""},${r.email ?? ""},${r.telefone ?? ""}`).join("\n");
    writeFileSync(out, head + body, "utf8");
    console.log(`Sem match listados em: ${out}`);
  }

  if (!APPLY) {
    console.log("\n[DRY-RUN] Nada foi gravado. Rode com --apply para persistir os UPDATEs.\n");
    await pool.end();
    return;
  }

  // ---------- apply ----------
  let ok = 0;
  for (const { id, r } of updates) {
    await pool.query(
      `update cs.contatos set
         edicao_ht = $2,
         legado_documento = $3,
         legado_no_grupo = $4, legado_pesquisa = $5, legado_ja_ht = $6,
         legado_qtd_ht = $7, legado_ja_hm = $8, legado_e_aluno = $9,
         legado_instrucao = $10, legado_ativado = $11,
         legado_ativacao_em = $12,
         legado_t_primeiro_contato_h = $13, legado_t_ativacao_h = $14, legado_sla_h = $15,
         primeiro_contato_em = coalesce(primeiro_contato_em, $16::timestamptz),
         legado_importado_em = now(),
         atualizado_em = now()
       where comprador_id = $1`,
      [id, r.edicao, r.documento, r.no_grupo, r.pesquisa, r.ja_ht, r.qtd_ht, r.ja_hm,
       r.e_aluno, r.instrucao, r.ativado, r.ativacao_em, r.t_primeiro_contato_h,
       r.t_ativacao_h, r.sla_h, r.primeiro_contato_em],
    );
    ok++;
  }
  console.log(`\n[APPLY] ${ok} contatos atualizados no overlay cs.contatos.\n`);
  await pool.end();
}

main().catch((e) => { console.error("ERRO:", e.message); pool.end(); process.exit(1); });
