#!/usr/bin/env node
// =====================================================================
// import-hotmart-vendas — o extrato financeiro completo da Hotmart.
//
// O webhook guarda só uma fatia do que a Hotmart manda: preço, método, parcelas.
// Joga fora o que o cliente realmente desembolsou (com juros), o que o produtor
// recebeu (líquido), as taxas, o tipo de cobrança, o canal da venda — e, o mais
// caro de todos, EM QUE COBRANÇA a transação está.
//
// Esse último é o que quebrava a automação: a Hotmart REUSA a transação no
// Parcelado e incrementa o contador de cobranças. Sem ele, a 2ª parcela de quem
// paga mensalidade era invisível (a Marina pagou duas e o sistema contava uma).
//
// Este script lê o export `sales_history` (o de 60 colunas) e preenche tudo.
// Não cria card: card nasce do gatilho de venda, e só para compra APROVADA.
//
//   node scripts/import-hotmart-vendas.mjs           → dry-run (padrão)
//   node scripts/import-hotmart-vendas.mjs --sql     → imprime o SQL gerado
// =====================================================================
import fs from 'node:fs'
import path from 'node:path'

const DOWNLOADS = 'C:/Users/infra/Downloads'
const SO_SQL = process.argv.includes('--sql')

// O export é UTF-8 COM BOM e separador ';'. Campos entre aspas podem ter ';'.
// Lê-lo como latin1 (o BOM aparece como "ï»¿" e engana) corrompe todo acento: o
// cabeçalho "Faturamento líquido" vira "Faturamento lÃ­quido", a coluna não é
// encontrada e o líquido entra zerado — e os nomes viram "MoysÃ©s Abras".
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
    else if (c === ';') { linha.push(campo); campo = '' }
    else if (c === '\n') { linha.push(campo); linhas.push(linha); linha = []; campo = '' }
    else if (c !== '\r') campo += c
  }
  if (campo || linha.length) { linha.push(campo); linhas.push(linha) }
  return linhas
}

// O Chrome sufixa "(1)" a cada download: pegar o mais RECENTE, senão o script lê a
// exportação de ontem e jura que está tudo em dia.
const arquivo = fs.readdirSync(DOWNLOADS)
  .filter((f) => f.startsWith('sales_history') && f.endsWith('.csv'))
  .map((f) => ({ f, m: fs.statSync(path.join(DOWNLOADS, f)).mtimeMs }))
  .sort((a, b) => b.m - a.m)
  .map((x) => x.f)
  .find((f) => {
    const cab = fs.readFileSync(path.join(DOWNLOADS, f), 'utf8').split('\n')[0]
    return cab.includes('Quantidade de cobran')   // o export completo, não o resumido
  })

if (!arquivo) {
  console.error('Não achei um sales_history com a coluna "Quantidade de cobranças" em ' + DOWNLOADS)
  process.exit(1)
}

const linhas = parseCsv(fs.readFileSync(path.join(DOWNLOADS, arquivo), 'utf8').replace(/^﻿/, ''))
const cab = linhas[0]
const ix = (frag) => cab.findIndex((c) => c.toLowerCase().includes(frag.toLowerCase()))

const COL = {
  transacao: ix('digo da transa'),
  status:    ix('Status da transa'),
  dataVenda: ix('Data da transa'),
  dataConf:  ix('Confirma'),
  produtoId: ix('digo do produto'),
  produto:   ix('Produto'),
  oferta:    ix('digo do pre'),
  ofertaNome:ix('Nome deste pre'),
  comImposto:cab.indexOf('Valor de compra com impostos'),
  impostos:  ix('Impostos locais de compra'),
  semImposto:cab.indexOf('Valor de compra sem impostos'),
  liquido:   cab.indexOf('Faturamento líquido'),
  taxaProc:  ix('Taxa de processamento'),
  taxaParc:  ix('Taxa de parcelamento'),
  canal:     ix('digo SCK'),
  metodo:    ix('todo de pagamento'),
  tipoCobr:  ix('Tipo de cobran'),
  parcelas:  ix('Quantidade total de parcelas'),
  cobrancas: ix('Quantidade de cobran'),
  vencimento:ix('Data de vencimento'),
  assinante: ix('digo do assinante'),
  nome:      ix('Comprador'),
  email:     ix('Email do(a) Comprador'),
  telefone:  ix('Telefone'),
  documento: ix('Documento'),
}

// "Aprovado"/"Completo" → o dinheiro entrou. Boleto impresso/Aguardando → não entrou.
const STATUS = {
  'Aprovado': 'APPROVED',
  'Completo': 'COMPLETE',
  'Boleto impresso': 'PRINTED_BILLET',
  'Aguardando Pagto': 'WAITING_PAYMENT',
  'Cancelada': 'CANCELED',
  'Reembolsado': 'REFUNDED',
  'Estornado': 'CHARGEBACK',
  'Expirado': 'EXPIRED',
}
const METODO = {
  'Cartão de Crédito': 'CREDIT_CARD',
  'Dois Cartões de Crédito': 'CREDIT_CARD',
  'Pix': 'PIX',
  'Boleto Bancário': 'BILLET',
  'Parcelado Hotmart': 'HOTMART_INSTALLMENTS',
}

const n = (v) => { const x = Number(String(v ?? '').trim()); return Number.isFinite(x) ? x : null }
const dt = (v) => {
  const m = String(v ?? '').match(/(\d{2})\/(\d{2})\/(\d{4})(?:\s+(\d{2}):(\d{2}):(\d{2}))?/)
  return m ? `${m[3]}-${m[2]}-${m[1]}${m[4] ? ` ${m[4]}:${m[5]}:${m[6]}` : ''}` : null
}
const q = (v) => (v == null || v === '' || v === '(none)' ? 'null' : `'${String(v).replace(/'/g, "''").trim()}'`)
const qn = (v) => (v == null ? 'null' : String(v))

const vendas = []
for (const l of linhas.slice(1)) {
  const tx = l[COL.transacao]?.trim()
  if (!tx || !tx.startsWith('HP')) continue
  vendas.push({
    transacao: tx,
    status: STATUS[l[COL.status]?.trim()] ?? l[COL.status]?.trim(),
    dataVenda: dt(l[COL.dataVenda]),
    dataConf: dt(l[COL.dataConf]),
    produtoId: l[COL.produtoId]?.trim(),
    produto: l[COL.produto]?.trim(),
    oferta: l[COL.oferta]?.trim() || null,
    preco: n(l[COL.semImposto]),
    comImposto: n(l[COL.comImposto]),
    liquido: n(l[COL.liquido]),
    taxaProc: n(l[COL.taxaProc]),
    taxaParc: n(l[COL.taxaParc]),
    canal: l[COL.canal]?.trim(),
    metodo: METODO[l[COL.metodo]?.trim()] ?? l[COL.metodo]?.trim(),
    tipoCobr: l[COL.tipoCobr]?.trim(),
    parcelas: n(l[COL.parcelas]),
    cobrancas: n(l[COL.cobrancas]),
    vencimento: dt(l[COL.vencimento]),
    assinante: l[COL.assinante]?.trim(),
    nome: l[COL.nome]?.trim(),
    email: l[COL.email]?.trim().toLowerCase(),
    telefone: l[COL.telefone]?.replace(/\D/g, ''),
    documento: l[COL.documento]?.replace(/\D/g, ''),
  })
}

const pagas = vendas.filter((v) => ['APPROVED', 'COMPLETE'].includes(v.status))
const parceladas = pagas.filter((v) => (v.cobrancas ?? 1) > 1)

console.log(`Arquivo: ${arquivo}`)
console.log(`Vendas lidas          : ${vendas.length}`)
console.log(`  pagas               : ${pagas.length}`)
console.log(`  não pagas (boletos) : ${vendas.length - pagas.length}`)
console.log(`Com MAIS DE UMA cobrança (a parcela que o sistema não via): ${parceladas.length}`)
for (const v of parceladas) {
  console.log(`  • ${v.nome.padEnd(32)} cobrança ${v.cobrancas}/${v.parcelas} · ` +
    `R$ ${v.preco} cada = R$ ${(v.preco * v.cobrancas).toFixed(2)} já pagos · ${v.oferta}`)
}

if (!process.argv.includes('--apply')) {
  console.log('\nNada foi gravado. Rode com --apply para importar.\n')
  process.exit(0)
}

// ---- grava, pela porta com nome (cs.fn_importar_venda_hotmart, 0089) ------
const { createRequire } = await import('node:module')
const req = createRequire('c:/Users/infra/sistema-disparos-participa/package.json')
const pg = req('pg')

const env = Object.fromEntries(
  fs.readFileSync('.env.local', 'utf8').split(/\r?\n/)
    .filter((l) => /^[A-Z_]+=/.test(l))
    .map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).replace(/^["']|["']$/g, '')]),
)

const db = new pg.Client({ connectionString: env.DATABASE_URL })
await db.connect()

let ok = 0, pulados = 0
const falhas = []
for (const v of vendas) {
  if (!v.email) { pulados++; continue }
  try {
    await db.query(
      `select cs.fn_importar_venda_hotmart(
         $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::smallint,$12,$13::timestamptz,$14::timestamptz,
         $15::smallint,$16,$17,$18,$19,$20,$21,$22,$23::date)`,
      [v.transacao, v.email, v.nome, v.telefone, v.documento, v.produtoId, v.produto, v.oferta,
       v.preco, v.metodo, v.parcelas, v.status, v.dataVenda, v.dataConf,
       v.cobrancas, v.tipoCobr, v.comImposto, v.liquido, v.taxaProc, v.taxaParc,
       v.canal, v.assinante, v.vencimento],
    )
    ok++
  } catch (e) {
    falhas.push({ tx: v.transacao, nome: v.nome, erro: e.message })
  }
}
await db.end()

console.log(`\nImportadas : ${ok}`)
console.log(`Sem e-mail : ${pulados}`)
if (falhas.length) {
  console.log(`FALHAS     : ${falhas.length}`)
  for (const f of falhas.slice(0, 10)) console.log(`  • ${f.nome} (${f.tx}): ${f.erro}`)
}
