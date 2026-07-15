import { NextResponse } from "next/server";
import { isAuthed, getSessao } from "@/lib/auth";
import { query, queryOne } from "@/lib/db";
import { parseBody, HmContatoPatchSchema } from "@/lib/validators";
import { moverEstagioHm, registrarPagamentoHm, addNotaHm, reverterEstagioHm, setResponsavelHm, agendarHm, fecharAgendamentoHm, confirmarCancelamentoHm, desfazerCancelamentoHm, HM_STAGE_ENTREVISTA, HM_STAGE_CANCELAMENTO } from "@/lib/services/hm";
import { fichaHm } from "@/lib/services/hm-ficha";

export const runtime = "nodejs";

// GET: detalhe do card HM + timeline + formulários (Respondi). A ficha é montada
// em lib/services/hm-ficha — o mesmo lugar de onde sai o XLSX exportado, para a
// planilha e a tela nunca contarem histórias diferentes.
export async function GET(_req: Request, { params }: { params: { id: string } }) {
  if (!isAuthed()) return NextResponse.json({ ok: false }, { status: 401 });

  const ficha = await fichaHm(params.id);
  if (!ficha) return NextResponse.json({ ok: false, reason: "não encontrado" }, { status: 404 });

  return NextResponse.json({ ok: true, ...ficha });
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

  // Desfazer a última EDIÇÃO de campo (A2) — também isolada. Restaura o snapshot
  // que foi tirado antes daquela edição e some (não dá para desfazer duas vezes).
  if (b.desfazer_edicao) {
    const r = await queryOne<{ res: { ok: boolean; reason?: string } }>(
      `select cs.fn_hm_undo_aplicar($1, $2) as res`, [compradorId, operador],
    );
    const res = r?.res ?? { ok: false, reason: "nada_a_desfazer" };
    return NextResponse.json({ ok: res.ok === true, reason: res.ok ? undefined : (res.reason ?? "nada_a_desfazer") });
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
  // reuniao_em / entrevista_em NÃO são escritas aqui: passam por agendarHm, que
  // sabe distinguir marcar de REMARCAR (e guarda a marcação anterior).
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

  // Revogação dos acessos do cancelado — o inverso do checklist de ativação.
  // O "quando" é carimbado pelo banco quando os quatro caem; o "quem" é este
  // operador. Sem isso, "removi os acessos" seria palavra contra palavra.
  const revogando = b.rev_searchie !== undefined || b.rev_comunidade !== undefined
    || b.rev_grupo !== undefined || b.rev_pesquisa !== undefined;
  if (b.rev_searchie !== undefined) add("rev_searchie", b.rev_searchie);
  if (b.rev_comunidade !== undefined) add("rev_comunidade", b.rev_comunidade);
  if (b.rev_grupo !== undefined) add("rev_grupo", b.rev_grupo);
  if (b.rev_pesquisa !== undefined) add("rev_pesquisa", b.rev_pesquisa);
  if (revogando) add("acessos_revogados_por", operador);
  if (b.link_facebook !== undefined) add("link_facebook", b.link_facebook);
  // Turma do aluno no HM. Trocar a turma troca a tag junto — senão o card diria
  // "Turma T39" no filtro e outra coisa na ficha.
  if (b.turma !== undefined && b.turma) {
    add("turma", b.turma);
    sets.push(
      `tags = (select coalesce(array_agg(distinct t), '{}')
                 from unnest(array(select x from unnest(tags) x where x !~ '^Turma ') || array['Turma ' || $${vals.length + 1}::text]) t)`,
    );
    vals.push(b.turma);
  }

  // Crédito pró-rata (insumos; o crédito e o saldo são conta — cs.fn_hm_prorata).
  if (b.credito_oferta !== undefined) add("credito_oferta", b.credito_oferta);
  if (b.credito_valor_pago !== undefined) add("credito_valor_pago", b.credito_valor_pago);
  if (b.credito_dias_totais !== undefined) add("credito_dias_totais", b.credito_dias_totais);
  if (b.credito_compra_em !== undefined) sets.push(`credito_compra_em = ${b.credito_compra_em ? `$${vals.push(b.credito_compra_em)}::date` : "null"}`);

  // Snapshot para o "Desfazer edição" (A2): guarda o estado ANTES de aplicar os
  // campos. Só quando há edição de campo — mudança de etapa e agendamento têm
  // desfazer próprio e não entram aqui.
  if (sets.length || b.responsavel !== undefined) {
    await query(`select cs.fn_hm_undo_registrar($1, $2, $3)`, [compradorId, resumoEdicao(b), operador]);
  }

  if (sets.length) {
    await query(`update cs.contatos_hm set ${sets.join(", ")}, atualizado_em = now() where id = $1`, vals);
  }

  // Responsável — via serviço (registra a mudança na timeline; permite reatribuir).
  if (b.responsavel !== undefined) await setResponsavelHm(compradorId, b.responsavel || null, operador);

  // Agendar / REAGENDAR. O serviço guarda a marcação anterior e conta quantas
  // vezes o aluno já remarcou — quem remarca três vezes não é "um agendamento",
  // é um sinal. `agendamento_motivo` explica por que a anterior caiu.
  if (b.reuniao_em !== undefined) {
    await agendarHm(compradorId, "reuniao", b.reuniao_em || null, b.agendamento_motivo ?? null, operador);
    // Agendou estando em "Contato Inicial" → avança para "Reunião Agendada".
    if (b.reuniao_em && atual.estagio_chave === "hm_comprou") {
      await moverEstagioHm(compradorId, "hm_reuniao_agendada", operador);
    }
  }
  if (b.entrevista_em !== undefined) {
    await agendarHm(compradorId, "entrevista", b.entrevista_em || null, b.agendamento_motivo ?? null, operador);
    if (b.entrevista_em && atual.estagio_chave && ["hm_pendente_liberacao", "hm_apto_ativacao", "hm_acesso_liberado", "hm_pagamento_realizado", "hm_comprou", "hm_reuniao_agendada", "hm_reuniao_finalizada", "hm_ativacao_contato"].includes(atual.estagio_chave)) {
      await moverEstagioHm(compradorId, HM_STAGE_ENTREVISTA, operador);
    }
  }

  // Fechar a marcação vigente: aconteceu, o aluno não veio, ou foi cancelada.
  if (b.agendamento_status && b.agendamento_tipo) {
    await fecharAgendamentoHm(compradorId, b.agendamento_tipo, b.agendamento_status, b.agendamento_motivo ?? null, operador);
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

  // O cancelamento virou fato: o reembolso saiu (na Hotmart isso chega sozinho
  // pelo webhook; acordo por fora precisa de alguém para dizer). Marca o aluno
  // como cancelado — sem apagá-lo — e abre a pendência de remover os acessos.
  // O card também vai para "Solicitou Cancelamento" se ainda não estiver lá:
  // confirmar um cancelamento de um card que segue no meio da esteira deixaria
  // a coluna contando uma história e a base, outra.
  if (b.confirmar_cancelamento) {
    if (atual.estagio_chave !== HM_STAGE_CANCELAMENTO) {
      await moverEstagioHm(compradorId, HM_STAGE_CANCELAMENTO, operador);
    }
    const r = await confirmarCancelamentoHm(compradorId, b.cancelamento_motivo ?? null, operador);
    if (!r.ok) return NextResponse.json({ ok: false, reason: "falha_ao_cancelar" }, { status: 500 });
  }

  // Enganou-se, ou a Hotmart negou o reembolso depois de lançado: o aluno volta.
  if (b.desfazer_cancelamento) {
    const ok = await desfazerCancelamentoHm(compradorId, operador);
    if (!ok) return NextResponse.json({ ok: false, reason: "falha_ao_desfazer" }, { status: 500 });
  }

  // Nota manual na timeline — ANTES da etapa, porque ela não depende dela: o que
  // o operador escreveu é dele, e uma etapa recusada (checklist incompleto) não
  // pode levar a anotação embora no 400.
  if (b.nota && b.nota.trim()) await addNotaHm(compradorId, b.nota.trim(), operador);

  // Mudança de estágio manual (via seletor) — depois dos automáticos. A recusa
  // volta como 400 com o `faltando` do checklist: a trava de "Ativação
  // Realizada" vale igual em qualquer tela, e a tela diz O QUE falta em vez de
  // recarregar com o card no mesmo lugar sem explicação.
  if (b.estagio_chave) {
    const mov = await moverEstagioHm(compradorId, b.estagio_chave, operador);
    if (!mov.ok) {
      return NextResponse.json({ ok: false, reason: mov.reason, faltando: mov.faltando }, { status: 400 });
    }
  }

  return NextResponse.json({ ok: true });
}

function fmtBr(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

// Rótulo curto do que a edição mudou — vira o texto do botão "Desfazer edição"
// e a nota na timeline. Genérico quando não bate nenhum grupo conhecido.
function resumoEdicao(b: Record<string, unknown>): string {
  const p: string[] = [];
  if (b.observacoes !== undefined) p.push("observações");
  if (b.acordo !== undefined || b.pagamento_meio !== undefined || b.oferta_saldo_codigo !== undefined || b.pagamento_previsto_em !== undefined || b.link_saldo_enviado !== undefined) p.push("acordo do saldo");
  if (b.credito_oferta !== undefined || b.credito_valor_pago !== undefined || b.credito_dias_totais !== undefined || b.credito_compra_em !== undefined) p.push("crédito pró-rata");
  if (b.ativ_searchie !== undefined || b.ativ_comunidade !== undefined || b.ativ_grupo !== undefined || b.ativ_pesquisa !== undefined || b.grupo_informes !== undefined || b.pendencia !== undefined) p.push("ativação");
  if (b.rev_searchie !== undefined || b.rev_comunidade !== undefined || b.rev_grupo !== undefined || b.rev_pesquisa !== undefined) p.push("revogação");
  if (b.nao_contatar !== undefined || b.revisar !== undefined) p.push("travas");
  if (b.tags !== undefined) p.push("tags");
  if (b.turma !== undefined) p.push("turma");
  if (b.responsavel !== undefined) p.push("responsável");
  if (b.reuniao_resultado !== undefined || b.entrevista_resultado !== undefined) p.push("resultado da reunião");
  if (b.cancelamento_motivo !== undefined) p.push("motivo do cancelamento");
  if (b.link_facebook !== undefined) p.push("Facebook");
  return p.length ? p.join(", ") : "edição da ficha";
}
