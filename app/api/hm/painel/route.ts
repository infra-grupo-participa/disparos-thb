import { NextResponse } from "next/server";
import { guardProdutoOpcional } from "@/lib/produto-hm";
import { parsePeriodoAtalho, parseGranularidade } from "@/lib/validators";
import { painelHm } from "@/lib/services/hm-painel";

export const runtime = "nodejs";

// GET /api/hm/painel?periodo=hoje|7d|30d|mes|livre[&de=YYYY-MM-DD&ate=YYYY-MM-DD]
//                    [&granularidade=dia|semana|mes][&produto=HM|AURUM|ETHB]
// — B2 (16/08): "como estamos no período", separado do "o que eu faço agora" (kanban/agenda).
// Cada KPI vem com valor do período + o MESMO recorte no período anterior (coorte, nunca
// janela de evento diferente) + série para sparkline.
//
// RECORTE: escopoVisibilidade(sessao), igual a /carteira e /atividade/desempenho — master vê
// tudo, quem tem equipe vê a equipe, operador vê só a própria carteira. Nunca de query/body.
//
// `?produto=` SEMPRE explícito no cliente (mesma armadilha de app/hm/atividade/page.tsx:
// sem ele o dinheiro do AURUM entra no placar do HM). guardProdutoOpcional aceita a ausência
// mas então exige os 3 portais e a query cruza os 3 produtos — comportamento seguro, não o
// que a tela deveria fazer por padrão.
export async function GET(req: Request) {
  const g = await guardProdutoOpcional(req);
  if (!g.ok) return g.res;

  const sp = new URL(req.url).searchParams;
  const periodo = parsePeriodoAtalho(sp);
  if (!periodo.ok) return periodo.res;
  const gran = parseGranularidade(sp);
  if (!gran.ok) return gran.res;

  const r = await painelHm(
    { periodo: periodo.periodo, de: periodo.de, ate: periodo.ate, granularidade: gran.granularidade, produto: g.produto },
    g.sessao,
  );
  return NextResponse.json({ ok: true, ...r });
}
