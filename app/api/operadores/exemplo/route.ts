import { NextResponse } from "next/server";
import { isAuthed } from "@/lib/auth";
import { query, queryOne } from "@/lib/db";
import { eventoDe } from "@/lib/services/evento";

export const runtime = "nodejs";

// GET /api/operadores/exemplo?edicao=HT27 — devolve o aluno do evento/edição com
// MAIS ações registradas e a timeline dele, para conferir como o histórico de
// ações (disparo / e-mail / ligação / kanban / nota) fica por aluno. Autenticado.
export async function GET(req: Request) {
  if (!isAuthed()) return NextResponse.json({ ok: false }, { status: 401 });

  const evento = eventoDe(req);
  const edicao = new URL(req.url).searchParams.get("edicao");

  const aluno = await queryOne<{ comprador_id: string; nome: string; edicao_ht: string | null; acoes: number }>(
    `select ct.comprador_id, v.nome, v.edicao_ht, count(i.id)::int as acoes
       from cs.contatos ct
       join cs.contatos_evento v on v.comprador_id = ct.comprador_id and v.evento = $1
       join cs.interacoes i on i.contato_id = ct.id
      where ($2::text is null or v.edicao_ht = $2)
      group by ct.comprador_id, v.nome, v.edicao_ht
      order by acoes desc
      limit 1`,
    [evento, edicao],
  );

  if (!aluno) {
    return NextResponse.json({
      ok: true, encontrado: false,
      motivo: `Nenhum aluno de ${evento}${edicao ? ` (${edicao})` : ""} tem ação registrada ainda.`,
    });
  }

  const timeline = await query<{ tipo: string; descricao: string | null; autor: string | null; criado_em: string }>(
    `select i.tipo, i.descricao, i.autor, i.criado_em
       from cs.interacoes i
       join cs.contatos c on c.id = i.contato_id
      where c.comprador_id = $1
      order by i.criado_em desc
      limit 50`,
    [aluno.comprador_id],
  );

  return NextResponse.json({ ok: true, encontrado: true, aluno, total_acoes: timeline.length, timeline });
}
