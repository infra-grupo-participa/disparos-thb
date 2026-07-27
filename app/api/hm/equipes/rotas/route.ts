import { NextResponse } from "next/server";
import { getSessao } from "@/lib/auth";
import { podeGerirAcesso } from "@/lib/papeis";
import { query } from "@/lib/db";
import { parseBody, EquipeRotaSchema } from "@/lib/validators";

export const runtime = "nodejs";

// Roteamento canal -> equipe: qual canal de aquisição "cai" direto para qual
// equipe (o card nasce dela, pulando o pool). HT29 começa hardcoded no seed; o
// resto se edita aqui. Só quem vê tudo (GP/admin).

// GET /api/hm/equipes/rotas — o mapa atual + os canais que existem nos cards
// (para o ADM escolher o que rotear).
export async function GET() {
  const sessao = await getSessao();
  if (!sessao) return NextResponse.json({ ok: false }, { status: 401 });
  if (!podeGerirAcesso(sessao.papel, sessao.equipe_tipo)) {
    return NextResponse.json({ ok: false, reason: "forbidden" }, { status: 403 });
  }
  const rotas = await query(
    `select ec.canal, ec.equipe_id, e.nome as equipe_nome, e.cor as equipe_cor
       from cs.equipe_canais ec join cs.equipes e on e.id = ec.equipe_id
      order by ec.canal`,
  );
  // Canais (tags) que aparecem nos cards, tirando turma/origem/aurum — a mesma
  // régua da tela de canais. Serve de sugestão para rotear.
  const canais = await query<{ canal: string }>(
    `select distinct t as canal from cs.contatos_hm, unnest(tags) t
      where t !~ '^(Origem|Turma|Aurum) ' order by t`,
  );
  return NextResponse.json({ ok: true, rotas, canais: canais.map((c) => c.canal) });
}

// PUT /api/hm/equipes/rotas — define (upsert) ou remove (equipe_id null) a rota
// de um canal.
export async function PUT(req: Request) {
  const sessao = await getSessao();
  if (!sessao) return NextResponse.json({ ok: false }, { status: 401 });
  if (!podeGerirAcesso(sessao.papel, sessao.equipe_tipo)) {
    return NextResponse.json({ ok: false, reason: "forbidden" }, { status: 403 });
  }
  const p = await parseBody(req, EquipeRotaSchema);
  if (!p.ok) return p.res;
  const { canal, equipe_id } = p.data;

  if (equipe_id === null) {
    await query(`delete from cs.equipe_canais where canal = $1`, [canal]);
  } else {
    await query(
      `insert into cs.equipe_canais (canal, equipe_id) values ($1, $2)
       on conflict (canal) do update set equipe_id = excluded.equipe_id`,
      [canal, equipe_id],
    );
  }
  return NextResponse.json({ ok: true });
}
