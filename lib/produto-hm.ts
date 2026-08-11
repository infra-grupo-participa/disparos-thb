import { guard, type GuardResultado } from "@/lib/guard";

/**
 * O board (produto) pedido na requisição, e o gate de acesso a ele.
 *
 * HM, AURUM e ETHB compartilham a mesma esteira (0155/0163), mas são PORTAIS
 * distintos em `cs.usuario_portais` — concedidos um a um. O `guard` precisa validar
 * o portal RESOLVIDO da query, não o literal "HM":
 *
 *   ❌ guard({ portal: "HM" }) + query filtrando por ?produto=AURUM
 *      → uma conta com HM e sem AURUM passava pelo gate e lia o board do Aurum.
 *   ✅ guard({ portal: produtoDaRequisicao(req) })
 *
 * É a diretriz que o próprio lib/guard.ts documenta ("o que importa é a whitelist da
 * conta cobrir o que a query VAI ler") e que 9 rotas não seguiam. Achado do
 * security-pentester em 11/08/2026; na data não havia exposição real (nenhuma conta
 * tinha HM sem AURUM), mas passaria a haver no primeiro usuário com um portal só.
 *
 * A normalização também estava copiada em 9 arquivos, em 3 variações sutilmente
 * diferentes — uma delas devolvia `null` em vez de "HM". Aqui é uma só.
 */
export type ProdutoHm = "HM" | "AURUM" | "ETHB";

const PRODUTOS: readonly string[] = ["HM", "AURUM", "ETHB"];

/** Normaliza `?produto=`. Valor ausente ou desconhecido vira "HM" (o padrão histórico). */
export function produtoDaRequisicao(req: Request): ProdutoHm {
  const cru = (new URL(req.url).searchParams.get("produto") || "HM").toUpperCase();
  return (PRODUTOS.includes(cru) ? cru : "HM") as ProdutoHm;
}

/** Igual à anterior, mas preserva `null` quando o parâmetro não veio — para rotas que
 *  distinguem "todos os produtos" de "o produto HM". */
export function produtoOpcional(req: Request): ProdutoHm | null {
  const cru = (new URL(req.url).searchParams.get("produto") || "").toUpperCase();
  return PRODUTOS.includes(cru) ? (cru as ProdutoHm) : null;
}

/**
 * `guard` para rota cujo `?produto=` é OPCIONAL — e cuja query, sem ele, CRUZA os três
 * produtos (visão consolidada, ou "um card ao acaso" entre os produtos da pessoa).
 *
 * ⚠️ Aqui `?? "HM"` seria brecha, não conveniência: validar só o portal HM enquanto a
 * query devolve HM+AURUM+ETHB entrega dado de board que a conta não tem. E o vetor é a
 * AUSÊNCIA do parâmetro, não um valor malicioso — `GET /api/hm/contato/<id>` sem
 * `?produto=` bastava. O front sempre manda o parâmetro (useFetchHm), mas quem chama a
 * API direto, não.
 *
 * Regra: produto explícito → valida aquele portal. Produto ausente (query cruza tudo)
 * → exige TODOS os portais. Achado do security-pentester em 11/08/2026.
 */
export async function guardProdutoOpcional(
  req: Request,
  opts?: { nivel?: "master" | "gestor" },
): Promise<
  | (GuardResultado & { ok: true; produto: ProdutoHm | null })
  | (GuardResultado & { ok: false })
> {
  const produto = produtoOpcional(req);
  if (produto) {
    const g = await guard({ portal: produto, nivel: opts?.nivel });
    return g.ok ? { ...g, produto } : g;
  }
  // Sem produto: a query mistura os três, então a conta precisa dos três.
  for (const p of PRODUTOS) {
    const g = await guard({ portal: p, nivel: opts?.nivel });
    if (!g.ok) return g;
  }
  const g = await guard({ nivel: opts?.nivel });
  return g.ok ? { ...g, produto: null } : g;
}

/**
 * `guard` + produto numa chamada só: valida o portal do produto PEDIDO e devolve os
 * dois. Use nas rotas que leem `?produto=`.
 *
 *   const g = await guardProduto(req);
 *   if (!g.ok) return g.res;
 *   // g.sessao, g.produto
 */
export async function guardProduto(
  req: Request,
  opts?: { nivel?: "master" | "gestor" },
): Promise<(GuardResultado & { ok: true; produto: ProdutoHm }) | (GuardResultado & { ok: false })> {
  const produto = produtoDaRequisicao(req);
  const g = await guard({ portal: produto, nivel: opts?.nivel });
  if (!g.ok) return g;
  return { ...g, produto };
}
