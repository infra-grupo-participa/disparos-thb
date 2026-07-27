import { NextResponse } from "next/server";
import { guard } from "@/lib/guard";
import { query } from "@/lib/db";

export const runtime = "nodejs";

// GET /api/hm/estagios — etapas HM (com a aba) para os seletores.
export async function GET() {
  const g = await guard({ portal: "HM" });
  if (!g.ok) return g.res;
  const estagios = await query(
    `select chave, nome, ordem, cor, aba, is_inicial, is_final
       from cs.estagios where ativo and evento = 'HM' order by ordem`,
  );
  return NextResponse.json({ ok: true, estagios });
}
