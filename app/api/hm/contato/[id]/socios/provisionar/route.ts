import { NextResponse } from "next/server";
import { guard } from "@/lib/guard";
import { produtoDaRequisicao } from "@/lib/produto-hm";
import { provisionarSociosHm, podeAgirCardHm, cancelamentoBloqueado } from "@/lib/services/hm";

export const runtime = "nodejs";

// POST /api/hm/contato/[id]/socios/provisionar — empurra os sócios do titular
// para a base mestre THB. É o "Enviar à base" do card: só chama a função que já
// roda sozinha quando o titular vira aluno (cs.fn_hm_provisionar_socios), agora
// sob demanda para os sócios que ficaram órfãos (importados por planilha antes de
// o titular quitar). Idempotente e blindada: se o titular ainda não é aluno,
// devolve 0 e nada acontece. [id] = comprador_id do TITULAR.
export async function POST(_req: Request, { params }: { params: { id: string } }) {
  // 0187: o portal validado é o do produto PEDIDO. Com "HM" literal, quem tem
  // só HM agia sobre o card do AURUM/ETHB de quem não tem card no HM.
  const produtoCard = produtoDaRequisicao(_req);
  const g = await guard({ portal: produtoCard });
  if (!g.ok) return g.res;
  const sessao = g.sessao;
  // Gate de AÇÃO (28/07, leitura ≠ ação): provisionar na base THB é efeito de
  // escrita — card de colega recusa com 403 'card_de_outro_operador'.
  const acao = await podeAgirCardHm(sessao, params.id);
  if (acao !== "ok") return NextResponse.json({ ok: false, reason: acao }, { status: 403 });
  // Card cancelado: só o master abre/mexe — provisionar sócio de reembolsado na
  // base THB é exatamente o tipo de efeito colateral que a trava existe pra impedir.
  if (await cancelamentoBloqueado(sessao, params.id)) return NextResponse.json({ ok: false, reason: "cancelamento_so_admin_gp" }, { status: 403 });

  const n = await provisionarSociosHm(params.id, sessao.nome || "cs");
  return NextResponse.json({ ok: true, provisionados: n });
}
