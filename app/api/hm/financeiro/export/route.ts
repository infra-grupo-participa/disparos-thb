import { guard } from "@/lib/guard";
import { escopoVisibilidade, paramsEscopo } from "@/lib/papeis";
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
  const g = await guard({ portal: "HM" });
  if (!g.ok) return g.res;
  const sp = new URL(req.url).searchParams;
  // A planilha sai RECORTADA pelo escopo de quem exporta (mesmo predicado do
  // board): um export sem recorte era a carteira inteira vazando com outra roupa.
  const { verTudo, equipeId, usuarioId } = paramsEscopo(escopoVisibilidade(g.sessao));

  const relatorio = await relatorioFinanceiroHm({
    responsavel: sp.getAll("responsavel"),
    canal: sp.getAll("canal"),
    turma: sp.getAll("turma"),
    estagio: sp.get("estagio"),
    verTudo, equipeId, usuarioId,
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
