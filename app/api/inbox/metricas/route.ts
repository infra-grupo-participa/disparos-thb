import { NextResponse } from "next/server";
import { guard } from "@/lib/guard";
import { escopoVisibilidade, paramsEscopo } from "@/lib/papeis";
import { query, queryOne } from "@/lib/db";
import { sqlEscopo } from "@/lib/services/contato";
import { getConfig } from "@/lib/services/config";
import { eventoDe } from "@/lib/services/evento";

export const runtime = "nodejs";

// GET /api/inbox/metricas — desempenho do CS no atendimento do evento ativo.
// FRT = tempo de primeiro contato (lead falou → CS respondeu). SLA configurável.
// cs.atendimentos não tem evento próprio: juntamos a cs.contatos pelo comprador.
//
// RECORTE por equipe (decisão do Marcio, 27/07): master vê o portal inteiro;
// gestor vê os números da própria equipe; operador, os dele. O atendimento
// herda o escopo do CONTATO atendido (dono/equipe do card, 0146) — inclusive
// pendentes e maior espera: um KPI de trabalho que o operador não pode ver não
// é KPI, é ruído.
export async function GET(req: Request) {
  // Portal do evento RESOLVIDO (cookie/query) contra a whitelist da conta (0145).
  const g = await guard({ portal: eventoDe(req) });
  if (!g.ok) return g.res;
  const SLA_MIN = Number(await getConfig("inbox.sla_min", 15)) || 15;
  const evento = eventoDe(req);
  const { verTudo, equipeId, usuarioId } = paramsEscopo(escopoVisibilidade(g.sessao));
  // O predicado sobre cs.contatos cru: a equipe deriva do dono (join usuarios).
  const ESCOPO_C = sqlEscopo({ rid: "c.responsavel_id", eq: "ru.equipe_id", nome: "c.responsavel" }, { verTudo: 2, usuario: 3, equipe: 4 });
  const f = [evento, verTudo, usuarioId, equipeId];

  const kpis = await queryOne(
    `select
        (select count(*) filter (where c.inbox_status = 'pendente')
           from cs.contatos c left join cs.usuarios ru on ru.id = c.responsavel_id
          where c.evento = $1 and ${ESCOPO_C})::int as pendentes,
        count(*)::int as total_atendimentos,
        count(*) filter (where (a.respondido_em at time zone 'America/Sao_Paulo')::date = (now() at time zone 'America/Sao_Paulo')::date)::int as atendidas_hoje,
        round(avg(a.frt_minutos))::int as frt_medio,
        round(avg(a.frt_minutos) filter (where (a.respondido_em at time zone 'America/Sao_Paulo')::date = (now() at time zone 'America/Sao_Paulo')::date))::int as frt_hoje,
        round(100.0 * count(*) filter (where a.frt_minutos <= ${SLA_MIN}) / nullif(count(*), 0))::int as sla_pct
       from cs.atendimentos a
       join cs.contatos c on c.comprador_id = a.comprador_id and c.evento = $1
       left join cs.usuarios ru on ru.id = c.responsavel_id
      where ${ESCOPO_C}`,
    f,
  );

  // Maior pendência aberta agora (pior espera) — sinaliza urgência.
  const maiorEspera = await queryOne<{ min: number | null }>(
    `select round(extract(epoch from (now() - min(c.aguardando_desde))) / 60)::int as min
       from cs.contatos c left join cs.usuarios ru on ru.id = c.responsavel_id
      where c.inbox_status = 'pendente' and c.evento = $1 and ${ESCOPO_C}`,
    f,
  );

  const porAtendente = await query(
    `select coalesce(nullif(a.atendente, ''), '— sem identificação —') as atendente,
            count(*)::int as atendimentos,
            round(avg(a.frt_minutos))::int as frt_medio,
            round(100.0 * count(*) filter (where a.frt_minutos <= ${SLA_MIN}) / nullif(count(*), 0))::int as sla_pct
       from cs.atendimentos a
       join cs.contatos c on c.comprador_id = a.comprador_id and c.evento = $1
       left join cs.usuarios ru on ru.id = c.responsavel_id
      where ${ESCOPO_C}
      group by 1
      order by atendimentos desc`,
    f,
  );

  const porDia = await query(
    `select to_char((a.respondido_em at time zone 'America/Sao_Paulo')::date, 'DD/MM') as dia,
            count(*)::int as qtd,
            round(avg(a.frt_minutos))::int as frt
       from cs.atendimentos a
       join cs.contatos c on c.comprador_id = a.comprador_id and c.evento = $1
       left join cs.usuarios ru on ru.id = c.responsavel_id
      where a.respondido_em >= now() - interval '14 days' and ${ESCOPO_C}
      group by (a.respondido_em at time zone 'America/Sao_Paulo')::date
      order by (a.respondido_em at time zone 'America/Sao_Paulo')::date`,
    f,
  );

  return NextResponse.json({
    ok: true,
    kpis: { ...(kpis ?? {}), maior_espera_min: maiorEspera?.min ?? null, sla_min: SLA_MIN },
    porAtendente,
    porDia,
  });
}
