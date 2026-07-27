import { guard } from "@/lib/guard";
import { escopoVisibilidade, paramsEscopo } from "@/lib/papeis";
import { relatorioHm } from "@/lib/services/hm-relatorio";
import { relatorioHmParaXlsx, nomeArquivoRelatorio } from "@/lib/export/hm-esteira-xlsx";

export const runtime = "nodejs";

// GET /api/hm/kanban/export — relatório da esteira em XLSX.
//   sem `estagio`  → geral: resumo + todos os alunos + uma aba por coluna
//   com `estagio`  → só aquela coluna (resumo daquela etapa + a lista)
// Os filtros são os mesmos do board; o RECORTE de equipe também (a planilha só
// traz o que a pessoa vê — GP/admin tudo, operador o pool+os dele, líder a equipe).
export async function GET(req: Request) {
  const g = await guard({ portal: "HM" });
  if (!g.ok) return g.res;
  const sp = new URL(req.url).searchParams;
  const { verTudo, equipeId, usuarioId } = paramsEscopo(escopoVisibilidade(g.sessao));

  // Filtros multi-valor: o mesmo parâmetro repetido (?canal=A&canal=B) — dentro
  // do filtro a leitura é OU, entre filtros é E (igual ao board).
  const relatorio = await relatorioHm({
    responsavel: sp.getAll("responsavel"),
    canal: sp.getAll("canal"),
    turma: sp.getAll("turma"),
    estagio: sp.get("estagio"),
    verTudo, equipeId, usuarioId,
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
