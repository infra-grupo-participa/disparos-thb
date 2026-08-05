import { NextResponse } from "next/server";
import { guard } from "@/lib/guard";
import { escopoVisibilidade, paramsEscopo } from "@/lib/papeis";
import { query } from "@/lib/db";
import { listaResponsaveis } from "@/lib/services/visibilidade";
import { relatorioHm } from "@/lib/services/hm-relatorio";

export const runtime = "nodejs";

// A mesma separação de tags do board: turma (Origem/Turma/Aurum) filtra em um
// seletor, canal/público no outro — é assim que o time pergunta.
const RE_TURMA = "^(Origem|Turma|Aurum) ";

// GET /api/hm/tabela — a esteira HM em linhas, para a visão em tabela.
// Mesmos filtros do board e da exportação (responsavel, canal, turma) e a MESMA
// função do XLSX (relatorioHm): a tabela e a planilha saem da mesma leitura por
// construção — se contarem histórias diferentes, é bug.
export async function GET(req: Request) {
  const g = await guard({ portal: "HM" });
  if (!g.ok) return g.res;
  const sp = new URL(req.url).searchParams;

  // Mesmo escopo do board: master tudo; gestor vê a equipe dele; operador vê o
  // pool + os dele. Idêntico à rota do kanban por construção.
  const { verTudo, equipeId, usuarioId } = paramsEscopo(escopoVisibilidade(g.sessao));
  // Board do produto (0155): mesma esteira, recorte por produto (default HM).
  const prodRaw = (sp.get("produto") || "HM").toUpperCase();
  const produto = (prodRaw === "AURUM" || prodRaw === "ETHB" ? prodRaw : "HM") as "HM" | "AURUM" | "ETHB";

  // Filtros multi-valor: o mesmo parâmetro repetido (?canal=A&canal=B) — dentro
  // do filtro a leitura é OU, entre filtros é E.
  const relatorio = await relatorioHm({
    responsavel: sp.getAll("responsavel"),
    canal: sp.getAll("canal"),
    turma: sp.getAll("turma"),
    verTudo, equipeId, usuarioId, produto,
  });

  // As listas dos filtros saem da base inteira (não da fatia filtrada): um
  // seletor que só mostra o que já passou pelo filtro não deixa trocar de filtro.
  // RECORTADA por nível (regra única em listaResponsaveis, visibilidade.ts —
  // a mesma do board): master = todos + legados; gestor = a própria equipe;
  // operador = só ele. A UI confia nesta lista para o seletor de atribuição.
  const responsaveis = await listaResponsaveis(g.sessao, "HM", {
    sql: `select distinct responsavel from cs.contatos_hm where responsavel is not null and responsavel <> ''`,
  });
  // `qtd` alimenta a régua de canais fixos — o placar do canal inteiro, sem os
  // filtros da tela (mesma regra da rota do kanban).
  // RECORTADO POR PRODUTO (05/08/2026). Sem o filtro, esta consulta varria
  // cs.contatos_hm inteira: o board do Aurum listava no dropdown de canal os
  // canais do HM ("HT29", "HT ATM", "Live Direto ao Ponto"...) e a régua somava
  // cards de outro board — inclusive gente que comprou Aurum mas cujo card
  // ficou no HM, inflando o placar de "ETHB SP" com quem o board nem mostra.
  // O placar continua sendo do canal INTEIRO (ignora os filtros da tela); o que
  // ele deixa de ignorar é o board.
  const tagRows = await query<{ tag: string; eh_turma: boolean; qtd: number }>(
    `select t as tag, t ~ $1 as eh_turma, count(*)::int as qtd
       from cs.contatos_hm, unnest(tags) t
      where produto = $2
      group by t
      order by tag`,
    [RE_TURMA, produto],
  );

  return NextResponse.json({
    ok: true,
    linhas: relatorio.linhas,
    estagios: relatorio.colunas,
    responsaveis,
    canais: tagRows.filter((t) => !t.eh_turma).map((t) => t.tag),
    turmas: tagRows.filter((t) => t.eh_turma).map((t) => t.tag),
    canaisQtd: Object.fromEntries(tagRows.filter((t) => !t.eh_turma).map((t) => [t.tag, t.qtd])),
  });
}
