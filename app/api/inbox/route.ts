import { NextResponse } from "next/server";
import { isAuthed } from "@/lib/auth";
import { query } from "@/lib/db";

export const runtime = "nodejs";

// GET /api/inbox — fila de conversas: contatos HT que já responderam,
// ordenados pela última resposta, com prévia da última mensagem do lead.
export async function GET() {
  if (!isAuthed()) return NextResponse.json({ ok: false }, { status: 401 });

  const conversas = await query(
    `select v.comprador_id, v.nome, v.telefone, v.edicao,
            v.estagio_chave, v.estagio_nome, v.ultima_resposta_em, v.ultimo_contato_em,
            (select i.descricao from cs.interacoes i
               where i.contato_id = ct.id and i.tipo = 'resposta'
               order by i.criado_em desc limit 1) as ultima_msg
       from cs.contatos_ht v
       join cs.contatos ct on ct.comprador_id = v.comprador_id
      where v.ultima_resposta_em is not null
      order by v.ultima_resposta_em desc
      limit 100`,
  );

  return NextResponse.json({ ok: true, conversas });
}
