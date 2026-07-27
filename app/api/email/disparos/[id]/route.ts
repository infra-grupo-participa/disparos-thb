import { NextResponse } from "next/server";
import { guard } from "@/lib/guard";
import { query, queryOne } from "@/lib/db";
import { eventoDe } from "@/lib/services/evento";

export const runtime = "nodejs";

// GET /api/email/disparos/[id] — progresso de um disparo de e-mail (para o
// polling da UI). Espelha GET /api/disparos/[id].
export async function GET(req: Request, { params }: { params: { id: string } }) {
  const g = await guard({ portal: eventoDe(req) });
  if (!g.ok) return g.res;

  const disparo = await queryOne<{
    status: string; total_contatos: number; total_enviados: number; total_erros: number; evento: string;
  }>(
    `select status, total_contatos, total_enviados, total_erros, evento
       from cs.disparos_email where id = $1`,
    [params.id],
  );
  if (!disparo) return NextResponse.json({ ok: false, reason: "não encontrado" }, { status: 404 });

  const contatos = await query<{
    id: string; comprador_id: string | null; nome: string | null; email: string;
    enviado: boolean; erro: string | null; enviado_em: string | null;
  }>(
    `select dec.id, dec.comprador_id, v.nome, dec.email, dec.enviado, dec.erro, dec.enviado_em
       from cs.disparo_email_contatos dec
       left join cs.contatos_evento v on v.comprador_id = dec.comprador_id and v.evento = $2
      where dec.disparo_id = $1
      order by dec.enviado desc, dec.erro nulls last`,
    [params.id, disparo.evento],
  );

  const resumo = {
    total: disparo.total_contatos,
    enviados: disparo.total_enviados,
    erros: disparo.total_erros,
  };
  return NextResponse.json({ ok: true, disparo, resumo, contatos });
}
