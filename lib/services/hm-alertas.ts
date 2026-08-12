import { query } from "@/lib/db";
import type { Alerta, CancelamentoHotmart } from "@/lib/alertas-catalogo";

export type { Alerta, CancelamentoHotmart } from "@/lib/alertas-catalogo";
export { EXPLICACAO } from "@/lib/alertas-catalogo";

// O monitor de dinheiro (cs.hm_alertas) existe desde a 0188 e nunca teve tela: os
// alertas nasciam no banco e morriam lá. Um alerta que ninguém vê é um alerta que não
// existe — foi assim que a venda do Rangel (Aurum, R$ 1.376,35, 11/08) passou o dia
// fora do razão sem ninguém saber.
//
// Esta é a fonte da tela /admin/alertas: o que o sistema detectou sozinho e NÃO
// consegue resolver sozinho, mais o registro dos cancelamentos que a Hotmart mandou.

export async function listarAlertasAbertos(): Promise<Alerta[]> {
  return query<Alerta>(
    `select id::text, tipo, chave, severidade, detalhe, detectado_em
       from cs.hm_alertas
      where resolvido_em is null
      order by (severidade = 'critico') desc, detectado_em desc
      limit 200`,
  );
}

export async function resolverAlerta(id: string): Promise<boolean> {
  const r = await query(
    `update cs.hm_alertas set resolvido_em = now()
      where id = $1::uuid and resolvido_em is null
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
