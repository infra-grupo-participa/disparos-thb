import { NextResponse } from "next/server";
import { getSessao } from "@/lib/auth";
import { escopoVisibilidade, paramsEscopo } from "@/lib/papeis";
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
  const sessao = await getSessao();
  if (!sessao) return NextResponse.json({ ok: false }, { status: 401 });
  const sp = new URL(req.url).searchParams;

  // Mesmo escopo do board: GP/admin tudo; líder de equipe vê a equipe dele;
  // operador vê o pool + os dele. Idêntico à rota do kanban por construção.
  const { verTudo, equipeId, usuarioId } = paramsEscopo(escopoVisibilidade(sessao));

  // Filtros multi-valor: o mesmo parâmetro repetido (?canal=A&canal=B) — dentro
  // do filtro a leitura é OU, entre filtros é E.
  const relatorio = await relatorioHm({
    responsavel: sp.getAll("responsavel"),
    canal: sp.getAll("canal"),
    turma: sp.getAll("turma"),
    verTudo, equipeId, usuarioId,
  });

  // As listas dos filtros saem da base inteira (não da fatia filtrada): um
  // seletor que só mostra o que já passou pelo filtro não deixa trocar de filtro.
  // Quem pode assumir um contato = a equipe ATIVA (cs.usuarios), não só quem já
  // tem card — senão um operador novo nunca aparece para ser atribuído. A união
  // preserva responsáveis legados fora de usuarios.
  const respRows = await query<{ responsavel: string }>(
    `select responsavel from (
        select nome as responsavel from cs.usuarios where ativo
        union
        select distinct responsavel from cs.contatos_hm where responsavel is not null and responsavel <> ''
     ) u
     order by responsavel`,
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
