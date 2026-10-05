// ---------------------------------------------------------------------------
// QUANDO O SLACK É CHAMADO.
//
// Este é o ÚNICO lugar que decide se um evento da Hotmart vira aviso no Slack.
// Função pura (sem I/O) para poder ser testada sem rede: index.ts importa daqui,
// os testes também. index.ts não pode ser importado em teste porque chama serve().
//
// Por que existe (medido em cs.hotmart_eventos):
//   · a Hotmart manda CADA evento 2 vezes, com 0,4 a 2,5 s de diferença — o card
//     saía duplicado. A `chave` devolvida aqui é reivindicada atomicamente no banco
//     (cs.fn_reivindicar_aviso_slack) antes de publicar: o 2º envio não publica;
//   · parcelas 2, 3… do parcelado chegavam como "Nova compra";
//   · PURCHASE_COMPLETE (garantia vencida) repetia o card da venda;
//   · OUT_OF_SHOPPING_CART (158 eventos desde 18/08) saía rotulado como boleto;
//   · cada tentativa de cartão recusada virava um card de "Compra cancelada".
// ---------------------------------------------------------------------------

export type TipoAviso = "VENDA" | "AGUARDANDO" | "RECUSA" | "CANCELAMENTO" | "NADA";

export type Aviso = { tipo: TipoAviso; chave: string | null };

// Escopo das regras acima. "TODOS" = valem para todos os canais (decisão do dono).
// Para restringir, troque por uma lista de canais (ex.: ["HM", "HT"]): os canais
// fora dela voltam ao comportamento anterior (decidirAvisoLegado) — ainda com a
// deduplicação do reenvio da Hotmart, que não tem motivo para ser desligada.
export const CANAIS_COM_REGRAS_DE_AVISO: readonly string[] | "TODOS" = "TODOS";

const EVENTOS_CANCELAMENTO_AVISO = new Set([
  "PURCHASE_CANCELED",
  "PURCHASE_REFUNDED",
  "PURCHASE_CHARGEBACK",
  "PURCHASE_PROTEST",
]);

const NADA: Aviso = { tipo: "NADA", chave: null };

type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj => (v && typeof v === "object" ? v as Obj : {});
const numOuNull = (v: unknown): number | null => {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

// Qual parcela é esta: 1 na 1ª, 2, 3… nas seguintes. Ausente (cartão à vista) = null,
// tratado como 1ª. `recurrency_number` (com y) é o nome que o código antigo lia e que
// a Hotmart não manda — fica só como reserva.
export function numeroRecorrencia(payload: unknown): number | null {
  const purchase = obj(obj(obj(payload).data).purchase);
  return numOuNull(purchase.recurrence_number) ?? numOuNull(purchase.recurrency_number);
}

// Liga as parcelas da mesma compra. O caminho antigo (purchase.subscription.subscriber_code)
// só existia em 13 de 140 compras; o real é data.subscription.subscriber.code.
export function codigoAssinante(payload: unknown): string | null {
  const data = obj(obj(payload).data);
  const code = obj(obj(data.subscription).subscriber).code
    ?? obj(obj(data.purchase).subscription).subscriber_code;
  return code != null && String(code).trim() !== "" ? String(code).trim() : null;
}

// Rótulo do card de pagamento gerado e não pago, por meio de pagamento.
export function rotuloAguardando(paymentType: unknown): string {
  switch (String(paymentType ?? "").toUpperCase()) {
    case "PIX": return "PIX gerado (ainda NÃO pago)";
    case "BILLET": return "Boleto gerado (ainda NÃO pago)";
    case "HOTMART_INSTALLMENTS": return "Parcelado sem cartão: 1ª parcela gerada (ainda NÃO paga)";
    default: return "Pagamento gerado (ainda NÃO pago)";
  }
}

// Título do card de RECUSA (PURCHASE_CANCELED sem approved_date), por meio de
// pagamento. Medido em cs.hotmart_eventos: CREDIT_CARD 391, BILLET 12, APPLE_PAY 10,
// HYBRID 4. Boleto/PIX nessa condição é vencimento, não recusa de cartão.
export function tituloRecusa(paymentType: unknown): string {
  switch (String(paymentType ?? "").toUpperCase()) {
    case "CREDIT_CARD":
    case "HYBRID":
    case "APPLE_PAY":
      return ":credit_card: *Cartão recusado — ainda não pagou*";
    case "BILLET":
    case "PIX":
      return ":hourglass: *Boleto/PIX venceu sem pagamento*";
    default:
      return ":x: *Pagamento não concluído*";
  }
}

// YYYY-MM-DD no fuso de São Paulo. en-CA formata como ISO.
export function diaSaoPaulo(ms: number): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(new Date(ms));
}

function canalNoEscopo(canal: string | null | undefined): boolean {
  if (CANAIS_COM_REGRAS_DE_AVISO === "TODOS") return true;
  return canal != null && CANAIS_COM_REGRAS_DE_AVISO.includes(canal);
}

// LGPD: o e-mail não vai para a chave (que fica no banco e no log) — vai o
// sha256(lower(btrim(email))) em hex. Mesma pessoa → mesmo hash → mesma chave.
export async function hashEmail(email: string): Promise<string> {
  const normalizado = email.trim().toLowerCase();
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(normalizado));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

// Componentes das chaves compostas são separados por "|", que não aparece em
// e-mail-hash, id de produto, data, código de transação nem nome de evento.
const SEP = "|";
const chave = (...partes: string[]) => partes.join(SEP);

// `agoraMs` só é usado quando o payload não traz data nenhuma; existe como
// parâmetro para o teste não depender do relógio. Async por causa do hash
// (crypto.subtle só tem digest assíncrono).
export async function decidirAviso(
  evento: string,
  payload: unknown,
  canal?: string | null,
  agoraMs: number = Date.now(),
): Promise<Aviso> {
  if (canal !== undefined && !canalNoEscopo(canal)) return decidirAvisoLegado(evento, payload, agoraMs);

  const body = obj(payload);
  const data = obj(body.data);
  const purchase = obj(data.purchase);
  const transacao = purchase.transaction != null ? String(purchase.transaction).trim() : "";
  const recorrencia = numeroRecorrencia(payload) ?? 1;

  switch (evento) {
    // 1. Garantia vencida: só muda o status da compra, a venda já foi avisada.
    case "PURCHASE_COMPLETE":
      return NADA;

    // 2. Venda paga. Parcela 2+ não é venda nova.
    case "PURCHASE_APPROVED":
      if (!transacao || recorrencia > 1) return NADA;
      return { tipo: "VENDA", chave: transacao };

    // 3. Boleto / PIX / parcelado sem cartão gerado e não pago.
    case "PURCHASE_BILLET_PRINTED":
      if (!transacao || recorrencia > 1) return NADA;
      return { tipo: "AGUARDANDO", chave: transacao };

    // 4. Carrinho abandonado: persiste, não avisa.
    case "PURCHASE_OUT_OF_SHOPPING_CART":
      return NADA;

    case "SUBSCRIPTION_CANCELLATION": {
      // Não está nas regras do dono: mantém o aviso de hoje, só deduplica o reenvio.
      // Sem transação no payload; o dia entra na chave para que um novo cancelamento
      // (depois de reassinar) volte a ser avisado. Sem código de assinante, o
      // e-mail entra em hash (LGPD), como na RECUSA.
      const sub = obj(data.subscriber);
      const codigo = String(sub.code ?? "").trim();
      const email = String(sub.email ?? obj(data.buyer).email ?? "").trim();
      const quem = codigo || (email ? await hashEmail(email) : "");
      if (!quem) return NADA;
      const quando = numOuNull(body.creation_date) ?? agoraMs;
      const productId = String(obj(data.product).id ?? "");
      return { tipo: "CANCELAMENTO", chave: chave(evento, quem, productId, diaSaoPaulo(quando)) };
    }
  }

  if (!EVENTOS_CANCELAMENTO_AVISO.has(evento)) return NADA;

  // 5. CANCELED sem approved_date = tentativa recusada (nunca pagou). Um aviso por
  //    pessoa, produto e dia: as novas tentativas do mesmo dia caem na mesma chave.
  const aprovadoEm = numOuNull(purchase.approved_date);
  if (evento === "PURCHASE_CANCELED" && !aprovadoEm) {
    const email = String(obj(data.buyer).email ?? "").trim();
    const productId = String(obj(data.product).id ?? "");
    const quando = numOuNull(body.creation_date) ?? numOuNull(purchase.order_date) ?? agoraMs;
    const quem = email ? await hashEmail(email) : transacao;
    if (!quem) return NADA;
    return { tipo: "RECUSA", chave: chave("RECUSA", quem, productId, diaSaoPaulo(quando)) };
  }

  // 6. Dinheiro que entrou e voltou (ou cancelamento de compra paga).
  if (!transacao) return NADA;
  return { tipo: "CANCELAMENTO", chave: chave(evento, transacao) };
}

// O comportamento anterior às regras (para canal fora de CANAIS_COM_REGRAS_DE_AVISO):
// toda aprovação/conclusão avisa venda, boleto e carrinho avisam "aguardando", todo
// cancelamento avisa. Só a deduplicação do reenvio é acrescentada.
export async function decidirAvisoLegado(
  evento: string,
  payload: unknown,
  agoraMs: number = Date.now(),
): Promise<Aviso> {
  const body = obj(payload);
  const data = obj(body.data);
  const transacao = String(obj(data.purchase).transaction ?? "").trim();
  if (evento === "SUBSCRIPTION_CANCELLATION") {
    return await decidirAviso(evento, payload, undefined, agoraMs);
  }
  if (!transacao) return NADA;
  if (evento === "PURCHASE_APPROVED" || evento === "PURCHASE_COMPLETE") {
    return { tipo: "VENDA", chave: transacao };
  }
  if (evento === "PURCHASE_BILLET_PRINTED" || evento === "PURCHASE_OUT_OF_SHOPPING_CART") {
    return { tipo: "AGUARDANDO", chave: transacao };
  }
  if (EVENTOS_CANCELAMENTO_AVISO.has(evento)) {
    return { tipo: "CANCELAMENTO", chave: chave(evento, transacao) };
  }
  return NADA;
}
