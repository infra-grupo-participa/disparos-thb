import { NextResponse } from "next/server";
import { isAuthed } from "@/lib/auth";
import { query } from "@/lib/db";

export const runtime = "nodejs";

// GET /api/hm/estagios — etapas HM (com a aba) para os seletores.
export async function GET() {
  if (!isAuthed()) return NextResponse.json({ ok: false }, { status: 401 });
  const estagios = await query(
    `select chave, nome, ordem, cor, aba, is_inicial, is_final
       from cs.estagios where ativo and evento = 'HM' order by ordem`,
  );
  return NextResponse.json({ ok: true, estagios });
}
