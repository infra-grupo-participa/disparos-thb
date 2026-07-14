import { NextResponse } from "next/server";
import { isAuthed } from "@/lib/auth";
import { relatorioFinanceiroHm } from "@/lib/services/hm-financeiro";
import { financeiroHmParaXlsx, nomeArquivoFinanceiro } from "@/lib/export/hm-financeiro-xlsx";

export const runtime = "nodejs";

// GET /api/hm/financeiro/export — o financeiro do HM em XLSX:
//   Resumo · Carteira · A receber · Pagamentos · Cancelamentos
//
// Os filtros são os mesmos do board (responsavel, canal, turma, estagio): a
// planilha sai do que a pessoa está vendo, e o cabeçalho do Resumo diz quais
// filtros valiam — uma planilha filtrada que não se declara filtrada é uma
// armadilha para quem a abrir depois.
export async function GET(req: Request) {
  if (!isAuthed()) return NextResponse.json({ ok: false }, { status: 401 });
  const sp = new URL(req.url).searchParams;

  const relatorio = await relatorioFinanceiroHm({
    responsavel: sp.getAll("responsavel"),
    canal: sp.getAll("canal"),
    turma: sp.getAll("turma"),
    estagio: sp.get("estagio"),
  });

  const agora = new Date();
  const buf = await financeiroHmParaXlsx(relatorio, agora);

  return new Response(new Uint8Array(buf), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${nomeArquivoFinanceiro(agora)}"`,
      "Content-Length": String(buf.length),
      "Cache-Control": "no-store",
    },
  });
}
