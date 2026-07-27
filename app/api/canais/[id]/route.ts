import { NextResponse } from "next/server";
import { guard } from "@/lib/guard";
import { query, queryOne } from "@/lib/db";
import { parseBody, CanalPatchSchema } from "@/lib/validators";
import { limparCacheCanais } from "@/lib/services/canais";

export const runtime = "nodejs";

// PATCH /api/canais/[id] — edita um canal (admin): troca a chave/número/nome ou
// ativa/desativa. Ao ativar, desativa os demais do mesmo evento/provider.
export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const g = await guard({ nivel: "master" });
  if (!g.ok) return g.res;

  const p = await parseBody(req, CanalPatchSchema);
  if (!p.ok) return p.res;
  const b = p.data;

  const canal = await queryOne<{ evento_chave: string; provider: string }>(
    `select evento_chave, provider from cs.canais_disparo where id = $1`,
    [params.id],
  );
  if (!canal) return NextResponse.json({ ok: false, reason: "nao_encontrado" }, { status: 404 });

  // Ao ativar este canal, garante que seja o único ativo do evento/provider.
  if (b.ativo === true) {
    await query(`update cs.canais_disparo set ativo = false, atualizado_em = now() where evento_chave = $1 and provider = $2 and id <> $3 and ativo`, [canal.evento_chave, canal.provider, params.id]);
  }

  await query(
    `update cs.canais_disparo set
        nome     = coalesce($2, nome),
        api_key  = coalesce($3, api_key),
        base_url = case when $4::text is not null then nullif($4, '') else base_url end,
        numero   = case when $5::text is not null then nullif($5, '') else numero end,
        ativo    = coalesce($6, ativo),
        atualizado_em = now()
      where id = $1`,
    [params.id, b.nome ?? null, b.api_key ?? null, b.base_url ?? null, b.numero ?? null, b.ativo ?? null],
  );
  limparCacheCanais();
  return NextResponse.json({ ok: true });
}
