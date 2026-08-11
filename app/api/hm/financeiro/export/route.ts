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
  const sp = new URL(req.url).searchParams;

  // Mesmo bug da rota do kanban: sem repassar `produto`, o financeiro do board do
  // Aurum saía com os dados do HM. Whitelist, nunca o valor cru.
  const prodRaw = (sp.get("produto") || "HM").toUpperCase();
  const produto = (prodRaw === "AURUM" || prodRaw === "ETHB" ? prodRaw : "HM") as "HM" | "AURUM" | "ETHB";

  // ⚠️ Valida o portal RESOLVIDO, não "HM" literal: com o literal, uma conta sem
  // AURUM baixaria o financeiro do Aurum via ?produto=AURUM. Ver comentário gêmeo
  // em /api/hm/kanban/export.
  const g = await guard({ portal: produto });
  if (!g.ok) return g.res;
  // A planilha sai RECORTADA pelo escopo de quem exporta (mesmo predicado do
  // board): um export sem recorte era a carteira inteira vazando com outra roupa.
  const { verTudo, equipeId, usuarioId } = paramsEscopo(escopoVisibilidade(g.sessao));

  const relatorio = await relatorioFinanceiroHm({
    responsavel: sp.getAll("responsavel"),
    canal: sp.getAll("canal"),
    turma: sp.getAll("turma"),
    estagio: sp.get("estagio"),
    verTudo, equipeId, usuarioId, produto,
  });

  const agora = new Date();
  const buf = await financeiroHmParaXlsx(relatorio, agora);

  return new Response(new Uint8Array(buf), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${nomeArquivoFinanceiro(agora, produto)}"`,
      "Content-Length": String(buf.length),
      "Cache-Control": "no-store",
    },
  });
}
