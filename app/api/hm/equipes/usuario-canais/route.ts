import { NextResponse } from "next/server";
import { guard } from "@/lib/guard";
import { query } from "@/lib/db";
import { parseBody, UsuarioCanalSchema } from "@/lib/validators";

export const runtime = "nodejs";

// Canal de aquisição → PESSOA (0154): qual operador "cuida" de qual canal. O
// operador vê E age nos cards com essa tag, além do pool e dos próprios. É o
// recorte por pessoa que complementa o canal→equipe (equipe_canais). Config
// global do board: só o master (mesmo gate das rotas de equipe).

// GET /api/hm/equipes/usuario-canais — os vínculos atuais + os canais que
// existem nos cards (mesma régua da tela de rotas), para o admin escolher.
export async function GET() {
  const g = await guard({ portal: "HM", nivel: "master" });
  if (!g.ok) return g.res;
  const vinculos = await query(
    `select uc.usuario_id, uc.canal, u.nome as usuario_nome
       from cs.usuario_canais uc join cs.usuarios u on u.id = uc.usuario_id
      order by u.nome, uc.canal`,
  );
  const canais = await query<{ canal: string }>(
    `select distinct t as canal from cs.contatos_hm, unnest(tags) t
      where t !~ '^(Origem|Turma|Aurum) ' order by t`,
  );
  return NextResponse.json({ ok: true, vinculos, canais: canais.map((c) => c.canal) });
}

// PUT /api/hm/equipes/usuario-canais — cria (acao=vincular) ou remove
// (acao=remover) o vínculo de um canal a uma pessoa.
export async function PUT(req: Request) {
  const g = await guard({ portal: "HM", nivel: "master" });
  if (!g.ok) return g.res;
  const p = await parseBody(req, UsuarioCanalSchema);
  if (!p.ok) return p.res;
  const { usuario_id, canal, acao } = p.data;

  if (acao === "remover") {
    await query(`delete from cs.usuario_canais where usuario_id = $1 and canal = $2`, [usuario_id, canal]);
  } else {
    await query(
      `insert into cs.usuario_canais (usuario_id, canal) values ($1, $2) on conflict do nothing`,
      [usuario_id, canal],
    );
  }
  return NextResponse.json({ ok: true });
}
