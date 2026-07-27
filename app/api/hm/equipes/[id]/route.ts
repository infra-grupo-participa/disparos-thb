import { NextResponse } from "next/server";
import { guard } from "@/lib/guard";
import { query, queryOne } from "@/lib/db";
import { parseBody, EquipePatchSchema } from "@/lib/validators";

export const runtime = "nodejs";

// PATCH /api/hm/equipes/[id] — edita nome/cor/ativo de uma equipe. Não muda o
// tipo (principal é única e definida no seed). Desativar não apaga: a rota do
// canal e os cards seguem apontando, mas some do seletor.
export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const g = await guard({ portal: "HM", nivel: "master" });
  if (!g.ok) return g.res;
  const p = await parseBody(req, EquipePatchSchema);
  if (!p.ok) return p.res;

  const sets: string[] = [];
  const vals: unknown[] = [params.id];
  if (p.data.nome !== undefined) { sets.push(`nome = $${vals.length + 1}`); vals.push(p.data.nome.trim()); }
  if (p.data.cor !== undefined) { sets.push(`cor = $${vals.length + 1}`); vals.push(p.data.cor); }
  if (p.data.ativo !== undefined) { sets.push(`ativo = $${vals.length + 1}`); vals.push(p.data.ativo); }
  if (!sets.length) return NextResponse.json({ ok: true });

  await query(`update cs.equipes set ${sets.join(", ")}, atualizado_em = now() where id = $1`, vals);
  const eq = await queryOne(`select id, nome, tipo, cor, ativo from cs.equipes where id = $1`, [params.id]);
  return NextResponse.json({ ok: true, equipe: eq });
}
