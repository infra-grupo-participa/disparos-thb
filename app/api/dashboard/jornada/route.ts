import { NextResponse } from "next/server";
import { isAuthed } from "@/lib/auth";
import { query } from "@/lib/db";
import { eventoDe } from "@/lib/services/evento";

export const runtime = "nodejs";

// GET /api/dashboard/jornada?evento=&convertido=ativado — estratégia "3 ao cubo":
// matriz 3×3 dos canais (1º contato × 2º contato) com a taxa de conversão de
// cada combinação. Conversão = estágio atual do aluno = alvo (default 'ativado').
// Reconstrói o 1º e o 2º toque de cada aluno a partir de cs.interacoes.canal.
type Par = { c1: string; c2: string; alunos: number; convertidos: number };

export async function GET(req: Request) {
  if (!isAuthed()) return NextResponse.json({ ok: false }, { status: 401 });

  const evento = eventoDe(req);
  const convertido = new URL(req.url).searchParams.get("convertido") || "ativado";

  const pares = await query<Par>(
    `with toques as (
       select c.comprador_id, i.canal,
              row_number() over (partition by c.comprador_id order by i.criado_em, i.id) as rn
         from cs.interacoes i
         join cs.contatos c on c.id = i.contato_id and c.evento = $1
        where i.canal is not null
     ),
     par as (
       select t1.comprador_id, t1.canal as c1, t2.canal as c2
         from toques t1
         join toques t2 on t2.comprador_id = t1.comprador_id and t2.rn = 2
        where t1.rn = 1
     )
     select p.c1, p.c2,
            count(*)::int as alunos,
            count(*) filter (where v.estagio_chave = $2)::int as convertidos
       from par p
       join cs.contatos_evento v on v.comprador_id = p.comprador_id and v.evento = $1
      group by p.c1, p.c2`,
    [evento, convertido],
  );

  const totais = pares.reduce(
    (a, l) => ({ alunos: a.alunos + l.alunos, convertidos: a.convertidos + l.convertidos }),
    { alunos: 0, convertidos: 0 },
  );

  return NextResponse.json({ ok: true, convertido, totais, pares });
}
