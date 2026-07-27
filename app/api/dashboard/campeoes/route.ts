import { NextResponse } from "next/server";
import { guard } from "@/lib/guard";
import { escopoVisibilidade, paramsEscopo } from "@/lib/papeis";
import { query } from "@/lib/db";
import { sqlEscopo } from "@/lib/services/contato";
import { eventoDe } from "@/lib/services/evento";

export const runtime = "nodejs";

// GET /api/dashboard/campeoes?evento=&desde=&ate=&edicao= — ranking dos
// templates/campanhas que mais ENGAJAM, por canal. Engajamento é o proxy
// disponível hoje (WhatsApp: taxa de resposta; E-mail: abertura/clique). A
// conversão por funil (decisão do 3³) entra quando houver atribuição
// template→contato→estágio. Só dados reais.
type WaCampeao = { template: string; enviados: number; respondidos: number };
type EmailCampeao = {
  nome: string; enviados: number; aberturas_unicas: number; cliques_unicos: number; enviada_em: string | null;
};

export async function GET(req: Request) {
  // Portal do evento RESOLVIDO (cookie/query) contra a whitelist da conta (0145).
  const g = await guard({ portal: eventoDe(req) });
  if (!g.ok) return g.res;

  const evento = eventoDe(req);
  const url = new URL(req.url);
  const desde = url.searchParams.get("desde");
  const ate = url.searchParams.get("ate");
  const edicao = url.searchParams.get("edicao");
  // Recorte por equipe (decisão do Marcio, 27/07): o ranking é DENTRO do escopo
  // de quem olha — um gestor vê os campeões da equipe dele, não os do GP.
  const { verTudo, equipeId, usuarioId } = paramsEscopo(escopoVisibilidade(g.sessao));

  // WhatsApp: templates por taxa de resposta (mínimo de envios para ter sinal).
  // O envio tem comprador_id → o recorte amarra cada linha ao contato do escopo.
  const whatsapp = await query<WaCampeao>(
    `select t.nome as template,
            count(*) filter (where dc.enviado)::int as enviados,
            count(*) filter (where dc.respondeu)::int as respondidos
       from cs.disparos d
       join cs.templates t on t.id = d.template_id
       join cs.disparo_contatos dc on dc.disparo_id = d.id
       join cs.contatos_evento v on v.comprador_id = dc.comprador_id and v.evento = $1
      where d.evento = $1
        and ($2::timestamptz is null or d.iniciado_em >= $2)
        and ($3::timestamptz is null or d.iniciado_em <= $3)
        and ($4::text is null or d.edicao_ht = $4)
        and ${sqlEscopo({ rid: "v.responsavel_id", eq: "v.equipe_id", nome: "v.responsavel" }, { verTudo: 5, usuario: 6, equipe: 7 })}
      group by t.nome
      having count(*) filter (where dc.enviado) >= 5
      order by (count(*) filter (where dc.respondeu))::numeric
               / nullif(count(*) filter (where dc.enviado), 0) desc, respondidos desc
      limit 20`,
    [evento, desde, ate, edicao, verTudo, usuarioId, equipeId],
  );

  // E-mail: campanhas por taxa de abertura (e clique como desempate).
  // NÃO recortável por equipe: cs.campanhas_email é agregado POR CAMPANHA vindo
  // do ActiveCampaign (enviados/aberturas somados lá) — não existe vínculo
  // campanha→contato para amarrar num dono/equipe. Fica global de propósito;
  // inventar um recorte aqui seria fabricar número.
  const email = await query<EmailCampeao>(
    `select nome, enviados, aberturas_unicas, cliques_unicos, enviada_em
       from cs.campanhas_email
      where evento = $1 and enviados >= 20
        and ($2::timestamptz is null or enviada_em >= $2)
        and ($3::timestamptz is null or enviada_em <= $3)
        and ($4::text is null or nome ilike '%' || $4 || '%')
      order by aberturas_unicas::numeric / nullif(enviados, 0) desc,
               cliques_unicos::numeric / nullif(aberturas_unicas, 0) desc
      limit 20`,
    [evento, desde, ate, edicao],
  );

  return NextResponse.json({ ok: true, whatsapp, email });
}
