import { NextResponse } from "next/server";
import { isAuthed } from "@/lib/auth";
import { query, queryOne } from "@/lib/db";

export const runtime = "nodejs";

// GET /api/ligacoes/diag — diagnóstico CRU das chamadas do Atende Simples, SEM
// filtrar por evento/aluno. Serve para confirmar se o webhook está gravando e
// quantas chamadas casaram com um aluno do sistema (as não-casadas não aparecem
// no painel por portal). Autenticado; abrir logado no navegador.
export async function GET() {
  if (!isAuthed()) return NextResponse.json({ ok: false }, { status: 401 });

  // Verifica antes se a migration 0024 (colunas do Atende Simples) foi aplicada.
  // Se faltar, o webhook também não consegue gravar — então a checagem aponta a
  // causa raiz em vez de estourar 500 genérico.
  const col = await queryOne<{ existe: boolean }>(
    `select exists (
       select 1 from information_schema.columns
        where table_schema = 'cs' and table_name = 'ligacoes' and column_name = 'direction'
     ) as existe`,
  );
  if (!col?.existe) {
    return NextResponse.json({
      ok: false,
      reason: "migration_0024_pendente",
      detalhe: "A coluna cs.ligacoes.direction não existe — aplique a migration 0024_cs_ligacoes_atendesimples.sql. Sem ela, o webhook não grava as chamadas.",
    });
  }

  const resumo = await queryOne(
    `select
       count(*)::int as total,
       count(*) filter (where comprador_id is not null)::int as com_aluno,
       count(*) filter (where comprador_id is null)::int as sem_aluno,
       count(*) filter (where direction = 'outbound')::int as feitas,
       count(*) filter (where direction = 'inbound')::int as recebidas,
       count(*) filter (where criado_em > now() - interval '24 hours')::int as ultimas_24h,
       max(criado_em) as ultima_em
     from cs.ligacoes where provider = 'atendesimples'`,
  );

  const por_status = await query(
    `select coalesce(status_pabx, '—') as status_pabx, coalesce(resultado, '—') as resultado, count(*)::int as qtd
       from cs.ligacoes where provider = 'atendesimples'
      group by 1, 2 order by qtd desc`,
  );

  const recentes = await query(
    `select criado_em, direction, status_pabx, resultado, from_number, dnis,
            operador as atendente, (comprador_id is not null) as casou_aluno, evento, duracao_seg
       from cs.ligacoes where provider = 'atendesimples'
      order by criado_em desc limit 20`,
  );

  return NextResponse.json({ ok: true, resumo, por_status, recentes });
}
