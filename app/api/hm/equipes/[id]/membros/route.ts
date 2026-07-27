import { NextResponse } from "next/server";
import { getSessao } from "@/lib/auth";
import { podeVerTudo } from "@/lib/papeis";
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
  if (!podeVerTudo(sessao.papel, sessao.equipe_tipo)) {
    return NextResponse.json({ ok: false, reason: "forbidden" }, { status: 403 });
  }
  const p = await parseBody(req, EquipeMembroSchema);
  if (!p.ok) return p.res;
  const { usuario_id, acao, papel } = p.data;

  // Vincular = aponta o usuário para esta equipe; remover = tira da equipe (volta
  // a não ter equipe). O cargo é opcional e vale para os dois casos.
  const equipeId = acao === "remover" ? null : params.id;
  const sets: string[] = ["equipe_id = $2"];
  const vals: unknown[] = [usuario_id, equipeId];
  if (papel !== undefined) { sets.push(`papel = $${vals.length + 1}`); vals.push(papel); }
  sets.push("atualizado_em = now()");
  await query(`update cs.usuarios set ${sets.join(", ")} where id = $1`, vals);
  return NextResponse.json({ ok: true });
}
