import { NextResponse } from "next/server";
import { isAuthed } from "@/lib/auth";
import { query, queryOne } from "@/lib/db";
import { eventoDe } from "@/lib/services/evento";

export const runtime = "nodejs";

// GET /api/ligacoes/metricas?evento=HT&desde=&ate= — métricas das ligações
// (Atende Simples) RESTRITAS aos compradores do evento dentro do sistema:
// escopo = chamadas que casaram com um aluno (comprador_id) E são do evento.
// Nada de chamada solta do discador entra nas contas. `fora_escopo`/`geral`
// existem só para diagnóstico (quanto ficou de fora e por quê).
type Totais = {
  total: number; feitas: number; recebidas: number; atendidas: number;
  abandonadas: number; recusadas: number; nao_atendidas: number; falhou: number;
  dur_total_seg: number; dur_media_seg: number | null;
  compradores_distintos: number; compradores_atendidos: number;
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

  // Escopo (comum a todas as queries): só chamadas de compradores DO EVENTO que
  // estão no sistema. $1 = desde, $2 = ate, $3 = evento.
  const escopo = `provider = 'atendesimples'
    and evento = $3 and comprador_id is not null
    and ($1::timestamptz is null or criado_em >= $1)
    and ($2::timestamptz is null or criado_em <= $2)`;
  const params = [desde, ate, evento];

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
       count(distinct comprador_id)::int as compradores_distintos,
       count(distinct comprador_id) filter (where resultado = 'atendeu')::int as compradores_atendidos
     from cs.ligacoes
     where ${escopo}`,
    params,
  )) ?? {
    total: 0, feitas: 0, recebidas: 0, atendidas: 0, abandonadas: 0,
    recusadas: 0, nao_atendidas: 0, falhou: 0, dur_total_seg: 0, dur_media_seg: null,
    compradores_distintos: 0, compradores_atendidos: 0,
  };

  // Diagnóstico: do total do discador no período, quanto NÃO entrou no escopo.
  const fora = (await queryOne<{ geral: number; sem_aluno: number; outro_evento: number }>(
    `select
       count(*)::int as geral,
       count(*) filter (where comprador_id is null)::int as sem_aluno,
       count(*) filter (where comprador_id is not null and (evento is distinct from $3))::int as outro_evento
     from cs.ligacoes
     where provider = 'atendesimples'
       and ($1::timestamptz is null or criado_em >= $1)
       and ($2::timestamptz is null or criado_em <= $2)`,
    params,
  )) ?? { geral: 0, sem_aluno: 0, outro_evento: 0 };

  // Atendimento por hora do dia (horário de Brasília) — melhor horário p/ ligar.
  const porHora = await query<{ hora: number; total: number; atendidas: number }>(
    `select extract(hour from coalesce(iniciada_em, criado_em) at time zone 'America/Sao_Paulo')::int as hora,
            count(*)::int as total,
            count(*) filter (where resultado = 'atendeu')::int as atendidas
       from cs.ligacoes
      where ${escopo}
      group by 1 order by 1`,
    params,
  );

  // Série por dia (horário REAL da chamada quando há started_at).
  const serieBase = await query<{ dia: string; total: number; atendidas: number }>(
    `select to_char(date_trunc('day', coalesce(iniciada_em, criado_em) at time zone 'America/Sao_Paulo'), 'YYYY-MM-DD') as dia,
            count(*)::int as total,
            count(*) filter (where resultado = 'atendeu')::int as atendidas
       from cs.ligacoes
      where ${escopo}
      group by 1 order by 1`,
    params,
  );

  // Quebra por atendente em cada dia (alimenta o tooltip de "ligações por dia").
  const serieAtend = await query<{ dia: string; operador: string; qtd: number }>(
    `select to_char(date_trunc('day', coalesce(iniciada_em, criado_em) at time zone 'America/Sao_Paulo'), 'YYYY-MM-DD') as dia,
            coalesce(nullif(operador, ''), '—') as operador,
            count(*)::int as qtd
       from cs.ligacoes
      where ${escopo}
      group by 1, 2 order by 1, qtd desc`,
    params,
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
     where ${escopo}
     group by 1
     order by total desc
     limit 50`,
    params,
  );

  return NextResponse.json({ ok: true, totais, serie, porHora, porAtendente, fora });
}
