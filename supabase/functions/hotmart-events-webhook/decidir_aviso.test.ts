// deno test supabase/functions/hotmart-events-webhook/decidir_aviso.test.ts
// Fixtures mínimos no formato do payload da Hotmart (v2). Dados fictícios.
import { assertEquals } from "jsr:@std/assert@1";
import {
  codigoAssinante,
  decidirAviso,
  decidirAvisoLegado,
  diaSaoPaulo,
  hashEmail,
  numeroRecorrencia,
  rotuloAguardando,
  tituloRecusa,
} from "./decidir_aviso.ts";

// 2026-09-20 02:30 UTC = 2026-09-19 23:30 em São Paulo: prova que o dia é o de SP.
const CRIADO_EM = Date.UTC(2026, 8, 20, 2, 30);
const AGORA = Date.UTC(2030, 0, 1);
// sha256("fulano.teste@exemplo.com"), calculado fora do Deno (sha256sum) — não pelo próprio código.
const HASH_FULANO = "537ff3adc8f3b5f8b8899bb088edd0e9f391b624735ffa40f9d4df852d3f900a";

function evento(event: string, purchase: Record<string, unknown>, extra: Record<string, unknown> = {}) {
  return {
    event,
    creation_date: CRIADO_EM,
    data: {
      product: { id: 5064314, name: "Holding Masters" },
      buyer: { name: "Fulano Teste", email: "  Fulano.Teste@Exemplo.COM " },
      purchase: { transaction: "HP0000000001", price: { value: 1000, currency_code: "BRL" }, ...purchase },
      ...extra,
    },
  };
}

const assinatura = { subscription: { subscriber: { code: "SUBTESTE1" } } };

const parcela1 = evento("PURCHASE_APPROVED", {
  status: "APPROVED", approved_date: CRIADO_EM, recurrence_number: 1,
  payment: { type: "HOTMART_INSTALLMENTS" },
}, assinatura);
const parcela3 = evento("PURCHASE_APPROVED", {
  transaction: "HP0000000003", status: "APPROVED", approved_date: CRIADO_EM, recurrence_number: 3,
  payment: { type: "HOTMART_INSTALLMENTS" },
}, assinatura);
const cartao = evento("PURCHASE_APPROVED", {
  status: "APPROVED", approved_date: CRIADO_EM, payment: { type: "CREDIT_CARD" },
});
const completo = evento("PURCHASE_COMPLETE", {
  status: "COMPLETED", approved_date: CRIADO_EM, payment: { type: "CREDIT_CARD" },
});
const recusa = evento("PURCHASE_CANCELED", {
  status: "CANCELED", payment: { type: "CREDIT_CARD", refusal_reason: "Transaction refused" },
});
const reembolso = evento("PURCHASE_REFUNDED", {
  status: "REFUNDED", approved_date: CRIADO_EM, payment: { type: "CREDIT_CARD" },
});
const pix = evento("PURCHASE_BILLET_PRINTED", {
  status: "BILLET_PRINTED", payment: { type: "PIX" },
});
const carrinho = evento("PURCHASE_OUT_OF_SHOPPING_CART", { status: "OUT_OF_SHOPPING_CART" });

Deno.test("parcela 1 do parcelado sem cartão: VENDA pela transação", async () => {
  assertEquals(await decidirAviso("PURCHASE_APPROVED", parcela1), { tipo: "VENDA", chave: "HP0000000001" });
});

Deno.test("parcela 3 do parcelado: NADA (só persiste)", async () => {
  assertEquals(await decidirAviso("PURCHASE_APPROVED", parcela3), { tipo: "NADA", chave: null });
});

Deno.test("parcela 3 com BILLET_PRINTED: NADA", async () => {
  const p = evento("PURCHASE_BILLET_PRINTED", { recurrence_number: 3, payment: { type: "HOTMART_INSTALLMENTS" } });
  assertEquals((await decidirAviso("PURCHASE_BILLET_PRINTED", p)).tipo, "NADA");
});

Deno.test("cartão sem recurrence_number: VENDA", async () => {
  assertEquals(await decidirAviso("PURCHASE_APPROVED", cartao), { tipo: "VENDA", chave: "HP0000000001" });
});

Deno.test("PURCHASE_COMPLETE: NADA", async () => {
  assertEquals(await decidirAviso("PURCHASE_COMPLETE", completo), { tipo: "NADA", chave: null });
});

Deno.test("CANCELED sem approved_date: RECUSA por e-mail normalizado, produto e dia em SP", async () => {
  assertEquals(await decidirAviso("PURCHASE_CANCELED", recusa, "HM", AGORA), {
    tipo: "RECUSA",
    chave: `RECUSA|${HASH_FULANO}|5064314|2026-09-19`,
  });
});

Deno.test("RECUSA: 2ª tentativa do mesmo dia (outra transação) cai na mesma chave", async () => {
  const outra = evento("PURCHASE_CANCELED", { transaction: "HP0000000009", status: "CANCELED" });
  const a = await decidirAviso("PURCHASE_CANCELED", recusa, "HM", AGORA); // 23:30 SP de 19/09
  outra.creation_date = CRIADO_EM - 60 * 60 * 1000; // 22:30 SP de 19/09: mesma chave
  assertEquals((await decidirAviso("PURCHASE_CANCELED", outra, "HM", AGORA)).chave, a.chave);
  outra.creation_date = CRIADO_EM + 60 * 60 * 1000; // 00:30 SP de 20/09: dia novo, avisa de novo
  assertEquals((await decidirAviso("PURCHASE_CANCELED", outra, "HM", AGORA)).chave === a.chave, false);
});

Deno.test("RECUSA de BILLET: mesma chave, título de boleto/PIX vencido", async () => {
  const b = evento("PURCHASE_CANCELED", {
    status: "CANCELED", payment: { type: "BILLET", refusal_reason: "Expired" },
  });
  assertEquals(await decidirAviso("PURCHASE_CANCELED", b, "HM", AGORA), {
    tipo: "RECUSA",
    chave: `RECUSA|${HASH_FULANO}|5064314|2026-09-19`,
  });
  assertEquals(tituloRecusa("BILLET"), ":hourglass: *Boleto/PIX venceu sem pagamento*");
  assertEquals(tituloRecusa("PIX"), ":hourglass: *Boleto/PIX venceu sem pagamento*");
});

Deno.test("RECUSA de APPLE_PAY sem refusal_reason: RECUSA, título de cartão", async () => {
  const a = evento("PURCHASE_CANCELED", { status: "CANCELED", payment: { type: "APPLE_PAY" } });
  assertEquals((await decidirAviso("PURCHASE_CANCELED", a, "HM", AGORA)).tipo, "RECUSA");
  assertEquals(tituloRecusa("APPLE_PAY"), ":credit_card: *Cartão recusado — ainda não pagou*");
  assertEquals(tituloRecusa("HYBRID"), ":credit_card: *Cartão recusado — ainda não pagou*");
  assertEquals(tituloRecusa("CREDIT_CARD"), ":credit_card: *Cartão recusado — ainda não pagou*");
  assertEquals(tituloRecusa("PAYPAL"), ":x: *Pagamento não concluído*");
  assertEquals(tituloRecusa(undefined), ":x: *Pagamento não concluído*");
});

Deno.test("CANCELED com approved_date: CANCELAMENTO pela transação", async () => {
  const c = evento("PURCHASE_CANCELED", { status: "CANCELED", approved_date: CRIADO_EM });
  assertEquals(await decidirAviso("PURCHASE_CANCELED", c), { tipo: "CANCELAMENTO", chave: "PURCHASE_CANCELED|HP0000000001" });
});

Deno.test("REFUNDED com approved_date: CANCELAMENTO com chave evento:transação", async () => {
  assertEquals(await decidirAviso("PURCHASE_REFUNDED", reembolso), {
    tipo: "CANCELAMENTO",
    chave: "PURCHASE_REFUNDED|HP0000000001",
  });
});

Deno.test("CHARGEBACK e PROTEST: CANCELAMENTO", async () => {
  for (const ev of ["PURCHASE_CHARGEBACK", "PURCHASE_PROTEST"]) {
    assertEquals(await decidirAviso(ev, reembolso), { tipo: "CANCELAMENTO", chave: `${ev}|HP0000000001` });
  }
});

Deno.test("BILLET_PRINTED com PIX: AGUARDANDO e rótulo de PIX", async () => {
  assertEquals(await decidirAviso("PURCHASE_BILLET_PRINTED", pix), { tipo: "AGUARDANDO", chave: "HP0000000001" });
  const tipo = (pix.data.purchase as unknown as { payment: { type: string } }).payment.type;
  assertEquals(rotuloAguardando(tipo), "PIX gerado (ainda NÃO pago)");
});

Deno.test("rótulos de pagamento gerado", async () => {
  assertEquals(rotuloAguardando("BILLET"), "Boleto gerado (ainda NÃO pago)");
  assertEquals(rotuloAguardando("HOTMART_INSTALLMENTS"), "Parcelado sem cartão: 1ª parcela gerada (ainda NÃO paga)");
  assertEquals(rotuloAguardando(undefined), "Pagamento gerado (ainda NÃO pago)");
});

Deno.test("OUT_OF_SHOPPING_CART: NADA", async () => {
  assertEquals(await decidirAviso("PURCHASE_OUT_OF_SHOPPING_CART", carrinho), { tipo: "NADA", chave: null });
});

Deno.test("evento sem tratamento: NADA", async () => {
  assertEquals(await decidirAviso("PURCHASE_DELAYED", cartao), { tipo: "NADA", chave: null });
});

Deno.test("SUBSCRIPTION_CANCELLATION: CANCELAMENTO deduplicado por assinante, produto e dia", async () => {
  const s = {
    event: "SUBSCRIPTION_CANCELLATION",
    creation_date: CRIADO_EM,
    data: { product: { id: 5064314 }, subscriber: { code: "SUBTESTE1", email: "x@exemplo.com" } },
  };
  assertEquals(await decidirAviso("SUBSCRIPTION_CANCELLATION", s), {
    tipo: "CANCELAMENTO",
    chave: "SUBSCRIPTION_CANCELLATION|SUBTESTE1|5064314|2026-09-19",
  });
});

Deno.test("recurrence_number e subscriber.code são lidos do payload", async () => {
  assertEquals(numeroRecorrencia(parcela1), 1);
  assertEquals(numeroRecorrencia(parcela3), 3);
  assertEquals(numeroRecorrencia(cartao), null);
  assertEquals(numeroRecorrencia(evento("PURCHASE_APPROVED", { recurrence_number: "2" })), 2);
  assertEquals(codigoAssinante(parcela3), "SUBTESTE1");
  assertEquals(codigoAssinante(cartao), null);
});

Deno.test("dia em São Paulo", async () => {
  assertEquals(diaSaoPaulo(CRIADO_EM), "2026-09-19");
});

Deno.test("legado (canal fora do escopo): comportamento anterior", async () => {
  assertEquals((await decidirAvisoLegado("PURCHASE_COMPLETE", completo)).tipo, "VENDA");
  assertEquals((await decidirAvisoLegado("PURCHASE_APPROVED", parcela3)).tipo, "VENDA");
  assertEquals((await decidirAvisoLegado("PURCHASE_OUT_OF_SHOPPING_CART", carrinho)).tipo, "AGUARDANDO");
  assertEquals((await decidirAvisoLegado("PURCHASE_CANCELED", recusa)).tipo, "CANCELAMENTO");
});

Deno.test("LGPD: a chave da RECUSA não contém o e-mail, e e-mail com caixa/espaço dá o mesmo hash", async () => {
  const a = await decidirAviso("PURCHASE_CANCELED", recusa, "HM", AGORA);
  assertEquals(a.chave!.includes("@"), false);
  assertEquals(a.chave!.toLowerCase().includes("fulano"), false);
  assertEquals(await hashEmail("  FULANO.teste@Exemplo.com "), HASH_FULANO);
});

Deno.test("SUBSCRIPTION_CANCELLATION sem código de assinante: e-mail em hash", async () => {
  const s = {
    event: "SUBSCRIPTION_CANCELLATION",
    creation_date: CRIADO_EM,
    data: { product: { id: 5064314 }, subscriber: { email: "x@exemplo.com" } },
  };
  // sha256("x@exemplo.com"), calculado com sha256sum.
  assertEquals((await decidirAviso("SUBSCRIPTION_CANCELLATION", s)).chave,
    "SUBSCRIPTION_CANCELLATION|9026ff20060dd42ea7da06c9240f6409e46653183db817cf96ade5c0db6b8a7e|5064314|2026-09-19");
});
