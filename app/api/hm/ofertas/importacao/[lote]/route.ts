import { NextResponse } from "next/server";
import { guard } from "@/lib/guard";
import { listarImportacao } from "@/lib/services/hm-ofertas";

export const runtime = "nodejs";

// GET /api/hm/ofertas/importacao/{lote} — a tela de conferência (F6) lê aqui:
// as linhas de um lote de import, cada uma já classificada (motivo_quarentena
// nulo = pronta para promover; preenchido = revisão humana).
export async function GET(_req: Request, { params }: { params: { lote: string } }) {
  const g = await guard({ portal: "HM", nivel: "master" });
  if (!g.ok) return g.res;

  const linhas = await listarImportacao(params.lote);
  if (linhas.length === 0) {
    return NextResponse.json({ ok: false, reason: "lote não encontrado" }, { status: 404 });
  }
  return NextResponse.json({ ok: true, linhas });
}
