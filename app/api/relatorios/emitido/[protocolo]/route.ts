import { NextResponse } from "next/server";
import { guard } from "@/lib/guard";
import { buscarRelatorioEmitido } from "@/lib/protocolo";

export const runtime = "nodejs";

// GET /api/relatorios/emitido/{protocolo} — o conteúdo CONGELADO de um relatório já emitido.
// Nunca regenera: reabrir amanhã devolve exatamente os mesmos números
// (cs.relatorio_emitido.conteudo). Quem pode ver decide pelo ESCOPO gravado na linha e pelo
// PORTAL do relatório — não pela sessão de agora reavaliada contra dado vivo. Ver
// lib/protocolo.ts:buscarRelatorioEmitido para a regra completa.
export async function GET(_req: Request, { params }: { params: { protocolo: string } }) {
  const g = await guard();
  if (!g.ok) return g.res;

  const r = await buscarRelatorioEmitido(params.protocolo, g.sessao);
  if (!r.ok) {
    // Resposta ÚNICA e genérica para "não existe" e "existe mas você não pode ver" — achado
    // BAIXO do pentester: o protocolo é sequencial (PORTAL-AAAAMMDD-NNNN), e distinguir 404 de
    // 403 vira um oráculo de existência: qualquer sessão autenticada varre a faixa numérica do
    // dia e descobre quantos relatórios do HM saíram, só pelo código HTTP mudar de forma.
    return NextResponse.json({ ok: false, reason: "nao_encontrado" }, { status: 404 });
  }
  return NextResponse.json({ ok: true, ...r.resultado, meta: r.meta });
}
