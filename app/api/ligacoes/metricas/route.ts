import { NextResponse } from "next/server";
import { isAuthed } from "@/lib/auth";
import { query, queryOne } from "@/lib/db";
import { eventoDe } from "@/lib/services/evento";

export const runtime = "nodejs";

// GET /api/ligacoes/metricas?evento=HT&desde=&ate= — métricas das ligações
// (Atende Simples) dos COMPRADORES do evento. O escopo é calculado CRUZANDO na
// hora cada chamada com a base de compradores por telefone (últimos 8 dígitos),
// e não pelo comprador_id congelado na gravação — assim reflete sempre a base
// atual e independe de re-casar. "Sem chance de erro": uma chamada que bate com
// 2+ compradores diferentes é AMBÍGUA e fica de fora (nunca atribui errado).
// `comprador_id` da própria ligação segue servindo à timeline; aqui não é usado.
type Linha = {
  resultado: string | null; direction: string | null; duracao_seg: number | null;
  atendente: string | null; dia: string; hora: number; comprador_id: string;
};

export async function GET(req: Request) {
  if (!isAuthed()) return NextResponse.json({ ok: false }, { status: 401 });

  const evento = eventoDe(req);
  const url = new URL(req.url);
  const desde = url.searchParams.get("desde");
  const ate = url.searchParams.get("ate");
  const params = [desde, ate, evento];

  // CTEs do cruzamento (compartilhadas pela query de linhas e a de diagnóstico):
  //  chamadas — do Atende Simples no período, com os últimos 8 dígitos de cada
  //             número (from = cliente; dnis = plataforma, mas testamos os dois);
  //  parts    — compradores do evento com os últimos 8 dígitos do telefone;
  //  casados  — por chamada: quantos compradores DISTINTOS batem (n) e qual (=1).
  const ctes = `
    with chamadas as (
      select l.id, l.resultado, l.direction, l.duracao_seg,
             coalesce(nullif(l.operador, ''), nullif(l.attendant_email, '')) as atendente,
             coalesce(l.iniciada_em, l.criado_em) as quando,
             right(regexp_replace(coalesce(l.from_number, ''), '\\D', '', 'g'), 8) as f8,
             right(regexp_replace(coalesce(l.dnis, ''),        '\\D', '', 'g'), 8) as d8
        from cs.ligacoes l
       where l.provider = 'atendesimples'
         and ($1::timestamptz is null or l.criado_em >= $1)
         and ($2::timestamptz is null or l.criado_em <= $2)
    ),
    parts as (
      select comprador_id, right(regexp_replace(telefone, '\\D', '', 'g'), 8) as t8
        from cs.contatos_evento
       where evento = $3 and telefone is not null
         and length(regexp_replace(telefone, '\\D', '', 'g')) >= 8
    ),
    casados as (
      select c.id,
             count(distinct p.comprador_id) as n,
             min(p.comprador_id::text) as comprador_id
        from chamadas c
        join lateral (values (c.f8), (c.d8)) s(t8) on length(s.t8) = 8
        join parts p on p.t8 = s.t8
       group by c.id
    )`;

  // Linhas das chamadas que casaram com EXATAMENTE 1 comprador (não-ambíguas).
  const linhas = await query<Linha>(
    `${ctes}
     select c.resultado, c.direction, c.duracao_seg, c.atendente,
            to_char(c.quando at time zone 'America/Sao_Paulo', 'YYYY-MM-DD') as dia,
            extract(hour from c.quando at time zone 'America/Sao_Paulo')::int as hora,
            k.comprador_id
       from chamadas c
       join casados k on k.id = c.id and k.n = 1`,
    params,
  );

  // Diagnóstico: do total do discador no período, quanto casou / ficou ambíguo /
  // não bateu com nenhum comprador (não-participante).
  const diag = (await queryOne<{ geral: number; casadas: number; ambiguas: number; sem_participante: number }>(
    `${ctes}
     select
       (select count(*) from chamadas)::int as geral,
       count(*) filter (where k.n = 1)::int as casadas,
       count(*) filter (where k.n > 1)::int as ambiguas,
       (select count(*) from chamadas)::int - count(*)::int as sem_participante
       from casados k`,
    params,
  )) ?? { geral: 0, casadas: 0, ambiguas: 0, sem_participante: 0 };

  // --- Agregações em JS (≤ ~milhar de linhas) -----------------------------
  const atendeu = (r: Linha) => r.resultado === "atendeu";
  const durAtend = linhas.filter((r) => atendeu(r) && r.duracao_seg);
  const totais = {
    total: linhas.length,
    feitas: linhas.filter((r) => r.direction === "outbound").length,
    recebidas: linhas.filter((r) => r.direction === "inbound").length,
    atendidas: linhas.filter(atendeu).length,
    abandonadas: linhas.filter((r) => r.resultado === "abandonou").length,
    recusadas: linhas.filter((r) => r.resultado === "recusada").length,
    nao_atendidas: linhas.filter((r) => r.resultado === "nao_atendeu").length,
    falhou: linhas.filter((r) => r.resultado === "falhou").length,
    dur_total_seg: linhas.reduce((a, r) => a + (r.duracao_seg || 0), 0),
    dur_media_seg: durAtend.length ? Math.round(durAtend.reduce((a, r) => a + (r.duracao_seg || 0), 0) / durAtend.length) : null,
    compradores_distintos: new Set(linhas.map((r) => r.comprador_id)).size,
    compradores_atendidos: new Set(linhas.filter(atendeu).map((r) => r.comprador_id)).size,
  };

  const diaMap = new Map<string, { total: number; atendidas: number; atend: Map<string, number> }>();
  const horaMap = new Map<number, { total: number; atendidas: number }>();
  const atMap = new Map<string, { total: number; atendidas: number; feitas: number; dur_total_seg: number }>();
  for (const r of linhas) {
    const d = diaMap.get(r.dia) ?? { total: 0, atendidas: 0, atend: new Map() };
    d.total++; if (atendeu(r)) d.atendidas++;
    const op = r.atendente || "—";
    d.atend.set(op, (d.atend.get(op) || 0) + 1);
    diaMap.set(r.dia, d);

    const h = horaMap.get(r.hora) ?? { total: 0, atendidas: 0 };
    h.total++; if (atendeu(r)) h.atendidas++;
    horaMap.set(r.hora, h);

    const a = atMap.get(op) ?? { total: 0, atendidas: 0, feitas: 0, dur_total_seg: 0 };
    a.total++; if (atendeu(r)) a.atendidas++; if (r.direction === "outbound") a.feitas++;
    a.dur_total_seg += r.duracao_seg || 0;
    atMap.set(op, a);
  }

  const serie = [...diaMap.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([dia, d]) => ({
    dia, total: d.total, atendidas: d.atendidas,
    atendentes: [...d.atend.entries()].map(([operador, qtd]) => ({ operador, qtd })).sort((a, b) => b.qtd - a.qtd),
  }));
  const porHora = [...horaMap.entries()].sort((a, b) => a[0] - b[0]).map(([hora, h]) => ({ hora, ...h }));
  const porAtendente = [...atMap.entries()].map(([atendente, a]) => ({ atendente, ...a })).sort((a, b) => b.total - a.total).slice(0, 50);

  return NextResponse.json({
    ok: true, totais, serie, porHora, porAtendente,
    fora: { geral: diag.geral, sem_participante: diag.sem_participante, ambiguas: diag.ambiguas },
  });
}
