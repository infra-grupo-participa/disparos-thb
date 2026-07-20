import { NextResponse } from "next/server";
import { getSessao } from "@/lib/auth";
import { query, queryOne } from "@/lib/db";

export const runtime = "nodejs";

// GET /api/hm/acessos — a consulta dos acessos do GPS. SÓ ADMIN.
//
// Mostra as duas metades que não são a mesma coisa:
//   • HABILITADO — existe linha na base (o GPS consegue casar a pessoa por documento)
//   • ENTROU     — a pessoa é membro/cliente no GPS de fato
// Criar o acesso não faz a pessoa entrar; o GPS é de adesão. Por isso o admin
// precisa ver os dois lados lado a lado (e quem está sem CPF, que o GPS nunca acha).
export async function GET(req: Request) {
  const sessao = await getSessao();
  if (!sessao) return NextResponse.json({ ok: false }, { status: 401 });
  if (sessao.papel !== "admin") {
    return NextResponse.json({ ok: false, reason: "só admin consulta os acessos" }, { status: 403 });
  }

  const sp = new URL(req.url).searchParams;
  const q = (sp.get("q") ?? "").trim();
  const tipo = sp.get("tipo") ?? "";              // '' | 'trilha' | 'aluno'
  const situacao = sp.get("situacao") ?? "";      // '' | 'entrou' | 'nao_entrou' | 'sem_documento' | 'vencido'

  const linhas = await query(
    `select aluno_id, nome, email, telefone, documento, tipo, turma, plano,
            status_acesso, regra_acesso, data_compra, data_expiracao, acesso_vencido,
            situacao_financeira, cancelado_em, criado_em,
            gps_membro, gps_cliente, sem_documento, comprador_id
       from cs.vw_gps_acessos
      where ($1 = '' or nome ilike '%'||$1||'%' or email ilike '%'||$1||'%'
             or coalesce(documento,'') ilike '%'||$1||'%' or coalesce(telefone,'') ilike '%'||$1||'%')
        and ($2 = '' or tipo = $2)
        and ($3 = ''
             or ($3 = 'entrou'         and (gps_membro or gps_cliente))
             or ($3 = 'nao_entrou'     and not (gps_membro or gps_cliente))
             or ($3 = 'sem_documento'  and sem_documento)
             or ($3 = 'vencido'        and acesso_vencido))
      order by criado_em desc nulls last, nome
      limit 500`,
    [q, tipo, situacao],
  );

  // O placar é do conjunto INTEIRO (não do recorte): é o retrato que o admin quer.
  const resumo = await queryOne(
    `select count(*)::int                                                as total,
            count(*) filter (where tipo = 'trilha')::int                 as trilha,
            count(*) filter (where tipo = 'aluno')::int                  as aluno,
            count(*) filter (where gps_membro or gps_cliente)::int       as entraram,
            count(*) filter (where sem_documento)::int                   as sem_documento,
            count(*) filter (where acesso_vencido)::int                  as vencidos
       from cs.vw_gps_acessos`,
  );

  return NextResponse.json({ ok: true, acessos: linhas, resumo });
}
