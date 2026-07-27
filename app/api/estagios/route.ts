import { NextResponse } from "next/server";
import { guard } from "@/lib/guard";
import { query } from "@/lib/db";
import { eventoDe } from "@/lib/services/evento";

export const runtime = "nodejs";

export async function GET(req: Request) {
  // Portal do evento RESOLVIDO (cookie/query) contra a whitelist da conta (0145).
  const g = await guard({ portal: eventoDe(req) });
  if (!g.ok) return g.res;
  const estagios = await query(
    `select id, chave, nome, ordem, cor, is_inicial, is_final
       from cs.estagios
      where ativo and evento = $1
      order by ordem`,
    [eventoDe(req)],
  );
  return NextResponse.json({ ok: true, estagios });
}
