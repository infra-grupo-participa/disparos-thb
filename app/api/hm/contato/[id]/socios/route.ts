import { NextResponse } from "next/server";
import { guard } from "@/lib/guard";
import { produtoDaRequisicao } from "@/lib/produto-hm";
import { query, queryOne } from "@/lib/db";
import { parseBody, HmSocioCriarSchema, HmSocioPatchSchema } from "@/lib/validators";
import { addNotaHm, provisionarSociosHm, podeAgirCardHm, cancelamentoBloqueado } from "@/lib/services/hm";

export const runtime = "nodejs";

// Sócios convidados do card HM (aba "SÓCIOS T39" da planilha). O sócio tem
// checklist próprio — ele também é ativado, pendurado no titular. Quando o
// titular já é aluno, gravar um sócio o provisiona na base (mesma turma, mesma
// validade, vinculado ao titular).

async function cardDo(compradorId: string, produto: string) {
  return queryOne<{ id: string; nome: string }>(
    // 0187: `and ch.produto = $2` — é esta seleção que ancora a escrita em
    // cs.hm_socios; sem ela, o sócio ia parar no card de outro board.
    `select ch.id, cmp.nome
       from cs.contatos_hm ch join public.compradores cmp on cmp.id = ch.comprador_id
      where ch.comprador_id = $1 and ch.produto = $2`,
    [compradorId, produto],
  );
}

// POST — adiciona um sócio ao card.
export async function POST(req: Request, { params }: { params: { id: string } }) {
  // 0187: o portal validado é o do produto PEDIDO. Com "HM" literal, quem tem
  // só HM agia sobre o card do AURUM/ETHB de quem não tem card no HM.
  const produtoCard = produtoDaRequisicao(req);
  const g = await guard({ portal: produtoCard });
  if (!g.ok) return g.res;
  const sessao = g.sessao;
  // Gate de AÇÃO (28/07, leitura ≠ ação): mexer nos sócios é ESCRITA no card —
  // card de colega recusa com 403 'card_de_outro_operador' (o front traduz).
  const acao = await podeAgirCardHm(sessao, params.id, produtoCard);
  if (acao !== "ok") return NextResponse.json({ ok: false, reason: acao }, { status: 403 });
  // Card cancelado: quem não é master não abre a ficha — logo também não mexe
  // nos sócios dela (era um furo da trava de escrita dos cancelados).
  if (await cancelamentoBloqueado(sessao, params.id)) return NextResponse.json({ ok: false, reason: "cancelamento_so_admin_gp" }, { status: 403 });
  const p = await parseBody(req, HmSocioCriarSchema);
  if (!p.ok) return p.res;

  const card = await cardDo(params.id, produtoCard);
  if (!card) return NextResponse.json({ ok: false, reason: "não encontrado" }, { status: 404 });

  // 0203: UM sócio vigente por titular. O cadastro manual passa pela MESMA função
  // do webhook do Respondi — se já existe sócio, o novo SUBSTITUI (o anterior é
  // arquivado, não apagado). Antes isto era um insert direto com `on conflict do
  // nothing` que nunca conflitava; hoje o índice `hm_socios_um_vigente_uniq`
  // recusaria o segundo, e o operador veria um erro cru de banco.
  const r = await queryOne<{ acao: string; substituiu: string | null }>(
    `select acao, substituiu from cs.fn_hm_socio_upsert(
       $1, $2, null, nullif(trim($3), ''), nullif(trim($4), ''),
       null, null, null, null, null, null, null, null, null, null, $5)`,
    [card.id, p.data.nome.trim(), p.data.email ?? "", p.data.telefone ?? "", `ficha:${sessao.nome || "cs"}`],
  );
  // A troca de sócio é um evento que o comercial precisa ver na timeline —
  // diferente de uma correção de telefone, que passa em silêncio.
  await addNotaHm(
    params.id,
    r?.acao === "substituido" && r.substituiu
      ? `Sócio trocado: ${r.substituiu} → ${p.data.nome.trim()} (o anterior fica no histórico)`
      : `Sócio convidado: ${p.data.nome.trim()}`,
    sessao.nome || "cs",
  );
  await provisionarSociosHm(params.id, sessao.nome || "cs");

  return NextResponse.json({ ok: true });
}

// PATCH — edita o sócio (checklist, contato, Facebook). body: { socioId, ... }
export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  // 0187: o portal validado é o do produto PEDIDO. Com "HM" literal, quem tem
  // só HM agia sobre o card do AURUM/ETHB de quem não tem card no HM.
  const produtoCard = produtoDaRequisicao(req);
  const g = await guard({ portal: produtoCard });
  if (!g.ok) return g.res;
  const sessao = g.sessao;
  // Gate de AÇÃO (28/07, leitura ≠ ação): mexer nos sócios é ESCRITA no card —
  // card de colega recusa com 403 'card_de_outro_operador' (o front traduz).
  const acao = await podeAgirCardHm(sessao, params.id, produtoCard);
  if (acao !== "ok") return NextResponse.json({ ok: false, reason: acao }, { status: 403 });
  if (await cancelamentoBloqueado(sessao, params.id)) return NextResponse.json({ ok: false, reason: "cancelamento_so_admin_gp" }, { status: 403 });
  const p = await parseBody(req, HmSocioPatchSchema);
  if (!p.ok) return p.res;
  const b = p.data;

  const card = await cardDo(params.id, produtoCard);
  if (!card) return NextResponse.json({ ok: false, reason: "não encontrado" }, { status: 404 });

  const sets: string[] = [];
  const vals: unknown[] = [b.socioId, card.id];
  const add = (col: string, v: unknown) => {
    sets.push(`${col} = $${vals.length + 1}`);
    vals.push(v === "" ? null : v);
  };
  if (b.nome !== undefined) add("nome", b.nome);
  if (b.email !== undefined) add("email", b.email);
  if (b.telefone !== undefined) add("telefone", b.telefone);
  if (b.link_facebook !== undefined) add("link_facebook", b.link_facebook);
  if (b.ativ_searchie !== undefined) add("ativ_searchie", b.ativ_searchie);
  if (b.ativ_comunidade !== undefined) add("ativ_comunidade", b.ativ_comunidade);
  if (b.ativ_grupo !== undefined) add("ativ_grupo", b.ativ_grupo);
  // Arrastar o sócio (0150): a chave vira o id do estágio; "" / null solta a
  // fixação e o card volta a derivar a coluna dos 3 acessos.
  if (b.estagio_chave !== undefined) {
    const est = b.estagio_chave
      ? await queryOne<{ id: number }>(`select id from cs.estagios where evento = 'HM' and chave = $1`, [b.estagio_chave])
      : null;
    add("estagio_id", est?.id ?? null);
  }

  if (sets.length) {
    // O `contato_hm_id` no where impede editar sócio de outro card por id solto.
    await query(
      `update cs.hm_socios set ${sets.join(", ")}, atualizado_em = now()
        where id = $1 and contato_hm_id = $2`,
      vals,
    );
  }
  return NextResponse.json({ ok: true });
}

// DELETE ?socioId= — remove o convite. Não apaga o aluno na base: se o sócio já
// foi provisionado, quem desfaz isso é a base mestre, não o kanban.
export async function DELETE(req: Request, { params }: { params: { id: string } }) {
  // 0187: o portal validado é o do produto PEDIDO. Com "HM" literal, quem tem
  // só HM agia sobre o card do AURUM/ETHB de quem não tem card no HM.
  const produtoCard = produtoDaRequisicao(req);
  const g = await guard({ portal: produtoCard });
  if (!g.ok) return g.res;
  const sessao = g.sessao;
  // Gate de AÇÃO (28/07, leitura ≠ ação): mexer nos sócios é ESCRITA no card —
  // card de colega recusa com 403 'card_de_outro_operador' (o front traduz).
  const acao = await podeAgirCardHm(sessao, params.id, produtoCard);
  if (acao !== "ok") return NextResponse.json({ ok: false, reason: acao }, { status: 403 });
  if (await cancelamentoBloqueado(sessao, params.id)) return NextResponse.json({ ok: false, reason: "cancelamento_so_admin_gp" }, { status: 403 });
  const socioId = new URL(req.url).searchParams.get("socioId");
  if (!socioId) return NextResponse.json({ ok: false, reason: "socioId ausente" }, { status: 400 });

  const card = await cardDo(params.id, produtoCard);
  if (!card) return NextResponse.json({ ok: false, reason: "não encontrado" }, { status: 404 });

  const s = await queryOne<{ nome: string; aluno_id: string | null }>(
    `delete from cs.hm_socios where id = $1 and contato_hm_id = $2 returning nome, aluno_id`,
    [socioId, card.id],
  );
  if (s) {
    await addNotaHm(
      params.id,
      s.aluno_id
        ? `Sócio removido do card: ${s.nome} — o cadastro dele na base THB foi mantido`
        : `Sócio removido do card: ${s.nome}`,
      sessao.nome || "cs",
    );
  }
  return NextResponse.json({ ok: true });
}
