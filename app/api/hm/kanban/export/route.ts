import { guard } from "@/lib/guard";
import { escopoVisibilidade, esteiraCompartilhadaNoBoard, paramsEscopo, type Ator } from "@/lib/papeis";
import { relatorioHm } from "@/lib/services/hm-relatorio";
import { relatorioHmParaXlsx, nomeArquivoRelatorio } from "@/lib/export/hm-esteira-xlsx";

export const runtime = "nodejs";

// GET /api/hm/kanban/export — relatório da esteira em XLSX.
//   sem `estagio`  → geral: resumo + todos os alunos + uma aba por coluna
//   com `estagio`  → só aquela coluna (resumo daquela etapa + a lista)
// Os filtros são os mesmos do board; o RECORTE de equipe também (a planilha só
// traz o que a pessoa vê — GP/admin tudo, operador o pool+os dele, líder a equipe).
export async function GET(req: Request) {
  const sp = new URL(req.url).searchParams;

  // O board é por produto (0155) e o export TAMBÉM precisa ser: sem repassar
  // `produto`, relatorioHm caía no default "HM" e o botão "Exportar" do board do
  // Aurum baixava a esteira do HM (249 cards em vez dos 35 do Aurum). Mesma
  // normalização de /api/hm/tabela — whitelist, nunca o valor cru.
  const prodRaw = (sp.get("produto") || "HM").toUpperCase();
  const produto = (prodRaw === "AURUM" || prodRaw === "ETHB" ? prodRaw : "HM") as "HM" | "AURUM" | "ETHB";

  // ⚠️ O portal validado é o RESOLVIDO, não "HM" literal — é a diretriz do próprio
  // lib/guard.ts ("a whitelist da conta tem de cobrir o que a query VAI ler").
  // Com "HM" fixo, uma conta com portal HM e sem AURUM baixaria a esteira do Aurum
  // só passando ?produto=AURUM: o guard aprovava e a query filtrava pelo produto
  // pedido. Hoje ninguém tem HM sem AURUM, então não houve exposição — mas passa a
  // haver no dia em que alguém receber só um dos portais.
  const g = await guard({ portal: produto });
  if (!g.ok) return g.res;
  const { verTudo, equipeId, usuarioId } = paramsEscopo(escopoVisibilidade(g.sessao));

  // Filtros multi-valor: o mesmo parâmetro repetido (?canal=A&canal=B) — dentro
  // do filtro a leitura é OU, entre filtros é E (igual ao board).
  const relatorio = await relatorioHm({
    responsavel: sp.getAll("responsavel"),
    canal: sp.getAll("canal"),
    turma: sp.getAll("turma"),
    estagio: sp.get("estagio"),
    verTudo, equipeId, usuarioId, produto,
    // Esteira compartilhada (0202): o XLSX é a MESMA leitura do board por outra
    // porta — se o card aparece no kanban, tem de sair no export.
    esteira: esteiraCompartilhadaNoBoard(g.sessao as Ator, "HM", produto),
  });

  const agora = new Date();
  const buf = await relatorioHmParaXlsx(relatorio, agora);
  const arquivo = nomeArquivoRelatorio(sp.get("estagio") ? relatorio.colunas[0] ?? null : null, agora, produto);

  return new Response(new Uint8Array(buf), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${arquivo}"`,
      "Content-Length": String(buf.length),
      "Cache-Control": "no-store",
    },
  });
}
