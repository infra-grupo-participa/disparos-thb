import { NextResponse } from "next/server";
import { guard } from "@/lib/guard";
import { query, queryOne } from "@/lib/db";
import { parseBody, CanalCriarSchema } from "@/lib/validators";
import { limparCacheCanais } from "@/lib/services/canais";

export const runtime = "nodejs";

// GET /api/canais — lista os canais de disparo (admin). A chave de API nunca é
// devolvida em claro: só os 4 últimos dígitos, para conferência.
export async function GET() {
  const g = await guard({ nivel: "master" });
  if (!g.ok) return g.res;

  const canais = await query(
    `select c.id, c.evento_chave, e.nome as evento_nome, c.nome, c.provider,
            c.base_url, c.numero, c.ativo, c.atualizado_em,
            '••••••' || right(c.api_key, 4) as api_key_mascarada
       from cs.canais_disparo c
       left join cs.eventos e on e.chave = c.evento_chave
      order by c.evento_chave, c.ativo desc, c.nome`,
  );
  const eventos = await query(`select chave, nome from cs.eventos where ativo order by ordem, nome`);
  return NextResponse.json({ ok: true, canais, eventos });
}

// POST /api/canais — cria um canal (admin). Se criado ativo, desativa os demais
// do mesmo evento/provider (o índice único garante 1 ativo por evento+provider).
export async function POST(req: Request) {
  const g = await guard({ nivel: "master" });
  if (!g.ok) return g.res;

  const p = await parseBody(req, CanalCriarSchema);
  if (!p.ok) return p.res;
  const { evento_chave, nome, provider, api_key } = p.data;
  const base_url = p.data.base_url ? p.data.base_url : null;
  const numero = p.data.numero || null;

  await query(`update cs.canais_disparo set ativo = false, atualizado_em = now() where evento_chave = $1 and provider = $2 and ativo`, [evento_chave, provider]);
  const novo = await queryOne<{ id: string }>(
    `insert into cs.canais_disparo (evento_chave, nome, provider, base_url, api_key, numero, ativo)
     values ($1, $2, $3, $4, $5, $6, true) returning id`,
    [evento_chave, nome, provider, base_url, api_key, numero],
  );
  limparCacheCanais();
  return NextResponse.json({ ok: true, id: novo?.id });
}
