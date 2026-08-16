import { NextResponse } from "next/server";
import { guardProduto } from "@/lib/produto-hm";
import { nivelDe } from "@/lib/papeis";
import { parsePeriodo } from "@/lib/validators";
import { relatorioPorId, relatoriosDisponiveis } from "@/lib/relatorios/registry";
import { emitirRelatorio } from "@/lib/protocolo";
import { logger } from "@/lib/log";

export const runtime = "nodejs";
const log = logger("relatorios");

// POST /api/relatorios/{tipo}?de&ate&produto — gera, protocola e devolve o número.
// A folha em si sai por GET /api/relatorios/emitido/{protocolo}: reabrir NUNCA regenera, é
// 1 select por PK — o conteúdo é congelado no instante da emissão (lib/protocolo.ts).
export async function POST(req: Request, { params }: { params: { tipo: string } }) {
  const g = await guardProduto(req);
  if (!g.ok) return g.res;

  const def = relatorioPorId(params.tipo);
  if (!def) return NextResponse.json({ ok: false, reason: "tipo_desconhecido" }, { status: 404 });

  // Não basta o tipo existir: precisa estar na lista que ESTA sessão pode gerar neste
  // portal (nível + portal) — a mesma checagem de GET /api/relatorios, repetida aqui porque
  // o cliente pode ignorar o que a listagem devolveu e chamar o POST direto.
  const disponiveis = relatoriosDisponiveis({ nivel: nivelDe(g.sessao) }, g.produto);
  if (!disponiveis.some((d) => d.id === def.id)) {
    return NextResponse.json({ ok: false, reason: "sem_permissao" }, { status: 403 });
  }

  const sp = new URL(req.url).searchParams;
  const periodo = parsePeriodo(sp);
  if (!periodo.ok) return periodo.res;
  if (def.params.includes("periodo") && !periodo.de) {
    return NextResponse.json({ ok: false, reason: "periodo_obrigatorio" }, { status: 400 });
  }

  try {
    const { protocolo, resultado } = await emitirRelatorio(
      def,
      { de: periodo.de, ate: periodo.ate, produto: g.produto, sessao: g.sessao },
      { portal: g.produto },
    );
    const linhas = resultado.secoes.reduce((s, sec) => s + sec.linhas.length, 0);
    return NextResponse.json({ ok: true, protocolo, linhas });
  } catch (e) {
    log.error("falha ao emitir relatorio", e, { tipo: def.id, produto: g.produto });
    return NextResponse.json({ ok: false, reason: "erro_ao_gerar" }, { status: 500 });
  }
}
