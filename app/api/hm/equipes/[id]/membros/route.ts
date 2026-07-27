import { NextResponse } from "next/server";
import { guard } from "@/lib/guard";
import { nivelDe } from "@/lib/papeis";
import { query } from "@/lib/db";
import { parseBody, EquipeMembroSchema } from "@/lib/validators";

export const runtime = "nodejs";

// GET /api/hm/equipes/[id]/membros — lista os membros ATIVOS de uma equipe.
// É o que alimenta o seletor de atribuição do gestor: ele precisa saber para
// quem pode distribuir. Master lista qualquer equipe; gestor SÓ a própria
// (outra equipe é 403 — a composição alheia não é da conta dele); operador
// não lista ninguém (ele só assume para si, não precisa de seletor).
export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const g = await guard({ portal: "HM" });
  if (!g.ok) return g.res;
  const sessao = g.sessao;

  const nivel = nivelDe(sessao);
  const podeListar = nivel === "master" || (nivel === "gestor" && sessao.equipe_id === params.id);
  if (!podeListar) {
    return NextResponse.json({ ok: false, reason: "sem_permissao" }, { status: 403 });
  }

  const membros = await query(
    `select id, nome, papel, lider_equipe
       from cs.usuarios
      where equipe_id = $1 and ativo
      order by nome`,
    [params.id],
  );
  return NextResponse.json({ ok: true, membros });
}

// PATCH /api/hm/equipes/[id]/membros — move um usuário PARA esta equipe (ou tira
// dele, se equipe_id do path for tratado como remoção via acao='remover') e,
// opcionalmente, define o cargo (papel) do membro. É o "definir quem é cada tipo
// de operador". SÓ MASTER altera composição de equipe — gestor lista (GET), mas
// não mexe: mudar a composição muda quem VÊ o quê, e isso é gestão de acesso.
export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const g = await guard({ portal: "HM", nivel: "master" });
  if (!g.ok) return g.res;
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
