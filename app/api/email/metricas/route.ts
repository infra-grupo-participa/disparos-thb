import { NextResponse } from "next/server";
import { isAuthed } from "@/lib/auth";
import { query, queryOne } from "@/lib/db";
import { eventoDe } from "@/lib/services/evento";

export const runtime = "nodejs";

// GET /api/email/metricas — KPIs e listagem das campanhas de e-mail (AC) do
// evento do contexto. Espelha /api/dashboard, mas para o canal de e-mail.
// Filtros opcionais: desde/ate (sobre a data de envio da campanha no AC).
type Kpis = {
  campanhas: number;
  enviados: number;
  aberturas_unicas: number;
  cliques_unicos: number;
  bounces: number;
  unsubscribes: number;
  ultima_em: string | null;
};

type CampanhaRow = {
  id: string;
  nome: string;
  tipo: string | null;
  status: string | null;
  enviados: number;
  processados: number;
  aberturas_unicas: number;
  cliques_unicos: number;
  hardbounces: number;
  softbounces: number;
  unsubscribes: number;
  enviada_em: string | null;
};

export async function GET(req: Request) {
  if (!isAuthed()) return NextResponse.json({ ok: false }, { status: 401 });

  const evento = eventoDe(req);
  const url = new URL(req.url);
  const desde = url.searchParams.get("desde");
  const ate = url.searchParams.get("ate");

  // Janela de datas (enviada_em). Parametrizado; null = sem limite.
  const filtros = `evento = $1
    and ($2::timestamptz is null or enviada_em >= $2)
    and ($3::timestamptz is null or enviada_em <= $3)`;
  const params = [evento, desde, ate];

  const kpis = (await queryOne<Kpis>(
    `select
       count(*)::int as campanhas,
       coalesce(sum(enviados), 0)::int as enviados,
       coalesce(sum(aberturas_unicas), 0)::int as aberturas_unicas,
       coalesce(sum(cliques_unicos), 0)::int as cliques_unicos,
       coalesce(sum(hardbounces + softbounces), 0)::int as bounces,
       coalesce(sum(unsubscribes), 0)::int as unsubscribes,
       max(enviada_em) as ultima_em
     from cs.campanhas_email
     where ${filtros}`,
    params,
  )) ?? {
    campanhas: 0, enviados: 0, aberturas_unicas: 0, cliques_unicos: 0,
    bounces: 0, unsubscribes: 0, ultima_em: null,
  };

  const campanhas = await query<CampanhaRow>(
    `select id, nome, tipo, status, enviados, processados,
            aberturas_unicas, cliques_unicos, hardbounces, softbounces, unsubscribes, enviada_em
       from cs.campanhas_email
      where ${filtros}
      order by enviada_em desc nulls last
      limit 100`,
    params,
  );

  // Engajamento "dos nossos": cruza o engajamento de e-mail (cs.email_contato,
  // sincronizado do AC por pessoa) com os contatos DESTE evento. Reflete as
  // pessoas reais do sistema, não a base inteira do AC. O evento vem do nosso
  // contato (cs.contatos_evento) — a mesma noção de filtro do disparo.
  const nossos = (await queryOne<{
    contatos: number; no_ac: number; receberam: number; abriram: number; clicaram: number; com_bounce: number;
  }>(
    `with base as (
       select distinct on (v.comprador_id) v.comprador_id, ec.encontrado, ec.recebidos,
              ec.abriu_em, ec.clicou_em, ec.bounce_hard
         from cs.contatos_evento v
         left join cs.email_contato ec on ec.comprador_id = v.comprador_id
        where v.evento = $1 and v.email is not null and v.email like '%@%'
        order by v.comprador_id
     )
     select
       count(*)::int as contatos,
       count(*) filter (where encontrado)::int as no_ac,
       count(*) filter (where recebidos > 0)::int as receberam,
       count(*) filter (where abriu_em is not null)::int as abriram,
       count(*) filter (where clicou_em is not null)::int as clicaram,
       count(*) filter (where bounce_hard > 0)::int as com_bounce
     from base`,
    [evento],
  )) ?? { contatos: 0, no_ac: 0, receberam: 0, abriram: 0, clicaram: 0, com_bounce: 0 };

  return NextResponse.json({ ok: true, kpis, campanhas, nossos });
}
