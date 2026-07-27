import { NextResponse } from "next/server";
import { guard } from "@/lib/guard";
import { escopoVisibilidade, paramsEscopo } from "@/lib/papeis";
import { queryOne } from "@/lib/db";
import { sqlEscopo } from "@/lib/services/contato";
import { eventoDe } from "@/lib/services/evento";

export const runtime = "nodejs";

// GET /api/dashboard/canais?evento=&desde=&ate=&edicao= — resumo COMPARATIVO dos
// 3 canais de ação (volume + resultado), para ver as proporções num relance.
// Só dados reais (zera se não houver). O filtro de edição vale para cada canal
// na medida em que cada um "tem" edição:
//   WhatsApp (Unnichat):     cs.disparos.edicao_ht (nativo)
//   E-mail (ActiveCampaign): pelo NOME da campanha (ex.: "[HT20]") — best-effort
//   Atendimentos (registro do time): herdam a edição do ALUNO (cs.contatos_evento).
//     Sem edição selecionada, ligações mostram o total geral (produtividade do
//     comercial não depende de o número estar na base).
export async function GET(req: Request) {
  // Portal do evento RESOLVIDO (cookie/query) contra a whitelist da conta (0145).
  const g = await guard({ portal: eventoDe(req) });
  if (!g.ok) return g.res;

  const evento = eventoDe(req);
  const url = new URL(req.url);
  const desde = url.searchParams.get("desde");
  const ate = url.searchParams.get("ate");
  const edicao = url.searchParams.get("edicao");
  // Recorte por equipe (decisão do Marcio, 27/07): master vê o portal; gestor,
  // a equipe; operador, os dele. Vale onde a métrica amarra num CONTATO
  // (WhatsApp por dc.comprador_id, atendimentos por l.comprador_id).
  const { verTudo, equipeId, usuarioId } = paramsEscopo(escopoVisibilidade(g.sessao));
  const ESCOPO_V = sqlEscopo({ rid: "v.responsavel_id", eq: "v.equipe_id", nome: "v.responsavel" }, { verTudo: 5, usuario: 6, equipe: 7 });
  const p = [evento, desde, ate, edicao, verTudo, usuarioId, equipeId];

  const whatsapp = (await queryOne<{ enviados: number; respondidos: number }>(
    `select
       count(*) filter (where dc.enviado)::int as enviados,
       count(*) filter (where dc.respondeu)::int as respondidos
     from cs.disparo_contatos dc
     join cs.disparos d on d.id = dc.disparo_id and d.evento = $1
     join cs.contatos_evento v on v.comprador_id = dc.comprador_id and v.evento = $1
     where ($2::timestamptz is null or d.iniciado_em >= $2)
       and ($3::timestamptz is null or d.iniciado_em <= $3)
       and ($4::text is null or d.edicao_ht = $4)
       and ${ESCOPO_V}`,
    p,
  )) ?? { enviados: 0, respondidos: 0 };

  // E-mail: NÃO recortável por equipe — cs.campanhas_email é agregado POR
  // CAMPANHA vindo do ActiveCampaign, sem vínculo campanha→contato para amarrar
  // num dono/equipe. Fica global de propósito (métrica do canal, não do lead).
  const email = (await queryOne<{ enviados: number; aberturas: number }>(
    `select
       coalesce(sum(enviados), 0)::int as enviados,
       coalesce(sum(aberturas_unicas), 0)::int as aberturas
     from cs.campanhas_email
     where evento = $1
       and ($2::timestamptz is null or enviada_em >= $2)
       and ($3::timestamptz is null or enviada_em <= $3)
       and ($4::text is null or nome ilike '%' || $4 || '%')`,
    [evento, desde, ate, edicao],
  )) ?? { enviados: 0, aberturas: 0 };

  // Atendimentos (ligação, WhatsApp, presencial) com compradores DESTE evento.
  // Duas correções em relação ao que havia aqui:
  //  1. sem o filtro `provider = 'atendesimples'` — era ele que escondia todo
  //     registro feito à mão pelo operador;
  //  2. join real com o evento (era `left join`, que não filtrava nada: ligações
  //     de quem não é comprador do evento entravam na conta e inflavam o card).
  const ligacoes = (await queryOne<{ total: number; feitas: number; atendidas: number }>(
    `select
       count(*)::int as total,
       count(*) filter (where l.direction is distinct from 'inbound')::int as feitas,
       count(*) filter (where l.resultado = 'atendeu')::int as atendidas
     from cs.ligacoes l
     join cs.contatos_evento v on v.comprador_id = l.comprador_id and v.evento = $1
     where ($2::timestamptz is null or l.criado_em >= $2)
       and ($3::timestamptz is null or l.criado_em <= $3)
       and ($4::text is null or v.edicao = $4)
       and ${ESCOPO_V}`,
    p,
  )) ?? { total: 0, feitas: 0, atendidas: 0 };

  return NextResponse.json({ ok: true, whatsapp, email, ligacoes });
}
