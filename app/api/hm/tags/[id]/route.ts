import { NextResponse } from "next/server";
import { getSessao } from "@/lib/auth";
import { parseBody, HmTagPatchSchema } from "@/lib/validators";
import { renomearTagHm, recolorirTagHm, excluirTagHm } from "@/lib/services/hm-tags";

export const runtime = "nodejs";

// PATCH/DELETE /api/hm/tags/[id] — renomear, recolorir, excluir. Só admin:
// renomear e excluir PROPAGAM para todos os cards (o serviço faz a troca no
// catálogo e nos arrays num statement só), e a cor vale para todo mundo.
// Tags de sistema não se renomeiam nem se excluem — funções do banco gravam
// esses nomes literais, e um rename viraria órfão na próxima venda.
export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const sessao = await getSessao();
  if (!sessao) return NextResponse.json({ ok: false }, { status: 401 });
  if (sessao.papel !== "admin") return NextResponse.json({ ok: false, reason: "só admin altera o catálogo" }, { status: 403 });
  const p = await parseBody(req, HmTagPatchSchema);
  if (!p.ok) return p.res;

  if (p.data.nome !== undefined) {
    const ok = await renomearTagHm(params.id, p.data.nome);
    if (!ok) return NextResponse.json({ ok: false, reason: "não renomeável (tag de sistema, nome em uso ou prefixo reservado)" }, { status: 400 });
  }
  if (p.data.cor !== undefined) {
    const ok = await recolorirTagHm(params.id, p.data.cor);
    if (!ok) return NextResponse.json({ ok: false, reason: "tag não encontrada" }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}

export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  const sessao = await getSessao();
  if (!sessao) return NextResponse.json({ ok: false }, { status: 401 });
  if (sessao.papel !== "admin") return NextResponse.json({ ok: false, reason: "só admin altera o catálogo" }, { status: 403 });
  const ok = await excluirTagHm(params.id);
  if (!ok) return NextResponse.json({ ok: false, reason: "não excluível (tag de sistema)" }, { status: 400 });
  return NextResponse.json({ ok: true });
}
