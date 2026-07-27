import { NextResponse } from "next/server";
import { guard } from "@/lib/guard";
import { provisionarSociosHm, podeVerCardHm } from "@/lib/services/hm";

export const runtime = "nodejs";

// POST /api/hm/contato/[id]/socios/provisionar — empurra os sócios do titular
// para a base mestre THB. É o "Enviar à base" do card: só chama a função que já
// roda sozinha quando o titular vira aluno (cs.fn_hm_provisionar_socios), agora
// sob demanda para os sócios que ficaram órfãos (importados por planilha antes de
// o titular quitar). Idempotente e blindada: se o titular ainda não é aluno,
// devolve 0 e nada acontece. [id] = comprador_id do TITULAR.
export async function POST(_req: Request, { params }: { params: { id: string } }) {
  const g = await guard({ portal: "HM" });
  if (!g.ok) return g.res;
  const sessao = g.sessao;
  if (!(await podeVerCardHm(sessao, params.id))) return NextResponse.json({ ok: false, reason: "sem_acesso" }, { status: 403 });

  const n = await provisionarSociosHm(params.id, sessao.nome || "cs");
  return NextResponse.json({ ok: true, provisionados: n });
}
