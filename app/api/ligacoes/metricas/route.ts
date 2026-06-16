import { NextResponse } from "next/server";
import { isAuthed } from "@/lib/auth";
import { query, queryOne } from "@/lib/db";
import { eventoDe } from "@/lib/services/evento";

export const runtime = "nodejs";

// GET /api/ligacoes/metricas?evento=HT&desde=&ate= — produtividade GERAL do
// comercial (todas as chamadas do Atende Simples no período); não depende de o
// número estar na base. `vinculadas_evento` conta quantas casaram com alunos do
// portal. Totais + série por dia + ranking por atendente.
type Totais = {
  total: number; feitas: number; recebidas: number; atendidas: number;
  abandonadas: number; recusadas: number; nao_atendidas: number; falhou: number;
  dur_total_seg: number; dur_media_seg: number | null; vinculadas_evento: number;
  numeros_distintos: number;
};
type Atendente = {
  atendente: string; total: number; atendidas: number; feitas: number; dur_total_seg: number;
};

export async function GET(req: Request) {
  if (!isAuthed()) return NextResponse.json({ ok: false }, { status: 401 });

  const evento = eventoDe(req);
  const url = new URL(req.url);
  const desde = url.searchParams.get("desde");
  const ate = url.searchParams.get("ate");

  // Filtro de período ($1 = desde, $2 = ate) — comum a todas as queries.
  const periodo = `provider = 'atendesimples'
    and ($1::timestamptz is null or criado_em >= $1)
    and ($2::timestamptz is null or criado_em <= $2)`;
  const periodoParams = [desde, ate];

  // Totais: período ($1,$2) + evento ($3) só para contar as vinculadas.
  const totais = (await queryOne<Totais>(
    `select
       count(*)::int as total,
       count(*) filter (where direction = 'outbound')::int as feitas,
       count(*) filter (where direction = 'inbound')::int as recebidas,
       count(*) filter (where resultado = 'atendeu')::int as atendidas,
       count(*) filter (where resultado = 'abandonou')::int as abandonadas,
       count(*) filter (where resultado = 'recusada')::int as recusadas,
       count(*) filter (where resultado = 'nao_atendeu')::int as nao_atendidas,
       count(*) filter (where resultado = 'falhou')::int as falhou,
       coalesce(sum(duracao_seg), 0)::int as dur_total_seg,
       round(avg(duracao_seg) filter (where resultado = 'atendeu'))::int as dur_media_seg,
       count(*) filter (where evento = $3)::int as vinculadas_evento,
       count(distinct coalesce(from_number, dnis))::int as numeros_distintos
     from cs.ligacoes
     where ${periodo}`,
    [...periodoParams, evento],
  )) ?? {
    total: 0, feitas: 0, recebidas: 0, atendidas: 0, abandonadas: 0,
    recusadas: 0, nao_atendidas: 0, falhou: 0, dur_total_seg: 0, dur_media_seg: null, vinculadas_evento: 0, numeros_distintos: 0,
  };

  // Atendimento por hora do dia (horário de Brasília) — revela o melhor horário
  // para o comercial ligar (faixa com mais atendimento).
  const porHora = await query<{ hora: number; total: number; atendidas: number }>(
    `select extract(hour from coalesce(iniciada_em, criado_em) at time zone 'America/Sao_Paulo')::int as hora,
            count(*)::int as total,
            count(*) filter (where resultado = 'atendeu')::int as atendidas
       from cs.ligacoes
      where ${periodo}
      group by 1 order by 1`,
    periodoParams,
  );

  // Série por dia e por hora usam o horário REAL da chamada (iniciada_em); só
  // caem no criado_em quando a chamada antiga não tem o started_at gravado.
  const serieBase = await query<{ dia: string; total: number; atendidas: number }>(
    `select to_char(date_trunc('day', coalesce(iniciada_em, criado_em) at time zone 'America/Sao_Paulo'), 'YYYY-MM-DD') as dia,
            count(*)::int as total,
            count(*) filter (where resultado = 'atendeu')::int as atendidas
       from cs.ligacoes
      where ${periodo}
      group by 1 order by 1`,
    periodoParams,
  );

  // Quebra por atendente em cada dia (alimenta o tooltip de "ligações por dia").
  const serieAtend = await query<{ dia: string; operador: string; qtd: number }>(
    `select to_char(date_trunc('day', coalesce(iniciada_em, criado_em) at time zone 'America/Sao_Paulo'), 'YYYY-MM-DD') as dia,
            coalesce(nullif(operador, ''), '—') as operador,
            count(*)::int as qtd
       from cs.ligacoes
      where ${periodo}
      group by 1, 2 order by 1, qtd desc`,
    periodoParams,
  );
  const porDiaAtend = new Map<string, { operador: string; qtd: number }[]>();
  for (const r of serieAtend) {
    const arr = porDiaAtend.get(r.dia) ?? [];
    arr.push({ operador: r.operador, qtd: r.qtd });
    porDiaAtend.set(r.dia, arr);
  }
  const serie = serieBase.map((d) => ({ ...d, atendentes: porDiaAtend.get(d.dia) ?? [] }));

  const porAtendente = await query<Atendente>(
    `select
       coalesce(nullif(operador, ''), nullif(attendant_email, ''), '—') as atendente,
       count(*)::int as total,
       count(*) filter (where resultado = 'atendeu')::int as atendidas,
       count(*) filter (where direction = 'outbound')::int as feitas,
       coalesce(sum(duracao_seg), 0)::int as dur_total_seg
     from cs.ligacoes
     where ${periodo}
     group by 1
     order by total desc
     limit 50`,
    periodoParams,
  );

  return NextResponse.json({ ok: true, totais, serie, porHora, porAtendente });
}
