import { NextResponse } from "next/server";
import { guard } from "@/lib/guard";
import { ehMaster } from "@/lib/papeis";
import { query, queryOne } from "@/lib/db";
import { parseBody, HmContatoPatchSchema } from "@/lib/validators";
import { moverEstagioHm, registrarPagamentoHm, addNotaHm, reverterEstagioHm, atribuirResponsavelHm, podeVerCardHm, podeAgirCardHm, cancelamentoBloqueado, agendarHm, fecharAgendamentoHm, confirmarCancelamentoHm, desfazerCancelamentoHm, HM_STAGE_ENTREVISTA, HM_STAGE_CANCELAMENTO, HM_STAGE_REEMBOLSADO, HM_ESTAGIOS_CANCELAMENTO, type DestinoAtribuicao } from "@/lib/services/hm";
import { fichaHm } from "@/lib/services/hm-ficha";

export const runtime = "nodejs";

// GET: detalhe do card HM + timeline + formulários (Respondi). A ficha é montada
// em lib/services/hm-ficha — o mesmo lugar de onde sai o XLSX exportado, para a
// planilha e a tela nunca contarem histórias diferentes.
export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const g = await guard({ portal: "HM" });
  if (!g.ok) return g.res;
  const sessao = g.sessao;
  // Gating de equipe: uma equipe comum não abre a ficha de um card de outra
  // equipe (nem do GP). O pool e os próprios cards seguem abertos.
  if (!(await podeVerCardHm(sessao, params.id))) {
    return NextResponse.json({ ok: false, reason: "sem_acesso" }, { status: 403 });
  }
  // Trava dos cancelados (27/07, decisão do Marcio): card em Reclamada/Reembolsado
  // não é só imutável para quem não é master — nem ABRE. A ficha inteira (dados,
  // timeline, financeiro) fica restrita ao admin do GP; o card segue visível na
  // listagem, mas o clique é negado. Mesmo reason das escritas: a UI já traduz.
  if (await cancelamentoBloqueado(sessao, params.id)) {
    return NextResponse.json({ ok: false, reason: "cancelamento_so_admin_gp" }, { status: 403 });
  }

  const ficha = await fichaHm(params.id);
  if (!ficha) return NextResponse.json({ ok: false, reason: "não encontrado" }, { status: 404 });

  return NextResponse.json({ ok: true, ...ficha });
}

// PATCH: atualiza estágio / campos da ficha HM / pagamento do saldo / nota.
export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const g = await guard({ portal: "HM" });
  if (!g.ok) return g.res;
  const sessao = g.sessao;
  const operador = sessao.nome || "cs";
  const compradorId = params.id;
  const parsed = await parseBody(req, HmContatoPatchSchema);
  if (!parsed.ok) return parsed.res;
  const b = parsed.data;

  // Gate de AÇÃO (28/07, leitura ≠ ação): editar é ESCRITA — operador só no
  // pool e nos cards DELE. Card de colega da equipe ABRE (GET, escopo de
  // leitura) mas recusa escrita: 403 'card_de_outro_operador' (o front traduz).
  const acao = await podeAgirCardHm(sessao, compradorId);
  if (acao !== "ok") {
    return NextResponse.json({ ok: false, reason: acao }, { status: 403 });
  }

  const atual = await queryOne<{ id: string; estagio_chave: string | null; reuniao_em: string | null; responsavel_id: string | null; atribuicao_admin: boolean }>(
    `select ch.id, est.chave as estagio_chave, ch.reuniao_em, ch.responsavel_id, ch.atribuicao_admin
       from cs.contatos_hm ch left join cs.estagios est on est.id = ch.estagio_id
      where ch.comprador_id = $1`,
    [compradorId],
  );
  if (!atual) return NextResponse.json({ ok: false, reason: "não encontrado" }, { status: 404 });

  // Trava dos cancelados (27/07): card em Reclamada/Reembolsado é IMUTÁVEL para
  // quem não é MASTER (admin do GP) — e mandar um card PARA essas colunas também
  // é só do master. As demais equipes veem, mas não alteram nem confirmam/desfazem.
  const souMaster = ehMaster(sessao);
  if (!souMaster) {
    const jaCancelado = atual.estagio_chave !== null && HM_ESTAGIOS_CANCELAMENTO.includes(atual.estagio_chave);
    const vaiCancelar = !!b.confirmar_cancelamento || !!b.desfazer_cancelamento
      || (!!b.estagio_chave && HM_ESTAGIOS_CANCELAMENTO.includes(b.estagio_chave));
    if (jaCancelado || vaiCancelar) {
      return NextResponse.json({ ok: false, reason: "cancelamento_so_admin_gp" }, { status: 403 });
    }
  }

  // Desfazer o último movimento (miss click) — ação isolada, ignora os demais campos.
  if (b.reverter) {
    const ok = await reverterEstagioHm(compradorId, operador);
    return NextResponse.json({ ok, reason: ok ? undefined : "sem_movimento_para_reverter" });
  }

  // Histórico de versões (0097). Desfazer = recuperar a versão mais recente;
  // restaurar_versao recupera uma específica. Ambos por cs.fn_hm_versao_restaurar.
  if (b.desfazer_edicao || b.restaurar_versao !== undefined) {
    const r = await queryOne<{ res: { ok: boolean; reason?: string } }>(
      `select cs.fn_hm_versao_restaurar($1, $2, $3) as res`,
      [compradorId, b.restaurar_versao ?? null, operador],
    );
    const res = r?.res ?? { ok: false, reason: "nada_a_recuperar" };
    return NextResponse.json({ ok: res.ok === true, reason: res.ok ? undefined : (res.reason ?? "nada_a_recuperar") });
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
  if (b.reuniao_gravacao_url !== undefined) add("reuniao_gravacao_url", b.reuniao_gravacao_url);
  if (b.entrevista_resultado !== undefined) add("entrevista_resultado", b.entrevista_resultado);
  if (b.entrevista_gravacao_url !== undefined) add("entrevista_gravacao_url", b.entrevista_gravacao_url);
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
  if (sets.length || b.responsavel !== undefined || b.responsavel_id !== undefined) {
    await query(`select cs.fn_hm_undo_registrar($1, $2, $3)`, [compradorId, resumoEdicao(b), operador]);
  }

  if (sets.length) {
    await query(`update cs.contatos_hm set ${sets.join(", ")}, atualizado_em = now() where id = $1`, vals);
  }

  // Responsável (atribuir / assumir / devolver ao pool / reatribuir) — por ID
  // (caminho novo) ou por NOME (seletor legado). A hierarquia INTEIRA vive em
  // atribuirResponsavelHm (lib/services/hm), a mesma do /api/hm/lote:
  //   master → qualquer destino, e a atribuição TRAVA o card (0142);
  //   gestor → só membro da própria equipe, sem travar;
  //   operador → só assume para SI um card do pool / devolve ao pool o que é
  //   dele (e sem trava). O nome que não casa com usuário nenhum só o master
  //   grava como texto livre — para os demais era o desvio da hierarquia.
  // (O podeAgirCardHm no topo já garante que o ator só chega a card em que AGE.)
  if (b.responsavel_id !== undefined || b.responsavel !== undefined) {
    const destino: DestinoAtribuicao =
      b.responsavel_id !== undefined
        ? (b.responsavel_id === null ? { tipo: "pool" } : { tipo: "id", id: b.responsavel_id })
        : ((b.responsavel ?? "").trim() === "" ? { tipo: "pool" } : { tipo: "nome", nome: (b.responsavel as string).trim() });
    const r = await atribuirResponsavelHm(sessao, compradorId, destino, operador);
    if (!r.ok) {
      const status = r.reason === "nao_encontrado" ? 404 : r.reason === "destino_invalido" ? 400 : 403;
      return NextResponse.json({ ok: false, reason: r.reason }, { status });
    }
  }

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

  // Pagamento do saldo — provisiona o aluno e vai para a Ativação SÓ se cobrir o
  // pacote inteiro. Sinal/parcial fica registrado com o saldo em aberto, no
  // comercial (0098). A tela avisa quando não finalizou.
  if (b.marcar_pagamento || b.pagamento_forma) {
    const pg = await registrarPagamentoHm(
      compradorId,
      b.pagamento_forma ?? "avista",
      b.pagamento_parcelas ?? null,
      b.valor_total ?? null,
      b.valor_pago ?? null,
      operador,
    );
    if (pg.ok && !pg.finalizado) {
      return NextResponse.json({ ok: true, pagamento_parcial: true, faltam: pg.faltam });
    }
  }

  // O cancelamento virou fato: o reembolso saiu (na Hotmart isso chega sozinho
  // pelo webhook; acordo por fora precisa de alguém para dizer). Marca o aluno
  // como cancelado — sem apagá-lo — e abre a pendência de remover os acessos.
  // O card vai para "Reembolsado" (0101), o estágio do FATO: confirmar um
  // cancelamento sem mover deixaria a coluna contando uma história e a base, outra.
  if (b.confirmar_cancelamento) {
    if (atual.estagio_chave !== HM_STAGE_REEMBOLSADO) {
      await moverEstagioHm(compradorId, HM_STAGE_REEMBOLSADO, operador);
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
  if (b.responsavel !== undefined || b.responsavel_id !== undefined) p.push("responsável");
  if (b.reuniao_resultado !== undefined || b.entrevista_resultado !== undefined) p.push("resultado da reunião");
  if (b.reuniao_gravacao_url !== undefined || b.entrevista_gravacao_url !== undefined) p.push("gravação");
  if (b.cancelamento_motivo !== undefined) p.push("motivo do cancelamento");
  if (b.link_facebook !== undefined) p.push("Facebook");
  return p.length ? p.join(", ") : "edição da ficha";
}
