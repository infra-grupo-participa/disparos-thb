import { NextResponse } from "next/server";
import { isAuthed } from "@/lib/auth";
import { query } from "@/lib/db";

export const runtime = "nodejs";

// GET /api/hm/agendamentos — reúne reuniões (Comercial) e entrevistas (Ativação)
// marcadas, com data/hora, aluno, responsável e resultado. Página dedicada.
export async function GET(req: Request) {
  if (!isAuthed()) return NextResponse.json({ ok: false }, { status: 401 });
  const sp = new URL(req.url).searchParams;
  const tipo = sp.get("tipo"); // 'reuniao' | 'entrevista' | null (ambos)

  const rows = await query(
    `select comprador_id, nome, telefone, plano, responsavel, estagio_nome,
            'reuniao'::text as tipo, reuniao_em as quando, reuniao_resultado as resultado
       from cs.contatos_hm_kanban
      where reuniao_em is not null and ($1::text is null or $1 = 'reuniao')
     union all
     select comprador_id, nome, telefone, plano, responsavel, estagio_nome,
            'entrevista'::text as tipo, entrevista_em as quando, entrevista_resultado as resultado
       from cs.contatos_hm_kanban
      where entrevista_em is not null and ($1::text is null or $1 = 'entrevista')
     order by quando asc nulls last`,
    [tipo],
  );

  return NextResponse.json({ ok: true, agendamentos: rows });
}
