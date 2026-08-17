import { NextResponse } from "next/server";
import { guardProduto } from "@/lib/produto-hm";
import { nivelDe } from "@/lib/papeis";
import { relatoriosDisponiveis } from "@/lib/relatorios/registry";

export const runtime = "nodejs";

// GET /api/relatorios?produto=HM|AURUM|ETHB — os tipos de relatório que ESTA sessão pode
// gerar neste portal. A tela (F5) monta o dropdown só com o que voltar daqui — nenhuma lista
// de tipos vive no front; um relatório novo aparece sozinho (1 arquivo + 1 linha no registry).
export async function GET(req: Request) {
  const g = await guardProduto(req);
  if (!g.ok) return g.res;

  const tipos = relatoriosDisponiveis({ nivel: nivelDe(g.sessao) }, g.produto).map((d) => ({
    id: d.id,
    nome: d.nome,
    descricao: d.descricao,
    params: d.params,
  }));
  return NextResponse.json({ ok: true, produto: g.produto, tipos });
}
