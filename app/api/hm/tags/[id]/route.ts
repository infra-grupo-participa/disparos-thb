import { NextResponse } from "next/server";
import { guard } from "@/lib/guard";
import { parseBody, HmTagPatchSchema } from "@/lib/validators";
import { renomearTagHm, recolorirTagHm, descreverTagHm, recategorizarTagHm, excluirTagHm } from "@/lib/services/hm-tags";

export const runtime = "nodejs";

// PATCH/DELETE /api/hm/tags/[id] — renomear, recolorir, descrever, recategorizar,
// excluir. Só admin: renomear e excluir PROPAGAM para todos os cards (o serviço
// faz a troca no catálogo e nos arrays num statement só), e cor/descrição/
// categoria valem para todo mundo que usa a tag.
// Tags de sistema não se renomeiam nem se excluem — funções do banco gravam
// esses nomes literais, e um rename viraria órfão na próxima venda. Descrição
// e categoria, ao contrário, valem para QUALQUER tipo (ver recategorizarTagHm).
//
// ⚠️ Um PATCH sem nenhum campo reconhecido NÃO pode responder {ok:true} como
// se tivesse alterado algo — foi exatamente esse silêncio (parseBody descarta
// chave desconhecida, nenhum `if` roda, {ok:true} sai do mesmo jeito) que fez
// o admin editar a descrição da tag, ver "sucesso" e o texto sumir no reload
// seguinte. `alterado` conta quantos campos de fato bateram no banco: 0 vira
// 400 explícito em vez de sucesso mentiroso.
export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const g = await guard({ portal: "HM", nivel: "master" });
  if (!g.ok) return g.res;
  const p = await parseBody(req, HmTagPatchSchema);
  if (!p.ok) return p.res;

  let alterado = 0;

  if (p.data.nome !== undefined) {
    const ok = await renomearTagHm(params.id, p.data.nome);
    if (!ok) return NextResponse.json({ ok: false, reason: "não renomeável (tag de sistema, nome em uso ou prefixo reservado)" }, { status: 400 });
    alterado++;
  }
  if (p.data.cor !== undefined) {
    const ok = await recolorirTagHm(params.id, p.data.cor);
    if (!ok) return NextResponse.json({ ok: false, reason: "tag não encontrada" }, { status: 404 });
    alterado++;
  }
  if (p.data.descricao !== undefined) {
    // "" normalizado para null: limpar o texto é gesto legítimo, não um valor
    // vazio sobrando no banco (ver comentário do schema em lib/validators.ts).
    const ok = await descreverTagHm(params.id, p.data.descricao || null);
    if (!ok) return NextResponse.json({ ok: false, reason: "tag não encontrada" }, { status: 404 });
    alterado++;
  }
  if (p.data.categoria !== undefined) {
    const ok = await recategorizarTagHm(params.id, p.data.categoria);
    if (!ok) return NextResponse.json({ ok: false, reason: "tag não encontrada" }, { status: 404 });
    alterado++;
  }

  if (alterado === 0) {
    return NextResponse.json({ ok: false, reason: "nenhum campo reconhecido no PATCH — nada foi alterado" }, { status: 400 });
  }
  return NextResponse.json({ ok: true });
}

export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  const g = await guard({ portal: "HM", nivel: "master" });
  if (!g.ok) return g.res;
  const ok = await excluirTagHm(params.id);
  if (!ok) return NextResponse.json({ ok: false, reason: "não excluível (tag de sistema)" }, { status: 400 });
  return NextResponse.json({ ok: true });
}
