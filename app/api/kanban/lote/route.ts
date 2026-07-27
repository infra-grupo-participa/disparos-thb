import { NextResponse } from "next/server";
import { guard } from "@/lib/guard";
import { escopoVisibilidade, paramsEscopo } from "@/lib/papeis";
import { query } from "@/lib/db";
import { eventoDe } from "@/lib/services/evento";
import { parseBody, KanbanLoteSchema } from "@/lib/validators";
import { addTagEmLote, atribuirResponsavel, sqlEscopo, type DestinoAtribuicao } from "@/lib/services/contato";

export const runtime = "nodejs";

type Falha = { compradorId: string; motivo: string };

// POST /api/kanban/lote — ações em massa sobre a seleção do board.
// body: { compradorIds, addTag?, responsavel? }
//
// Cada ação só se aplica aos cards que o ator VÊ (predicado de escopo da 0146):
// ids fora do escopo voltam em `falhas`, nominalmente — não derrubam o lote. O
// responsável passa pela MESMA hierarquia da ficha (atribuirResponsavel): o
// lote não pode ser a porta dos fundos que a rota unitária fechou.
export async function POST(req: Request) {
  const evento = eventoDe(req);
  // Portal do evento RESOLVIDO (cookie/query) contra a whitelist da conta (0145).
  const g = await guard({ portal: evento });
  if (!g.ok) return g.res;
  const sessao = g.sessao;
  const operador = sessao.nome || "cs";
  const p = await parseBody(req, KanbanLoteSchema);
  if (!p.ok) return p.res;
  const b = p.data;

  // Recorte em UMA query (não N podeVerContato): quais dos selecionados o ator
  // pode tocar. O que sobrar é "sem acesso".
  const { verTudo, equipeId, usuarioId } = paramsEscopo(escopoVisibilidade(sessao));
  const visiveis = new Set(
    (
      await query<{ comprador_id: string }>(
        `select v.comprador_id
           from cs.contatos_evento v
          where v.evento = $2 and v.comprador_id = any($1::uuid[])
            and ${sqlEscopo({ rid: "v.responsavel_id", eq: "v.equipe_id", nome: "v.responsavel" }, { verTudo: 3, usuario: 4, equipe: 5 })}`,
        [b.compradorIds, evento, verTudo, usuarioId, equipeId],
      )
    ).map((r) => r.comprador_id),
  );

  const falhas: Falha[] = b.compradorIds
    .filter((id) => !visiveis.has(id))
    .map((compradorId) => ({ compradorId, motivo: "sem acesso a este card" }));
  const ids = b.compradorIds.filter((id) => visiveis.has(id));

  if (b.addTag && b.addTag.trim() && ids.length) await addTagEmLote(ids, b.addTag.trim());

  // Responsável em lote — caminho legado por NOME, um a um, pela hierarquia
  // (master: qualquer um; gestor: só a própria equipe; operador: só assume p/ si).
  let aplicados = ids.length;
  if (b.responsavel !== undefined) {
    aplicados = 0;
    const destino: DestinoAtribuicao = (b.responsavel ?? "").trim() === ""
      ? { tipo: "pool" }
      : { tipo: "nome", nome: (b.responsavel as string).trim() };
    for (const compradorId of ids) {
      const r = await atribuirResponsavel(sessao, compradorId, destino, evento, operador);
      if (!r.ok) {
        const motivo =
          r.reason === "destino_fora_da_equipe" ? "destino fora da sua equipe"
          : r.reason === "atribuicao_travada" ? "card já tem outro responsável"
          : r.reason === "sem_permissao_para_atribuir" ? "sem permissão para atribuir"
          : "contato não encontrado";
        falhas.push({ compradorId, motivo });
        continue;
      }
      aplicados++;
    }
  }

  return NextResponse.json({ ok: true, aplicados, falhas });
}
