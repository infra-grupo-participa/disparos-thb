import { NextResponse } from "next/server";
import { isAuthed } from "@/lib/auth";
import { query, queryOne } from "@/lib/db";
import { eventoDe } from "@/lib/services/evento";

export const runtime = "nodejs";

// GET /api/ligacoes/metricas?evento=HT&desde=&ate= — produtividade do comercial
// (ligações do Atende Simples), por evento. Totais + ranking por atendente.
// Espelha o padrão do /api/dashboard: filtra por evento (chamadas casadas com
// alunos daquele portal) e período sobre criado_em.
type Totais = {
  total: number; feitas: number; recebidas: number; atendidas: number;
  abandonadas: number; recusadas: number; nao_atendidas: number; falhou: number;
  dur_total_seg: number; dur_media_seg: number | null; vinculadas_evento: number;
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

  // Produtividade do comercial é GERAL (todas as chamadas do Atende Simples no
  // período) — não depende de o número estar na base. `evento = $1` é usado só
  // para contar quantas casaram com alunos daquele portal (vinculadas_evento).
  const filtros = `provider = 'atendesimples'
    and ($2::timestamptz is null or criado_em >= $2)
    and ($3::timestamptz is null or criado_em <= $3)`;
  const params = [evento, desde, ate];

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
       count(*) filter (where evento = $1)::int as vinculadas_evento
     from cs.ligacoes
     where ${filtros}`,
    params,
  )) ?? {
    total: 0, feitas: 0, recebidas: 0, atendidas: 0, abandonadas: 0,
    recusadas: 0, nao_atendidas: 0, falhou: 0, dur_total_seg: 0, dur_media_seg: null, vinculadas_evento: 0,
  };

  // Série por dia (volume + atendidas) — para ver picos e vazios de atividade.
  const serie = await query<{ dia: string; total: number; atendidas: number }>(
    `select to_char(date_trunc('day', criado_em), 'YYYY-MM-DD') as dia,
            count(*)::int as total,
            count(*) filter (where resultado = 'atendeu')::int as atendidas
       from cs.ligacoes
      where ${filtros}
      group by 1 order by 1`,
    params,
  );

  const porAtendente = await query<Atendente>(
    `select
       coalesce(nullif(operador, ''), nullif(attendant_email, ''), '—') as atendente,
       count(*)::int as total,
       count(*) filter (where resultado = 'atendeu')::int as atendidas,
       count(*) filter (where direction = 'outbound')::int as feitas,
       coalesce(sum(duracao_seg), 0)::int as dur_total_seg
     from cs.ligacoes
     where ${filtros}
     group by 1
     order by total desc
     limit 50`,
    params,
  );

  return NextResponse.json({ ok: true, totais, serie, porAtendente });
}
