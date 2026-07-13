import { NextResponse } from "next/server";
import { isAuthed, getSessao } from "@/lib/auth";
import { query, queryOne } from "@/lib/db";
import { parseBody, HmContatoPatchSchema } from "@/lib/validators";
import { moverEstagioHm, registrarPagamentoHm, addNotaHm, reverterEstagioHm, setResponsavelHm, HM_STAGE_ENTREVISTA } from "@/lib/services/hm";

export const runtime = "nodejs";

// GET: detalhe do card HM + timeline + formulários (Respondi).
export async function GET(_req: Request, { params }: { params: { id: string } }) {
  if (!isAuthed()) return NextResponse.json({ ok: false }, { status: 401 });
  const compradorId = params.id;

  const contato = await queryOne<{ [k: string]: unknown }>(
    `select comprador_id, nome, email, telefone, turma, turma_origem, plano, categoria_entrada,
            estagio_chave, estagio_nome, estagio_aba, responsavel,
            reuniao_em, reuniao_resultado, entrevista_em, entrevista_resultado,
            pagamento_forma, pagamento_parcelas, pagamento_em, apto_ativacao,
            pagamento_meio, pagamento_previsto_em, acordo, oferta_saldo_codigo, link_saldo_enviado_em,
            nao_contatar, nao_contatar_motivo, revisar, revisar_motivo,
            ativ_searchie, ativ_comunidade, ativ_grupo, ativ_pesquisa, grupo_informes, pendencia,
            cancelamento_em, cancelamento_motivo, link_facebook,
            tags, observacoes, criado_em
       from cs.contatos_hm_kanban where comprador_id = $1`,
    [compradorId],
  );
  if (!contato) return NextResponse.json({ ok: false, reason: "não encontrado" }, { status: 404 });

  // Sócios convidados (aba "SÓCIOS T39"). `aluno_id` preenchido = já está na base.
  const socios = await query(
    `select s.id, s.nome, s.email, s.telefone, s.link_facebook,
            s.ativ_searchie, s.ativ_comunidade, s.ativ_grupo, s.aluno_id
       from cs.hm_socios s
       join cs.contatos_hm ch on ch.id = s.contato_hm_id
      where ch.comprador_id = $1
      order by s.criado_em`,
    [compradorId],
  );

  // Crédito pró-rata: o que o aluno da base já pagou e ainda não usou. Só existe
  // se alguém preencheu os insumos (oferta anterior, data e valor) — sem eles o
  // saldo é o cheio (14.700). Ver cs.fn_hm_prorata (0056).
  const prorata = await queryOne(
    `select dias_usados, dias_restantes, valor_dia, consumido, credito, saldo_a_pagar
       from cs.fn_hm_prorata($1)`,
    [compradorId],
  );

  // Link de saldo sugerido: cada valor de saldo tem sua própria oferta na Hotmart
  // (o desconto do pró-rata vem embutido no valor — 0049). Sabendo o saldo, o
  // sistema escolhe o link certo em vez de o operador procurar numa aba de planilha.
  const alvo = (prorata as { saldo_a_pagar?: string } | null)?.saldo_a_pagar ?? "14700";
  const linksSaldo = await query(
    `select distinct on (recorrente) codigo, valor, recorrente, link
       from cs.hm_ofertas_saldo
      where ativo and valor is not null
      order by recorrente, abs(valor - $1::numeric)`,
    [alvo],
  );

  const timeline = await query(
    `select i.tipo, i.descricao, i.autor, i.criado_em
       from cs.interacoes i
       join cs.contatos_hm ch on ch.id = i.contato_hm_id
      where ch.comprador_id = $1
      order by i.criado_em desc
      limit 200`,
    [compradorId],
  );

  // Formulários do comprador (Respondi / HT). Mesma tabela cs.formularios.
  const formularios = await query(
    `select tipo, respostas, pontuacao, respondido_em
       from cs.formularios where comprador_id = $1
      order by respondido_em desc nulls last`,
    [compradorId],
  );

  // Bloco financeiro: o que já foi registrado + a sugestão para o formulário de
  // pagamento. A sugestão vem de cs.fn_hm_sugestao_financeira porque o papel do
  // app não lê public.compras / hm_product_catalog (RLS sem grant).
  const financeiro = await queryOne(
    `select ch.valor_total, ch.valor_pago, ch.aluno_id, ch.categoria_entrada,
            s.sugestao_valor_total, s.hotmart_bruto
       from cs.contatos_hm ch,
            lateral cs.fn_hm_sugestao_financeira(ch.comprador_id) s
      where ch.comprador_id = $1`,
    [compradorId],
  );

  return NextResponse.json({ ok: true, contato, timeline, formularios, financeiro, prorata, linksSaldo, socios });
}

// PATCH: atualiza estágio / campos da ficha HM / pagamento do saldo / nota.
export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const sessao = await getSessao();
  if (!sessao) return NextResponse.json({ ok: false }, { status: 401 });
  const operador = sessao.nome || "cs";
  const compradorId = params.id;
  const parsed = await parseBody(req, HmContatoPatchSchema);
  if (!parsed.ok) return parsed.res;
  const b = parsed.data;

  const atual = await queryOne<{ id: string; estagio_chave: string | null; reuniao_em: string | null }>(
    `select ch.id, est.chave as estagio_chave, ch.reuniao_em
       from cs.contatos_hm ch left join cs.estagios est on est.id = ch.estagio_id
      where ch.comprador_id = $1`,
    [compradorId],
  );
  if (!atual) return NextResponse.json({ ok: false, reason: "não encontrado" }, { status: 404 });

  // Desfazer o último movimento (miss click) — ação isolada, ignora os demais campos.
  if (b.reverter) {
    const ok = await reverterEstagioHm(compradorId, operador);
    return NextResponse.json({ ok, reason: ok ? undefined : "sem_movimento_para_reverter" });
  }

  // Campos simples da ficha (atualiza só os enviados; string vazia limpa).
  const sets: string[] = [];
  const vals: unknown[] = [atual.id];
  const add = (col: string, v: unknown) => {
    sets.push(`${col} = $${vals.length + 1}`);
    vals.push(v === "" ? null : v);
  };
  if (b.observacoes !== undefined) add("observacoes", b.observacoes);
  if (b.plano !== undefined) add("plano", b.plano);
  if (b.reuniao_resultado !== undefined) add("reuniao_resultado", b.reuniao_resultado);
  if (b.entrevista_resultado !== undefined) add("entrevista_resultado", b.entrevista_resultado);
  if (b.reuniao_em !== undefined) sets.push(`reuniao_em = ${b.reuniao_em ? `$${vals.push(b.reuniao_em)}::timestamptz` : "null"}`);
  if (b.entrevista_em !== undefined) sets.push(`entrevista_em = ${b.entrevista_em ? `$${vals.push(b.entrevista_em)}::timestamptz` : "null"}`);
  if (b.tags !== undefined) { sets.push(`tags = $${vals.length + 1}`); vals.push(b.tags); }

  // Acordo do saldo — o gargalo que vivia em texto solto na planilha.
  if (b.pagamento_meio !== undefined) add("pagamento_meio", b.pagamento_meio);
  if (b.acordo !== undefined) add("acordo", b.acordo);
  if (b.oferta_saldo_codigo !== undefined) add("oferta_saldo_codigo", b.oferta_saldo_codigo);
  if (b.pagamento_previsto_em !== undefined) sets.push(`pagamento_previsto_em = ${b.pagamento_previsto_em ? `$${vals.push(b.pagamento_previsto_em)}::date` : "null"}`);
  // Marcar "link enviado" carimba a hora — um booleano perderia o "quando", que é
  // o que permite cobrar quem recebeu o link e não pagou.
  if (b.link_saldo_enviado !== undefined) {
    sets.push(`link_saldo_enviado_em = ${b.link_saldo_enviado ? "now()" : "null"}`);
  }

  // Travas operacionais — o operador precisa VER isso antes de ligar.
  if (b.nao_contatar !== undefined) add("nao_contatar", b.nao_contatar);
  if (b.nao_contatar_motivo !== undefined) add("nao_contatar_motivo", b.nao_contatar_motivo);
  if (b.revisar !== undefined) add("revisar", b.revisar);
  if (b.revisar_motivo !== undefined) add("revisar_motivo", b.revisar_motivo);

  // Checklist de ativação + o que falta para concluir.
  if (b.ativ_searchie !== undefined) add("ativ_searchie", b.ativ_searchie);
  if (b.ativ_comunidade !== undefined) add("ativ_comunidade", b.ativ_comunidade);
  if (b.ativ_grupo !== undefined) add("ativ_grupo", b.ativ_grupo);
  if (b.ativ_pesquisa !== undefined) add("ativ_pesquisa", b.ativ_pesquisa);
  if (b.grupo_informes !== undefined) add("grupo_informes", b.grupo_informes);
  if (b.pendencia !== undefined) add("pendencia", b.pendencia);

  // Cancelamento: o motivo. "Pediu reembolso? SIM" sem o porquê não serve a ninguém.
  if (b.cancelamento_motivo !== undefined) add("cancelamento_motivo", b.cancelamento_motivo);
  if (b.link_facebook !== undefined) add("link_facebook", b.link_facebook);

  // Crédito pró-rata (insumos; o crédito e o saldo são conta — cs.fn_hm_prorata).
  if (b.credito_oferta !== undefined) add("credito_oferta", b.credito_oferta);
  if (b.credito_valor_pago !== undefined) add("credito_valor_pago", b.credito_valor_pago);
  if (b.credito_dias_totais !== undefined) add("credito_dias_totais", b.credito_dias_totais);
  if (b.credito_compra_em !== undefined) sets.push(`credito_compra_em = ${b.credito_compra_em ? `$${vals.push(b.credito_compra_em)}::date` : "null"}`);

  if (sets.length) {
    await query(`update cs.contatos_hm set ${sets.join(", ")}, atualizado_em = now() where id = $1`, vals);
  }

  // Responsável — via serviço (registra a mudança na timeline; permite reatribuir).
  if (b.responsavel !== undefined) await setResponsavelHm(compradorId, b.responsavel || null, operador);

  // Agendou reunião estando em "Comprou HM" → avança para "Reunião Agendada".
  if (b.reuniao_em) {
    await addNotaHm(compradorId, `Reunião agendada para ${fmtBr(b.reuniao_em)}`, operador);
    if (atual.estagio_chave === "hm_comprou") await moverEstagioHm(compradorId, "hm_reuniao_agendada", operador);
  }
  if (b.entrevista_em) {
    await addNotaHm(compradorId, `Entrevista agendada para ${fmtBr(b.entrevista_em)}`, operador);
    if (atual.estagio_chave && ["hm_pendente_liberacao", "hm_apto_ativacao", "hm_acesso_liberado", "hm_pagamento_realizado", "hm_comprou", "hm_reuniao_agendada", "hm_reuniao_finalizada"].includes(atual.estagio_chave)) {
      await moverEstagioHm(compradorId, HM_STAGE_ENTREVISTA, operador);
    }
  }

  // Pagamento do saldo (14.700) — provisiona o aluno na base THB e dispara a
  // transição para a Ativação.
  if (b.marcar_pagamento || b.pagamento_forma) {
    await registrarPagamentoHm(
      compradorId,
      b.pagamento_forma ?? "avista",
      b.pagamento_parcelas ?? null,
      b.valor_total ?? null,
      b.valor_pago ?? null,
      operador,
    );
  }

  // Mudança de estágio manual (via seletor) — depois dos automáticos.
  if (b.estagio_chave) await moverEstagioHm(compradorId, b.estagio_chave, operador);

  // Nota manual na timeline.
  if (b.nota && b.nota.trim()) await addNotaHm(compradorId, b.nota.trim(), operador);

  return NextResponse.json({ ok: true });
}

function fmtBr(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
}
