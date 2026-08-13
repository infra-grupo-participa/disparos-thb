import { NextResponse } from "next/server";
import { guard } from "@/lib/guard";
import { produtoDaRequisicao } from "@/lib/produto-hm";
import { escopoVisibilidade, abasDaEsteira, paramsEscopo, type Ator } from "@/lib/papeis";
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
  // 0187: o portal validado e o do produto PEDIDO, nao "HM" literal — HM/AURUM/ETHB
  // sao portais distintos em cs.usuario_portais. Vem no topo: nada pode ler g.sessao
  // antes do gate.
  const produto = produtoDaRequisicao(req);
  const g = await guard({ portal: produto });
  if (!g.ok) return g.res;
  const sp = new URL(req.url).searchParams;

  // Mesmo escopo do board: master tudo; gestor vê a equipe dele; operador vê o
  // pool + os dele. Idêntico à rota do kanban por construção.
  const { verTudo, equipeId, usuarioId } = paramsEscopo(escopoVisibilidade(g.sessao));
  // Board do produto (0155): mesma esteira, recorte por produto (default HM).

  // Filtros multi-valor: o mesmo parâmetro repetido (?canal=A&canal=B) — dentro
  // do filtro a leitura é OU, entre filtros é E.
  const relatorio = await relatorioHm({
    responsavel: sp.getAll("responsavel"),
    canal: sp.getAll("canal"),
    turma: sp.getAll("turma"),
    verTudo, equipeId, usuarioId, produto,
    // Esteira compartilhada (0210/0212): a tabela é a MESMA leitura do board —
    // se o card aparece no kanban para quem tem a função, tem de aparecer aqui.
    abas: abasDaEsteira(g.sessao as Ator, "HM", produto),
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
  const tagRows = await query<{ tag: string; eh_turma: boolean; qtd: number }>(
    // 13/08 — `and produto = $2`. Faltava, e a régua do board do AURUM contava
    // os cards do HM junto: o canal "ETHB SP" aparecia com 50 num board de 35
    // cards. São 35 PESSOAS; as outras 15 linhas são o card que essas mesmas
    // pessoas têm no HM (as 15 de sempre, card por pessoa × produto desde a
    // 0163). O mesmo filtro conserta a LISTA de canais logo abaixo, que oferecia
    // no Aurum canais que só existem no HM — e filtrar por eles não devolvia nada.
    //
    // "Placar do canal INTEIRO" segue valendo para o que a frase quis dizer:
    // ignora os filtros DA TELA. O produto não é filtro de tela, é o board.
    `select t as tag, t ~ $1 as eh_turma, count(*)::int as qtd
       from cs.contatos_hm, unnest(tags) t
      where coalesce(produto, 'HM') = $2
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
