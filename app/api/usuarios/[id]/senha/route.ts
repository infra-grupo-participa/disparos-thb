import { NextResponse } from "next/server";
import { getSessao, hashSenha, verifySenha } from "@/lib/auth";
import { podeGerirAcesso } from "@/lib/papeis";
import { query, queryOne } from "@/lib/db";
import { parseBody, SenhaSchema } from "@/lib/validators";

export const runtime = "nodejs";

// PATCH /api/usuarios/[id]/senha — redefinição de senha.
//  • Admin do GP redefine a senha de qualquer usuário (sem exigir a atual).
//  • O próprio usuário troca a sua, informando a senha atual.
//  Um admin de equipe COMUM (Kelly) NÃO redefine senha de terceiros.
export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const sessao = await getSessao();
  if (!sessao) return NextResponse.json({ ok: false }, { status: 401 });

  const ehDono = params.id === sessao.id;
  const ehAdmin = podeGerirAcesso(sessao.papel, sessao.equipe_tipo);
  if (!ehDono && !ehAdmin) return NextResponse.json({ ok: false, reason: "forbidden" }, { status: 403 });

  const p = await parseBody(req, SenhaSchema);
  if (!p.ok) return p.res;

  // Usuário trocando a própria senha precisa confirmar a senha atual.
  // (Admin redefinindo a de outro não precisa.)
  if (ehDono && !ehAdmin) {
    const atual = await queryOne<{ senha_hash: string }>(
      `select senha_hash from cs.usuarios where id = $1`,
      [params.id],
    );
    if (!atual || !verifySenha(p.data.atualSenha ?? "", atual.senha_hash)) {
      return NextResponse.json({ ok: false, reason: "senha_atual_incorreta" }, { status: 400 });
    }
  }

  await query(
    `update cs.usuarios set senha_hash = $2, atualizado_em = now() where id = $1`,
    [params.id, hashSenha(p.data.novaSenha)],
  );
  return NextResponse.json({ ok: true });
}
