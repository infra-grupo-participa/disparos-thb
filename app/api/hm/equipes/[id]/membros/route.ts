import { NextResponse } from "next/server";
import { getSessao } from "@/lib/auth";
import { podeGerirAcesso } from "@/lib/papeis";
import { query } from "@/lib/db";
import { parseBody, EquipeMembroSchema } from "@/lib/validators";

export const runtime = "nodejs";

// PATCH /api/hm/equipes/[id]/membros — move um usuário PARA esta equipe (ou tira
// dele, se equipe_id do path for tratado como remoção via acao='remover') e,
// opcionalmente, define o cargo (papel) do membro. É o "definir quem é cada tipo
// de operador" do ADM: operador (normal) x disparador (operador de disparos).
export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const sessao = await getSessao();
  if (!sessao) return NextResponse.json({ ok: false }, { status: 401 });
  if (!podeGerirAcesso(sessao.papel, sessao.equipe_tipo)) {
    return NextResponse.json({ ok: false, reason: "forbidden" }, { status: 403 });
  }
  const p = await parseBody(req, EquipeMembroSchema);
  if (!p.ok) return p.res;
  const { usuario_id, acao, papel, lider_equipe } = p.data;

  // Vincular = aponta o usuário para esta equipe; remover = tira da equipe (volta
  // a não ter equipe). Cargo e "líder da equipe" são opcionais. Remover zera o
  // lider_equipe junto (não faz sentido ser líder de equipe nenhuma).
  const equipeId = acao === "remover" ? null : params.id;
  const sets: string[] = ["equipe_id = $2"];
  const vals: unknown[] = [usuario_id, equipeId];
  if (papel !== undefined) { sets.push(`papel = $${vals.length + 1}`); vals.push(papel); }
  if (acao === "remover") { sets.push("lider_equipe = false"); }
  else if (lider_equipe !== undefined) { sets.push(`lider_equipe = $${vals.length + 1}`); vals.push(lider_equipe); }
  sets.push("atualizado_em = now()");
  await query(`update cs.usuarios set ${sets.join(", ")} where id = $1`, vals);
  return NextResponse.json({ ok: true });
}
