#!/usr/bin/env node
// =====================================================================
// import-hm-prorata — os insumos do crédito pró-rata, e SÓ eles.
//
// O saldo do aluno da base é 14.700 menos o que ele pagou e ainda não usou.
// Esse crédito só é calculável com quatro dados: qual foi a compra anterior,
// quando, por quanto, e por quantos dias de acesso. Sem eles, o sistema não
// afirma saldo nenhum — e o que ele não sabe cobrar, não cobra.
//
// POR QUE NÃO USAR scripts/import-hm-planilha.mjs: aquele importador escreve
// etapa, resultado de reunião, observações, cancelamento — 126 cards. A planilha
// está APOSENTADA (docs/hm-modelo-de-dados.md): o kanban andou desde então, e
// reimportá-la reescreveria o presente com o passado. Este script toca em quatro
// colunas e em mais nenhuma.
//
// Nunca sobrescreve valor já preenchido (coalesce): a planilha COMPLEMENTA o que
// falta, nunca corrige o que existe. Onde os dois discordam, o script RELATA e
// deixa a decisão com uma pessoa.
//
//   node scripts/import-hm-prorata.mjs           → dry-run (padrão)
//   node scripts/import-hm-prorata.mjs --apply   → grava, dentro de transação
// =====================================================================
import fs from 'node:fs'
import path from 'node:path'
import pg from 'pg'

const APLICAR = process.argv.includes('--apply')
const DOWNLOADS = 'C:/Users/infra/Downloads'

// O Chrome sufixa "(1)", "(2)" a cada novo download da mesma aba, e a planilha é
// reexportada o tempo todo. Pegar a mais RECENTE por data de modificação — apontar
// para um nome fixo faz o script ler a versão de ontem e jurar que está tudo em dia.
function planilhaMaisRecente(fragmento) {
  const candidatos = fs.readdirSync(DOWNLOADS)
    .filter((f) => f.endsWith('.csv') && f.normalize('NFC').includes(fragmento.normalize('NFC')))
    .map((f) => ({ f, mtime: fs.statSync(path.join(DOWNLOADS, f)).mtimeMs }))
    .sort((a, b) => b.mtime - a.mtime)
  return candidatos[0]
}

// --- CSV: campos entre aspas podem conter vírgula e quebra de linha ---------
function parseCsv(texto) {
  const linhas = []
  let campo = '', linha = [], aspas = false
  for (let i = 0; i < texto.length; i++) {
    const c = texto[i]
    if (aspas) {
      if (c === '"' && texto[i + 1] === '"') { campo += '"'; i++ }
      else if (c === '"') aspas = false
      else campo += c
    } else if (c === '"') aspas = true
    else if (c === ',') { linha.push(campo); campo = '' }
    else if (c === '\n') { linha.push(campo); linhas.push(linha); linha = []; campo = '' }
    else if (c !== '\r') campo += c
  }
  if (campo || linha.length) { linha.push(campo); linhas.push(linha) }
  return linhas
}

const normaliza = (s) =>
  (s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim()

// A planilha mistura 12.772,68 (BR) e 12,772.68 (US) na MESMA coluna.
// Regra que resolve os dois: o último separador é o decimal.
function numero(bruto) {
  if (bruto == null) return null
  const s = String(bruto).replace(/[R$\s]/g, '').trim()
  if (!s || s === '-') return null
  const ultimaVirgula = s.lastIndexOf(',')
  const ultimoPonto = s.lastIndexOf('.')
  let limpo
  if (ultimaVirgula > ultimoPonto) limpo = s.replace(/\./g, '').replace(',', '.')
  else if (ultimoPonto > ultimaVirgula) limpo = s.replace(/,/g, '')
  else limpo = s.replace(',', '.')
  const n = Number(limpo)
  return Number.isFinite(n) ? n : null
}

function data(bruto) {
  const m = String(bruto ?? '').match(/(\d{2})\/(\d{2})\/(\d{4})/)
  return m ? `${m[3]}-${m[2]}-${m[1]}` : null
}

const soDigitos = (s) => String(s ?? '').replace(/\D/g, '')
const brl = (n) =>
  n == null ? '—' : n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })

// --- lê a aba ---------------------------------------------------------------
const escolhida = planilhaMaisRecente('HM - Programa de Implementa')
if (!escolhida) {
  console.error(`Não achei a planilha "HM - Programa de Implementação" em ${DOWNLOADS}`)
  process.exit(1)
}
const arquivo = path.join(DOWNLOADS, escolhida.f)
console.log(`Planilha: ${escolhida.f}  (baixada em ${new Date(escolhida.mtime).toLocaleString('pt-BR')})`)

const linhas = parseCsv(fs.readFileSync(arquivo, 'utf8').replace(/^﻿/, ''))
const cabecalho = linhas[0].map(normaliza)
const acha = (frag) => cabecalho.findIndex((h) => h.includes(normaliza(frag)))

const col = {
  nome:      acha('nome'),
  documento: acha('documento'),
  email:     acha('email'),
  telefone:  acha('telefone'),
  oferta:    acha('ultima compra (oferta)'),
  pagoEm:    acha('data do pagamento'),
  valorPago: acha('valor pago'),
  diasTotais:acha('dias totais'),
  credito:   acha('pro-rata (credito)'),
  saldo:     acha('saldo a pagar'),
}
if (col.oferta < 0 || col.valorPago < 0) {
  console.error('A planilha não tem as colunas esperadas (oferta / valor pago).')
  process.exit(1)
}

const registros = []
for (const l of linhas.slice(1)) {
  const nome = l[col.nome]?.trim()
  if (!nome || nome.startsWith('#REF')) continue
  const valorPago = numero(l[col.valorPago])
  const pagoEm = data(l[col.pagoEm])
  // Sem valor E sem data não há crédito a calcular — a linha não tem o que dizer.
  if (valorPago == null && !pagoEm) continue
  registros.push({
    nome,
    documento: soDigitos(l[col.documento]),
    email: (l[col.email] ?? '').trim().toLowerCase(),
    telefone: soDigitos(l[col.telefone]).slice(-10),
    oferta: (l[col.oferta] ?? '').trim() || null,
    pagoEm,
    valorPago,
    diasTotais: numero(l[col.diasTotais]) ?? 365,
    creditoPlanilha: numero(l[col.credito]),
    saldoPlanilha: numero(l[col.saldo]),
  })
}

// --- banco ------------------------------------------------------------------
const env = Object.fromEntries(
  fs.readFileSync('.env.local', 'utf8').split(/\r?\n/)
    .filter((l) => /^[A-Z_]+=/.test(l))
    .map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).replace(/^["']|["']$/g, '')]),
)

const db = new pg.Client({ connectionString: env.DATABASE_URL })
await db.connect()

const { rows: cards } = await db.query(`
  select ch.id, ch.comprador_id, cp.nome, lower(cp.email) as email,
         regexp_replace(coalesce(cp.documento,''), '\\D', '', 'g') as documento,
         right(regexp_replace(coalesce(cp.telefone,''), '\\D', '', 'g'), 10) as telefone,
         ch.credito_oferta, ch.credito_compra_em, ch.credito_valor_pago, ch.credito_dias_totais
    from cs.contatos_hm ch
    join public.compradores cp on cp.id = ch.comprador_id`)

// Casamento: documento (CPF é único) → e-mail → últimos 10 dígitos do telefone.
// O `via` importa: SOBRESCREVER só é permitido quando o CPF casou. Foi um casamento
// frouxo que embaralhou os créditos da primeira vez (o card do Rodolfo ficou com a
// compra do Pedro Henrique) — telefone e e-mail erram, CPF não.
const porDoc = new Map(), porEmail = new Map(), porTel = new Map()
for (const c of cards) {
  if (c.documento) porDoc.set(c.documento, c)
  if (c.email) porEmail.set(c.email, c)
  if (c.telefone) porTel.set(c.telefone, c)
}
const casa = (r) => {
  if (r.documento && porDoc.get(r.documento)) return { card: porDoc.get(r.documento), via: 'documento' }
  if (r.email && porEmail.get(r.email)) return { card: porEmail.get(r.email), via: 'email' }
  if (r.telefone && porTel.get(r.telefone)) return { card: porTel.get(r.telefone), via: 'telefone' }
  return null
}

const preencher = [], jaTinha = [], divergentes = [], orfaos = [], semCpf = []

for (const r of registros) {
  const m = casa(r)
  if (!m) { orfaos.push(r); continue }           // sem card não se cria card
  const { card, via } = m

  const temTudo = card.credito_valor_pago != null && card.credito_compra_em != null
  if (temTudo) {
    const doBanco = Number(card.credito_valor_pago)
    if (r.valorPago != null && Math.abs(doBanco - r.valorPago) >= 1) {
      // Diverge. Só corrijo por chave FORTE: CPF ou e-mail (public.compradores é
      // único por e-mail — a Hotmart faz upsert por ele). Telefone não corrige nada:
      // os últimos 10 dígitos colidem entre pessoas, e casamento frouxo foi o que
      // embaralhou esses créditos da primeira vez.
      if (via === 'documento' || via === 'email') divergentes.push({ ...r, card, doBanco, via })
      else semCpf.push({ ...r, card, doBanco, via })
    } else {
      jaTinha.push({ ...r, card })
    }
    continue
  }
  if (r.valorPago == null || !r.pagoEm) continue  // insumo incompleto não vira crédito
  preencher.push({ ...r, card, via })
}

console.log(`\n=== PRÓ-RATA: insumos do crédito ${APLICAR ? '(APLICANDO)' : '(DRY-RUN — nada será gravado)'}\n`)
console.log(`Linhas com insumo na planilha : ${registros.length}`)
console.log(`Casaram com um card           : ${registros.length - orfaos.length}`)
console.log(`Órfãs (sem card — ignoradas)  : ${orfaos.length}`)
console.log(`\nA PREENCHER (card sem insumo) : ${preencher.length}`)
console.log(`Já tinham insumo (intactos)   : ${jaTinha.length}`)
console.log(`DIVERGENTES (não sobrescrevo) : ${divergentes.length}`)

if (preencher.length) {
  console.log('\n--- Vão ganhar crédito calculável ---')
  for (const p of preencher.slice(0, 40)) {
    console.log(
      `  ${p.card.nome.slice(0, 34).padEnd(35)} ${brl(p.valorPago).padStart(13)}` +
      `  em ${p.pagoEm}  (${p.diasTotais}d)  ${String(p.oferta ?? '').slice(0, 30)}`)
  }
  if (preencher.length > 40) console.log(`  … e mais ${preencher.length - 40}`)
}

if (divergentes.length) {
  // O que a divergência CUSTA. O crédito é o que o aluno pagou e ainda não usou:
  //   credito = valor_pago × (dias_restantes / dias_totais)  ·  saldo = 14.700 − credito
  // Crédito inflado = saldo menor = dinheiro que deixamos de cobrar. O sinal importa
  // mais que o valor: um crédito para MENOS cobra a mais e vira reclamação.
  const hoje = new Date()
  const creditoDe = (valorPago, pagoEm, diasTotais) => {
    if (valorPago == null || !pagoEm) return null
    const usados = Math.floor((hoje - new Date(pagoEm + 'T00:00:00')) / 86400000)
    const restantes = Math.max((diasTotais ?? 365) - usados, 0)
    return (valorPago * restantes) / (diasTotais ?? 365)
  }

  let deixadoDeCobrar = 0, cobradoAMais = 0
  const linhas = []
  for (const d of divergentes) {
    const cBanco = creditoDe(d.doBanco, d.card.credito_compra_em?.toISOString().slice(0, 10), d.card.credito_dias_totais)
    const cPlan = creditoDe(d.valorPago, d.pagoEm, d.diasTotais)
    const saldoBanco = cBanco == null ? null : 14700 - cBanco
    const saldoPlan = cPlan == null ? null : 14700 - cPlan
    const delta = saldoBanco != null && saldoPlan != null ? saldoPlan - saldoBanco : null
    if (delta != null) { if (delta > 0) deixadoDeCobrar += delta; else cobradoAMais += -delta }
    linhas.push({ ...d, cBanco, cPlan, saldoBanco, saldoPlan, delta })
  }
  linhas.sort((a, b) => (b.delta ?? 0) - (a.delta ?? 0))

  console.log('\n--- DIVERGEM do banco: o insumo do crédito não bate (NÃO sobrescrevo) ---')
  console.log('    (saldo = 14.700 − crédito de hoje. Δ positivo = estamos cobrando MENOS do que deveríamos)\n')
  console.log(`    ${'Nome'.padEnd(34)} ${'pago (banco)'.padStart(13)} ${'pago (planilha)'.padStart(15)} ${'saldo banco'.padStart(12)} ${'saldo planilha'.padStart(14)} ${'Δ'.padStart(11)}`)
  for (const l of linhas) {
    console.log(
      `    ${l.card.nome.slice(0, 33).padEnd(34)} ${brl(l.doBanco).padStart(13)} ${brl(l.valorPago).padStart(15)}` +
      ` ${brl(l.saldoBanco).padStart(12)} ${brl(l.saldoPlan).padStart(14)} ${brl(l.delta).padStart(11)}`)
  }
  console.log(`\n    Se a PLANILHA estiver certa:`)
  console.log(`      deixamos de cobrar : ${brl(deixadoDeCobrar)}`)
  console.log(`      cobramos a mais    : ${brl(cobradoAMais)}`)
  console.log(`      efeito líquido     : ${brl(deixadoDeCobrar - cobradoAMais)}`)
}

if (semCpf.length) {
  console.log('\n--- DIVERGEM, mas casaram só por TELEFONE — NÃO corrijo (confira à mão) ---')
  for (const s of semCpf) {
    console.log(`  ${s.card.nome.slice(0, 34).padEnd(35)} banco ${brl(s.doBanco).padStart(13)}  ×  planilha ${brl(s.valorPago).padStart(13)}`)
  }
}

if (orfaos.length) {
  console.log('\n--- Sem card (nenhum card será criado) ---')
  for (const o of orfaos) console.log(`  ${o.nome} · ${o.email}`)
}

if (!APLICAR) {
  console.log('\nNada foi gravado. Rode com --apply depois de conferir.\n')
  await db.end()
  process.exit(0)
}

// --- grava, e só os quatro campos ------------------------------------------
// Backup do estado anterior: cs._bkp_0080_credito (tirado antes desta rodada).
try {
  await db.query('begin')

  // 1) Card sem insumo: a planilha COMPLEMENTA (coalesce — não pisa em nada).
  //    EXCETO dias_totais: a coluna tem DEFAULT 365, então ela nunca está "vazia" e
  //    um coalesce faria o default vencer o dado real. Acesso de 90 dias importado
  //    como 365 infla o crédito e derruba o saldo (foi o caso do Vezio: R$ 3.178 a
  //    menos). Quando a planilha diz quantos dias são, ela manda.
  for (const p of preencher) {
    await db.query(
      `update cs.contatos_hm
          set credito_oferta      = coalesce(credito_oferta, $2),
              credito_compra_em   = coalesce(credito_compra_em, $3::date),
              credito_valor_pago  = coalesce(credito_valor_pago, $4::numeric),
              credito_dias_totais = coalesce($5::int, credito_dias_totais),
              atualizado_em       = now()
        where id = $1`,
      [p.card.id, p.oferta, p.pagoEm, p.valorPago, p.diasTotais])
  }

  // 2) Card com insumo EMBARALHADO: a planilha CORRIGE (sobrescreve), e só onde o
  //    CPF casou. O crédito passa a sair da compra certa da pessoa certa.
  for (const d of divergentes) {
    await db.query(
      `update cs.contatos_hm
          set credito_oferta      = $2,
              credito_compra_em   = $3::date,
              credito_valor_pago  = $4::numeric,
              credito_dias_totais = $5::int,
              atualizado_em       = now()
        where id = $1`,
      [d.card.id, d.oferta, d.pagoEm, d.valorPago, d.diasTotais])
  }

  await db.query('commit')
  console.log(`\n${preencher.length} card(s) ganharam insumo · ${divergentes.length} corrigidos pelo CPF.`)
  console.log(`Backup do estado anterior: cs._bkp_0080_credito. Nada mais foi tocado.\n`)
} catch (e) {
  await db.query('rollback')
  console.error('\nFALHOU — rollback, nada gravado:', e.message)
  process.exitCode = 1
} finally {
  await db.end()
}
