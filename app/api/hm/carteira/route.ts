import { NextResponse } from "next/server";
import { guardProdutoOpcional } from "@/lib/produto-hm";
import { carteiraHm } from "@/lib/services/hm-carteira";

export const runtime = "nodejs";

// GET /api/hm/carteira[?produto=HM|AURUM|ETHB]
// — a carteira de cada pessoa do comercial: quem é dela, quanto já entrou, quanto falta e
// quando a pessoa paga. Fonte única: cs.vw_hm_carteira (0240→0245).
//
// RECORTE: sai de escopoVisibilidade(sessao), como o resto do HM — master vê todo mundo,
// quem tem equipe vê a equipe, operador vê a própria carteira. Nunca de query/body: uma tela
// que mostra quanto cada colega fechou é exatamente onde inflar o próprio escopo teria valor.
//
// O produto vai SEMPRE explícito no cliente (mesma razão da tela de desempenho, 12/08): sem
// ele a query deixa de filtrar `produto` e o dinheiro do AURUM entra no placar do HM para
// quem tem card nos dois boards.
export async function GET(req: Request) {
  const g = await guardProdutoOpcional(req);
  if (!g.ok) return g.res;

  const r = await carteiraHm({ produto: g.produto }, g.sessao);
  return NextResponse.json({ ok: true, ...r });
}
