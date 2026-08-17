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
  // 0263: CPF e endereço entram aqui também (opcionais) — a ficha ganhou os
  // mesmos campos que o formulário do Respondi manda.
  const r = await queryOne<{ acao: string; substituiu: string | null }>(
    `select acao, substituiu from cs.fn_hm_socio_upsert(
       $1, $2, nullif(trim($3), ''), nullif(trim($4), ''), nullif(trim($5), ''),
       nullif(trim($6), ''), nullif(trim($7), ''), nullif(trim($8), ''), nullif(trim($9), ''),
       nullif(trim($10), ''), nullif(trim($11), ''), nullif(trim($12), ''), nullif(trim($13), ''),
       nullif(trim($14), ''), null, $15)`,
    [
      card.id, p.data.nome.trim(), p.data.cpf ?? "", p.data.email ?? "", p.data.telefone ?? "",
      p.data.cep ?? "", p.data.cidade ?? "", p.data.estado ?? "", p.data.bairro ?? "",
      p.data.pais ?? "", p.data.endereco ?? "", p.data.numero ?? "", p.data.complemento ?? "",
      p.data.observacao ?? "", `ficha:${sessao.nome || "cs"}`,
    ],
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
  // 0263: produto explícito — sem ele, quem tem card em dois boards (HM+AURUM)
  // provisiona o sócio pelo comprador_id errado (0221).
  await provisionarSociosHm(params.id, sessao.nome || "cs", produtoCard);

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

  // 0263: identidade (nome/email/telefone/cpf) passa a rotear por
  // cs.fn_hm_socio_upsert — um único juiz de identidade em todos os caminhos de
  // escrita (webhook, ficha manual). Antes o PATCH gravava esses campos direto
  // na tabela, furando a regra de "CPF decide" que a 0201/0203 mandaram entrar
  // só por um caminho. Só dispara se algum desses 4 campos veio no corpo.
  const socioAtual = await queryOne<{ nome: string; email: string | null; telefone: string | null; cpf: string | null }>(
    `select nome, email, telefone, cpf from cs.hm_socios where id = $1 and contato_hm_id = $2 and substituido_em is null`,
    [b.socioId, card.id],
  );
  if (!socioAtual) return NextResponse.json({ ok: false, reason: "socio não encontrado" }, { status: 404 });

  if (b.nome !== undefined || b.email !== undefined || b.telefone !== undefined || b.cpf !== undefined) {
    // ⚠️ O upsert age sobre o sócio VIGENTE do card, não sobre um id: só faz
    // sentido chamá-lo se o alvo do PATCH é justamente o vigente. Sem esta
    // guarda, um PATCH mirando outro `socioId` escreveria no vigente por tabela.
    // (O `socioAtual` acima já exige `substituido_em is null`, então chegar aqui
    // com outro alvo significa que o id não é o vigente — recusa em vez de
    // escrever na pessoa errada.)
    const vigente = await queryOne<{ id: string }>(
      `select id from cs.hm_socios where contato_hm_id = $1 and substituido_em is null`,
      [card.id],
    );
    if (vigente?.id !== b.socioId) {
      return NextResponse.json({ ok: false, reason: "socio_nao_vigente" }, { status: 409 });
    }

    const r = await queryOne<{ acao: string; substituiu: string | null }>(
      `select acao, substituiu from cs.fn_hm_socio_upsert(
         $1, $2, nullif(trim($3), ''), nullif(trim($4), ''), nullif(trim($5), ''),
         null, null, null, null, null, null, null, null, null, null, $6)`,
      [
        card.id,
        (b.nome ?? socioAtual.nome).trim(),
        b.cpf !== undefined ? b.cpf ?? "" : socioAtual.cpf ?? "",
        b.email !== undefined ? b.email ?? "" : socioAtual.email ?? "",
        b.telefone !== undefined ? b.telefone ?? "" : socioAtual.telefone ?? "",
        `ficha:${sessao.nome || "cs"}`,
      ],
    );
    // Trocar o CPF pela ficha é "pessoa nova" para a regra da 0203: o upsert
    // ARQUIVA o sócio e cria outro. Isso não pode passar em silêncio — é o mesmo
    // evento que o webhook anuncia na timeline. Sem esta nota, uma correção de
    // CPF digitado errado arquivava alguém sem deixar rastro visível ao comercial.
    if (r?.acao === "substituido" && r.substituiu) {
      await addNotaHm(
        params.id,
        `Sócio trocado: ${r.substituiu} → ${(b.nome ?? socioAtual.nome).trim()} (o anterior fica no histórico)`,
        sessao.nome || "cs",
      );
    }
  }

  // O resto (checklist, Facebook, estágio) NÃO é identidade — é operação da
  // Ativação, segue como UPDATE direto na linha vigente.
  const sets: string[] = [];
  const vals: unknown[] = [b.socioId, card.id];
  const add = (col: string, v: unknown) => {
    sets.push(`${col} = $${vals.length + 1}`);
    vals.push(v === "" ? null : v);
  };
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
    // O `contato_hm_id` e o `substituido_em is null` no where impedem editar
    // sócio de outro card, ou um sócio já arquivado (identidade imutável).
    await query(
      `update cs.hm_socios set ${sets.join(", ")}, atualizado_em = now()
        where id = $1 and contato_hm_id = $2 and substituido_em is null`,
      vals,
    );
  }
  return NextResponse.json({ ok: true });
}

// DELETE ?socioId= — remove o convite do CARD. Não apaga o aluno na base: se o
// sócio já foi provisionado, quem desfaz isso é a base mestre, não o kanban.
//
// 0263: arquivamento, não DELETE físico. cs.hm_socios_historico tem `on delete
// cascade` (0201) — apagar a linha apagaria o log de mudanças da pessoa, e
// `substituido_por` (`on delete set null`) romperia a cadeia de trocas de quem
// vier depois. `cs.vw_hm_socios` já filtra `substituido_em is null`, então o
// card some da tela sem mudar nenhum componente. `substituido_por` fica NULL de
// propósito: isto é remoção, não troca por outro sócio.
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
    `update cs.hm_socios set substituido_em = now(), atualizado_em = now()
      where id = $1 and contato_hm_id = $2 and substituido_em is null
      returning nome, aluno_id`,
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
