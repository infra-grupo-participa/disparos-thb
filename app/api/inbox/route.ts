import { NextResponse } from "next/server";
import { isAuthed } from "@/lib/auth";
import { query, queryOne } from "@/lib/db";

export const runtime = "nodejs";

// GET /api/inbox — fila de conversas: contatos HT que já responderam.
// Pendentes (aguardando o CS) sobem ao topo; ?status filtra a fila.
export async function GET(req: Request) {
  if (!isAuthed()) return NextResponse.json({ ok: false }, { status: 401 });
  const status = new URL(req.url).searchParams.get("status") || null; // pendente | resolvido

  const conversas = await query(
    `select v.comprador_id, v.nome, v.telefone, v.edicao,
            v.estagio_chave, v.estagio_nome, v.ultima_resposta_em, v.ultimo_contato_em,
            ct.inbox_status, ct.aguardando_desde, ct.opt_out, ct.responsavel,
            (select i.descricao from cs.interacoes i
               where i.contato_id = ct.id and i.tipo = 'resposta'
               order by i.criado_em desc limit 1) as ultima_msg
       from cs.contatos_ht v
       join cs.contatos ct on ct.comprador_id = v.comprador_id
      where v.ultima_resposta_em is not null
        and ($1::text is null or ct.inbox_status = $1)
      order by (ct.inbox_status = 'pendente') desc,
               coalesce(ct.aguardando_desde, v.ultima_resposta_em) desc
      limit 100`,
    [status],
  );

  const resumo = await queryOne<{ pendentes: number }>(
    `select count(*) filter (where inbox_status = 'pendente')::int as pendentes from cs.contatos`,
  );

  return NextResponse.json({ ok: true, conversas, pendentes: resumo?.pendentes ?? 0 });
}
