import { NextResponse } from "next/server";
import { isAuthed } from "@/lib/auth";
import { query, queryOne } from "@/lib/db";

export const runtime = "nodejs";

// GET /api/inbox/metricas — desempenho do CS no atendimento.
// FRT = tempo de primeiro contato (lead falou → CS respondeu). SLA = ≤ 15 min.
const SLA_MIN = 15;

export async function GET() {
  if (!isAuthed()) return NextResponse.json({ ok: false }, { status: 401 });

  const kpis = await queryOne(
    `select
        (select count(*) filter (where inbox_status = 'pendente') from cs.contatos)::int as pendentes,
        count(*)::int as total_atendimentos,
        count(*) filter (where (respondido_em at time zone 'America/Sao_Paulo')::date = (now() at time zone 'America/Sao_Paulo')::date)::int as atendidas_hoje,
        round(avg(frt_minutos))::int as frt_medio,
        round(avg(frt_minutos) filter (where (respondido_em at time zone 'America/Sao_Paulo')::date = (now() at time zone 'America/Sao_Paulo')::date))::int as frt_hoje,
        round(100.0 * count(*) filter (where frt_minutos <= ${SLA_MIN}) / nullif(count(*), 0))::int as sla_pct
       from cs.atendimentos`,
  );

  // Maior pendência aberta agora (pior espera) — sinaliza urgência.
  const maiorEspera = await queryOne<{ min: number | null }>(
    `select round(extract(epoch from (now() - min(aguardando_desde))) / 60)::int as min
       from cs.contatos where inbox_status = 'pendente'`,
  );

  const porAtendente = await query(
    `select coalesce(nullif(atendente, ''), '— sem identificação —') as atendente,
            count(*)::int as atendimentos,
            round(avg(frt_minutos))::int as frt_medio,
            round(100.0 * count(*) filter (where frt_minutos <= ${SLA_MIN}) / nullif(count(*), 0))::int as sla_pct
       from cs.atendimentos
      group by 1
      order by atendimentos desc`,
  );

  const porDia = await query(
    `select to_char((respondido_em at time zone 'America/Sao_Paulo')::date, 'DD/MM') as dia,
            count(*)::int as qtd,
            round(avg(frt_minutos))::int as frt
       from cs.atendimentos
      where respondido_em >= now() - interval '14 days'
      group by (respondido_em at time zone 'America/Sao_Paulo')::date
      order by (respondido_em at time zone 'America/Sao_Paulo')::date`,
  );

  return NextResponse.json({
    ok: true,
    kpis: { ...(kpis ?? {}), maior_espera_min: maiorEspera?.min ?? null, sla_min: SLA_MIN },
    porAtendente,
    porDia,
  });
}
