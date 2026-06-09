// Popula cs._staging_ht_import com os compradores HT que NÃO existem na base
// (os 119 sem match). Lê os CSVs, casa por e-mail/telefone com cs.contatos_ht,
// e insere só os ausentes na staging. O move staging->public é feito por SQL
// admin (set-based), mantendo os dados pessoais fora do chat.

import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { Pool } = require("pg");
const { loadEnvConfig } = require("@next/env");
loadEnvConfig(process.cwd());

const DIR = process.env.HT_DIR || "c:/tmp/ht-import";

const stripBom = (s) => s.replace(/^﻿/, "");
const fixMojibake = (s) => (/Ã.|Â.|ï»¿/.test(s) ? Buffer.from(s, "latin1").toString("utf8") : s);
const normEmail = (s) => (s || "").trim().toLowerCase() || null;
function normPhone(s) {
  let d = String(s || "").replace(/\D/g, "");
  if (!d) return null;
  if (!d.startsWith("55") && (d.length === 10 || d.length === 11)) d = "55" + d;
  return d.length >= 12 && d.length <= 13 ? d : null;
}
function normDate(s) {
  const m = String(s || "").trim().match(/(\d{2})\/(\d{2})\/(\d{4})(?:\s+(\d{1,2}):(\d{2}))?/);
  if (!m) return null;
  const [, d, mo, y, h = "00", mi = "00"] = m;
  return `${y}-${mo}-${d}T${h.padStart(2, "0")}:${mi}:00-03:00`;
}
const edicaoDoArquivo = (n) => { const m = n.match(/ht\s*0*(\d+)/i); return m ? "HT" + m[1] : null; };

const arquivos = readdirSync(DIR).filter((f) => /^ht.*\.csv$/i.test(f)).sort();
const registros = [];
for (const arq of arquivos) {
  const edicao = edicaoDoArquivo(arq);
  const linhas = stripBom(fixMojibake(readFileSync(join(DIR, arq), "utf8"))).split(/\r?\n/).filter((l) => l.trim());
  for (const l of linhas.slice(1)) {
    const c = l.split(",");
    if (c.length < 18) continue;
    registros.push({
      edicao,
      nome: (c[1] || "").trim(),
      documento: (c[2] || "").trim() || null,
      email: normEmail(c[3]),
      telefone: normPhone(c[4]),
      data_compra: normDate(c[0]),
    });
  }
}

const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
(async () => {
  const base = await pool.query(`select lower(email) as email, telefone from cs.contatos_ht`);
  const emails = new Set(), tels = new Set();
  for (const r of base.rows) { if (r.email) emails.add(r.email); if (r.telefone) tels.add(r.telefone); }

  const ausentes = registros.filter((r) => {
    if (r.email && emails.has(r.email)) return false;
    if (r.telefone && tels.has(r.telefone)) return false;
    return true;
  });

  let n = 0;
  for (const r of ausentes) {
    if (!r.email && !r.telefone) continue; // sem identificador, não dá pra inserir
    await pool.query(
      `insert into cs._staging_ht_import (edicao, nome, documento, email, telefone, data_compra)
       values ($1,$2,$3,$4,$5,$6)`,
      [r.edicao, r.nome, r.documento, r.email, r.telefone, r.data_compra],
    );
    n++;
  }
  console.log(`Ausentes no CSV: ${ausentes.length} | inseridos na staging: ${n}`);
  await pool.end();
})().catch((e) => { console.error("ERRO:", e.message); pool.end(); process.exit(1); });
