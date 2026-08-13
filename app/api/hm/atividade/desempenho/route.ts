import { NextResponse } from "next/server";
import { guardProdutoOpcional } from "@/lib/produto-hm";
import { parsePeriodo } from "@/lib/validators";
import { desempenhoHm } from "@/lib/services/hm-atividade";

export const runtime = "nodejs";

// GET /api/hm/atividade/desempenho?de=YYYY-MM-DD&ate=YYYY-MM-DD[&produto=HM|AURUM|ETHB]
// — o dashboard "carro-chefe" (pedido do Marcio, 12/08 à noite): dinheiro
// fechado por responsável COMERCIAL (cs.hm_pagamentos, filtrado por produto e
// pelas categorias que são venda de verdade), tempo mediano até o saldo, e —
// em eixo SEPARADO, nunca somado — quantos alunos cada responsável de
// ATIVAÇÃO levou até a quitação e em quanto tempo. Ver o cabeçalho da seção
// em lib/services/hm-atividade.ts para o porquê dos dois eixos não se somarem.
//
// RECORTE: sai de escopoVisibilidade(sessao) (lib/papeis.ts) — a MESMA função
// que decide o que o kanban/tabela deixam cada nível ver. Master vê todo
// mundo; quem tem equipe (gestor OU operador) vê a própria equipe; sem equipe,
// só a própria linha. Nunca de query/body — dashboard de desempenho é
// justamente onde inflar o próprio escopo teria mais valor para alguém tentar.
export async function GET(req: Request) {
  const g = await guardProdutoOpcional(req);
  if (!g.ok) return g.res;

  const sp = new URL(req.url).searchParams;
  const periodo = parsePeriodo(sp);
  if (!periodo.ok) return periodo.res;

  const r = await desempenhoHm({ de: periodo.de, ate: periodo.ate, produto: g.produto }, g.sessao);
  return NextResponse.json({ ok: true, ...r });
}
