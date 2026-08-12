import { NextResponse } from "next/server";
import { guard } from "@/lib/guard";
import { query } from "@/lib/db";
import { parseBody, UsuarioPatchSchema } from "@/lib/validators";

export const runtime = "nodejs";

// PATCH /api/usuarios/[id] — edita nome/papel/ativo. Gerir CONTAS/papéis é do
// MASTER (admin do Grupo Participa). Um admin/gestor de equipe COMUM NÃO mexe em
// conta nenhuma — cada equipe é independente; só a principal gere.
export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const g = await guard({ nivel: "master" });
  if (!g.ok) return g.res;
  const sessao = g.sessao;

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
            gerente_distribuidor = coalesce($5, gerente_distribuidor),
            atualizado_em = now()
      where id = $1`,
    [params.id, b.nome ?? null, b.papel ?? null, b.ativo ?? null, b.gerente_distribuidor ?? null],
  );
  return NextResponse.json({ ok: true });
}
