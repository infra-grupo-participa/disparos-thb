import { NextResponse } from "next/server";
import { guard } from "@/lib/guard";
import { query } from "@/lib/db";
import { eventoDe } from "@/lib/services/evento";
import { parseBody, KanbanLoteSchema } from "@/lib/validators";
import { veredictoAcao, podeVerPorEscopo } from "@/lib/services/visibilidade";
import { acaoLivrePorEquipeEvento, escopoVisibilidade } from "@/lib/papeis";
import { addTagEmLote, atribuirResponsavel, type DestinoAtribuicao } from "@/lib/services/contato";

export const runtime = "nodejs";

type Falha = { compradorId: string; motivo: string };

// POST /api/kanban/lote — ações em massa sobre a seleção do board.
// body: { compradorIds, addTag?, responsavel? }
//
// Cada ação só se aplica aos cards em que o ator pode AGIR (escopo de AÇÃO,
// 28/07 — o lote é escrita): ids fora voltam em `falhas`, nominalmente — não
// derrubam o lote. O card do colega (visível no board pelo escopo de leitura)
// falha como "card de outro operador". O responsável passa pela MESMA
// hierarquia da ficha (atribuirResponsavel): o lote não pode ser a porta dos
// fundos que a rota unitária fechou.
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

  // Recorte em UMA query (não N podeAgirContato): as colunas de escopo de todos
  // os selecionados de uma vez; o veredicto (ok / card de colega / sem acesso)
  // é o MESMO predicado das rotas unitárias (veredictoAcao, visibilidade.ts).
  const rows = await query<{ comprador_id: string; responsavel_id: string | null; equipe_id: string | null; responsavel: string | null }>(
    `select v.comprador_id, v.responsavel_id, v.equipe_id, v.responsavel
       from cs.contatos_evento v
      where v.evento = $2 and v.comprador_id = any($1::uuid[])`,
    [b.compradorIds, evento],
  );
  // Ação livre no Seminário p/ a equipe principal (30/07): todo card VISÍVEL vira
  // "ok" no lote — a mesma liberação de podeAgirContato, aplicada aqui em massa.
  const livre = acaoLivrePorEquipeEvento(sessao, evento);
  const escopoVis = escopoVisibilidade(sessao);
  const veredictos = new Map(rows.map((r) => [
    r.comprador_id,
    livre ? (podeVerPorEscopo(escopoVis, r) ? "ok" : "sem_acesso") : veredictoAcao(sessao, r),
  ]));

  const falhas: Falha[] = [];
  const ids: string[] = [];
  for (const compradorId of b.compradorIds) {
    const v = veredictos.get(compradorId); // ausente = não existe no evento → 404 nominal
    if (v === "ok") ids.push(compradorId);
    else if (v === "card_de_outro_operador") falhas.push({ compradorId, motivo: "card de outro operador" });
    else falhas.push({ compradorId, motivo: v === "sem_acesso" ? "sem acesso a este card" : "contato não encontrado" });
  }

  // Escopado pelo MESMO evento do guard: a tag entra só na linha deste portal.
  if (b.addTag && b.addTag.trim() && ids.length) await addTagEmLote(ids, evento, b.addTag.trim());

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
          : r.reason === "destino_sem_portal" ? `destino sem acesso ao portal ${evento}`
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
