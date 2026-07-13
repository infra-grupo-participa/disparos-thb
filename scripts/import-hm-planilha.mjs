#!/usr/bin/env node
// =====================================================================
// Importador da planilha "HM - T39 CONTROLE DE ATIVAÇÃO" → sistema.
//
//   node scripts/import-hm-planilha.mjs            # dry-run (não grava nada)
//   node scripts/import-hm-planilha.mjs --apply    # grava, dentro de uma transação
//
// A planilha é a operação inteira do comercial/ativação em 5 abas. O mapa
// coluna-a-coluna está em docs/hm-mapa-planilha.md. Aqui só entra o que o
// sistema NÃO consegue derivar sozinho: o acordo do saldo, o checklist de
// ativação, o responsável, as reuniões, o crédito pró-rata e os sócios.
//
// O que NUNCA é importado (a Hotmart e a base de alunos mandam nisso):
// nome, e-mail, telefone, documento, endereço, turma, canal, valores de compra,
// situação de acesso. Sobrescrever isso com a planilha seria trocar a fonte da
// verdade por uma cópia manual desatualizada.
//
// Casamento com o card: documento (CPF/CNPJ) → e-mail → telefone (10 dígitos).
// Sem casamento, a linha entra no relatório de órfãs — nunca cria card novo:
// card do HM nasce de compra aprovada na Hotmart, não de linha de planilha.
// =====================================================================

import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import pg from "pg";

const DIR = "C:/Users/infra/Downloads";
const APLICAR = process.argv.includes("--apply");
const ANO = 2026; // a planilha escreve "14/07" sem ano; a T39 é toda de 2026

// ---------- CSV ----------------------------------------------------------
// Parser próprio: os campos têm vírgula, aspas e quebra de linha DENTRO de
// aspas (ex.: "Reunião do Zoom\n(data e horário)"). Um split(",") corromperia.
function parseCsv(texto) {
  const linhas = [];
  let campo = "";
  let linha = [];
  let aspas = false;
  for (let i = 0; i < texto.length; i++) {
    const c = texto[i];
    if (aspas) {
      if (c === '"') {
        if (texto[i + 1] === '"') { campo += '"'; i++; } else aspas = false;
      } else campo += c;
    } else if (c === '"') aspas = true;
    else if (c === ",") { linha.push(campo); campo = ""; }
    else if (c === "\n") { linha.push(campo); linhas.push(linha); linha = []; campo = ""; }
    else if (c !== "\r") campo += c;
  }
  if (campo || linha.length) { linha.push(campo); linhas.push(linha); }
  return linhas;
}

// Os cabeçalhos da planilha são hostis: têm espaço sobrando ("Grupo de informes
// (THB #25) "), espaço na frente (" STATUS REUNIÃO") e até quebra de linha no
// meio ("Reunião do Zoom\n(data e horário )"). Comparar a string literal é como
// se perde uma coluna inteira em silêncio — foi o que aconteceu no primeiro
// dry-run com o checklist do grupo. Por isso a busca é por FRAGMENTO normalizado.
const norm = (s) => (s ?? "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/\s+/g, " ").trim();

function lerAba(arquivo) {
  const linhas = parseCsv(readFileSync(join(DIR, arquivo), "utf8"));
  const head = linhas[0].map((h) => norm(h));
  return linhas.slice(1)
    .filter((l) => l.some((c) => c.trim() !== "") && l[2] !== "#REF!" && l[0] !== "#REF!")
    .map((l) => {
      const o = {};
      head.forEach((h, i) => { o[h] = (l[i] ?? "").trim(); });
      // colunas sem cabeçalho (a planilha "vaza" dados para o lado) ficam por índice
      o.__cols = l.map((c) => (c ?? "").trim());
      return o;
    });
}

// pick(r, "grupo de informes") → valor da 1ª coluna cujo cabeçalho CONTÉM o fragmento.
function pick(r, ...frags) {
  for (const frag of frags) {
    const alvo = norm(frag);
    for (const k of Object.keys(r)) {
      if (k !== "__cols" && k.includes(alvo) && r[k] !== "") return r[k];
    }
  }
  return "";
}

// ---------- normalização -------------------------------------------------
const digitos = (s) => (s ?? "").replace(/\D/g, "");
const vazio = (s) => !s || !s.trim();

// "SIM"/"TRUE" → true. Só isso: "NÃO", "FALSE" e vazio são false.
function bool(s) {
  const v = (s ?? "").trim().toUpperCase();
  return v === "TRUE" || v === "SIM" || v === "X";
}

// A planilha mistura formato US ("12,772.68") e BR ("3.997,00") na MESMA coluna.
// Regra: o último separador é o decimal.
function numero(s) {
  if (vazio(s) || s === "-") return null;
  const t = s.replace(/[R$\s]/g, "");
  const ultVirg = t.lastIndexOf(",");
  const ultPonto = t.lastIndexOf(".");
  let limpo;
  if (ultVirg > ultPonto) limpo = t.replace(/\./g, "").replace(",", ".");
  else limpo = t.replace(/,/g, "");
  const n = Number(limpo);
  return Number.isFinite(n) ? n : null;
}

// "25/06/2026 20:34:46" → Date
function dataHoraCompleta(s) {
  const m = (s ?? "").match(/(\d{2})\/(\d{2})\/(\d{4})(?:\s+(\d{2}):(\d{2}))?/);
  if (!m) return null;
  const [, d, mes, a, h = "0", min = "0"] = m;
  return new Date(Number(a), Number(mes) - 1, Number(d), Number(h), Number(min));
}

// Coluna de agenda da planilha: mistura data com recado. Ex.:
//   "30/06 as 09"  "29/06 as 9:30h"  "14/07"  → data (hora 00:00 quando ausente)
//   "pagamento agendado 17/07"  "só pode pagar 23/07" → previsão de PAGAMENTO
//   "reagendar na segunda"  "não agendado por orientação" → recado, sem data
// Devolve { reuniao, pagamentoPrevisto, nota } — separando o que a planilha juntou.
function agenda(s) {
  const txt = (s ?? "").trim();
  if (!txt) return { reuniao: null, pagamentoPrevisto: null, nota: null };

  const m = txt.match(/(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?(?:\s*(?:as|às|@)?\s*(\d{1,2})(?::(\d{2}))?\s*h?)?/i);
  if (!m) return { reuniao: null, pagamentoPrevisto: null, nota: txt };

  const [, d, mes, anoTxt, h, min] = m;
  const ano = anoTxt ? (anoTxt.length === 2 ? 2000 + Number(anoTxt) : Number(anoTxt)) : ANO;
  const dt = new Date(ano, Number(mes) - 1, Number(d), Number(h ?? 0), Number(min ?? 0));
  if (isNaN(dt.getTime())) return { reuniao: null, pagamentoPrevisto: null, nota: txt };

  // "pagamento agendado 17/07" é dinheiro previsto, não reunião — a planilha
  // guardava as duas coisas na mesma coluna e ninguém conseguia filtrar.
  const ehPagamento = /pag(ar|amento)|boleto|pix|cart[ãa]o/i.test(txt);
  const restoTexto = txt.replace(m[0], "").trim();
  return {
    reuniao: ehPagamento ? null : dt,
    pagamentoPrevisto: ehPagamento ? dt : null,
    nota: restoTexto || (ehPagamento ? txt : null),
  };
}

// "Como vai pagar o saldo restante?" → meio de pagamento + o texto original.
function meioPagamento(s) {
  const t = (s ?? "").toLowerCase();
  if (!t.trim()) return null;
  if (/cancelamento|reembolso/.test(t)) return null;
  if (/recorrente/.test(t)) return "cartao_recorrente";
  if (/boleto/.test(t)) return "boleto";
  if (/cart[ãa]o/.test(t)) return "cartao";
  if (/pix/.test(t)) return "pix";
  if (/vista/.test(t)) return "avista";
  return null;
}

// STATUS REUNIÃO → etapa do kanban (a esteira comercial disfarçada de texto).
//
// "Realizada/pago" NÃO vira "Pagamento Realizado": essa etapa é uma PORTA — quem
// passa por ela é empurrado para a Ativação e vira aluno na base. Quem decide
// isso é a Hotmart (a compra do saldo), não uma célula de planilha. Sem lastro,
// o import afirmaria um pagamento que não existe e criaria matrícula indevida
// (foi o que aconteceu na 1ª rodada, com 4 cards). O fato verificável é que a
// reunião aconteceu — e o card sobe marcado para conferência.
function etapaPorStatus(status, pediuCancelamento) {
  if (pediuCancelamento) return "hm_cancelamento";
  const t = (status ?? "").trim().toLowerCase();
  if (!t) return null;
  if (t.includes("realizada")) return "hm_reuniao_finalizada";  // inclui "Realizada/pago"
  if (t.includes("agendada")) return "hm_reuniao_agendada";
  if (t.includes("aguardando")) return "hm_aguardando_retorno";
  return null;
}
// A planilha diz que pagou, mas o pagamento tem que existir na Hotmart.
const dizQuePagou = (status) => /pago/i.test(status ?? "");

// O código da oferta de saldo vive dentro do link: ...?off=ikgazdy8
const ofertaDoLink = (s) => ((s ?? "").match(/off=([a-z0-9]+)/i)?.[1] ?? null);

// ---------- leitura das abas --------------------------------------------
const ARQS = readdirSync(DIR).filter((f) => f.startsWith("HM - T39 CONTROLE DE ATIVA") && f.endsWith(".csv"));
const achar = (frag) => ARQS.find((f) => f.includes(frag));

const registros = [];   // uma linha por pessoa, já normalizada
const socios = [];

// --- aba "HM - Programa de Implementação": o crédito pró-rata mora aqui ---
for (const r of lerAba(achar("Programa de Implementação"))) {
  if (vazio(pick(r, "nome"))) continue;
  const ag = agenda(pick(r, "data da reuniao"));
  const situacao = pick(r, "situacao").toUpperCase();
  const contatoComercial = pick(r, "contato comercial");
  const naoContatar = /N[ÃA]O ENTRAR EM CONTATO/i.test(contatoComercial);
  const precisaRevisar = situacao.includes("REVISAR") || situacao.includes("ATRASO");

  registros.push({
    aba: "Programa de Implementação",
    nome: pick(r, "nome"), documento: digitos(pick(r, "documento")),
    email: pick(r, "email").toLowerCase(),
    telefone: digitos(pick(r, "ddd") + pick(r, "telefone")),
    // crédito: a compra ANTIGA do aluno — insumo do pró-rata
    credito_oferta: pick(r, "ultima compra") || null,
    credito_compra_em: dataHoraCompleta(pick(r, "data do pagamento")),
    credito_valor_pago: numero(pick(r, "valor pago")),
    credito_dias_totais: numero(pick(r, "dias totais")) ?? 365,
    reuniao_em: ag.reuniao,
    pagamento_previsto_em: ag.pagamentoPrevisto,
    reuniao_resultado: pick(r, "status da reuniao") || null,
    etapa: etapaPorStatus(pick(r, "status da reuniao"), false),
    diz_que_pagou: dizQuePagou(pick(r, "status da reuniao")),
    observacoes: [pick(r, "obs"), ag.nota].filter(Boolean).join(" · ") || null,
    nao_contatar: naoContatar,
    nao_contatar_motivo: naoContatar ? contatoComercial : null,
    revisar: precisaRevisar,
    revisar_motivo: precisaRevisar ? [pick(r, "situacao"), pick(r, "obs")].filter(Boolean).join(" — ") : null,
  });
}

// --- abas de alunos por evento (HT ATM, Live, Imersão POA) ---------------
// O grupo de informes muda por turma do evento: a Live cita "THB #27", a
// Imersão POA "#25" — por isso o nome do grupo sai do cabeçalho, não fixo.
for (const [frag, grupo] of [
  ["ALUNOS T39 - HT ATM", null],
  ["ALUNOS T39 - Live Direto ao Ponto", "THB #27"],
  ["ALUNOS T39 - Imersão POA", "THB #25"],
]) {
  const arq = achar(frag);
  if (!arq) continue;
  for (const r of lerAba(arq)) {
    if (vazio(pick(r, "nome"))) continue;
    const comoPaga = pick(r, "como vai pagar", "opcao de pagamento");
    const cancelou = bool(pick(r, "pediu reembolso")) || /cancelamento/i.test(comoPaga);
    const status = pick(r, "status reuniao");

    // A data da reunião: "Reunião do Zoom (data e horário)" nas abas de evento,
    // "Data da reunião Comercial" na HT ATM. Nesta última, quando o status é
    // "Agendada" a data foi parar na coluna SEGUINTE (sem cabeçalho) — a planilha
    // vazou para o lado. Por isso o fallback pela última célula preenchida.
    const agTxt = pick(r, "reuniao do zoom", "data da reuniao comercial");
    const vazado = !agTxt && /agendada/i.test(status) ? (r.__cols.at(-1) || "") : "";
    const ag = agenda(agTxt || vazado);

    registros.push({
      aba: frag,
      nome: pick(r, "nome"), documento: digitos(pick(r, "documento")),
      email: pick(r, "email").toLowerCase(), telefone: digitos(pick(r, "telefone")),
      responsavel: pick(r, "responsavel") || null,
      acordo: comoPaga || null,
      pagamento_meio: meioPagamento(comoPaga),
      oferta_saldo_codigo: ofertaDoLink(pick(r, "link do pagamento", "link de pagamento")),
      link_saldo_enviado: bool(pick(r, "link enviado", "liink enviado")),
      reuniao_em: ag.reuniao,
      pagamento_previsto_em: ag.pagamentoPrevisto,
      reuniao_resultado: status || null,
      etapa: etapaPorStatus(status, cancelou),
      diz_que_pagou: dizQuePagou(status),
      cancelamento_motivo: cancelou ? (comoPaga || "Pediu reembolso") : null,
      // checklist de ativação
      ativ_searchie: bool(pick(r, "acesso ao searchie")),
      ativ_comunidade: bool(pick(r, "acesso a comunidade")),
      ativ_grupo: bool(pick(r, "grupo de informes")),
      ativ_pesquisa: bool(pick(r, "pesquisa")),
      grupo_informes: grupo,
      link_facebook: pick(r, "link do facebook") || null,
      pendencia: pick(r, "o que esta pendente") || null,
      observacoes: [pick(r, "obs"), ag.nota].filter(Boolean).join(" · ") || null,
    });
  }
}

// --- abas de sócios -------------------------------------------------------
// As duas abas se sobrepõem (a de Imersão repete gente da geral): dedupe por
// titular + sócio, senão o mesmo sócio entraria duas vezes.
const vistos = new Set();
for (const frag of ["SÓCIOS T39", "SÓCIOS T39 - Imersão POA"]) {
  const arq = ARQS.find((f) => f.includes(frag));
  if (!arq) continue;
  for (const r of lerAba(arq)) {
    const alunoEmail = pick(r, "e-mail de acesso do aluno").toLowerCase();
    const socioNome = pick(r, "nome completo do(a) socio");
    if (!alunoEmail || !socioNome) continue;
    const chave = `${alunoEmail}|${norm(socioNome)}`;
    if (vistos.has(chave)) continue;
    vistos.add(chave);

    socios.push({
      aluno_email: alunoEmail,
      aluno_nome: pick(r, "nome completo do aluno"),
      nome: socioNome,
      email: pick(r, "e-mail do(a) socio").toLowerCase() || null,
      telefone: digitos(pick(r, "numero de telefone do(a) socio")) || null,
      ativ_searchie: bool(pick(r, "acesso ao searchie")),
      ativ_comunidade: bool(pick(r, "acesso a comunidade")),
      ativ_grupo: bool(pick(r, "grupo de informes")),
      link_facebook: pick(r, "link do facebook") || null,
    });
  }
}

// ---------- casamento com os cards ---------------------------------------
const { Client } = pg;
const url = readFileSync(".env.local", "utf8").match(/DATABASE_URL=(.+)/)?.[1]?.trim().replace(/^["']|["']$/g, "");
const db = new Client({ connectionString: url, ssl: { rejectUnauthorized: false } });
await db.connect();

const { rows: cards } = await db.query(`
  select ch.id as card_id, ch.comprador_id, cmp.nome, lower(trim(cmp.email)) as email,
         regexp_replace(coalesce(cmp.documento,''), '[^0-9]', '', 'g') as documento,
         right(regexp_replace(coalesce(cmp.telefone,''), '[^0-9]', '', 'g'), 10) as tel10
    from cs.contatos_hm ch join public.compradores cmp on cmp.id = ch.comprador_id`);

const porDoc = new Map(cards.filter((c) => c.documento).map((c) => [c.documento, c]));
const porEmail = new Map(cards.filter((c) => c.email).map((c) => [c.email, c]));
const porTel = new Map(cards.filter((c) => c.tel10?.length === 10).map((c) => [c.tel10, c]));

function casar(r) {
  const tel10 = (r.telefone ?? "").slice(-10);
  return (
    (r.documento && porDoc.get(r.documento)) ||
    (r.email && porEmail.get(r.email)) ||
    (tel10.length === 10 && porTel.get(tel10)) ||
    null
  );
}

const casados = [];
const orfas = [];
for (const r of registros) {
  const card = casar(r);
  if (card) casados.push({ ...r, card });
  else orfas.push(r);
}

const sociosCasados = [];
const sociosOrfaos = [];
for (const s of socios) {
  const card = porEmail.get(s.aluno_email) ?? null;
  if (card) sociosCasados.push({ ...s, card });
  else sociosOrfaos.push(s);
}

// ---------- relatório ------------------------------------------------------
const fmt = (d) => (d ? d.toISOString().slice(0, 16).replace("T", " ") : "—");
console.log(`\n=== PLANILHA HM T39 → SISTEMA ${APLICAR ? "(APLICANDO)" : "(DRY-RUN — nada será gravado)"}\n`);
console.log(`Linhas lidas:        ${registros.length}  (${ARQS.length} abas)`);
console.log(`Casaram com um card: ${casados.length}`);
console.log(`Órfãs (sem card):    ${orfas.length}`);
console.log(`Sócios lidos:        ${socios.length}  (casaram: ${sociosCasados.length}, órfãos: ${sociosOrfaos.length})`);

const conta = (campo) => casados.filter((c) => c[campo] !== null && c[campo] !== undefined && c[campo] !== false && c[campo] !== "").length;
console.log(`\nDados que serão gravados:`);
for (const campo of ["responsavel", "reuniao_em", "reuniao_resultado", "etapa", "acordo", "pagamento_meio",
  "pagamento_previsto_em", "oferta_saldo_codigo", "link_saldo_enviado", "nao_contatar", "revisar",
  "ativ_searchie", "ativ_comunidade", "ativ_grupo", "ativ_pesquisa", "pendencia", "link_facebook",
  "credito_valor_pago", "cancelamento_motivo", "observacoes"]) {
  const n = conta(campo);
  if (n) console.log(`  ${campo.padEnd(24)} ${n}`);
}

if (orfas.length) {
  console.log(`\n⚠️  ÓRFÃS — linha da planilha sem card no sistema (NÃO serão importadas):`);
  for (const o of orfas) console.log(`  [${o.aba}] ${o.nome} · doc ${o.documento || "—"} · ${o.email || "—"}`);
}
if (sociosOrfaos.length) {
  console.log(`\n⚠️  SÓCIOS órfãos — titular não encontrado:`);
  for (const s of sociosOrfaos) console.log(`  ${s.nome} (sócio de ${s.aluno_nome} <${s.aluno_email}>)`);
}

// Amostra: as 5 primeiras linhas com o que foi extraído da coluna de agenda —
// é onde mora o maior risco de interpretação (data x recado x previsão de pagto).
console.log(`\nAmostra da leitura de agenda (data x recado):`);
for (const c of casados.filter((x) => x.reuniao_em || x.pagamento_previsto_em || x.observacoes).slice(0, 8)) {
  console.log(`  ${c.nome.padEnd(34)} reunião ${fmt(c.reuniao_em).padEnd(17)} previsão ${fmt(c.pagamento_previsto_em).padEnd(17)} ${c.observacoes ?? ""}`);
}

writeFileSync("scripts/.import-hm-relatorio.json", JSON.stringify({ casados: casados.length, orfas, sociosOrfaos }, null, 2));

// ---------- gravação -------------------------------------------------------
if (!APLICAR) {
  console.log(`\nNada foi gravado. Rode com --apply depois de conferir o relatório acima.\n`);
  await db.end();
  process.exit(0);
}

await db.query("begin");
try {
  let n = 0;
  for (const c of casados) {
    // COALESCE em tudo: a planilha COMPLEMENTA o card, nunca apaga o que já
    // existe nele (o operador pode ter preenchido algo desde a exportação).
    await db.query(
      `update cs.contatos_hm set
         responsavel           = coalesce(responsavel, $2),
         reuniao_em            = coalesce(reuniao_em, $3::timestamptz),
         reuniao_resultado     = coalesce(reuniao_resultado, $4),
         acordo                = coalesce(acordo, $5),
         pagamento_meio        = coalesce(pagamento_meio, $6),
         pagamento_previsto_em = coalesce(pagamento_previsto_em, $7::date),
         oferta_saldo_codigo   = coalesce(oferta_saldo_codigo, $8),
         link_saldo_enviado_em = coalesce(link_saldo_enviado_em, case when $9 then now() else null end),
         nao_contatar          = nao_contatar or $10,
         nao_contatar_motivo   = coalesce(nao_contatar_motivo, $11),
         revisar               = revisar or $12,
         revisar_motivo        = coalesce(revisar_motivo, $13),
         ativ_searchie         = ativ_searchie or $14,
         ativ_comunidade       = ativ_comunidade or $15,
         ativ_grupo            = ativ_grupo or $16,
         ativ_pesquisa         = ativ_pesquisa or $17,
         grupo_informes        = coalesce(grupo_informes, $18),
         pendencia             = coalesce(pendencia, $19),
         link_facebook         = coalesce(link_facebook, $20),
         cancelamento_motivo   = coalesce(cancelamento_motivo, $21),
         credito_oferta        = coalesce(credito_oferta, $22),
         credito_compra_em     = coalesce(credito_compra_em, $23::date),
         credito_valor_pago    = coalesce(credito_valor_pago, $24),
         credito_dias_totais   = coalesce(credito_dias_totais, $25),
         observacoes           = case
                                   when $26::text is null then observacoes
                                   when observacoes is null then $26
                                   when position($26 in observacoes) > 0 then observacoes
                                   else observacoes || E'\n' || $26
                                 end,
         atualizado_em = now()
       where id = $1`,
      [c.card.card_id, c.responsavel ?? null, c.reuniao_em ?? null, c.reuniao_resultado ?? null,
       c.acordo ?? null, c.pagamento_meio ?? null, c.pagamento_previsto_em ?? null,
       c.oferta_saldo_codigo ?? null, !!c.link_saldo_enviado, !!c.nao_contatar, c.nao_contatar_motivo ?? null,
       !!c.revisar, c.revisar_motivo ?? null, !!c.ativ_searchie, !!c.ativ_comunidade, !!c.ativ_grupo,
       !!c.ativ_pesquisa, c.grupo_informes ?? null, c.pendencia ?? null, c.link_facebook ?? null,
       c.cancelamento_motivo ?? null, c.credito_oferta ?? null, c.credito_compra_em ?? null,
       c.credito_valor_pago ?? null, c.credito_dias_totais ?? null, c.observacoes ?? null],
    );
    n++;
  }

  // "Realizada/pago" sem pagamento na Hotmart: o comercial afirma, a plataforma
  // não confirma. O sistema não escolhe um lado — marca para conferência humana.
  let conferir = 0;
  for (const c of casados.filter((x) => x.diz_que_pagou)) {
    const { rowCount } = await db.query(
      `update cs.contatos_hm ch
          set revisar = true,
              revisar_motivo = coalesce(ch.revisar_motivo,
                'Planilha diz "Realizada/pago", mas a Hotmart não registra o pagamento do saldo. '
                || 'Se foi combinado fora da plataforma, use "Registrar pagamento" na ficha.'),
              atualizado_em = now()
        where ch.id = $1
          and not exists (
            select 1 from public.compras c
              join public.hm_product_catalog cat on cat.offer_code = c.oferta_codigo
             where c.comprador_id = ch.comprador_id
               and c.status in ('APPROVED','COMPLETE','COMPLETED')
               and cat.categoria in ('diferenca','compra_cheia'))`,
      [c.card.card_id],
    );
    conferir += rowCount;
  }

  // Etapa: só move o card que ainda está no ponto de partida. Quem o operador já
  // moveu no board manda — o board é mais novo que a planilha exportada.
  let movidos = 0;
  for (const c of casados.filter((x) => x.etapa)) {
    const { rowCount } = await db.query(
      `update cs.contatos_hm ch
          set estagio_id = (select id from cs.estagios where chave = $2 and evento='HM' and ativo),
              atualizado_em = now()
        where ch.id = $1
          and ch.estagio_id = (select id from cs.estagios where chave = 'hm_comprou' and evento='HM')`,
      [c.card.card_id, c.etapa],
    );
    movidos += rowCount;
  }

  let s = 0;
  for (const so of sociosCasados) {
    await db.query(
      `insert into cs.hm_socios (contato_hm_id, nome, email, telefone, ativ_searchie, ativ_comunidade, ativ_grupo, link_facebook)
       values ($1,$2,nullif($3,''),nullif($4,''),$5,$6,$7,nullif($8,''))
       on conflict do nothing`,
      [so.card.card_id, so.nome, so.email ?? "", so.telefone ?? "", so.ativ_searchie, so.ativ_comunidade, so.ativ_grupo, so.link_facebook ?? ""],
    );
    s++;
  }

  await db.query("commit");
  console.log(`\n✅ Gravado: ${n} cards atualizados · ${movidos} movidos de etapa · ${s} sócios inseridos.\n`);
} catch (e) {
  await db.query("rollback");
  console.error("\n❌ ROLLBACK — nada foi gravado:", e.message, "\n");
  process.exitCode = 1;
}
await db.end();
