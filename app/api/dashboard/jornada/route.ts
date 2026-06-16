import { NextResponse } from "next/server";
import { isAuthed } from "@/lib/auth";
import { query } from "@/lib/db";
import { eventoDe } from "@/lib/services/evento";

export const runtime = "nodejs";

// GET /api/dashboard/jornada?evento=&convertido=ativado — estratégia "3 ao cubo":
// para cada aluno, a SEQUÊNCIA de canais que o tocou (ordem do 1º toque de cada
// canal) e quanto cada sequência converte. Conversão = estágio atual do aluno
// igual ao alvo (default 'ativado'). Reconstruído de cs.interacoes.canal.
type LinhaJornada = { sequencia: string; alunos: number; convertidos: number };

export async function GET(req: Request) {
  if (!isAuthed()) return NextResponse.json({ ok: false }, { status: 401 });

  const evento = eventoDe(req);
  const convertido = new URL(req.url).searchParams.get("convertido") || "ativado";

  const linhas = await query<LinhaJornada>(
    `with primeiro as (
       select c.comprador_id, i.canal, min(i.criado_em) as t
         from cs.interacoes i
         join cs.contatos c on c.id = i.contato_id and c.evento = $1
        where i.canal is not null
        group by c.comprador_id, i.canal
     ),
     seq as (
       select comprador_id, string_agg(canal, ' → ' order by t) as sequencia
         from primeiro group by comprador_id
     )
     select s.sequencia,
            count(*)::int as alunos,
            count(*) filter (where v.estagio_chave = $2)::int as convertidos
       from seq s
       join cs.contatos_evento v on v.comprador_id = s.comprador_id and v.evento = $1
      group by s.sequencia
      order by alunos desc
      limit 40`,
    [evento, convertido],
  );

  const totais = linhas.reduce(
    (a, l) => ({ alunos: a.alunos + l.alunos, convertidos: a.convertidos + l.convertidos }),
    { alunos: 0, convertidos: 0 },
  );

  return NextResponse.json({ ok: true, convertido, totais, sequencias: linhas });
}
