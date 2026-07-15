import { NextResponse } from "next/server";
import { getSessao } from "@/lib/auth";
import { query, queryOne } from "@/lib/db";
import { parseBody, HmAdminEditSchema } from "@/lib/validators";

export const runtime = "nodejs";

// PATCH /api/hm/contato/[id]/admin — a edição plena, só para admin.
// Identidade (nome/e-mail/telefone) corrige a FONTE (public.compradores) e
// espelha na base THB via cs.fn_hm_admin_editar (o role da aplicação não
// escreve nessas tabelas — a função definer é a porta). Financeiro refaz o
// saldo; datas e turma de origem ajustam histórico errado. TUDO fica na
// timeline: a maleabilidade não pode custar a auditoria.
export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const sessao = await getSessao();
  if (!sessao) return NextResponse.json({ ok: false }, { status: 401 });
  if (sessao.papel !== "admin") return NextResponse.json({ ok: false, reason: "só admin edita dados do aluno" }, { status: 403 });
  const p = await parseBody(req, HmAdminEditSchema);
  if (!p.ok) return p.res;
  const b = p.data;
  const compradorId = params.id;

  const atual = await queryOne<{
    id: string; nome: string; email: string | null; telefone: string | null;
    turma_origem: string | null;
  }>(
    `select ch.id, cmp.nome, cmp.email, cmp.telefone, ch.turma_origem
       from cs.contatos_hm ch join public.compradores cmp on cmp.id = ch.comprador_id
      where ch.comprador_id = $1`,
    [compradorId],
  );
  if (!atual) return NextResponse.json({ ok: false, reason: "não encontrado" }, { status: 404 });

  const mudancas: string[] = [];

  // Snapshot para o "Desfazer edição" (A2) — só quando a edição toca campo do
  // card (financeiro/datas/turma). Alterar só nome/e-mail/telefone não gera undo:
  // esses vivem em compradores, fora do alcance do desfazer.
  const tocaCard = b.valor_total !== undefined || b.valor_pago !== undefined
    || b.pagamento_em !== undefined || b.cancelamento_em !== undefined || b.turma_origem !== undefined;
  if (tocaCard) {
    await query(`select cs.fn_hm_undo_registrar($1, $2, $3)`, [compradorId, "edição administrativa", sessao.nome || "admin"]);
  }

  // Identidade + financeiro — na fonte, via definer.
  if (b.nome !== undefined || b.email !== undefined || b.telefone !== undefined || b.valor_total !== undefined || b.valor_pago !== undefined) {
    await queryOne(
      `select cs.fn_hm_admin_editar($1, $2, $3, $4, $5, $6)`,
      [compradorId, b.nome ?? null, b.email ?? null, b.telefone ?? null, b.valor_total ?? null, b.valor_pago ?? null],
    );
    if (b.nome !== undefined && b.nome !== atual.nome) mudancas.push(`nome ("${atual.nome}" → "${b.nome}")`);
    if (b.email !== undefined && b.email !== atual.email) mudancas.push(`e-mail ("${atual.email ?? "—"}" → "${b.email}")`);
    if (b.telefone !== undefined && b.telefone !== atual.telefone) mudancas.push(`telefone ("${atual.telefone ?? "—"}" → "${b.telefone}")`);
    if (b.valor_total !== undefined) mudancas.push(`valor total (${b.valor_total})`);
    if (b.valor_pago !== undefined) mudancas.push(`valor pago (${b.valor_pago})`);
  }

  // Datas do card (ajuste de histórico) — string vazia/null limpa.
  if (b.pagamento_em !== undefined) {
    await query(`update cs.contatos_hm set pagamento_em = ${b.pagamento_em ? "$2::timestamptz" : "null"}, atualizado_em = now() where id = $1`,
      b.pagamento_em ? [atual.id, b.pagamento_em] : [atual.id]);
    mudancas.push(`saldo pago em (${b.pagamento_em ?? "limpo"})`);
  }
  if (b.cancelamento_em !== undefined) {
    await query(`update cs.contatos_hm set cancelamento_em = ${b.cancelamento_em ? "$2::timestamptz" : "null"}, atualizado_em = now() where id = $1`,
      b.cancelamento_em ? [atual.id, b.cancelamento_em] : [atual.id]);
    mudancas.push(`cancelamento em (${b.cancelamento_em ?? "limpo"})`);
  }

  // Turma de origem: troca o campo E a tag "Origem X" junto — senão o filtro
  // do board diria uma coisa e a ficha outra.
  if (b.turma_origem !== undefined && b.turma_origem !== atual.turma_origem) {
    await query(
      `update cs.contatos_hm
          set turma_origem = $2,
              tags = (select coalesce(array_agg(distinct t), '{}')
                        from unnest(array(select x from unnest(coalesce(tags, '{}')) x where x !~ '^Origem ')
                             || case when $2::text is not null then array['Origem ' || $2::text] else '{}'::text[] end) t),
              atualizado_em = now()
        where id = $1`,
      [atual.id, b.turma_origem],
    );
    mudancas.push(`turma de origem ("${atual.turma_origem ?? "—"}" → "${b.turma_origem ?? "—"}")`);
  }

  if (mudancas.length) {
    await query(
      `insert into cs.interacoes (contato_hm_id, tipo, descricao, autor) values ($1, 'sistema', $2, $3)`,
      [atual.id, `[admin] Dados editados: ${mudancas.join(" · ")}`, sessao.nome || "admin"],
    );
  }

  return NextResponse.json({ ok: true, mudancas: mudancas.length });
}
