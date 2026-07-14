import { NextResponse } from "next/server";
import { isAuthed } from "@/lib/auth";
import { query } from "@/lib/db";
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
  if (!isAuthed()) return NextResponse.json({ ok: false }, { status: 401 });
  const sp = new URL(req.url).searchParams;

  // Filtros multi-valor: o mesmo parâmetro repetido (?canal=A&canal=B) — dentro
  // do filtro a leitura é OU, entre filtros é E.
  const relatorio = await relatorioHm({
    responsavel: sp.getAll("responsavel"),
    canal: sp.getAll("canal"),
    turma: sp.getAll("turma"),
  });

  // As listas dos filtros saem da base inteira (não da fatia filtrada): um
  // seletor que só mostra o que já passou pelo filtro não deixa trocar de filtro.
  const respRows = await query<{ responsavel: string }>(
    `select distinct responsavel from cs.contatos_hm where responsavel is not null and responsavel <> '' order by responsavel`,
  );
  // `qtd` alimenta a régua de canais fixos — o placar do canal inteiro, sem os
  // filtros da tela (mesma regra da rota do kanban).
  const tagRows = await query<{ tag: string; eh_turma: boolean; qtd: number }>(
    `select t as tag, t ~ $1 as eh_turma, count(*)::int as qtd
       from cs.contatos_hm, unnest(tags) t
      group by t
      order by tag`,
    [RE_TURMA],
  );

  return NextResponse.json({
    ok: true,
    linhas: relatorio.linhas,
    estagios: relatorio.colunas,
    responsaveis: respRows.map((r) => r.responsavel),
    canais: tagRows.filter((t) => !t.eh_turma).map((t) => t.tag),
    turmas: tagRows.filter((t) => t.eh_turma).map((t) => t.tag),
    canaisQtd: Object.fromEntries(tagRows.filter((t) => !t.eh_turma).map((t) => [t.tag, t.qtd])),
  });
}
