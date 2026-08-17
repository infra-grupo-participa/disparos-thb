import { query } from "@/lib/db";
import { EXPLICACAO, type Alerta, type CancelamentoHotmart, type ReceitaForaDoSaldo } from "@/lib/alertas-catalogo";

export type { Alerta, CancelamentoHotmart, ReceitaForaDoSaldo } from "@/lib/alertas-catalogo";
export { EXPLICACAO } from "@/lib/alertas-catalogo";

// O monitor de dinheiro (cs.hm_alertas) existe desde a 0188 e nunca teve tela: os
// alertas nasciam no banco e morriam lá. Um alerta que ninguém vê é um alerta que não
// existe — foi assim que a venda do Rangel (Aurum, R$ 1.376,35, 11/08) passou o dia
// fora do razão sem ninguém saber.
//
// Esta é a fonte da tela /admin/alertas: o que o sistema detectou sozinho e NÃO
// consegue resolver sozinho, mais o registro dos cancelamentos que a Hotmart mandou.

export async function listarAlertasAbertos(): Promise<Alerta[]> {
  const alertas = await query<Alerta>(
    `select id::text, tipo, chave, severidade, detalhe, detectado_em
       from cs.hm_alertas
      where resolvido_em is null
      order by (severidade = 'critico') desc, detectado_em desc
      limit 200`,
  );
  // 0263: existem tipos abertos em produção (ex.: aluno_sem_base, crítico) sem
  // entrada em EXPLICACAO — a tela mostra o alerta sem ícone, sem título e sem
  // "o que fazer". Isto não corrige o catálogo (seria inventar a regra de quem
  // gera o tipo); só avisa no log do servidor para não passar em silêncio.
  const semCatalogo = new Set(alertas.filter((a) => !EXPLICACAO[a.tipo]).map((a) => a.tipo));
  for (const tipo of semCatalogo) {
    console.warn(`[hm-alertas] tipo "${tipo}" aberto em produção sem entrada em lib/alertas-catalogo.ts`);
  }
  return alertas;
}

// 0234 — os 27 alertas "compra fora do razão" saíram da fila (não havia o que
// fazer com eles) e viraram ESTE número. Sem esta função a receita some da
// vista, que é pior do que os 27 avisos: alerta chato a gente ignora, dinheiro
// invisível a gente esquece que existe.
//
// É receita real, aprovada, que NÃO abate o pacote de 15k de propósito
// (renovação, reserva). `desde` vem junto porque valor sem janela não quer
// dizer nada.
export async function receitaForaDoSaldo(): Promise<ReceitaForaDoSaldo | null> {
  const r = await query<{ compras: number; total: string; desde: string | null }>(
    `select compras, total, desde from cs.fn_hm_receita_fora_do_saldo()`,
  );
  if (r.length === 0 || !r[0].compras) return null;
  return { compras: r[0].compras, total: Number(r[0].total), desde: r[0].desde };
}

// 0263: cs.hm_alertas.id é BIGINT (não UUID) — `$1::uuid` fazia toda baixa
// manual de alerta dar erro de cast antes mesmo de chegar no update, para os
// 5 tipos abertos hoje, não só o novo (socio_sem_titular).
export async function resolverAlerta(id: string): Promise<boolean> {
  const r = await query(
    `update cs.hm_alertas set resolvido_em = now()
      where id = $1::bigint and resolvido_em is null
      returning id`,
    [id],
  );
  return r.length > 0;
}

// Cancelamentos que vieram da Hotmart (reembolso, chargeback, assinatura cancelada).
// Board junto: depois da 0197 o cancelamento acerta o card do produto certo, e é isso
// que esta lista prova no dia a dia.
export async function listarCancelamentosHotmart(dias = 30): Promise<CancelamentoHotmart[]> {
  return query<CancelamentoHotmart>(
    `select ch.id::text as contato_hm_id, cp.nome, cp.email, ch.produto,
            e.nome as etapa,
            ch.hotmart_cancelamento_evento as evento,
            ch.hotmart_cancelamento_transacao as transacao,
            ch.cancelamento_motivo as motivo,
            ch.hotmart_cancelado_em as cancelado_em,
            ch.cancelamento_origem as origem
       from cs.contatos_hm ch
       join public.compradores cp on cp.id = ch.comprador_id
       left join cs.estagios e on e.id = ch.estagio_id
      where ch.hotmart_cancelado_em >= now() - ($1::int || ' days')::interval
      order by ch.hotmart_cancelado_em desc
      limit 100`,
    [dias],
  );
}
