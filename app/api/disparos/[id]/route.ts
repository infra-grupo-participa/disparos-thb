import { NextResponse } from "next/server";
import { isAuthed } from "@/lib/auth";
import { query, queryOne } from "@/lib/db";

export const runtime = "nodejs";

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  if (!isAuthed()) return NextResponse.json({ ok: false }, { status: 401 });

  const disparo = await queryOne(
    `select d.id, d.status, d.fase, d.total_enviados, d.total_respondidos, d.total_contatos_criados,
            d.edicao_ht, d.iniciado_em, d.concluido_em, t.nome as template_nome
       from cs.disparos d
       left join cs.templates t on t.id = d.template_id
      where d.id = $1`,
    [params.id],
  );
  if (!disparo) return NextResponse.json({ ok: false, reason: "não encontrado" }, { status: 404 });

  const contatos = await query(
    `select dc.id, dc.telefone, dc.enviado, dc.respondeu, dc.erro,
            dc.contato_criado, dc.erro_contato, dc.enviado_em, v.nome
       from cs.disparo_contatos dc
       left join cs.contatos_ht v on v.comprador_id = dc.comprador_id
      where dc.disparo_id = $1
      order by dc.enviado_em nulls last, dc.id`,
    [params.id],
  );

  const total = contatos.length;
  const criados = contatos.filter((c) => (c as { contato_criado: boolean }).contato_criado).length;
  const enviados = contatos.filter((c) => (c as { enviado: boolean }).enviado).length;
  const erros = contatos.filter((c) => (c as { erro: string | null }).erro).length;

  return NextResponse.json({ ok: true, disparo, contatos, resumo: { total, criados, enviados, erros } });
}
