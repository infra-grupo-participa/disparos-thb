import { query } from "@/lib/db";
import { escopoVisibilidade, type Ator, type EscopoVisibilidade } from "@/lib/papeis";

// CARTEIRA DO COMERCIAL — "de quem é cada aluno, quanto ele deve e quando ele paga".
//
// Pedido do João (16/08/2026), depois de a Kelly precisar levar ao Marcio a lista de quem
// pagou o sinal: "quero as informações da carteira de cliente da pessoa, como em carteiras
// convencionais — quem quitou, quem está com saldo parado, e qual a próxima data que aquela
// pessoa tem que pagar".
//
// ── TUDO SAI DE cs.vw_hm_carteira (0240→0245) ───────────────────────────────────────
// Nada aqui recalcula dinheiro. A view já resolve as três coisas que deram errado quando
// eu tentei calcular por fora, e cada uma custou uma correção:
//
//   1) DE QUEM É O CARD não sai de `responsavel_comercial_id`: a 0161 carimba toda venda
//      nova na distribuidora e a ativação sobrescreve o dono quando o card avança. A view
//      reconstrói pela linha do tempo e devolve a ORIGEM em `carteira_origem`.
//   2) QUEM É DO COMERCIAL é declarado (`cs.usuarios.carteira_comercial`), não deduzido do
//      papel de acesso — senão o SDR aparece com carteira.
//   3) QUANTO FALTA vem de `saldo_a_perseguir`, e o que a pessoa pagou no ciclo vem de
//      `pago_no_ciclo`. Somar o razão inteiro conta o dinheiro do ciclo ANTERIOR duas vezes:
//      ele já está dentro do crédito pró-rata que reduz o pacote. Ver
//      disparos-brain/"Crédito do ciclo anterior não é pagamento deste".

export type StatusCarteira =
  | "quitado" | "parcelando" | "pagando_parcial" | "so_entrada" | "cancelado" | "entrada_estornada";

/** Quantos dias sem pagar antes de uma mensalidade virar "parou de pagar". Uma parcela cai a
 *  cada ~30 dias; 35 dá folga para fim de semana e feriado sem chamar de inadimplente quem
 *  está em dia. */
const JANELA_PARCELA_DIAS = 35;

export type AlunoCarteira = {
  contato_hm_id: string;
  nome: string;
  email: string | null;
  telefone: string | null;
  status: StatusCarteira;
  /** "Já era aluno da casa" x "Aluno novo" — a diferenciação que o comercial usa na conversa. */
  perfil: "aluno_base" | "lead_novo" | "nao_classificado" | null;
  turma: string | null;
  turma_origem: string | null;
  entrada_valor: number | null;
  entrada_pago_em: string | null;
  pago_apos_entrada: number;
  pago_no_ciclo: number | null;
  credito_ciclo_anterior: number | null;
  /** O que ESTA pessoa paga: 15.000 menos o crédito dela. Para 91 dos 242 não é 15.000. */
  pacote: number | null;
  falta_pagar: number | null;
  pct_pago: number | null;
  proximo_pagamento: string | null;
  ultimo_pagamento_em: string | null;
  parcelas: number;
  /** Frase pronta para a pergunta "quando essa pessoa paga?" — nunca inventa data. */
  cobranca: string;
  /** 0 = tocar hoje · 1 = precisa de combinação · 2 = combinado e perto · 3 = em dia · 9 = nada a fazer */
  urgencia: 0 | 1 | 2 | 3 | 9;
  /** Explica por que o valor dele não é R$ 15.000. Vazio quando é. */
  porque_o_valor: string;
  /** Anomalia detectada nesta linha, se houver — sai nominal, nunca somada em silêncio. */
  conferir: string | null;
  carteira_nome: string | null;
  carteira_usuario_id: string | null;
  carteira_origem: string;
  carteira_lastro: string;
  carteira_confirmada: boolean;
};

export type ResumoCarteira = {
  usuario_id: string | null;
  pessoa: string;
  identificada: boolean;
  alunos: number;
  quitados: number;
  pagando: number;
  so_entrada: number;
  cancelados: number;
  recebido: number;
  a_receber: number;
  parou_de_pagar: number;
  combinou_e_nao_pagou: number;
  sem_data: number;
  conferir: number;
};

const num = (v: unknown): number => (v === null || v === undefined ? 0 : Number(v));
const numOuNulo = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));
const txt = (v: unknown): string | null => (v === null || v === undefined ? null : String(v));
const brl = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const dm = (iso: string) => {
  const [, m, d] = iso.slice(0, 10).split("-");
  return `${d}/${m}`;
};
const diasEntre = (a: string, b: string) => Math.round((Date.parse(a) - Date.parse(b)) / 86_400_000);
/** Datas digitadas à mão trazem ano de 5 dígitos e 2027 no meio de 2026 — a tela nunca calcula
 *  prazo em cima delas; manda conferir. */
const dataPlausivel = (iso: string | null): boolean => {
  if (!iso) return false;
  const ano = Number(iso.slice(0, 4));
  return ano >= 2025 && ano <= 2026;
};

function recorte(escopo: EscopoVisibilidade): { sql: string; params: (string | null)[] } {
  if (escopo.modo === "tudo") return { sql: "", params: [null, null] };
  if (escopo.modo === "equipe") {
    return {
      sql: `and (v.carteira_usuario_id = $2::uuid
                 or exists (select 1 from cs.usuarios u2
                             where u2.id = v.carteira_usuario_id and u2.equipe_id = $3::uuid))`,
      params: [escopo.usuarioId, escopo.equipeId],
    };
  }
  return { sql: "and v.carteira_usuario_id = $2::uuid", params: [escopo.usuarioId, null] };
}

function cobrancaDe(r: {
  status: StatusCarteira;
  ultimo_pagamento_em: string | null;
  proximo_pagamento_bruto: string | null;
  entrada_pago_em: string | null;
  hoje: string;
}): { cobranca: string; urgencia: AlunoCarteira["urgencia"] } {
  if (r.status === "quitado") return { cobranca: "Já pagou tudo", urgencia: 9 };
  if (r.status === "cancelado" || r.status === "entrada_estornada") return { cobranca: "—", urgencia: 9 };

  // Quem paga em parcelas se mede pela ÚLTIMA PARCELA, não pela data combinada: 26 dos 28 em
  // mensalidade tinham combinado vencido e estavam pagando em dia (medido em 16/08).
  if ((r.status === "parcelando" || r.status === "pagando_parcial") && r.ultimo_pagamento_em) {
    const dias = diasEntre(r.hoje, r.ultimo_pagamento_em);
    if (dias <= JANELA_PARCELA_DIAS) {
      return { cobranca: `Em dia — último pagamento em ${dm(r.ultimo_pagamento_em)}`, urgencia: 3 };
    }
    return { cobranca: `Parou de pagar — último em ${dm(r.ultimo_pagamento_em)} (${dias} dias)`, urgencia: 0 };
  }

  if (r.proximo_pagamento_bruto && !dataPlausivel(r.proximo_pagamento_bruto)) {
    return { cobranca: "Data combinada cadastrada errada — conferir", urgencia: 1 };
  }
  if (r.proximo_pagamento_bruto) {
    const d = diasEntre(r.proximo_pagamento_bruto, r.hoje);
    if (d < 0) return { cobranca: `Combinou para ${dm(r.proximo_pagamento_bruto)} e não pagou (${-d} dias)`, urgencia: 0 };
    if (d === 0) return { cobranca: "Combinado para hoje", urgencia: 1 };
    if (d <= 7) return { cobranca: `Combinado para ${dm(r.proximo_pagamento_bruto)} (em ${d} dias)`, urgencia: 2 };
    return { cobranca: `Combinado para ${dm(r.proximo_pagamento_bruto)}`, urgencia: 3 };
  }
  if (r.entrada_pago_em) {
    return { cobranca: `Sem data combinada — pagou o sinal há ${diasEntre(r.hoje, r.entrada_pago_em)} dias`, urgencia: 1 };
  }
  return { cobranca: "Sem data combinada", urgencia: 1 };
}

/** Por que o valor desta pessoa não é R$ 15.000 — a pergunta que a Kelly precisa responder
 *  de improviso. Sai vazio quando o valor é o cheio. */
function porqueOValor(credito: number | null, pacote: number | null, turmaOrigem: string | null): string {
  if (credito && credito > 0) {
    const onde = turmaOrigem ? `do que já pagou na ${turmaOrigem}` : "do programa anterior";
    return `Tinha crédito de ${brl(credito)} ${onde}. Por isso paga ${brl(pacote ?? 0)} e não R$ 15.000,00.`;
  }
  if (pacote !== null && Math.abs(pacote - 15000) > 1) {
    return "Valor negociado fora do padrão de R$ 15.000,00 — confirmar com quem fechou.";
  }
  return "";
}

/** As checagens que a varredura de 16/08 formalizou. Uma linha só entra em "Conferir" quando
 *  o próprio dado se contradiz — nunca por suspeita. */
function conferirDe(a: {
  pacote: number | null;
  pago_no_ciclo: number | null;
  falta_pagar: number | null;
  entrada_valor: number | null;
  credito: number | null;
  proximo_bruto: string | null;
  estorno_em: string | null;
}): string | null {
  const pacote = a.pacote ?? 0;
  const pago = a.pago_no_ciclo ?? 0;
  const falta = a.falta_pagar ?? 0;
  if (pago - pacote > 1) return `Pagou a mais: ${brl(pago - pacote)} além do pacote`;
  if (Math.abs(pacote - (pago + falta)) > 1) {
    return `A conta não fecha: pacote ${brl(pacote)} × pago ${brl(pago)} + falta ${brl(falta)}`;
  }
  if ((a.entrada_valor ?? 0) > pago + 1) {
    return `Entrada lançada duas vezes: ${brl(a.entrada_valor ?? 0)} no razão, ${brl(pago)} no ciclo`;
  }
  if (a.proximo_bruto && !dataPlausivel(a.proximo_bruto)) return "Data combinada inválida no cadastro";
  if (pacote > 0 && pacote < 14000 && (a.credito ?? 0) === 0) {
    return "Pacote negociado fora do padrão, sem crédito que explique";
  }
  if (a.estorno_em) return `Entrada reembolsada em ${dm(a.estorno_em)}`;
  return null;
}

type Linha = Record<string, unknown>;

/**
 * A carteira do board, recortada pelo que a pessoa logada pode ver. Devolve o resumo por
 * pessoa do comercial + a lista nominal — são ~250 linhas, paginar só criaria estado sem
 * ganho, e ter a lista inteira é o que garante que o resumo bata com o detalhe (agregar aqui,
 * e não em SQL separado, elimina a classe de bug em que o topo e a tabela discordam).
 */
export async function carteiraHm(
  f: { produto?: string | null },
  sessao: Ator,
): Promise<{ resumo: ResumoCarteira[]; alunos: AlunoCarteira[]; hoje: string }> {
  const rec = recorte(escopoVisibilidade(sessao));
  const rows = await query<Linha>(
    `select v.contato_hm_id, v.nome, v.email, v.telefone, v.status, v.perfil, v.turma, v.turma_origem,
            v.carteira_usuario_id, v.carteira_nome, v.carteira_origem, v.carteira_lastro, v.carteira_confirmada,
            v.sinal_valor, v.sinal_pago_em, v.entrada_estorno_em,
            v.pago_apos_entrada, v.ultimo_pagamento_apos_entrada, v.parcelas_lancamentos,
            v.pago_no_ciclo, v.credito_ciclo_anterior, v.pacote_efetivo, v.falta_pagar,
            f.pagamento_previsto_em
       from cs.vw_hm_carteira v
       left join cs.vw_hm_financeiro f on f.contato_hm_id = v.contato_hm_id
      where v.pagou_entrada_do_programa
        and ($1::text is null or v.produto = $1)
        ${rec.sql}
      order by v.nome`,
    [f.produto || null, ...rec.params],
  );

  const hoje = new Date().toISOString().slice(0, 10);

  const alunos: AlunoCarteira[] = rows.map((r) => {
    const status = String(r.status) as StatusCarteira;
    const pacote = numOuNulo(r.pacote_efetivo);
    const pagoCiclo = numOuNulo(r.pago_no_ciclo);
    const credito = numOuNulo(r.credito_ciclo_anterior);
    const proximoBruto = txt(r.pagamento_previsto_em);
    const ultimo = txt(r.ultimo_pagamento_apos_entrada);
    const entradaEm = txt(r.sinal_pago_em);
    const { cobranca, urgencia } = cobrancaDe({
      status,
      ultimo_pagamento_em: ultimo,
      proximo_pagamento_bruto: proximoBruto,
      entrada_pago_em: entradaEm,
      hoje,
    });
    return {
      contato_hm_id: String(r.contato_hm_id),
      nome: String(r.nome ?? ""),
      email: txt(r.email),
      telefone: txt(r.telefone),
      status,
      perfil: (txt(r.perfil) as AlunoCarteira["perfil"]) ?? null,
      turma: txt(r.turma),
      turma_origem: txt(r.turma_origem),
      entrada_valor: numOuNulo(r.sinal_valor),
      entrada_pago_em: entradaEm,
      pago_apos_entrada: num(r.pago_apos_entrada),
      pago_no_ciclo: pagoCiclo,
      credito_ciclo_anterior: credito,
      pacote,
      falta_pagar: numOuNulo(r.falta_pagar),
      // Sem pacote não existe denominador: 0% diria que não pagou nada, 100% seria pior.
      pct_pago: pacote && pacote > 0 && pagoCiclo !== null ? Math.min(100, Math.round((pagoCiclo / pacote) * 100)) : null,
      proximo_pagamento: dataPlausivel(proximoBruto) ? proximoBruto : null,
      ultimo_pagamento_em: ultimo,
      parcelas: num(r.parcelas_lancamentos),
      cobranca,
      urgencia,
      porque_o_valor: porqueOValor(credito, pacote, txt(r.turma_origem)),
      conferir: conferirDe({
        pacote,
        pago_no_ciclo: pagoCiclo,
        falta_pagar: numOuNulo(r.falta_pagar),
        entrada_valor: numOuNulo(r.sinal_valor),
        credito,
        proximo_bruto: proximoBruto,
        estorno_em: txt(r.entrada_estorno_em),
      }),
      carteira_nome: txt(r.carteira_nome),
      carteira_usuario_id: txt(r.carteira_usuario_id),
      carteira_origem: String(r.carteira_origem),
      carteira_lastro: String(r.carteira_lastro ?? ""),
      carteira_confirmada: Boolean(r.carteira_confirmada),
    };
  });

  const mapa = new Map<string, ResumoCarteira>();
  for (const a of alunos) {
    const identificada = Boolean(a.carteira_nome);
    const chave = identificada ? a.carteira_usuario_id ?? a.carteira_nome ?? "?" : "__sem_dono__";
    let r = mapa.get(chave);
    if (!r) {
      r = {
        usuario_id: a.carteira_usuario_id, pessoa: a.carteira_nome ?? "Sem dono identificado",
        identificada, alunos: 0, quitados: 0, pagando: 0, so_entrada: 0, cancelados: 0,
        recebido: 0, a_receber: 0, parou_de_pagar: 0, combinou_e_nao_pagou: 0, sem_data: 0, conferir: 0,
      };
      mapa.set(chave, r);
    }
    const cancelado = a.status === "cancelado" || a.status === "entrada_estornada";
    r.alunos += 1;
    if (a.status === "quitado") r.quitados += 1;
    else if (a.status === "parcelando" || a.status === "pagando_parcial") r.pagando += 1;
    else if (a.status === "so_entrada") r.so_entrada += 1;
    if (cancelado) r.cancelados += 1;
    r.recebido += a.pago_no_ciclo ?? 0;
    // Cancelado não entra em "a receber": ninguém vai perseguir, e somar vira meta de ficção.
    if (!cancelado) {
      r.a_receber += a.falta_pagar ?? 0;
      if (a.cobranca.startsWith("Parou")) r.parou_de_pagar += 1;
      else if (a.cobranca.startsWith("Combinou")) r.combinou_e_nao_pagou += 1;
      else if (a.cobranca.startsWith("Sem data")) r.sem_data += 1;
    }
    if (a.conferir) r.conferir += 1;
  }

  const resumo = [...mapa.values()].sort((a, b) =>
    a.identificada === b.identificada ? b.a_receber - a.a_receber : a.identificada ? -1 : 1,
  );
  return { resumo, alunos, hoje };
}
