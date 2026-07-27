import { NextResponse } from "next/server";
import { guard } from "@/lib/guard";
import { query, queryOne } from "@/lib/db";
import { eventoDe } from "@/lib/services/evento";

export const runtime = "nodejs";

export async function GET(req: Request, { params }: { params: { id: string } }) {
  const g = await guard({ portal: eventoDe(req) });
  if (!g.ok) return g.res;

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
    `select dc.id, dc.comprador_id, dc.telefone, dc.enviado, dc.respondeu, dc.erro,
            dc.contato_criado, dc.erro_contato, dc.status_meta, dc.erro_meta_code, dc.enviado_em, v.nome
       from cs.disparo_contatos dc
       left join cs.contatos_evento v on v.comprador_id = dc.comprador_id
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
