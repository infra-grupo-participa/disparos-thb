import { NextResponse } from "next/server";
import { isAuthed } from "@/lib/auth";
import { query } from "@/lib/db";
import { eventoDe } from "@/lib/services/evento";

export const runtime = "nodejs";

// GET /api/operadores?evento=&desde=&ate= — produtividade dos operadores a partir
// do histórico de ações dos alunos (cs.interacoes), por evento e período. Conta
// o que cada operador fez: disparos, ligações, movimentações no Kanban e notas.
// As ligações entram pelo atendente real (Atende Simples); as demais ações pelo
// usuário logado que as executou.
type LinhaOperador = {
  operador: string; disparos: number; ligacoes: number; movimentacoes: number; notas: number; total: number;
};

export async function GET(req: Request) {
  if (!isAuthed()) return NextResponse.json({ ok: false }, { status: 401 });

  const evento = eventoDe(req);
  const url = new URL(req.url);
  const desde = url.searchParams.get("desde");
  const ate = url.searchParams.get("ate");

  const operadores = await query<LinhaOperador>(
    `select
       coalesce(nullif(i.autor, ''), '—') as operador,
       count(*) filter (where i.tipo = 'disparo')::int as disparos,
       count(*) filter (where i.tipo = 'ligacao')::int as ligacoes,
       count(*) filter (where i.tipo = 'mudanca_estagio')::int as movimentacoes,
       count(*) filter (where i.tipo = 'nota')::int as notas,
       count(*) filter (where i.tipo in ('disparo','ligacao','mudanca_estagio','nota'))::int as total
     from cs.interacoes i
     join cs.contatos c on c.id = i.contato_id and c.evento = $1
     where ($2::timestamptz is null or i.criado_em >= $2)
       and ($3::timestamptz is null or i.criado_em <= $3)
       and i.tipo in ('disparo','ligacao','mudanca_estagio','nota')
     group by 1
     having count(*) filter (where i.tipo in ('disparo','ligacao','mudanca_estagio','nota')) > 0
     order by total desc
     limit 100`,
    [evento, desde, ate],
  );

  return NextResponse.json({ ok: true, operadores });
}
