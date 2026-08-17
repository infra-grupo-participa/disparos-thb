import { NextResponse } from "next/server";
import { guard } from "@/lib/guard";
import { guardProdutoOpcional, produtoDaRequisicao } from "@/lib/produto-hm";
import { ehMaster, nivelDe, temFuncao, podeEscreverEscopoHm, CAMPOS_HM_COMERCIAL, CAMPOS_HM_ATIVACAO } from "@/lib/papeis";
import { query, queryOne } from "@/lib/db";
import { parseBody, HmContatoPatchSchema } from "@/lib/validators";
import { moverEstagioHm, addNotaHm, reverterEstagioHm, atribuirResponsavelHm, podeVerCardHm, podeAgirCardHm, cancelamentoBloqueado, agendarHm, fecharAgendamentoHm, confirmarCancelamentoHm, desfazerCancelamentoHm, veredictoCamposHm, chavesEstagioAntesDaOrdem, HM_STAGE_ENTREVISTA, HM_STAGE_CANCELAMENTO, HM_STAGE_REEMBOLSADO, HM_ESTAGIOS_CANCELAMENTO, type DestinoAtribuicao } from "@/lib/services/hm";
import { fichaHm } from "@/lib/services/hm-ficha";

export const runtime = "nodejs";

// GET: detalhe do card HM + timeline + formulários (Respondi). A ficha é montada
// em lib/services/hm-ficha — o mesmo lugar de onde sai o XLSX exportado, para a
// planilha e a tela nunca contarem histórias diferentes.
export async function GET(_req: Request, { params }: { params: { id: string } }) {
  // 0164: a mesma pessoa pode ter card em HM e AURUM — sem o produto a ficha abriria
  // um dos dois ao acaso. O front manda ?produto= (useFetchHm) nos boards novos.
  //
  // 0187: por isso o gate não pode ser "HM" literal nem "produto ?? HM". Com produto
  // explícito valida aquele portal; SEM produto a ficha pode devolver o card do
  // AURUM/ETHB, então exige-se os três — senão uma conta só-HM lia a ficha completa
  // (telefone, financeiro, observações) de um board alheio só omitindo o parâmetro.
  const g = await guardProdutoOpcional(_req);
  if (!g.ok) return g.res;
  const produtoFicha = g.produto;
  const sessao = g.sessao;
  // Gating de equipe: uma equipe comum não abre a ficha de um card de outra
  // equipe (nem do GP). O pool e os próprios cards seguem abertos.
  if (!(await podeVerCardHm(sessao, params.id, produtoFicha))) {
    return NextResponse.json({ ok: false, reason: "sem_acesso" }, { status: 403 });
  }
  // Trava dos cancelados (27/07, decisão do Marcio): card em Reclamada/Reembolsado
  // não é só imutável para quem não é master — nem ABRE. A ficha inteira (dados,
  // timeline, financeiro) fica restrita ao admin do GP; o card segue visível na
  // listagem, mas o clique é negado. Mesmo reason das escritas: a UI já traduz.
  if (await cancelamentoBloqueado(sessao, params.id)) {
    return NextResponse.json({ ok: false, reason: "cancelamento_so_admin_gp" }, { status: 403 });
  }

  const ficha = await fichaHm(params.id, produtoFicha);
  if (!ficha) return NextResponse.json({ ok: false, reason: "não encontrado" }, { status: 404 });

  // 0217: abrir a ficha É a visualização. Marca a PRIMEIRA (o `is null` no WHERE
  // torna a escrita idempotente: quem abrir depois não sobrescreve quem chegou
  // primeiro, e o UPDATE nem acontece nas outras 297 aberturas do dia).
  //
  // Depois do gate de visibilidade e do gate de cancelado, de propósito: quem
  // levou 403 não olhou o card, e marcar como visto ali apagaria o selo sem
  // ninguém ter visto nada.
  //
  // Falha aqui não pode derrubar a ficha — o selo é sinalização, o conteúdo é o
  // trabalho. Se o UPDATE cair, o card só continua marcado como novo.
  const cardId = (ficha.contato as { contato_hm_id?: string } | null)?.contato_hm_id;
  if (cardId) {
    await query(
      `update cs.contatos_hm
          set visto_em = now(), visto_por = $2
        where id = $1 and visto_em is null`,
      [cardId, sessao.nome || "operador"],
    ).catch(() => undefined);
  }

  return NextResponse.json({ ok: true, ...ficha });
}

// PATCH: atualiza estágio / campos da ficha HM / pagamento do saldo / nota.
export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  // ⚠️ 0187 — mesma correção do GET irmão, e pelo mesmo motivo. Este handler edita
  // um card resolvido por `comprador_id` SEM filtro de produto: com `guard({portal:
  // "HM"})` literal, uma conta sem AURUM editava o card do Aurum de quem não tem
  // card no HM (20 cards hoje nessa situação) — observações, tags, cancelamento e
  // revogação de acesso. Aqui o produto é OBRIGATÓRIO (o PATCH sempre age sobre um
  // card concreto, nunca sobre visão consolidada), então `produtoDaRequisicao`.
  const produtoCard = produtoDaRequisicao(req);
  const g = await guard({ portal: produtoCard });
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
  const acao = await podeAgirCardHm(sessao, compradorId, produtoCard);
  if (acao !== "ok") {
    return NextResponse.json({ ok: false, reason: acao }, { status: 403 });
  }

  const atual = await queryOne<{ id: string; estagio_chave: string | null; estagio_aba: string | null; reuniao_em: string | null; reuniao_resultado: string | null; responsavel_id: string | null; atribuicao_admin: boolean; responsavel_ativacao_id: string | null; entrevista_realizada: boolean; intencao_pagamento: string | null }>(
    // 0187: `and ch.produto = $2` — sem isso, `atual.id` (usado no UPDATE lá
    // embaixo) podia ser o card de OUTRO board. É aqui que a escrita é ancorada.
    // `estagio_aba` (assumir ativação, 12/08): só se decide se o card está na
    // aba ativação DEPOIS de ler o estágio atual — não dá para saber pelo body.
    // `responsavel_ativacao_id` atual: para a nota da timeline dizer "assumiu de
    // Fulano" e o resumoEdicao não confundir "vazio" com "trocou de dono".
    // `entrevista_realizada` (13/08, item 2a — achado da validação final): a
    // trava da entrevista ancorava só na ETAPA (`hm_entrevista_realizada` /
    // `hm_ativacao_realizada`) — quem não é master movia o card PARA FORA
    // dessa etapa (2 cliques), editava a entrevista e devolvia; a trava nunca
    // via. A da reunião não tem esse furo porque ancora no VALOR de
    // `reuniao_resultado` (Realizada/Realizada-pago), que a etapa não apaga.
    // Aqui o equivalente é o FATO em `cs.hm_agendamentos` — sobrevive a
    // qualquer arrasto de etapa, porque nenhum caminho do PATCH escreve nessa
    // tabela além de `fecharAgendamentoHm`.
    `select ch.id, est.chave as estagio_chave, est.aba as estagio_aba, ch.reuniao_em, ch.reuniao_resultado, ch.responsavel_id, ch.atribuicao_admin, ch.responsavel_ativacao_id, ch.intencao_pagamento,
            exists (
              select 1 from cs.hm_agendamentos ag
               where ag.contato_hm_id = ch.id and ag.tipo = 'entrevista' and ag.status = 'realizado'
            ) as entrevista_realizada
       from cs.contatos_hm ch left join cs.estagios est on est.id = ch.estagio_id
      where ch.comprador_id = $1 and ch.produto = $2`,
    [compradorId, produtoCard],
  );
  if (!atual) return NextResponse.json({ ok: false, reason: "não encontrado" }, { status: 404 });

  // Dados de TRANSAÇÃO só entram pela Hotmart (30/07, decisão do Marcio). Nenhum
  // colaborador — nem o master — "marca como pago" ou digita valor pago/saldo à
  // mão: um pagamento inexistente na Hotmart não pode virar aluno ativo (foi o
  // caso da Kelly). Se a Hotmart não refletiu, o certo é catalogar a oferta de
  // saldo que faltou (cs.hm_ofertas_saldo + public.hm_product_catalog) — aí o
  // trigger cs.fn_seed_contato_hm move o card sozinho. Estes campos são recusados
  // no servidor, não só escondidos na tela.
  if (b.marcar_pagamento || b.pagamento_forma !== undefined || b.valor_total !== undefined || b.valor_pago !== undefined) {
    return NextResponse.json({ ok: false, reason: "pagamento_so_hotmart" }, { status: 403 });
  }
  if (b.saldo_a_pagar_manual !== undefined) {
    return NextResponse.json({ ok: false, reason: "saldo_so_hotmart" }, { status: 403 });
  }

  // Trava dos cancelados (27/07): card em Reclamada/Reembolsado é IMUTÁVEL para
  // quem não é MASTER (admin do GP) — e mandar um card PARA essas colunas também
  // é só do master. As demais equipes veem, mas não alteram nem confirmam/desfazem.
  const souMaster = ehMaster(sessao);

  // REUNIÃO FINALIZADA É REGISTRO, NÃO CAMPO (12/08, pedido do Marcio): "como a
  // reunião foi finalizada a gente não precisa mais mexer — não quero que o
  // pessoal da ativação mexa aí". Depois da reunião o card VIVE na ativação, e
  // ali qualquer um do fluxo abriria a ficha e reescreveria data ou resultado
  // de um evento que já aconteceu.
  //
  // Trava só os três campos da reunião — o resto da ficha continua editável, que
  // é o trabalho da ativação. O master corrige (mesmo critério do cancelado).
  //
  // Aqui, no SERVIDOR: o `disabled` da tela é conforto, não regra. Quem chamar a
  // rota direto (ou com a aba aberta de antes da trava) leva 403 igual.
  //
  // ⚠️ Calculado FORA do `if (!souMaster)` (0219, achado do pentester): o gate
  // de nome de campo abaixo não é o único jeito de escrever nestas colunas —
  // `desfazer_edicao`/`restaurar_versao` (mais abaixo) também escrevem, e
  // precisam da MESMA resposta a "a reunião/entrevista já terminou?" para
  // saber quais colunas excluir do restore. Ver o bloco de versão/desfazer.
  const reuniaoFinalizada = atual.reuniao_resultado === "Realizada"
    || atual.reuniao_resultado === "Realizada/pago"
    || atual.estagio_chave === "hm_reuniao_finalizada";
  // ENTREVISTA FINALIZADA É REGISTRO, NÃO CAMPO (12/08, mesmo pedido do Marcio
  // que travou a reunião — "algumas etapas podem ser truncadas... evita que o
  // pessoal mexa e cause problema"). A entrevista de ativação é o espelho
  // exato da reunião comercial (mesmo formato: data, resultado, gravação) e
  // tem a mesma etapa de chegada dedicada — `hm_entrevista_realizada`, cujo
  // nome na tela é "Entrevista Finalizada" (renomeada na 0042). Diferente da
  // reunião, `entrevista_resultado` é texto livre (sem os valores fixos de
  // RESULTADOS) — por isso o sinal de "já aconteceu" é só a ETAPA: o card
  // está em "Entrevista Finalizada" ou já passou dela, para "Ativação
  // Realizada" (a linha de chegada seguinte na mesma aba).
  //
  // Trava só os três campos da entrevista — o resto da ficha (checklist,
  // acordo do saldo, etc.) segue editável, que é o trabalho da ativação
  // continuando depois da entrevista. O master corrige, mesmo critério da
  // reunião e do cancelado.
  //
  // ⚠️ 13/08 (item 2a): NÃO ancora mais na etapa. Ancorada só em
  // `estagio_chave`, a trava tinha um furo de 2 passos: mover o card para
  // FORA de `hm_entrevista_realizada`/`hm_ativacao_realizada` (arrasto livre,
  // sem passar pela trava — ela só olha campos NOMEADOS de
  // entrevista/reunião, não o próprio `estagio_chave`), editar
  // `entrevista_resultado`/`entrevista_gravacao_url` com o card já fora
  // dessas etapas (a checagem abaixo lia `entrevistaFinalizada = false`) e
  // devolver o card. A da reunião nunca teve esse furo porque ancora no VALOR
  // de `reuniao_resultado` — a etapa some, o valor não. Aqui o equivalente é
  // o FATO em `cs.hm_agendamentos` (`entrevista_realizada`, resolvido na
  // query de `atual` acima): sobrevive a qualquer arrasto de etapa.
  const entrevistaFinalizada = atual.entrevista_realizada;

  if (!souMaster) {
    const jaCancelado = atual.estagio_chave !== null && HM_ESTAGIOS_CANCELAMENTO.includes(atual.estagio_chave);
    const vaiCancelar = !!b.confirmar_cancelamento || !!b.desfazer_cancelamento
      || (!!b.estagio_chave && HM_ESTAGIOS_CANCELAMENTO.includes(b.estagio_chave));
    if (jaCancelado || vaiCancelar) {
      return NextResponse.json({ ok: false, reason: "cancelamento_so_admin_gp" }, { status: 403 });
    }

    const mexeNaReuniao = b.reuniao_em !== undefined
      || b.reuniao_resultado !== undefined
      || b.reuniao_gravacao_url !== undefined
      || (b.agendamento_status !== undefined && b.agendamento_tipo === "reuniao");
    if (reuniaoFinalizada && mexeNaReuniao) {
      return NextResponse.json({ ok: false, reason: "reuniao_finalizada_travada" }, { status: 403 });
    }

    const mexeNaEntrevista = b.entrevista_em !== undefined
      || b.entrevista_resultado !== undefined
      || b.entrevista_gravacao_url !== undefined
      || (b.agendamento_status !== undefined && b.agendamento_tipo === "entrevista");
    if (entrevistaFinalizada && mexeNaEntrevista) {
      return NextResponse.json({ ok: false, reason: "entrevista_finalizada_travada" }, { status: 403 });
    }
  }

  // SEPARAÇÃO DURA COMERCIAL × ATIVAÇÃO (13/08, pedido literal do Marcio —
  // lib/papeis.ts tem a regra completa e o porquê). Gate de CAMPO, roda DEPOIS
  // do gate de CARD (podeAgirCardHm, lá em cima): mesmo card autorizado — por
  // dono, equipe, ação livre da equipe principal do GP ou esteira
  // compartilhada — um `responsavel_id`/campo de reunião no body de quem só
  // tem HM:ativacao, ou um `responsavel_ativacao_id`/checklist/entrevista de
  // quem só tem HM:comercial, cai aqui. `camposPresentes`: as CHAVES do body
  // cuja escrita foi pedida — inclui `reuniao_em`/`entrevista_em` também
  // quando chegam por `agendamento_tipo` (fecharAgendamentoHm), que não tem
  // nome de campo próprio no body.
  const camposPresentes = Object.keys(b).filter((k) => (b as Record<string, unknown>)[k] !== undefined);
  if (b.agendamento_tipo === "reuniao") camposPresentes.push("reuniao_em");
  if (b.agendamento_tipo === "entrevista") camposPresentes.push("entrevista_em");
  const veredictoCampo = await veredictoCamposHm(sessao, camposPresentes, b.estagio_chave ?? null);
  if (veredictoCampo !== "ok") {
    return NextResponse.json({ ok: false, reason: veredictoCampo }, { status: 403 });
  }

  // Desfazer o último movimento (miss click) — ação isolada, ignora os demais campos.
  if (b.reverter) {
    const ok = await reverterEstagioHm(compradorId, operador);
    return NextResponse.json({ ok, reason: ok ? undefined : "sem_movimento_para_reverter" });
  }

  // Histórico de versões (0097). Desfazer = recuperar a versão mais recente;
  // restaurar_versao recupera uma específica. Ambos por cs.fn_hm_versao_restaurar.
  //
  // ⚠️ 0219 (achado do pentester): "desfazer edição"/"restaurar versão" escreve
  // nas MESMAS colunas que a trava da reunião/entrevista finalizada protege
  // (reuniao_resultado, reuniao_gravacao_url, entrevista_resultado,
  // entrevista_gravacao_url) — SEM passar pelo gate por nome de campo lá em
  // cima, porque o body não menciona esses nomes. `colunasTravadas` é a MESMA
  // resposta (reuniaoFinalizada/entrevistaFinalizada, calculados fora do
  // `if (!souMaster)` acima) — o 4º argumento da função faz o snapshot
  // ignorar essas colunas quando quem pediu não é master. Master continua
  // restaurando tudo (mesmo critério do cancelado e da trava original).
  //
  // ⚠️ 13/08: MESMO bypass, para a separação comercial×ativação — sem isso,
  // "desfazer edição" reescrevia `responsavel_id`/`responsavel` (comercial) ou
  // `ativ_*`/`grupo_informes`/`pendencia`/`rev_*` (ativação) de quem não tem a
  // função daquele escopo, sem passar pelo gate de NOME de campo acima (o
  // body de `desfazer_edicao` não menciona esses nomes — é o MESMO desenho de
  // furo que o 0219 fechou para reunião/entrevista). Reaproveita o mesmo
  // parâmetro da função — `fn_hm_versao_restaurar` já ignora qualquer coluna
  // que não estiver no snapshot, então listar CAMPOS_HM_COMERCIAL/
  // CAMPOS_HM_ATIVACAO inteiros é seguro mesmo quando a versão não tocou
  // metade deles.
  if (b.desfazer_edicao || b.restaurar_versao !== undefined) {
    // `Set` deduplica: reuniao_resultado/reuniao_gravacao_url (e os gêmeos da
    // entrevista) podem entrar por DUAS regras ao mesmo tempo (etapa
    // finalizada + escopo sem função) — sem dedup a mensagem da timeline
    // listaria a mesma coluna repetida.
    const colunasTravadas = souMaster
      ? []
      : Array.from(new Set([
          ...(reuniaoFinalizada ? ["reuniao_resultado", "reuniao_gravacao_url"] : []),
          ...(entrevistaFinalizada ? ["entrevista_resultado", "entrevista_gravacao_url"] : []),
          ...(!podeEscreverEscopoHm(sessao, "comercial") ? CAMPOS_HM_COMERCIAL : []),
          ...(!podeEscreverEscopoHm(sessao, "ativacao") ? CAMPOS_HM_ATIVACAO : []),
        ]));
    const r = await queryOne<{ res: { ok: boolean; reason?: string } }>(
      // 0220: `produtoCard` no 5o argumento — sem ele a funcao resolvia o card
      // por comprador_id sem produto e, para quem tem card no HM E no AURUM,
      // restaurava por cima do board errado (achado no ensaio da 0219).
      `select cs.fn_hm_versao_restaurar($1, $2, $3, $4, $5) as res`,
      [compradorId, b.restaurar_versao ?? null, operador, colunasTravadas.length ? colunasTravadas : null, produtoCard],
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

  // Desfecho comercial da reunião (D2, 0281/0284) — declaração, não dado de
  // pagamento (o gate `pagamento_so_hotmart` no topo já barra isso). Carimba
  // a hora só quando o VALOR muda de fato — reenviar o mesmo valor não deve
  // reescrever "quando foi dito".
  if (b.intencao_pagamento !== undefined && b.intencao_pagamento !== atual.intencao_pagamento) {
    add("intencao_pagamento", b.intencao_pagamento);
    sets.push(`intencao_pagamento_em = ${b.intencao_pagamento ? "now()" : "null"}`);
  }
  if (b.intencao_pagamento_obs !== undefined) add("intencao_pagamento_obs", b.intencao_pagamento_obs);
  if (b.oferta_saldo_codigo !== undefined) add("oferta_saldo_codigo", b.oferta_saldo_codigo);
  if (b.pagamento_previsto_em !== undefined) sets.push(`pagamento_previsto_em = ${b.pagamento_previsto_em ? `$${vals.push(b.pagamento_previsto_em)}::date` : "null"}`);
  // Marcar "link enviado" carimba a hora — um booleano perderia o "quando", que é
  // o que permite cobrar quem recebeu o link e não pagou.
  if (b.link_saldo_enviado !== undefined) {
    sets.push(`link_saldo_enviado_em = ${b.link_saldo_enviado ? "now()" : "null"}`);
  }
  // (saldo_a_pagar_manual removido em 30/07: saldo vem só da Hotmart — rejeitado no topo.)

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
  // Valor financeiro do cancelamento (0152): a reembolsar/reter.
  if (b.cancelamento_valor !== undefined) add("cancelamento_valor", b.cancelamento_valor);

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
  // Motivo do pró-rata manual (0207/F4) — por que este crédito foi concedido.
  if (b.credito_obs !== undefined) add("credito_obs", b.credito_obs);

  // Snapshot para o "Desfazer edição" (A2): guarda o estado ANTES de aplicar os
  // campos. Só quando há edição de campo — mudança de etapa e agendamento têm
  // desfazer próprio e não entram aqui.
  if (sets.length || b.responsavel !== undefined || b.responsavel_id !== undefined || b.responsavel_ativacao_id !== undefined) {
    // 0220: o retrato e do CARD deste board, nunca de um card qualquer da pessoa.
    await query(`select cs.fn_hm_undo_registrar($1, $2, $3, $4)`, [compradorId, resumoEdicao(b), operador, produtoCard]);
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

  // "Assumir a ativação" (pedido do Marcio, 12/08): responsavel_ativacao_id é
  // um SEGUNDO dono, só para a aba Ativação — coexiste com `responsavel_id`
  // (o operador VIGENTE, geralmente do comercial) em vez de substituí-lo.
  // Ex.: Kelly vendeu (responsavel_id=Kelly, comercial), Ana Camila assume a
  // ativação (responsavel_ativacao_id=Ana) — os dois ficam registrados.
  //
  // ⚠️ Distinto de `responsavel_comercial_id`: aquele é IMUTÁVEL por trigger
  // (fn_hm_congela_comercial, 0212) — quem vendeu não se reescreve. Este campo
  // NÃO tem trava de banco (conferido: só existe trigger de congelamento para
  // o comercial) — a permissão de troca é só esta checagem de aplicação.
  //
  // REGRA DE PERMISSÃO (decisão desta implementação, documentada porque não
  // veio pronta do pedido):
  //   · quem tem a FUNÇÃO 'HM:ativacao' (temFuncao — hoje Ana Camila/Thomas,
  //     lib/papeis) — é o time cujo trabalho é justamente ativar o aluno;
  //   · OU master/gestor (nivelDe ≠ 'operador') — quem já distribui cards
  //     também pode redistribuir a ativação;
  //   · um operador SEM a função de ativação e sem nível de gestão NÃO assume
  //     — senão qualquer operador do comercial poderia "roubar" a ativação de
  //     quem realmente cuida dela. Regra frouxa (qualquer operador) foi
  //     descartada de propósito.
  // SÓ na aba ATIVAÇÃO do card: comercial não tem ativação para assumir — o
  // pedido do Marcio nasceu explicitamente do momento "quando o lead vai para
  // a ativação". Fora da aba, a rota recusa (400, não 403 — não é permissão,
  // é o card ainda não ter chegado lá).
  if (b.responsavel_ativacao_id !== undefined) {
    const podeAssumirAtivacao = temFuncao(sessao, "HM", "ativacao") || nivelDe(sessao) !== "operador";
    if (!podeAssumirAtivacao) {
      return NextResponse.json({ ok: false, reason: "sem_permissao_ativacao" }, { status: 403 });
    }
    if (atual.estagio_aba !== "ativacao") {
      return NextResponse.json({ ok: false, reason: "fora_da_ativacao" }, { status: 400 });
    }
    let novoDono: { id: string; nome: string } | null = null;
    if (b.responsavel_ativacao_id !== null) {
      novoDono = await queryOne<{ id: string; nome: string }>(
        `select id, nome from cs.usuarios where id = $1 and ativo`,
        [b.responsavel_ativacao_id],
      );
      if (!novoDono) return NextResponse.json({ ok: false, reason: "destino_invalido" }, { status: 400 });
    }
    await query(`update cs.contatos_hm set responsavel_ativacao_id = $2, atualizado_em = now() where id = $1`, [atual.id, b.responsavel_ativacao_id]);
    // Timeline (alimenta o relatório e a ficha): quem assumiu, e de quem —
    // "assumiu" só quando não havia ninguém, "reatribuiu" quando havia outro
    // dono de ativação diferente, "devolveu" quando o novo valor é null.
    const descricaoAtivacao = novoDono
      ? (atual.responsavel_ativacao_id ? `Ativação reatribuída para ${novoDono.nome}` : `${novoDono.nome} assumiu a ativação deste aluno`)
      : "Ativação devolvida (sem responsável de ativação)";
    await query(
      `insert into cs.interacoes (contato_hm_id, tipo, descricao, autor) values ($1, 'sistema', $2, $3)`,
      [atual.id, descricaoAtivacao, operador],
    );
  }

  // "Sinalizei que enviei a mensagem" (D1, B5): o operador confirma que já
  // mandou a primeira abordagem. Carimba o gesto e, se o card ainda está em
  // "Contato Inicial" (chegou, ninguém falou com ele), avança para
  // "Aguardando Retorno" — o GATILHO da Hotmart que criou o card não muda,
  // só o estágio anda. Fica ANTES do bloco de agendamento porque os dois
  // fazem a mesma pergunta ("saiu de Contato Inicial?") e só um precisa
  // decidir por vez — se o operador marcar o sinal E agendar a reunião no
  // mesmo PATCH, o agendamento (mais forte) prevalece por rodar depois.
  if (b.contato_inicial_sinalizado) {
    await query(
      `update cs.contatos_hm set contato_inicial_em = coalesce(contato_inicial_em, now()), atualizado_em = now() where id = $1`,
      [atual.id],
    );
    await query(
      `insert into cs.interacoes (contato_hm_id, tipo, descricao, autor) values ($1, 'sistema', $2, $3)`,
      [atual.id, "Operador sinalizou que já enviou a primeira mensagem", operador],
    );
    if (atual.estagio_chave === "hm_comprou") {
      await moverEstagioHm(compradorId, "hm_aguardando_retorno", operador, undefined, produtoCard);
    }
  }

  // Agendar / REAGENDAR. O serviço guarda a marcação anterior e conta quantas
  // vezes o aluno já remarcou — quem remarca três vezes não é "um agendamento",
  // é um sinal. `agendamento_motivo` explica por que a anterior caiu.
  if (b.reuniao_em !== undefined) {
    // 13/08 (item 2b): `produtoCard` no 6º argumento — sem ele, agendarHm
    // resolvia o card por comprador_id sem produto e, para as 15 pessoas com
    // card no HM e no AURUM, marcava a reunião pelo board errado.
    await agendarHm(compradorId, "reuniao", b.reuniao_em || null, b.agendamento_motivo ?? null, operador, produtoCard);
    // REGRA 9: agendar puxa o card para "Reunião Agendada" a partir de
    // QUALQUER estágio comercial de ordem < 20 (hm_aguardando_pagamento,
    // hm_comprou, hm_aguardando_retorno hoje) — lido do banco (ordem de
    // cs.estagios), não uma lista de chaves digitada à mão. Quem já está em
    // ordem >= 20 NÃO é puxado para trás: remarcar a reunião de alguém que
    // já avançou (Pagamento, Ativação) não pode regredir o card.
    if (b.reuniao_em && atual.estagio_chave && (await chavesEstagioAntesDaOrdem(20)).includes(atual.estagio_chave)) {
      await moverEstagioHm(compradorId, "hm_reuniao_agendada", operador, undefined, produtoCard);
    }
  }
  if (b.entrevista_em !== undefined) {
    await agendarHm(compradorId, "entrevista", b.entrevista_em || null, b.agendamento_motivo ?? null, operador, produtoCard);
    // Mesma fonte (ordem de cs.estagios): "antes da própria entrevista" é
    // ordem < 90 (a ordem de hm_entrevista_agendada) — cobre todo o
    // Comercial e o começo da Ativação, sem listar chave por chave (o array
    // de 8 strings ficava desatualizado a cada estágio novo — foi o caso de
    // hm_aguardando_pagamento/hm_aguardando_retorno, que nunca entraram nele).
    if (b.entrevista_em && atual.estagio_chave && (await chavesEstagioAntesDaOrdem(90)).includes(atual.estagio_chave)) {
      await moverEstagioHm(compradorId, HM_STAGE_ENTREVISTA, operador, undefined, produtoCard);
    }
  }

  // Fechar a marcação vigente: aconteceu, o aluno não veio, ou foi cancelada.
  if (b.agendamento_status && b.agendamento_tipo) {
    // 13/08 (item 2b): mesmo motivo — `produtoCard` também aqui.
    await fecharAgendamentoHm(compradorId, b.agendamento_tipo, b.agendamento_status, b.agendamento_motivo ?? null, operador, produtoCard);
  }

  // (Pagamento do saldo manual removido em 30/07: pagamento vira aluno ativo SÓ
  // pela Hotmart, via trigger cs.fn_seed_contato_hm. Rejeitado no topo do handler.)

  // O cancelamento virou fato: o reembolso saiu (na Hotmart isso chega sozinho
  // pelo webhook; acordo por fora precisa de alguém para dizer). Marca o aluno
  // como cancelado — sem apagá-lo — e abre a pendência de remover os acessos.
  // O card vai para "Reembolsado" (0101), o estágio do FATO: confirmar um
  // cancelamento sem mover deixaria a coluna contando uma história e a base, outra.
  if (b.confirmar_cancelamento) {
    if (atual.estagio_chave !== HM_STAGE_REEMBOLSADO) {
      await moverEstagioHm(compradorId, HM_STAGE_REEMBOLSADO, operador, undefined, produtoCard);
    }
    // 13/08 (item 2c): `produtoCard` — sem ele, confirmar o cancelamento de UM
    // board podia cancelar o OUTRO (desempate de fn_hm_cancelar prefere HM).
    const r = await confirmarCancelamentoHm(compradorId, b.cancelamento_motivo ?? null, operador, produtoCard);
    if (!r.ok) return NextResponse.json({ ok: false, reason: "falha_ao_cancelar" }, { status: 500 });
  }

  // Enganou-se, ou a Hotmart negou o reembolso depois de lançado: o aluno volta.
  if (b.desfazer_cancelamento) {
    const ok = await desfazerCancelamentoHm(compradorId, operador, produtoCard);
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
    // 0187: o movimento tem de cair no card DESTE board.
    const mov = await moverEstagioHm(compradorId, b.estagio_chave, operador, undefined, produtoCard);
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
  if (b.intencao_pagamento !== undefined || b.intencao_pagamento_obs !== undefined) p.push("intenção de pagamento");
  if (b.credito_oferta !== undefined || b.credito_valor_pago !== undefined || b.credito_dias_totais !== undefined || b.credito_compra_em !== undefined || b.credito_obs !== undefined) p.push("crédito pró-rata");
  if (b.ativ_searchie !== undefined || b.ativ_comunidade !== undefined || b.ativ_grupo !== undefined || b.ativ_pesquisa !== undefined || b.grupo_informes !== undefined || b.pendencia !== undefined) p.push("ativação");
  if (b.rev_searchie !== undefined || b.rev_comunidade !== undefined || b.rev_grupo !== undefined || b.rev_pesquisa !== undefined) p.push("revogação");
  if (b.nao_contatar !== undefined || b.revisar !== undefined) p.push("travas");
  if (b.tags !== undefined) p.push("tags");
  if (b.turma !== undefined) p.push("turma");
  if (b.responsavel !== undefined || b.responsavel_id !== undefined) p.push("responsável");
  if (b.responsavel_ativacao_id !== undefined) p.push("responsável de ativação");
  if (b.reuniao_resultado !== undefined || b.entrevista_resultado !== undefined) p.push("resultado da reunião");
  if (b.reuniao_gravacao_url !== undefined || b.entrevista_gravacao_url !== undefined) p.push("gravação");
  if (b.cancelamento_motivo !== undefined) p.push("motivo do cancelamento");
  if (b.link_facebook !== undefined) p.push("Facebook");
  return p.length ? p.join(", ") : "edição da ficha";
}
