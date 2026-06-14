import { NextResponse } from "next/server";
import { isAuthed } from "@/lib/auth";
import { query, queryOne } from "@/lib/db";
import { getConfig } from "@/lib/services/config";
import { eventoDe } from "@/lib/services/evento";

export const runtime = "nodejs";

// GET /api/inbox/metricas — desempenho do CS no atendimento do evento ativo.
// FRT = tempo de primeiro contato (lead falou → CS respondeu). SLA configurável.
// cs.atendimentos não tem evento próprio: juntamos a cs.contatos pelo comprador.
export async function GET(req: Request) {
  if (!isAuthed()) return NextResponse.json({ ok: false }, { status: 401 });
  const SLA_MIN = Number(await getConfig("inbox.sla_min", 15)) || 15;
  const evento = eventoDe(req);

  const kpis = await queryOne(
    `select
        (select count(*) filter (where inbox_status = 'pendente') from cs.contatos where evento = $1)::int as pendentes,
        count(*)::int as total_atendimentos,
        count(*) filter (where (a.respondido_em at time zone 'America/Sao_Paulo')::date = (now() at time zone 'America/Sao_Paulo')::date)::int as atendidas_hoje,
        round(avg(a.frt_minutos))::int as frt_medio,
        round(avg(a.frt_minutos) filter (where (a.respondido_em at time zone 'America/Sao_Paulo')::date = (now() at time zone 'America/Sao_Paulo')::date))::int as frt_hoje,
        round(100.0 * count(*) filter (where a.frt_minutos <= ${SLA_MIN}) / nullif(count(*), 0))::int as sla_pct
       from cs.atendimentos a
       join cs.contatos c on c.comprador_id = a.comprador_id and c.evento = $1`,
    [evento],
  );

  // Maior pendência aberta agora (pior espera) — sinaliza urgência.
  const maiorEspera = await queryOne<{ min: number | null }>(
    `select round(extract(epoch from (now() - min(aguardando_desde))) / 60)::int as min
       from cs.contatos where inbox_status = 'pendente' and evento = $1`,
    [evento],
  );

  const porAtendente = await query(
    `select coalesce(nullif(a.atendente, ''), '— sem identificação —') as atendente,
            count(*)::int as atendimentos,
            round(avg(a.frt_minutos))::int as frt_medio,
            round(100.0 * count(*) filter (where a.frt_minutos <= ${SLA_MIN}) / nullif(count(*), 0))::int as sla_pct
       from cs.atendimentos a
       join cs.contatos c on c.comprador_id = a.comprador_id and c.evento = $1
      group by 1
      order by atendimentos desc`,
    [evento],
  );

  const porDia = await query(
    `select to_char((a.respondido_em at time zone 'America/Sao_Paulo')::date, 'DD/MM') as dia,
            count(*)::int as qtd,
            round(avg(a.frt_minutos))::int as frt
       from cs.atendimentos a
       join cs.contatos c on c.comprador_id = a.comprador_id and c.evento = $1
      where a.respondido_em >= now() - interval '14 days'
      group by (a.respondido_em at time zone 'America/Sao_Paulo')::date
      order by (a.respondido_em at time zone 'America/Sao_Paulo')::date`,
    [evento],
  );

  return NextResponse.json({
    ok: true,
    kpis: { ...(kpis ?? {}), maior_espera_min: maiorEspera?.min ?? null, sla_min: SLA_MIN },
    porAtendente,
    porDia,
  });
}
