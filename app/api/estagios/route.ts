import { NextResponse } from "next/server";
import { isAuthed } from "@/lib/auth";
import { query } from "@/lib/db";
import { eventoDe } from "@/lib/services/evento";

export const runtime = "nodejs";

export async function GET(req: Request) {
  if (!isAuthed()) {
    return NextResponse.json({ ok: false, reason: "unauthorized" }, { status: 401 });
  }
  const estagios = await query(
    `select id, chave, nome, ordem, cor, is_inicial, is_final
       from cs.estagios
      where ativo and evento = $1
      order by ordem`,
    [eventoDe(req)],
  );
  return NextResponse.json({ ok: true, estagios });
}
