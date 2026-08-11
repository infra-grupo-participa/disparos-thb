import { NextResponse } from "next/server";
import { guard } from "@/lib/guard";
import { guardProdutoOpcional } from "@/lib/produto-hm";
import { podeVerCardHm, cancelamentoBloqueado } from "@/lib/services/hm";
import { fichaHm } from "@/lib/services/hm-ficha";
import { fichaHmParaXlsx, nomeArquivoFicha } from "@/lib/export/hm-ficha-xlsx";

export const runtime = "nodejs";

// GET /api/hm/contato/[id]/export — baixa a ficha completa do aluno em XLSX.
// Lê exatamente a mesma ficha que a tela mostra (lib/services/hm-ficha), então a
// planilha nunca diverge do drawer.
export async function GET(req: Request, { params }: { params: { id: string } }) {
  // 0187: valida o portal do produto pedido (ver /api/hm/contato/[id]).
  const g = await guardProdutoOpcional(req);
  if (!g.ok) return g.res;
  const pExp = g.produto;
  const sessao = g.sessao;
  // Mesmo gating do drawer: não exporta a ficha de card de outra equipe.
  if (!(await podeVerCardHm(sessao, params.id))) {
    return NextResponse.json({ ok: false, reason: "sem_acesso" }, { status: 403 });
  }
  // Card cancelado (Reclamada/Reembolsado) não abre para quem não é master — e o
  // XLSX é a MESMA ficha por outra porta. Bloqueio que deixa o export aberto não
  // é bloqueio.
  if (await cancelamentoBloqueado(sessao, params.id)) {
    return NextResponse.json({ ok: false, reason: "cancelamento_so_admin_gp" }, { status: 403 });
  }

  // 0164: mesmo recorte de produto do GET da ficha. Sem isso o XLSX de um card do
  // Aurum podia exportar a ficha do HM (a mesma pessoa tem card nos dois boards).
  const ficha = await fichaHm(params.id, pExp);
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
