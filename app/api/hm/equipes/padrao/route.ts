import { NextResponse } from "next/server";
import { guard } from "@/lib/guard";
import { query, queryOne } from "@/lib/db";
import { parseBody, EquipePadraoSchema } from "@/lib/validators";

export const runtime = "nodejs";

// Equipe padrão do board HM (0146): para onde TODA venda HM nova cai por padrão.
// A equipe é carimbada no card no momento em que ele nasce (trigger no banco) —
// afeta só compras "de agora em diante", os cards já existentes no pool ficam
// como estão. Config global: só o master (admin do GP) vê/edita.

// GET /api/hm/equipes/padrao — a equipe padrão vigente (ou null).
export async function GET() {
  const g = await guard({ portal: "HM", nivel: "master" });
  if (!g.ok) return g.res;
  const row = await queryOne<{ equipe_id: string | null; equipe_nome: string | null; equipe_cor: string | null }>(
    `select c.equipe_padrao_id as equipe_id, e.nome as equipe_nome, e.cor as equipe_cor
       from cs.hm_config c left join cs.equipes e on e.id = c.equipe_padrao_id
      where c.id = 1`,
  );
  return NextResponse.json({
    ok: true,
    equipe_id: row?.equipe_id ?? null,
    equipe_nome: row?.equipe_nome ?? null,
    equipe_cor: row?.equipe_cor ?? null,
  });
}

// PUT /api/hm/equipes/padrao — define (uuid) ou limpa (null) a equipe padrão.
export async function PUT(req: Request) {
  const g = await guard({ portal: "HM", nivel: "master" });
  if (!g.ok) return g.res;
  const p = await parseBody(req, EquipePadraoSchema);
  if (!p.ok) return p.res;
  const { equipe_id } = p.data;

  // Garante a linha singleton e grava (o carimbo nos cards só ocorre na criação
  // de novos cards; mudar aqui NÃO remexe nos cards que já nasceram).
  await query(
    `insert into cs.hm_config (id, equipe_padrao_id, atualizado_em)
       values (1, $1, now())
     on conflict (id) do update set equipe_padrao_id = excluded.equipe_padrao_id, atualizado_em = now()`,
    [equipe_id],
  );
  return NextResponse.json({ ok: true });
}
