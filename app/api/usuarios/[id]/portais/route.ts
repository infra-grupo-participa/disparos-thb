import { NextResponse } from "next/server";
import { getSessao } from "@/lib/auth";
import { podeGerirAcesso } from "@/lib/papeis";
import { query } from "@/lib/db";
import { parseBody, UsuarioPortaisSchema } from "@/lib/validators";

export const runtime = "nodejs";

// PATCH /api/usuarios/[id]/portais — define a whitelist de portais de uma conta
// (0145). Só o admin do Grupo Participa gere isso (podeGerirAcesso = admin + GP).
// Recebe a lista COMPLETA e substitui (delete + insert) — simples e idempotente.
export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const sessao = await getSessao();
  if (!sessao) return NextResponse.json({ ok: false }, { status: 401 });
  if (!podeGerirAcesso(sessao.papel, sessao.equipe_tipo)) {
    return NextResponse.json({ ok: false, reason: "forbidden" }, { status: 403 });
  }
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
