// deno test supabase/functions/hotmart-events-webhook/rotulo_produto.test.ts
// Nomes reais de fin.ofertas (09/10/2026).
import { assertEquals } from "jsr:@std/assert@1";
import { rotuloDoProduto } from "./rotulo_produto.ts";

Deno.test("Clínica de Miami: a oferta já cita o produto, sai só ela", () => {
  assertEquals(
    rotuloDoProduto("Clínica de Holding Familiar", "Clínica de Holding Familiar - Miami"),
    "Clínica de Holding Familiar - Miami",
  );
});

Deno.test("oferta que não cita o produto ganha o produto na frente", () => {
  assertEquals(
    rotuloDoProduto("Holding Masters", "Taxa de inscrição R$ 697"),
    "Holding Masters · Taxa de inscrição R$ 697",
  );
});

Deno.test("acento e caixa não impedem reconhecer o produto no nome da oferta", () => {
  assertEquals(
    rotuloDoProduto("Encontro do Time Holding Brasil", "ENCONTRO DO TIME HOLDING BRASIL/2027 - LOTE 0"),
    "ENCONTRO DO TIME HOLDING BRASIL/2027 - LOTE 0",
  );
});

Deno.test("TAB e espaço duplo do cadastro da Hotmart viram um espaço", () => {
  assertEquals(
    rotuloDoProduto("Aurum", "Saldo Aurum - ETHB\tR$59.000,00"),
    "Saldo Aurum - ETHB R$59.000,00",
  );
});

Deno.test("sem nome de oferta (principal vazia, ou fora do catálogo) fica o produto", () => {
  assertEquals(rotuloDoProduto("Clínica de Holding Familiar", ""), "Clínica de Holding Familiar");
  assertEquals(rotuloDoProduto("Holding Total", "   "), "Holding Total");
  assertEquals(rotuloDoProduto("Holding Total", null), "Holding Total");
});
