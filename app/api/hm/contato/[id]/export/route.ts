import { NextResponse } from "next/server";
import { getSessao } from "@/lib/auth";
import { podeVerCardHm } from "@/lib/services/hm";
import { fichaHm } from "@/lib/services/hm-ficha";
import { fichaHmParaXlsx, nomeArquivoFicha } from "@/lib/export/hm-ficha-xlsx";

export const runtime = "nodejs";

// GET /api/hm/contato/[id]/export — baixa a ficha completa do aluno em XLSX.
// Lê exatamente a mesma ficha que a tela mostra (lib/services/hm-ficha), então a
// planilha nunca diverge do drawer.
export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const sessao = await getSessao();
  if (!sessao) return NextResponse.json({ ok: false }, { status: 401 });
  // Mesmo gating do drawer: não exporta a ficha de card de outra equipe.
  if (!(await podeVerCardHm(sessao, params.id))) {
    return NextResponse.json({ ok: false, reason: "sem_acesso" }, { status: 403 });
  }

  const ficha = await fichaHm(params.id);
  if (!ficha) return NextResponse.json({ ok: false, reason: "não encontrado" }, { status: 404 });

  const agora = new Date();
  const buf = await fichaHmParaXlsx(ficha, agora);
  const arquivo = nomeArquivoFicha(ficha.contato.nome, agora);

  return new Response(new Uint8Array(buf), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${arquivo}"`,
      "Content-Length": String(buf.length),
      "Cache-Control": "no-store",
    },
  });
}
