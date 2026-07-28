import { query, queryOne } from "@/lib/db";
import { logger } from "@/lib/log";
import { ehMaster, escopoVisibilidade, nivelDe, podeAtribuirPara, type Ator, type Papel, type TipoEquipe } from "@/lib/papeis";
import { podeVerPorEscopo, veredictoAcao, type VeredictoAcao } from "@/lib/services/visibilidade";

const log = logger("hm");

// Serviço do módulo Holding Masters (evento 'HM'). Opera o overlay isolado
// cs.contatos_hm (uma linha por comprador), reaproveitando cs.interacoes para
// a timeline. NÃO toca cs.contatos (HT/SEM). Sem disparos — só esteira/ficha.

export const HM_STAGE_PAGAMENTO = "hm_pagamento_realizado";
// Cancelamento tem dois estágios (0101): "Reclamada" (hm_cancelamento) é o PEDIDO;
// "Reembolsado" (hm_reembolsado) é o FATO — reembolso confirmado/executado.
export const HM_STAGE_CANCELAMENTO = "hm_cancelamento";
export const HM_STAGE_REEMBOLSADO = "hm_reembolsado";
export const HM_STAGE_PENDENTE = "hm_pendente_liberacao";
export const HM_STAGE_ACESSO = "hm_acesso_liberado";
// A linha de chegada da esteira (0065): só entra quem cumpriu o checklist inteiro.
export const HM_STAGE_ATIVACAO_REALIZADA = "hm_ativacao_realizada";
export const HM_STAGE_ENTREVISTA = "hm_entrevista_agendada";

type EstagioHm = { id: number; chave: string; nome: string; aba: string | null; ordem: number };

async function estagioPorChave(chave: string): Promise<EstagioHm | null> {
  return queryOne<EstagioHm>(
    `select id, chave, nome, aba, ordem from cs.estagios where chave = $1 and evento = 'HM' and ativo`,
    [chave],
  );
}

async function addInteracaoHm(
  contatoHmId: string,
  tipo: string,
  descricao: string,
  autor: string,
  estagioAnteriorId?: number | null,
  estagioNovoId?: number | null,
) {
  await query(
    `insert into cs.interacoes (contato_hm_id, tipo, descricao, autor, estagio_anterior_id, estagio_novo_id)
     values ($1, $2, $3, $4, $5, $6)`,
    [contatoHmId, tipo, descricao, autor, estagioAnteriorId ?? null, estagioNovoId ?? null],
  );
}

// Onde o card deve parar dentro da coluna. `antesDe` é o comprador_id do card
// que ficará logo ABAIXO dele; null = fim da fila. A posição é uma âncora, e não
// um índice, porque o board pode estar filtrado (busca, responsável, turma): o
// operador enxerga uma fatia da coluna, mas "antes do João" continua valendo na
// coluna inteira. Ausente (undefined) = sem gesto de posição — o card vai para o
// topo, que é onde a novidade pede atenção (chegada por webhook, troca de etapa
// pela ficha, redirecionamento do próprio servidor).
export type PosicaoHm = { antesDe: string | null };

// O checklist de ativação (Searchie, comunidade THB, grupo de informes, pesquisa)
// É a definição de "ativado" — por isso ele TRAVA a saída de "Acesso Liberado".
// Sem isso, o card avança para a entrevista com a ativação pela metade e ninguém
// mais descobre o que ficou faltando (era o papel da coluna "O que está pendente
// para conclusão" da planilha).
const CHECKLIST: { col: string; label: string }[] = [
  { col: "ativ_searchie", label: "Acesso ao Searchie/Óbvio" },
  { col: "ativ_comunidade", label: "Acesso à comunidade THB" },
  { col: "ativ_grupo", label: "Grupo de informes" },
  { col: "ativ_pesquisa", label: "Pesquisa" },
];

export type MoverErro = "estagio_invalido" | "checklist_incompleto" | "saldo_em_aberto";
export type MoverResultado = { ok: true } | { ok: false; reason: MoverErro; faltando?: string[]; faltam?: number };

// Itens do checklist que ainda faltam. Lista vazia = ativação completa.
export async function checklistPendente(compradorId: string): Promise<string[]> {
  const r = await queryOne<Record<string, boolean>>(
    `select ${CHECKLIST.map((c) => c.col).join(", ")} from cs.contatos_hm where comprador_id = $1`,
    [compradorId],
  );
  if (!r) return [];
  return CHECKLIST.filter((c) => !r[c.col]).map((c) => c.label);
}

// Reescreve a ordem (1..N) da coluna inteira com o card na posição pedida.
// Reordenar não é editar o card: não mexe em atualizado_em (o desempate e o
// "tempo na etapa" do board dependem dele) e não escreve na timeline.
async function reposicionarNaColuna(contatoHmId: string, estagioId: number, posicao?: PosicaoHm) {
  const fila = await query<{ id: string; comprador_id: string }>(
    `select id, comprador_id
       from cs.contatos_hm
      where estagio_id = $1 and id <> $2
      order by ordem, atualizado_em desc`,
    [estagioId, contatoHmId],
  );

  const antes = posicao?.antesDe ?? null;
  const ancora = antes ? fila.findIndex((f) => f.comprador_id === antes) : -1;
  // Sem gesto → topo. Âncora nula (ou que já saiu da coluna) → fim.
  const idx = !posicao ? 0 : ancora >= 0 ? ancora : fila.length;

  const ids = fila.map((f) => f.id);
  ids.splice(idx, 0, contatoHmId);

  await query(
    `update cs.contatos_hm c
        set ordem = n.ord
       from unnest($1::uuid[], $2::int[]) as n(id, ord)
      where c.id = n.id and c.ordem is distinct from n.ord`,
    [ids, ids.map((_, i) => i + 1)],
  );
}

// Move o card HM de etapa e o posiciona na coluna de destino. Regra especial: ao
// entrar em "Pagamento Realizado", registra o pagamento e joga automaticamente
// para a Ativação (1ª etapa — "Pendente de Liberação"), marcando o card como
// pago (apto_ativacao).
// Ao voltar para uma etapa da aba Comercial um card que estava pago (veio
// da Ativação), limpa apto_ativacao/pagamento — mantém o estado consistente
// tanto no seletor livre quanto no "desfazer" (evita card pago no Comercial).
// Retorna false se a etapa/contato não existem.
export async function moverEstagioHm(
  compradorId: string,
  chave: string,
  autor = "cs",
  posicao?: PosicaoHm,
): Promise<MoverResultado> {
  const novo = await estagioPorChave(chave);
  if (!novo) return { ok: false, reason: "estagio_invalido" };

  const ch = await queryOne<{ id: string; estagio_id: number | null; apto_ativacao: boolean; estagio_chave: string | null }>(
    `select ch.id, ch.estagio_id, ch.apto_ativacao, e.chave as estagio_chave
       from cs.contatos_hm ch left join cs.estagios e on e.id = ch.estagio_id
      where ch.comprador_id = $1`,
    [compradorId],
  );
  if (!ch) return { ok: false, reason: "estagio_invalido" };
  // Mesma coluna: o arrasto foi só vertical — reordena e pronto, sem timeline.
  if (ch.estagio_id === novo.id && chave !== HM_STAGE_PAGAMENTO) {
    if (posicao) await reposicionarNaColuna(ch.id, novo.id, posicao);
    return { ok: true };
  }

  // Só finaliza (apto/aluno) quem tem o SALDO coberto (0098). Sinal ou pagamento
  // parcial não entra na Ativação nem no "Pagamento Realizado" — fica no comercial,
  // com o saldo em aberto no contas a receber. Foi por aqui que o Décio (só sinal)
  // virou apto. Não trava o resto do board: só a entrada no estado de "pago".
  const vaiFinalizar = chave === HM_STAGE_PAGAMENTO || (novo.aba === "ativacao" && !ch.apto_ativacao);
  if (vaiFinalizar) {
    const g = await queryOne<{ pode: boolean; faltam: number | null }>(
      `select cs.fn_hm_pode_finalizar($1) as pode,
              (select greatest(coalesce(f.saldo_a_perseguir,0),0) from cs.vw_hm_financeiro f where f.comprador_id=$1) as faltam`,
      [compradorId],
    );
    if (!g?.pode) return { ok: false, reason: "saldo_em_aberto", faltam: g?.faltam ?? undefined };
  }

  // A ÚNICA trava do board: "Ativação Realizada" é a linha de chegada, e só entra
  // nela quem cumpriu o checklist inteiro (Searchie, comunidade, grupo, pesquisa).
  // A trava guarda a porta de uma coluna — não prende o card no meio do caminho:
  // todo o resto do kanban se move livremente, para frente e para trás.
  if (chave === HM_STAGE_ATIVACAO_REALIZADA) {
    const faltando = await checklistPendente(compradorId);
    if (faltando.length > 0) return { ok: false, reason: "checklist_incompleto", faltando };
  }

  // Transição automática Comercial → Ativação ao confirmar o pagamento do saldo.
  // O card cai em "Pendente de Liberação" (ponto de partida da aba Ativação).
  if (chave === HM_STAGE_PAGAMENTO) {
    // Onde o card cai depende de já haver acesso: quem só renovou (a matrícula
    // dele ainda está válida) não precisa que ninguém crie acesso — vai direto
    // para "Acesso Liberado". Cadastro novo passa por "Pendente de Liberação",
    // porque lá alguém de fato cria o acesso na plataforma.
    const destinoChave = await queryOne<{ etapa: string }>(
      `select cs.fn_hm_etapa_pos_pagamento($1) as etapa`,
      [compradorId],
    );
    const pendente = await estagioPorChave(destinoChave?.etapa || HM_STAGE_PENDENTE);
    if (!pendente) return { ok: false, reason: "estagio_invalido" };
    await query(
      `update cs.contatos_hm
          set estagio_id = $2, pagamento_em = coalesce(pagamento_em, now()),
              apto_ativacao = true, atualizado_em = now()
        where id = $1`,
      [ch.id, pendente.id],
    );
    await addInteracaoHm(ch.id, "sistema", "Pagamento realizado — pendente de liberação", autor);
    await addInteracaoHm(ch.id, "mudanca_estagio", `Movido para "${pendente.nome}"`, autor, ch.estagio_id, pendente.id);
    // O destino real não é a coluna onde o card foi solto — a posição pedida era
    // da fila do Comercial e não diz nada sobre a fila da Ativação: entra no topo.
    await reposicionarNaColuna(ch.id, pendente.id);

    // Arrastar o card é dizer "pagou" — e quem pagou precisa existir na base
    // mestre, senão o GPS nunca cria o acesso dele. Até a migration 0051 só o
    // botão "Registrar pagamento" da ficha provisionava, e os cards arrastados
    // ficavam na Ativação sem cadastro nenhum. Os valores saem das compras da
    // Hotmart; quando não dão para afirmar (acordo fora da plataforma, parcela),
    // o aluno nasce marcado para conferência — nunca com um número inventado.
    // Blindado: a base mestre é de outro domínio e não pode travar o board.
    try {
      const r = await queryOne<{ aluno_id: string | null }>(
        `select cs.fn_hm_provisionar_derivado($1) as aluno_id`,
        [compradorId],
      );
      if (r?.aluno_id) {
        await addInteracaoHm(ch.id, "sistema", "Aluno criado/atualizado na base THB", autor);
        // O sócio acompanha o titular: agora que ele é aluno, os convidados dele
        // também entram na base (mesma turma, mesma validade).
        await provisionarSociosHm(compradorId, autor);
      }
    } catch (e) {
      log.error("falha ao provisionar aluno ao mover para pago", e, { compradorId });
      await addInteracaoHm(ch.id, "sistema", "Falha ao criar o aluno na base THB — use “Registrar pagamento” na ficha", autor);
    }
    return { ok: true };
  }

  // Cancelamento é a única saída do Comercial que NÃO desfaz o pagamento: se a
  // pessoa pagou e depois pediu reembolso, o dinheiro entrou — apagar o
  // financeiro reescreveria o histórico. O card só sai da esteira de Ativação
  // (a aba do estágio é quem decide isso) e fica registrado como cancelamento.
  //
  // Arrastar o card é a SOLICITAÇÃO — e ela não toca na base. Quem pediu
  // reembolso pode ter o pedido negado pela Hotmart (fora dos 7 dias) ou
  // simplesmente desistir de cancelar; marcar o aluno aqui seria condená-lo pela
  // intenção. O aluno só é marcado quando o cancelamento vira FATO: o webhook da
  // Hotmart (PURCHASE_REFUNDED e afins) ou a confirmação manual — confirmarCancelamentoHm.
  if (chave === HM_STAGE_CANCELAMENTO) {
    await query(
      `update cs.contatos_hm
          set estagio_id = $2, cancelamento_em = coalesce(cancelamento_em, now()), atualizado_em = now()
        where id = $1`,
      [ch.id, novo.id],
    );
    await addInteracaoHm(ch.id, "sistema", "Solicitou cancelamento — card fora da esteira de Ativação (o acesso continua valendo até o cancelamento ser confirmado)", autor);
    await addInteracaoHm(ch.id, "mudanca_estagio", `Movido para "${novo.nome}"`, autor, ch.estagio_id, novo.id);
    await reposicionarNaColuna(ch.id, novo.id, posicao);
    return { ok: true };
  }

  // "Reembolsado" é o FATO (reembolso confirmado/executado). Quem marca o aluno e
  // pede a remoção de acesso é o confirmarCancelamentoHm/o webhook — chamados à
  // parte. Aqui só posicionamos o card, sem passar pela lógica de "voltar ao
  // Comercial desfaz o pagamento" (que não faz sentido para um reembolso).
  if (chave === HM_STAGE_REEMBOLSADO) {
    await query(`update cs.contatos_hm set estagio_id = $2, atualizado_em = now() where id = $1`, [ch.id, novo.id]);
    await addInteracaoHm(ch.id, "mudanca_estagio", `Movido para "${novo.nome}"`, autor, ch.estagio_id, novo.id);
    await reposicionarNaColuna(ch.id, novo.id, posicao);
    return { ok: true };
  }

  // Voltar para o Comercial um card pago: tira a MARCA de pago (apto_ativacao),
  // que é o estado operacional — mas preserva o FATO (a data, a forma, as
  // parcelas). Apagar a data reescreveria o histórico, e era pior do que parece:
  // quem tirasse o card da Ativação e o devolvesse depois via a data do pagamento
  // virar "hoje", porque não havia mais o original para reaproveitar. É a mesma
  // regra que o cancelamento já seguia — o dinheiro entrou, e isso não se apaga.
  const voltandoAoComercial = novo.aba === "comercial" && ch.apto_ativacao;
  if (voltandoAoComercial) {
    await query(
      `update cs.contatos_hm
          set estagio_id = $2, apto_ativacao = false, atualizado_em = now()
        where id = $1`,
      [ch.id, novo.id],
    );
    await addInteracaoHm(ch.id, "sistema", "Pagamento desfeito — de volta ao Comercial (a data do pagamento fica registrada)", autor);
    await addInteracaoHm(ch.id, "mudanca_estagio", `Movido para "${novo.nome}"`, autor, ch.estagio_id, novo.id);
    await reposicionarNaColuna(ch.id, novo.id, posicao);
    return { ok: true };
  }

  // Entrar na Ativação por movimento livre — arrastando direto para "Acesso
  // Liberado", por exemplo, sem passar por "Pagamento Realizado". A esteira de
  // Ativação é, por definição, a de quem já quitou: um card lá sem a marca de
  // pago faz o sistema mentir duas vezes (o relatório o conta como devendo, e o
  // aluno nunca nasce na base — era o buraco que a 0051 fechou). Então mover para
  // lá É dizer "pagou": o card ganha a marca, e o aluno é provisionado.
  const entrandoNaAtivacao = novo.aba === "ativacao" && !ch.apto_ativacao;
  if (entrandoNaAtivacao) {
    await query(
      `update cs.contatos_hm
          set estagio_id = $2, apto_ativacao = true,
              pagamento_em = coalesce(pagamento_em, now()), atualizado_em = now()
        where id = $1`,
      [ch.id, novo.id],
    );
    await addInteracaoHm(ch.id, "sistema", `Card movido para a Ativação ("${novo.nome}") — pagamento considerado confirmado`, autor);
  } else {
    await query(
      `update cs.contatos_hm set estagio_id = $2, atualizado_em = now() where id = $1`,
      [ch.id, novo.id],
    );
  }
  await addInteracaoHm(ch.id, "mudanca_estagio", `Movido para "${novo.nome}"`, autor, ch.estagio_id, novo.id);
  await reposicionarNaColuna(ch.id, novo.id, posicao);

  // Chegou na linha de chegada — e só chega quem cumpriu o checklist inteiro.
  if (chave === HM_STAGE_ATIVACAO_REALIZADA) {
    await addInteracaoHm(ch.id, "sistema", "Ativação concluída — checklist completo (Searchie, comunidade, grupo e pesquisa)", autor);
  }

  // Quem está na Ativação precisa existir na base mestre, senão o GPS nunca cria
  // o acesso dele. Blindado: a base é de outro domínio e não pode travar o board.
  if (entrandoNaAtivacao) {
    try {
      const r = await queryOne<{ aluno_id: string | null }>(
        `select cs.fn_hm_provisionar_derivado($1) as aluno_id`,
        [compradorId],
      );
      if (r?.aluno_id) {
        await addInteracaoHm(ch.id, "sistema", "Aluno criado/atualizado na base THB", autor);
        await provisionarSociosHm(compradorId, autor);
      }
    } catch (e) {
      log.error("falha ao provisionar aluno ao entrar na Ativação", e, { compradorId });
      await addInteracaoHm(ch.id, "sistema", "Falha ao criar o aluno na base THB — use “Registrar pagamento” na ficha", autor);
    }
  }

  // "Acesso Liberado" registra a liberação em public.hm_liberacoes — a fonte
  // única de "o acesso foi criado", que a fila do painel v2 também lê. Não toca
  // status_acesso: esse campo é derivado da validade da matrícula e recalculado
  // diariamente. Só vale se o aluno já foi provisionado (pagamento confirmado);
  // nunca aborta o movimento do card por causa da base mestre.
  if (chave === HM_STAGE_ACESSO) {
    try {
      const r = await queryOne<{ ok: boolean }>(`select cs.fn_hm_liberar_acesso($1) as ok`, [compradorId]);
      if (r?.ok) await addInteracaoHm(ch.id, "sistema", "Acesso liberado — registrado na base de alunos (THB)", autor);
      else await addInteracaoHm(ch.id, "sistema", "Card sem aluno na base THB — a liberação não foi registrada", autor);
    } catch (e) {
      log.error("falha ao registrar liberação de acesso", e, { compradorId });
      await addInteracaoHm(ch.id, "sistema", "Falha ao registrar a liberação de acesso na base THB", autor);
    }
  }
  return { ok: true };
}

// Reverte o último movimento de etapa do card (miss click). Lê a interação
// `mudanca_estagio` mais recente — que guarda estagio_anterior_id — e devolve o
// card para lá via moverEstagioHm (que já limpa apto/pagamento se voltar ao
// Comercial). Retorna false se não há histórico de movimento.
export async function reverterEstagioHm(compradorId: string, autor = "cs"): Promise<boolean> {
  const ch = await queryOne<{ id: string }>(`select id from cs.contatos_hm where comprador_id = $1`, [compradorId]);
  if (!ch) return false;
  // Desfazer é sempre um passo para trás — a trava do checklist não se aplica.

  const ult = await queryOne<{ estagio_anterior_id: number | null }>(
    `select estagio_anterior_id
       from cs.interacoes
      where contato_hm_id = $1 and tipo = 'mudanca_estagio'
      order by criado_em desc
      limit 1`,
    [ch.id],
  );
  if (!ult?.estagio_anterior_id) return false;

  const anterior = await queryOne<{ chave: string }>(
    `select chave from cs.estagios where id = $1 and evento = 'HM'`,
    [ult.estagio_anterior_id],
  );
  if (!anterior) return false;

  return (await moverEstagioHm(compradorId, anterior.chave, autor)).ok;
}

// Confirma que o cancelamento aconteceu DE VERDADE — o reembolso saiu na
// Hotmart. É o gêmeo manual do webhook: normalmente o fato chega sozinho
// (PURCHASE_REFUNDED e afins), mas cancelamento acertado por fora (Pix
// devolvido, acordo) não passa pela Hotmart e precisa de alguém para dizê-lo.
//
// A partir daqui o aluno é marcado como cancelado — nunca apagado: some das
// telas do GPS, mantém turma, validade, sócios e histórico, e o Thomas recebe a
// pendência de remover os acessos. Se ele voltar, é o MESMO cadastro que revive.
export async function confirmarCancelamentoHm(
  compradorId: string,
  motivo: string | null,
  autor = "cs",
): Promise<{ ok: boolean; resultado?: string }> {
  const ch = await queryOne<{ id: string }>(`select id from cs.contatos_hm where comprador_id = $1`, [compradorId]);
  if (!ch) return { ok: false };

  try {
    const r = await queryOne<{ resultado: string }>(
      `select cs.fn_hm_cancelar($1, $2, 'manual') as resultado`,
      [compradorId, motivo],
    );
    await addInteracaoHm(
      ch.id,
      "sistema",
      r?.resultado === "cancelado"
        ? `Cancelamento confirmado${motivo ? ` — ${motivo}` : ""}. Aluno marcado como cancelado na base THB (o cadastro e o histórico ficam). Remover os acessos.`
        : `Cancelamento confirmado${motivo ? ` — ${motivo}` : ""}. O contato ainda não era aluno; não há acesso a remover.`,
      autor,
    );
    return { ok: true, resultado: r?.resultado };
  } catch (e) {
    log.error("falha ao confirmar o cancelamento na base THB", e, { compradorId });
    await addInteracaoHm(ch.id, "sistema", "Falha ao refletir o cancelamento na base THB — confira o aluno manualmente", autor);
    return { ok: false };
  }
}

// Cancelamento confirmado por engano (ou negado pela Hotmart depois de já ter
// sido lançado). Desfaz o FATO — o pedido e o histórico continuam registrados.
export async function desfazerCancelamentoHm(compradorId: string, autor = "cs"): Promise<boolean> {
  const ch = await queryOne<{ id: string; aluno_id: string | null }>(
    `select id, aluno_id from cs.contatos_hm where comprador_id = $1`,
    [compradorId],
  );
  if (!ch) return false;

  await query(
    `update cs.contatos_hm
        set cancelamento_efetivado_em = null, cancelamento_origem = null, atualizado_em = now()
      where id = $1`,
    [ch.id],
  );

  // A base é de outro domínio: uma falha lá não pode travar a correção do card.
  try {
    await query(`select cs.fn_hm_descancelar($1)`, [compradorId]);
  } catch (e) {
    log.error("falha ao desfazer o cancelamento na base THB", e, { compradorId });
    await addInteracaoHm(ch.id, "sistema", "Cancelamento desfeito no card, mas a base THB não respondeu — confira o aluno", autor);
    return true;
  }

  await addInteracaoHm(ch.id, "sistema", "Cancelamento desfeito — o aluno volta a valer na base (o pedido de cancelamento continua registrado)", autor);
  return true;
}

// Registra o pagamento do saldo (forma + valores), provisiona o aluno na base
// mestre public.thb_alunos (turma T39 + bloco financeiro) e dispara a transição
// para a Ativação (via moverEstagioHm → "Pendente de Liberação").
//
// O provisionamento é blindado: a base mestre é de outro domínio (alimenta o
// GPS) e uma falha lá NÃO pode impedir o registro do pagamento nem travar o
// card no Comercial. Se falhar, a timeline registra e o card segue — dá para
// reprocessar confirmando o pagamento de novo (a função é idempotente).
export async function registrarPagamentoHm(
  compradorId: string,
  forma: "avista" | "parcelado",
  parcelas: number | null,
  valorTotal: number | null,
  valorPago: number | null,
  autor = "cs",
): Promise<{ ok: boolean; finalizado: boolean; faltam?: number }> {
  const ch = await queryOne<{ id: string }>(`select id from cs.contatos_hm where comprador_id = $1`, [compradorId]);
  if (!ch) return { ok: false, finalizado: false };
  await query(
    `update cs.contatos_hm
        set pagamento_forma = $2, pagamento_parcelas = $3, atualizado_em = now()
      where id = $1`,
    [ch.id, forma, forma === "parcelado" ? parcelas : null],
  );
  const label = forma === "parcelado" ? `parcelado${parcelas ? ` em ${parcelas}x` : ""}` : "à vista";

  // Quem finaliza (0098/0100): o pagamento à vista que cobre o pacote inteiro OU
  // o PARCELADO — quem parcelou assumiu o compromisso e prossegue para a Ativação
  // pagando (desde que já tenha pago ao menos a entrada); o saldo segue no contas
  // a receber. O que NÃO finaliza é o sinal-só à vista (o caso Décio): registra o
  // valor para o financeiro refletir, mas não cria aluno, não marca apto, não move.
  const total = valorTotal ?? 0;
  const pago = valorPago ?? 0;
  const cobreTudo = total > 0 && pago >= total;
  const parceladoValido = forma === "parcelado" && pago > 0;
  if (!cobreTudo && !parceladoValido) {
    await query(`update cs.contatos_hm set valor_total = $2, valor_pago = $3, atualizado_em = now() where id = $1`,
      [ch.id, valorTotal, valorPago]);
    await addInteracaoHm(ch.id, "nota",
      `Pagamento parcial do saldo registrado (${brl(pago)} de ${brl(total)}) — saldo em aberto, card mantido no comercial`, autor);
    return { ok: true, finalizado: false, faltam: Math.max(total - pago, 0) };
  }

  await addInteracaoHm(ch.id, "nota", `Pagamento do saldo registrado (${label})`, autor);

  try {
    const r = await queryOne<{ aluno_id: string | null }>(
      `select cs.fn_hm_provisionar_aluno($1, $2, $3) as aluno_id`,
      [compradorId, valorTotal, valorPago],
    );
    if (r?.aluno_id) {
      const saldo = Math.max((valorTotal ?? 0) - (valorPago ?? 0), 0);
      // A turma sai do que a pessoa É: lead novo entra na T39, aluno da base
      // mantém a dele e tem o acesso renovado (0055). O texto não afirma T39.
      await addInteracaoHm(
        ch.id,
        "sistema",
        `Aluno criado/atualizado na base THB — total ${brl(valorTotal)}, pago ${brl(valorPago)}, saldo ${brl(saldo)}`,
        autor,
      );
      await provisionarSociosHm(compradorId, autor);
    } else {
      await addInteracaoHm(ch.id, "sistema", "Não foi possível provisionar o aluno na base THB (comprador não encontrado)", autor);
    }
  } catch (e) {
    log.error("falha ao provisionar aluno na base THB", e, { compradorId });
    await addInteracaoHm(ch.id, "sistema", "Falha ao provisionar o aluno na base THB — confirme o pagamento de novo para reprocessar", autor);
  }

  const mov = await moverEstagioHm(compradorId, HM_STAGE_PAGAMENTO, autor);
  return { ok: mov.ok, finalizado: mov.ok };
}

function brl(v: number | null): string {
  return (v ?? 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

// Atribui (ou reatribui) o responsável do card HM e registra a mudança na
// timeline — controle de quem passou a responder pelo aluno. Só loga se mudou.
export async function setResponsavelHm(compradorId: string, responsavel: string | null, autor = "cs") {
  const ch = await queryOne<{ id: string; responsavel: string | null }>(
    `select id, responsavel from cs.contatos_hm where comprador_id = $1`,
    [compradorId],
  );
  if (!ch) return;
  const anterior = ch.responsavel?.trim() || null;
  const novo = responsavel?.trim() || null;
  if (anterior === novo) return;
  await query(`update cs.contatos_hm set responsavel = $2, atualizado_em = now() where id = $1`, [ch.id, novo]);
  const descricao = novo
    ? anterior
      ? `Responsável alterado de "${anterior}" para "${novo}"`
      : `Responsável atribuído: "${novo}"`
    : `Responsável removido (era "${anterior}")`;
  await addInteracaoHm(ch.id, "sistema", descricao, autor);
}

// Atribui o responsável por ID (o caminho das equipes): grava responsavel_id — o
// texto `responsavel` é derivado por trigger (0140). Passar null = devolve ao
// pool. Registra na timeline com o nome legível. Assumir = passar o próprio id.
// `porAdmin` = a atribuição foi feita por admin/GP → trava o card para operadores
// comuns (0142). Devolver ao pool (null) zera a trava.
export async function setResponsavelHmPorId(compradorId: string, responsavelId: string | null, autor = "cs", porAdmin = false) {
  const ch = await queryOne<{ id: string; responsavel: string | null; responsavel_id: string | null }>(
    `select id, responsavel, responsavel_id from cs.contatos_hm where comprador_id = $1`,
    [compradorId],
  );
  if (!ch) return;
  if ((ch.responsavel_id ?? null) === (responsavelId ?? null)) return;
  const anterior = ch.responsavel?.trim() || null;
  const nomeNovo = responsavelId
    ? (await queryOne<{ nome: string }>(`select nome from cs.usuarios where id = $1`, [responsavelId]))?.nome ?? null
    : null;
  // Trava: liga quando um admin atribui a alguém; desliga ao devolver ao pool.
  const trava = responsavelId ? porAdmin : false;
  await query(
    `update cs.contatos_hm set responsavel_id = $2, atribuicao_admin = $3, atualizado_em = now() where id = $1`,
    [ch.id, responsavelId, trava],
  );
  const descricao = nomeNovo
    ? anterior
      ? `Responsável alterado de "${anterior}" para "${nomeNovo}"${porAdmin ? " (travado pelo admin)" : ""}`
      : `Responsável atribuído: "${nomeNovo}"${porAdmin ? " (travado pelo admin)" : ""}`
    : `Responsável removido (era "${anterior}") — devolvido ao pool`;
  await addInteracaoHm(ch.id, "sistema", descricao, autor);
}

// ----- Atribuição com hierarquia (níveis master/gestor/operador) -------------
// A regra completa de "quem pode pôr o card na mão de QUEM", aplicada nas DUAS
// portas que mexem em responsável (PATCH da ficha e POST /api/hm/lote) —
// inclusive no caminho legado por NOME, que antes contornava a hierarquia toda.
//
//   master   → atribui a qualquer um e TRAVA o card (porAdmin, 0142).
//   gestor   → atribui só a membro da PRÓPRIA equipe, sem travar. Card travado
//              pelo master é imutável para ele reatribuir (0142: só o master
//              remaneja) — mas devolver ao pool segue permitido (decisão 27/07).
//   operador → só ASSUME para si um card do pool; devolve ao pool só o card que
//              é DELE e que o master não travou.
export type AtribuicaoErro =
  | "nao_encontrado"               // card não existe
  | "destino_invalido"             // id de destino não é usuário ativo
  | "destino_fora_da_equipe"       // gestor tentando atribuir fora da própria equipe
  | "destino_sem_portal"           // destino sem o portal do card na whitelist (0145)
  | "atribuicao_travada"           // card com dono/trava — imutável para este nível
  | "sem_permissao_para_atribuir"; // operador dando o card a outrem / texto livre sem ser master
export type AtribuicaoResultado = { ok: true } | { ok: false; reason: AtribuicaoErro };

export type DestinoAtribuicao =
  | { tipo: "pool" }                // devolver ao pool (responsavel null)
  | { tipo: "id"; id: string }      // caminho novo, por responsavel_id
  | { tipo: "nome"; nome: string }; // caminho legado, por NOME (seletor antigo)

export async function atribuirResponsavelHm(
  sessao: Ator,
  compradorId: string,
  destino: DestinoAtribuicao,
  autor = "cs",
): Promise<AtribuicaoResultado> {
  const nivel = nivelDe(sessao);
  const atual = await queryOne<{ id: string; responsavel_id: string | null; responsavel: string | null; atribuicao_admin: boolean }>(
    `select id, responsavel_id, responsavel, atribuicao_admin from cs.contatos_hm where comprador_id = $1`,
    [compradorId],
  );
  if (!atual) return { ok: false, reason: "nao_encontrado" };

  // Devolver ao pool: só o MASTER passa por cima da trava (0142) — ele é quem a
  // põe. O gestor devolve ao pool o que a equipe dele segura, mas NÃO um card
  // travado: senão a trava vira decorativa (devolve ao pool e reatribui logo em
  // seguida, dois passos para desfazer o que o master decidiu). O operador só
  // devolve o card que é DELE, e também não fura a trava.
  if (destino.tipo === "pool") {
    if (nivel !== "master" && atual.atribuicao_admin) {
      return { ok: false, reason: "atribuicao_travada" };
    }
    if (nivel === "operador" && atual.responsavel_id !== sessao.id) {
      return { ok: false, reason: "sem_permissao_para_atribuir" };
    }
    await setResponsavelHmPorId(compradorId, null, autor, false);
    // Card legado só com o TEXTO (id já nulo): o clear por id é no-op — limpa o texto.
    if (atual.responsavel_id === null && atual.responsavel) {
      await setResponsavelHm(compradorId, null, autor);
    }
    return { ok: true };
  }

  // Resolve o destino para um usuário ATIVO. Pelo nome (legado): se não casar
  // com usuário nenhum, só o master pode gravar texto livre — para os demais o
  // nome solto era exatamente o desvio da hierarquia. `tem_portal` sai na mesma
  // query: atribuir a quem não tem 'HM' na whitelist (0145) faria o card sumir
  // da vista do destino no instante seguinte — recusado para TODOS os níveis
  // (28/07, decisão do Marcio: equipes são globais, o isolamento é do portal).
  type DestinoUser = { id: string; equipe_id: string | null; tem_portal: boolean };
  const TEM_PORTAL_HM = `exists (select 1 from cs.usuario_portais up where up.usuario_id = u.id and up.portal = 'HM') as tem_portal`;
  let user: DestinoUser | null;
  if (destino.tipo === "id") {
    user = await queryOne<DestinoUser>(
      `select u.id, u.equipe_id, ${TEM_PORTAL_HM} from cs.usuarios u where u.id = $1 and u.ativo`,
      [destino.id],
    );
    if (!user) return { ok: false, reason: "destino_invalido" };
  } else {
    user = await queryOne<DestinoUser>(
      `select u.id, u.equipe_id, ${TEM_PORTAL_HM} from cs.usuarios u
        where lower(btrim(u.nome)) = lower(btrim($1)) and u.ativo
        limit 1`,
      [destino.nome],
    );
    if (!user) {
      if (nivel !== "master") return { ok: false, reason: "sem_permissao_para_atribuir" };
      // Texto livre do master: limpa o id (e a trava) ANTES — senão id e texto
      // divergem: o texto diria "Fulano" e o card continuaria, pelo id, na
      // carteira/equipe do dono antigo (a trigger da 0140 só deriva o texto
      // quando o ID muda; escrever só o texto não a aciona). Mesmo conserto do
      // atribuirResponsavel dos genéricos. O card vira "texto órfão": visível
      // só a master até alguém reatribuir por id — é o que o texto livre É.
      if (atual.responsavel_id) {
        await query(
          `update cs.contatos_hm set responsavel_id = null, atribuicao_admin = false, atualizado_em = now() where id = $1`,
          [atual.id],
        );
      }
      const nome = destino.nome.trim();
      await query(`update cs.contatos_hm set responsavel = $2, atualizado_em = now() where id = $1`, [atual.id, nome]);
      if ((atual.responsavel?.trim() || null) !== nome) {
        await addInteracaoHm(
          atual.id,
          "sistema",
          atual.responsavel?.trim()
            ? `Responsável alterado de "${atual.responsavel.trim()}" para "${nome}"`
            : `Responsável atribuído: "${nome}"`,
          autor,
        );
      }
      return { ok: true };
    }
  }

  // Portal antes da hierarquia: sem 'HM' na whitelist não há destino válido —
  // nem para o master (o card sumiria da vista da pessoa; libere o portal antes).
  if (!user.tem_portal) return { ok: false, reason: "destino_sem_portal" };

  // Hierarquia do DESTINO (lib/papeis) + estado do CARD.
  if (!podeAtribuirPara(sessao, user)) {
    return { ok: false, reason: nivel === "gestor" ? "destino_fora_da_equipe" : "sem_permissao_para_atribuir" };
  }
  if (nivel !== "master") {
    if (atual.atribuicao_admin) return { ok: false, reason: "atribuicao_travada" };
    // Operador: só assume do pool (ou re-assume o próprio, que é no-op). Card
    // com outro dono — por id OU por TEXTO órfão — não é dele para pegar: o
    // texto órfão não é pool (visibilidade.ts), e aqui a escrita espelha a
    // leitura (mesma regra do atribuirResponsavel dos genéricos).
    if (nivel === "operador" && ((atual.responsavel_id !== null && atual.responsavel_id !== sessao.id)
        || (atual.responsavel_id === null && (atual.responsavel ?? "") !== ""))) {
      return { ok: false, reason: "atribuicao_travada" };
    }
  }
  await setResponsavelHmPorId(compradorId, user.id, autor, nivel === "master");
  return { ok: true };
}

// ===== Leitura ≠ ação (28/07): DOIS gates, um por pergunta ==================
// podeVerCardHm  → LEITURA: quem pode ABRIR o card (ficha, conversa, export).
//                  Espelha o WHERE das listagens (escopoVisibilidade): master
//                  tudo; gestor E OPERADOR o pool + a equipe inteira.
// podeAgirCardHm → ESCRITA: quem pode EDITAR/mover/atribuir/enviar (escopoAcao):
//                  operador SÓ no pool e nos cards DELE — card de colega abre
//                  em leitura e recusa escrita (403 'card_de_outro_operador').
// Era UMA função servindo às duas perguntas — exatamente a confusão que fazia
// o operador não ver o board da equipe. NÃO reunificar.
type SessaoEquipe = { id: string; papel: Papel; equipe_id: string | null; equipe_tipo: TipoEquipe | null; lider_equipe?: boolean | null };

async function cardEscopoHm(compradorId: string) {
  return queryOne<{ responsavel_id: string | null; equipe_id: string | null; responsavel: string | null }>(
    `select responsavel_id, equipe_id, responsavel from cs.contatos_hm_kanban where comprador_id = $1`,
    [compradorId],
  );
}

export async function podeVerCardHm(sessao: SessaoEquipe, compradorId: string): Promise<boolean> {
  const escopo = escopoVisibilidade(sessao);
  if (escopo.modo === "tudo") return true;
  const k = await cardEscopoHm(compradorId);
  if (!k) return true; // inexistente → deixa o 404 acontecer no fluxo normal
  // O MESMO predicado do sqlEscopo das listagens e do podeVerContato dos
  // genéricos (visibilidade.ts). Inclui a regra do texto órfão: card cujo dono
  // existe só como TEXTO (id null, texto preenchido) NÃO é pool — o HM tratava
  // como livre e o card ficava visível a todo mundo (divergência corrigida 27/07).
  return podeVerPorEscopo(escopo, k);
}

// Gate de AÇÃO das rotas de escrita (PATCH da ficha, mover no board, lote,
// inbox POST/PATCH, sócios). As rotas respondem 403 com o próprio veredicto
// como reason ('card_de_outro_operador' | 'sem_acesso').
export async function podeAgirCardHm(sessao: SessaoEquipe, compradorId: string): Promise<VeredictoAcao> {
  if (ehMaster(sessao)) return "ok";
  const k = await cardEscopoHm(compradorId);
  if (!k) return "ok"; // inexistente → deixa o 404 acontecer no fluxo normal
  return veredictoAcao(sessao, k);
}

// Colunas de cancelamento — Reclamada (pedido) e Reembolsado (fato).
export const HM_ESTAGIOS_CANCELAMENTO = [HM_STAGE_CANCELAMENTO, HM_STAGE_REEMBOLSADO];

// Trava dos cancelados (decisão do Marcio 27/07): um card em Reembolsado/Reclamada
// é IMUTÁVEL para quem não é MASTER (admin do Grupo Participa) — só o master
// mexe (mover de/para, editar, atribuir, confirmar/desfazer). Retorna true se a
// ação deve ser BLOQUEADA para esta sessão. As demais equipes veem, mas não alteram.
// (Merge 27/07: portado do origin/main adaptando podeGerirAcesso(papel, tipo) —
// API antiga de 2 args — para ehMaster(sessao), mesma semântica no modelo novo.)
export async function cancelamentoBloqueado(sessao: SessaoEquipe, compradorId: string): Promise<boolean> {
  if (ehMaster(sessao)) return false; // só o master libera
  const r = await queryOne<{ chave: string | null }>(
    `select est.chave from cs.contatos_hm ch left join cs.estagios est on est.id = ch.estagio_id
      where ch.comprador_id = $1`,
    [compradorId],
  );
  return !!r?.chave && HM_ESTAGIOS_CANCELAMENTO.includes(r.chave);
}

// Leva os sócios convidados para a base mestre — mesma turma e mesma validade do
// titular, vinculados a ele (é o que `socio_de_aluno_id` significa lá). Só faz
// efeito depois que o titular virou aluno: antes disso o sócio é um convidado do
// card, e a base não pode saber dele. Silencioso e blindado: a base é de outro
// domínio e nunca pode derrubar o cadastro de um sócio no kanban.
export async function provisionarSociosHm(compradorId: string, autor = "cs"): Promise<number> {
  try {
    const r = await queryOne<{ n: number }>(`select cs.fn_hm_provisionar_socios($1) as n`, [compradorId]);
    const n = r?.n ?? 0;
    if (n > 0) {
      const ch = await queryOne<{ id: string }>(`select id from cs.contatos_hm where comprador_id = $1`, [compradorId]);
      if (ch) await addInteracaoHm(ch.id, "sistema", `${n} sócio(s) criado(s)/vinculado(s) na base THB`, autor);
    }
    return n;
  } catch (e) {
    log.error("falha ao provisionar sócios na base THB", e, { compradorId });
    return 0;
  }
}

// ----- Agendamento e reagendamento (reunião comercial / entrevista de ativação) -----

export type TipoAgendamento = "reuniao" | "entrevista";
export type StatusAgendamento = "realizado" | "nao_compareceu" | "cancelado";

const ROTULO: Record<TipoAgendamento, string> = { reuniao: "Reunião", entrevista: "Entrevista" };

function fmtBr(iso: string | Date): string {
  const d = typeof iso === "string" ? new Date(iso) : iso;
  return isNaN(d.getTime())
    ? String(iso)
    : d.toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

// Marca (ou remarca) a reunião/entrevista. Remarcar não é "trocar a data": é um
// FATO da operação — a pessoa já tinha se comprometido com um horário e não veio,
// ou pediu para adiar. Antes, a nova data simplesmente sobrescrevia a antiga e o
// sistema esquecia que houve remarcação; era impossível saber quem está enrolando.
// Agora a data vigente continua no card (é o que a agenda lê) e cada marcação vira
// uma linha em cs.hm_agendamentos, com o motivo de a anterior ter caído.
export async function agendarHm(
  compradorId: string,
  tipo: TipoAgendamento,
  quando: string | null,
  motivo: string | null,
  autor = "cs",
): Promise<{ reagendou: boolean; vezes: number }> {
  const col = tipo === "reuniao" ? "reuniao_em" : "entrevista_em";
  const ch = await queryOne<{ id: string; atual: string | null }>(
    `select id, ${col} as atual from cs.contatos_hm where comprador_id = $1`,
    [compradorId],
  );
  if (!ch) return { reagendou: false, vezes: 0 };

  const tinha = !!ch.atual;
  const mesma = tinha && quando && new Date(ch.atual as string).getTime() === new Date(quando).getTime();
  if (mesma) return { reagendou: false, vezes: 0 };

  // A marcação vigente sai de cena: virou outra data (reagendado) ou foi desmarcada.
  await query(
    `update cs.hm_agendamentos
        set status = $3, motivo = coalesce($4, motivo), encerrado_em = now()
      where contato_hm_id = $1 and tipo = $2 and status = 'agendado'`,
    [ch.id, tipo, quando ? "reagendado" : "cancelado", motivo],
  );

  await query(
    `update cs.contatos_hm set ${col} = $2::timestamptz, atualizado_em = now() where id = $1`,
    [ch.id, quando],
  );

  if (!quando) {
    await addInteracaoHm(ch.id, "sistema", `${ROTULO[tipo]} desmarcada${motivo ? ` — ${motivo}` : ""}`, autor);
    return { reagendou: false, vezes: 0 };
  }

  await query(
    `insert into cs.hm_agendamentos (contato_hm_id, tipo, quando, status, autor)
     values ($1, $2, $3::timestamptz, 'agendado', $4)`,
    [ch.id, tipo, quando, autor],
  );

  const r = await queryOne<{ vezes: number }>(
    `select count(*)::int as vezes
       from cs.hm_agendamentos
      where contato_hm_id = $1 and tipo = $2 and status = 'reagendado'`,
    [ch.id, tipo],
  );
  const vezes = r?.vezes ?? 0;

  const descricao = tinha
    ? `${ROTULO[tipo]} reagendada de ${fmtBr(ch.atual as string)} para ${fmtBr(quando)}${motivo ? ` — ${motivo}` : ""} (${vezes}ª remarcação)`
    : `${ROTULO[tipo]} agendada para ${fmtBr(quando)}`;
  await addInteracaoHm(ch.id, tinha ? "sistema" : "nota", descricao, autor);

  return { reagendou: tinha, vezes };
}

// Fecha a marcação vigente: aconteceu, o aluno não veio, ou foi cancelada. O
// no-show é o dado que faltava — é ele que distingue "remarcou porque surgiu algo"
// de "não apareceu e sumiu".
export async function fecharAgendamentoHm(
  compradorId: string,
  tipo: TipoAgendamento,
  status: StatusAgendamento,
  motivo: string | null,
  autor = "cs",
): Promise<boolean> {
  const ch = await queryOne<{ id: string }>(`select id from cs.contatos_hm where comprador_id = $1`, [compradorId]);
  if (!ch) return false;

  const fechou = await query(
    `update cs.hm_agendamentos
        set status = $3, motivo = coalesce($4, motivo), encerrado_em = now()
      where contato_hm_id = $1 and tipo = $2 and status = 'agendado'
      returning id`,
    [ch.id, tipo, status, motivo],
  );
  if (fechou.length === 0) return false;

  const texto: Record<StatusAgendamento, string> = {
    realizado: `${ROTULO[tipo]} realizada`,
    nao_compareceu: `${ROTULO[tipo]} — o aluno não compareceu`,
    cancelado: `${ROTULO[tipo]} cancelada`,
  };
  await addInteracaoHm(ch.id, "sistema", `${texto[status]}${motivo ? ` — ${motivo}` : ""}`, autor);
  return true;
}

// Nota manual / campos de acompanhamento da ficha HM.
export async function addNotaHm(compradorId: string, texto: string, autor: string) {
  const ch = await queryOne<{ id: string }>(`select id from cs.contatos_hm where comprador_id = $1`, [compradorId]);
  if (!ch) return;
  await addInteracaoHm(ch.id, "nota", texto, autor);
}

// ----- Tags do card -----
// A tag de turma ("Origem …", "Turma …", "Aurum …") não se edita à mão: ela é o
// espelho do campo turma e dos fatos de origem (0053) — o PATCH da ficha a
// sincroniza ao trocar a turma, e remover "Turma T39" na unha deixaria a ficha
// dizendo uma coisa e o filtro do board outra. O resto é livre, inclusive
// canal: quando o sistema não tem o fato (um evento sem janela cadastrada, como
// o Ex aluno de 13/07 antes da 0066), o operador É a fonte — e a timeline
// guarda quem atribuiu e quando.
const RE_TAG_GERENCIADA = /^(Origem|Turma|Aurum) /;

export type TagErro = "tag_gerenciada" | "nao_encontrado";
export type TagResultado = { ok: true; mudou: boolean } | { ok: false; reason: TagErro };

export async function addTagHm(compradorId: string, tag: string, autor = "cs"): Promise<TagResultado> {
  const t = tag.trim();
  if (!t || RE_TAG_GERENCIADA.test(t)) return { ok: false, reason: "tag_gerenciada" };
  const ch = await queryOne<{ id: string; tem: boolean }>(
    `select id, $2 = any(tags) as tem from cs.contatos_hm where comprador_id = $1`,
    [compradorId, t],
  );
  if (!ch) return { ok: false, reason: "nao_encontrado" };
  // Atribuir uma tag que o catálogo não conhece a registra como livre (0067):
  // criar é digitar o nome, e nenhuma tag em uso fica órfã de catálogo.
  await query(
    `insert into cs.tags (evento, nome, tipo, criado_por) values ('HM', $1, 'livre', $2)
     on conflict (evento, nome) do nothing`,
    [t, autor],
  );
  // Já tem: nada a fazer — e nada a logar (timeline registra mudança, não gesto).
  if (ch.tem) return { ok: true, mudou: false };
  await query(`update cs.contatos_hm set tags = array_append(tags, $2), atualizado_em = now() where id = $1`, [ch.id, t]);
  await addInteracaoHm(ch.id, "sistema", `Tag adicionada: "${t}"`, autor);
  return { ok: true, mudou: true };
}

export async function removeTagHm(compradorId: string, tag: string, autor = "cs"): Promise<TagResultado> {
  const t = tag.trim();
  if (!t || RE_TAG_GERENCIADA.test(t)) return { ok: false, reason: "tag_gerenciada" };
  const ch = await queryOne<{ id: string; tem: boolean }>(
    `select id, $2 = any(tags) as tem from cs.contatos_hm where comprador_id = $1`,
    [compradorId, t],
  );
  if (!ch) return { ok: false, reason: "nao_encontrado" };
  if (!ch.tem) return { ok: true, mudou: false };
  await query(`update cs.contatos_hm set tags = array_remove(tags, $2), atualizado_em = now() where id = $1`, [ch.id, t]);
  await addInteracaoHm(ch.id, "sistema", `Tag removida: "${t}"`, autor);
  return { ok: true, mudou: true };
}

// Cadastro manual na esteira HM — a porta para quem o seed não pegou (o boleto
// do sinal que só é aprovado num UPDATE, que a trigger AFTER INSERT não vê) e
// para quem entra sem compra na Hotmart (indicação, acordo por fora). Delega ao
// banco (cs.fn_hm_cadastrar_manual): achar/criar o comprador e garantir o card
// são uma transação só, idempotente por comprador. Devolve o comprador_id para
// a tela abrir a ficha logo em seguida.
export type CadastroManualHm = {
  ok: boolean;
  reason?: string;
  compradorId?: string;
  jaExistia?: boolean;    // o card já estava na esteira (nada foi criado)
  criouComprador?: boolean;
  nome?: string;
};

export async function cadastrarManualHm(
  dados: {
    nome: string; email: string; telefone?: string | null; documento?: string | null;
    turma?: string | null; categoria?: string | null; responsavel?: string | null; estagioChave?: string | null;
  },
  autor = "cs",
): Promise<CadastroManualHm> {
  const r = await queryOne<{ res: Record<string, unknown> }>(
    `select cs.fn_hm_cadastrar_manual($1,$2,$3,$4,$5,$6,$7,$8,$9) as res`,
    [
      dados.nome, dados.email, dados.telefone ?? null, dados.documento ?? null,
      dados.turma ?? "T39", dados.categoria ?? null, dados.responsavel ?? null,
      dados.estagioChave ?? "hm_comprou", autor,
    ],
  );
  const res = (r?.res ?? {}) as Record<string, unknown>;
  if (res.ok !== true) {
    log.warn("cadastro manual HM recusado", { reason: res.reason, email: dados.email });
    return { ok: false, reason: String(res.reason ?? "falha") };
  }
  return {
    ok: true,
    compradorId: res.comprador_id as string,
    jaExistia: res.ja_existia === true,
    criouComprador: res.criou_comprador === true,
    nome: res.nome as string,
  };
}
