import { NextResponse } from "next/server";
import { isAuthed } from "@/lib/auth";
import { query, queryOne } from "@/lib/db";

export const runtime = "nodejs";

// GET: detalhe do contato HT + estado de CS + timeline.
export async function GET(_req: Request, { params }: { params: { id: string } }) {
  if (!isAuthed()) return NextResponse.json({ ok: false }, { status: 401 });
  const compradorId = params.id;

  const contato = await queryOne(
    `select v.comprador_id, v.nome, v.email, v.telefone, v.edicao, v.ultima_compra_ht,
            v.estagio_chave, v.estagio_nome, v.responsavel, v.proxima_acao_em,
            v.proxima_acao_nota, v.ultima_resposta_em, v.ultimo_contato_em, v.observacoes,
            v.edicao_ht, v.legado_ativado, v.legado_sla_h, v.legado_ativacao_em,
            v.legado_no_grupo, v.legado_pesquisa, v.legado_ja_ht, v.legado_qtd_ht,
            v.legado_ja_hm, v.legado_e_aluno, v.legado_instrucao, v.primeiro_contato_em,
            v.legado_t_primeiro_contato_h, v.legado_t_ativacao_h
       from cs.contatos_ht v
      where v.comprador_id = $1`,
    [compradorId],
  );
  if (!contato) return NextResponse.json({ ok: false, reason: "não encontrado" }, { status: 404 });

  const timeline = await query(
    `select i.tipo, i.descricao, i.autor, i.criado_em
       from cs.interacoes i
       join cs.contatos c on c.id = i.contato_id
      where c.comprador_id = $1
      order by i.criado_em desc
      limit 200`,
    [compradorId],
  );

  return NextResponse.json({ ok: true, contato, timeline });
}

// PATCH: atualiza estágio / próxima ação / observações; opcionalmente adiciona uma nota.
export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  if (!isAuthed()) return NextResponse.json({ ok: false }, { status: 401 });
  const compradorId = params.id;
  const b = (await req.json().catch(() => ({}))) as {
    estagio_chave?: string;
    proxima_acao_em?: string | null;
    proxima_acao_nota?: string | null;
    observacoes?: string | null;
    nota?: string;
  };

  // mudança de estágio (com log na timeline)
  if (b.estagio_chave) {
    const atual = await queryOne<{ estagio_id: number | null }>(
      `select estagio_id from cs.contatos where comprador_id = $1`,
      [compradorId],
    );
    const novo = await queryOne<{ id: number; nome: string }>(
      `select id, nome from cs.estagios where chave = $1 and ativo`,
      [b.estagio_chave],
    );
    if (novo) {
      await query(
        `update cs.contatos set estagio_id = $2, atualizado_em = now() where comprador_id = $1`,
        [compradorId, novo.id],
      );
      await query(
        `insert into cs.interacoes (contato_id, tipo, descricao, estagio_anterior_id, estagio_novo_id, autor)
         select id, 'mudanca_estagio', $2, $3, $4, 'cs' from cs.contatos where comprador_id = $1`,
        [compradorId, `Estágio alterado para "${novo.nome}"`, atual?.estagio_id ?? null, novo.id],
      );
    }
  }

  // campos de follow-up / observações (atualiza só os enviados)
  await query(
    `update cs.contatos
        set proxima_acao_em  = case when $2::text is not null then nullif($2,'')::timestamptz else proxima_acao_em end,
            proxima_acao_nota = coalesce($3, proxima_acao_nota),
            observacoes       = coalesce($4, observacoes),
            atualizado_em     = now()
      where comprador_id = $1`,
    [
      compradorId,
      b.proxima_acao_em === undefined ? null : (b.proxima_acao_em ?? ""),
      b.proxima_acao_nota ?? null,
      b.observacoes ?? null,
    ],
  );

  // nota manual na timeline
  if (b.nota && b.nota.trim()) {
    await query(
      `insert into cs.interacoes (contato_id, tipo, descricao, autor)
       select id, 'nota', $2, 'cs' from cs.contatos where comprador_id = $1`,
      [compradorId, b.nota.trim()],
    );
  }

  return NextResponse.json({ ok: true });
}
