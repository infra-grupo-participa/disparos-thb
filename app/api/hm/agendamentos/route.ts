import { NextResponse } from "next/server";
import { guard } from "@/lib/guard";
import { escopoVisibilidade, paramsEscopo } from "@/lib/papeis";
import { query } from "@/lib/db";

export const runtime = "nodejs";

// GET /api/hm/agendamentos — reúne reuniões (Comercial) e entrevistas (Ativação)
// marcadas, com data/hora, aluno, responsável e resultado. RECORTE por equipe:
// cada um só vê os agendamentos dos cards que enxerga (pool / própria equipe / GP).
export async function GET(req: Request) {
  const g = await guard({ portal: "HM" });
  if (!g.ok) return g.res;
  const sessao = g.sessao;
  const sp = new URL(req.url).searchParams;
  const tipo = sp.get("tipo"); // 'reuniao' | 'entrevista' | null (ambos)
  const { verTudo, equipeId, usuarioId } = paramsEscopo(escopoVisibilidade(sessao));

  // O modal da agenda precisa do contexto que faz a reunião valer a pena: quem é
  // a pessoa (aluno da base? lead novo?), o que foi combinado, se o link do saldo
  // já foi enviado e se há trava ("não contatar"). Sem isso, o card da agenda é
  // só um nome numa data — e alguém teria que abrir o kanban para saber do que
  // se trata.
  const rows = await query(
    `select comprador_id, nome, email, telefone, plano, responsavel, estagio_nome, estagio_aba,
            tags, turma, turma_origem, acordo, pagamento_meio, pagamento_previsto_em,
            link_saldo_enviado_em, nao_contatar, nao_contatar_motivo, revisar, revisar_motivo,
            pendencia, apto_ativacao, observacoes,
            ativ_searchie, ativ_comunidade, ativ_grupo, ativ_pesquisa,
            'reuniao'::text as tipo, reuniao_em as quando, reuniao_resultado as resultado
       from cs.contatos_hm_kanban
      where reuniao_em is not null and ($1::text is null or $1 = 'reuniao')
        and ($2::boolean or (responsavel_id is null and equipe_id is null) or responsavel_id = $3::uuid or equipe_id = $4::uuid)
     union all
     select comprador_id, nome, email, telefone, plano, responsavel, estagio_nome, estagio_aba,
            tags, turma, turma_origem, acordo, pagamento_meio, pagamento_previsto_em,
            link_saldo_enviado_em, nao_contatar, nao_contatar_motivo, revisar, revisar_motivo,
            pendencia, apto_ativacao, observacoes,
            ativ_searchie, ativ_comunidade, ativ_grupo, ativ_pesquisa,
            'entrevista'::text as tipo, entrevista_em as quando, entrevista_resultado as resultado
       from cs.contatos_hm_kanban
      where entrevista_em is not null and ($1::text is null or $1 = 'entrevista')
        and ($2::boolean or (responsavel_id is null and equipe_id is null) or responsavel_id = $3::uuid or equipe_id = $4::uuid)
     order by quando asc nulls last`,
    [tipo, verTudo, usuarioId, equipeId],
  );

  return NextResponse.json({ ok: true, agendamentos: rows });
}
