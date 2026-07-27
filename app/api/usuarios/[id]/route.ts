import { NextResponse } from "next/server";
import { getSessao } from "@/lib/auth";
import { podeGerirAcesso } from "@/lib/papeis";
import { query } from "@/lib/db";
import { parseBody, UsuarioPatchSchema } from "@/lib/validators";

export const runtime = "nodejs";

// PATCH /api/usuarios/[id] — edita nome/papel/ativo. Gerir CONTAS/papéis é do admin
// do Grupo Participa (podeGerirAcesso = admin + GP). Um admin de equipe COMUM (ex.:
// Kelly) NÃO mexe em conta nenhuma — cada equipe é independente; só a principal gere.
export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const sessao = await getSessao();
  if (!sessao) return NextResponse.json({ ok: false }, { status: 401 });
  if (!podeGerirAcesso(sessao.papel, sessao.equipe_tipo)) return NextResponse.json({ ok: false, reason: "forbidden" }, { status: 403 });

  const p = await parseBody(req, UsuarioPatchSchema);
  if (!p.ok) return p.res;
  const b = p.data;

  // Trava de segurança: o admin não pode se auto-rebaixar nem se desativar
  // (evita ficar trancado para fora / sem nenhum admin).
  if (params.id === sessao.id) {
    if (b.ativo === false) return NextResponse.json({ ok: false, reason: "nao_pode_desativar_a_si" }, { status: 400 });
    if (b.papel && b.papel !== "admin") return NextResponse.json({ ok: false, reason: "nao_pode_rebaixar_a_si" }, { status: 400 });
  }

  await query(
    `update cs.usuarios
        set nome  = coalesce($2, nome),
            papel = coalesce($3, papel),
            ativo = coalesce($4, ativo),
            atualizado_em = now()
      where id = $1`,
    [params.id, b.nome ?? null, b.papel ?? null, b.ativo ?? null],
  );
  return NextResponse.json({ ok: true });
}
