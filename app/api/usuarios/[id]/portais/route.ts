import { NextResponse } from "next/server";
import { guard } from "@/lib/guard";
import { query } from "@/lib/db";
import { parseBody, UsuarioPortaisSchema } from "@/lib/validators";

export const runtime = "nodejs";

// PATCH /api/usuarios/[id]/portais — define a whitelist de portais de uma conta
// (0145). Só o MASTER (admin do Grupo Participa) gere isso.
// Recebe a lista COMPLETA e substitui (delete + insert) — simples e idempotente.
export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const g = await guard({ nivel: "master" });
  if (!g.ok) return g.res;
  const p = await parseBody(req, UsuarioPortaisSchema);
  if (!p.ok) return p.res;

  await query(`delete from cs.usuario_portais where usuario_id = $1`, [params.id]);
  if (p.data.portais.length > 0) {
    await query(
      `insert into cs.usuario_portais (usuario_id, portal)
       select $1, unnest($2::text[]) on conflict do nothing`,
      [params.id, p.data.portais],
    );
  }
  return NextResponse.json({ ok: true });
}
