import { NextResponse } from "next/server";
import { isAuthed } from "@/lib/auth";
import { query, queryOne } from "@/lib/db";

export const runtime = "nodejs";

export async function GET(req: Request) {
  if (!isAuthed()) return NextResponse.json({ ok: false }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const desde = searchParams.get("desde") || null;
  const ate = searchParams.get("ate") || null;
  const edicao = searchParams.get("edicao") || null;
  const f = [desde, ate, edicao];

  const filtro = `($1::timestamptz is null or d.iniciado_em >= $1)
              and ($2::timestamptz is null or d.iniciado_em <= $2)
              and ($3::text is null or d.edicao_ht = $3)`;

  const kpis = await queryOne(
    `select
        count(*) filter (where dc.enviado)   as enviados,
        count(*) filter (where dc.respondeu) as respondidos,
        round(avg(dc.sla_minutos) filter (where dc.respondeu))::int as sla_medio
       from cs.disparos d
       join cs.disparo_contatos dc on dc.disparo_id = d.id
      where ${filtro}`,
    f,
  );

  const porTemplate = await query(
    `select t.nome as template,
            count(*) filter (where dc.enviado)   as enviados,
            count(*) filter (where dc.respondeu) as respondidos,
            round(avg(dc.sla_minutos) filter (where dc.respondeu))::int as sla_medio
       from cs.disparos d
       join cs.templates t on t.id = d.template_id
       join cs.disparo_contatos dc on dc.disparo_id = d.id
      where ${filtro}
      group by t.nome
      order by enviados desc`,
    f,
  );

  const porDisparo = await query(
    `select d.id, t.nome as template, d.edicao_ht, d.iniciado_em, d.status,
            count(*) filter (where dc.enviado)   as enviados,
            count(*) filter (where dc.respondeu) as respondidos,
            round(avg(dc.sla_minutos) filter (where dc.respondeu))::int as sla_medio
       from cs.disparos d
       left join cs.templates t on t.id = d.template_id
       left join cs.disparo_contatos dc on dc.disparo_id = d.id
      where ${filtro}
      group by d.id, t.nome, d.edicao_ht, d.iniciado_em, d.status
      order by d.iniciado_em desc
      limit 100`,
    f,
  );

  // Edições que já tiveram disparo — alimenta o dropdown de filtro (não filtrado,
  // para a lista permanecer estável independentemente do filtro ativo).
  const edicoesRows = await query<{ edicao_ht: string }>(
    `select distinct edicao_ht from cs.disparos where edicao_ht is not null and edicao_ht <> '' order by 1`,
  );
  const edicoes = edicoesRows.map((e) => e.edicao_ht);

  return NextResponse.json({ ok: true, kpis, porTemplate, porDisparo, edicoes });
}
