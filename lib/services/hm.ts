import { query, queryOne } from "@/lib/db";
import { logger } from "@/lib/log";

const log = logger("hm");

// Serviço do módulo Holding Masters (evento 'HM'). Opera o overlay isolado
// cs.contatos_hm (uma linha por comprador), reaproveitando cs.interacoes para
// a timeline. NÃO toca cs.contatos (HT/SEM). Sem disparos — só esteira/ficha.

export const HM_STAGE_PAGAMENTO = "hm_pagamento_realizado";
export const HM_STAGE_CANCELAMENTO = "hm_cancelamento";
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

export type MoverErro = "estagio_invalido" | "checklist_incompleto";
export type MoverResultado = { ok: true } | { ok: false; reason: MoverErro; faltando?: string[] };

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
  if (chave === HM_STAGE_CANCELAMENTO) {
    await query(
      `update cs.contatos_hm
          set estagio_id = $2, cancelamento_em = coalesce(cancelamento_em, now()), atualizado_em = now()
        where id = $1`,
      [ch.id, novo.id],
    );
    await addInteracaoHm(ch.id, "sistema", "Solicitou cancelamento — card fora da esteira de Ativação", autor);
    // A base mestre reage ao cancelamento (0070): quem NASCEU por este funil
    // some dela — o GPS não o vê mais (se pagar de novo, o provisionamento
    // recria). Aluno que JÁ EXISTIA mantém todos os dados; só a situação
    // financeira registra o cancelamento. Blindado: a base é de outro domínio
    // e nunca pode travar o movimento do card.
    try {
      const r = await queryOne<{ resultado: string }>(`select cs.fn_hm_cancelar($1) as resultado`, [compradorId]);
      if (r?.resultado === "excluido") {
        await addInteracaoHm(ch.id, "sistema", "Aluno removido da base THB — nasceu neste funil e cancelou (pagar de novo recria o cadastro)", autor);
      } else if (r?.resultado === "atualizado") {
        await addInteracaoHm(ch.id, "sistema", "Situação financeira marcada como cancelada na base THB — aluno antigo mantém todos os dados", autor);
      }
    } catch (e) {
      log.error("falha ao refletir o cancelamento na base THB", e, { compradorId });
      await addInteracaoHm(ch.id, "sistema", "Falha ao refletir o cancelamento na base THB — confira o aluno manualmente", autor);
    }
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
): Promise<boolean> {
  const ch = await queryOne<{ id: string }>(`select id from cs.contatos_hm where comprador_id = $1`, [compradorId]);
  if (!ch) return false;
  await query(
    `update cs.contatos_hm
        set pagamento_forma = $2, pagamento_parcelas = $3, atualizado_em = now()
      where id = $1`,
    [ch.id, forma, forma === "parcelado" ? parcelas : null],
  );
  const label = forma === "parcelado" ? `parcelado${parcelas ? ` em ${parcelas}x` : ""}` : "à vista";
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

  return (await moverEstagioHm(compradorId, HM_STAGE_PAGAMENTO, autor)).ok;
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
