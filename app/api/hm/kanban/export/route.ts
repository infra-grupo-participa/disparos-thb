import { NextResponse } from "next/server";
import { isAuthed } from "@/lib/auth";
import { relatorioHm } from "@/lib/services/hm-relatorio";
import { relatorioHmParaXlsx, nomeArquivoRelatorio } from "@/lib/export/hm-esteira-xlsx";

export const runtime = "nodejs";

// GET /api/hm/kanban/export — relatório da esteira em XLSX.
//   sem `estagio`  → geral: resumo + todos os alunos + uma aba por coluna
//   com `estagio`  → só aquela coluna (resumo daquela etapa + a lista)
// Os filtros são os mesmos do board (responsavel, canal, turma): o relatório sai
// do que a pessoa está vendo, e o cabeçalho da planilha diz quais filtros valiam.
export async function GET(req: Request) {
  if (!isAuthed()) return NextResponse.json({ ok: false }, { status: 401 });
  const sp = new URL(req.url).searchParams;

  const relatorio = await relatorioHm({
    responsavel: sp.get("responsavel"),
    canal: sp.get("canal"),
    turma: sp.get("turma"),
    estagio: sp.get("estagio"),
  });

  const agora = new Date();
  const buf = await relatorioHmParaXlsx(relatorio, agora);
  const arquivo = nomeArquivoRelatorio(sp.get("estagio") ? relatorio.colunas[0] ?? null : null, agora);

  return new Response(new Uint8Array(buf), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${arquivo}"`,
      "Content-Length": String(buf.length),
      "Cache-Control": "no-store",
    },
  });
}
