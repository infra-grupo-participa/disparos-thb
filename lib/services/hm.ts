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

  const ch = await queryOne<{ id: string; estagio_id: number | null; apto_ativacao: boolean; estagio_chave: string | null; estagio_ordem: number | null }>(
    `select ch.id, ch.estagio_id, ch.apto_ativacao, e.chave as estagio_chave, e.ordem as estagio_ordem
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

  // Trava do checklist: sair de "Acesso Liberado" para a frente exige a ativação
  // completa. Voltar (para trás na esteira, ou para o Comercial) continua livre —
  // a trava existe para impedir avanço com ativação pela metade, não para prender
  // o card quando o operador percebe que errou.
  const avancando = (novo.ordem ?? 0) > (ch.estagio_ordem ?? 0);
  if (ch.estagio_chave === HM_STAGE_ACESSO && avancando) {
    const faltando = await checklistPendente(compradorId);
    if (faltando.length > 0) return { ok: false, reason: "checklist_incompleto", faltando };
  }

  // Transição automática Comercial → Ativação ao confirmar o pagamento do saldo.
  // O card cai em "Pendente de Liberação" (ponto de partida da aba Ativação).
  if (chave === HM_STAGE_PAGAMENTO) {
    const pendente = await estagioPorChave(HM_STAGE_PENDENTE);
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
    await addInteracaoHm(ch.id, "mudanca_estagio", `Movido para "${novo.nome}"`, autor, ch.estagio_id, novo.id);
    await reposicionarNaColuna(ch.id, novo.id, posicao);
    return { ok: true };
  }

  // Voltar para o Comercial um card pago: limpa a marcação de pagamento.
  const voltandoAoComercial = novo.aba === "comercial" && ch.apto_ativacao;
  if (voltandoAoComercial) {
    await query(
      `update cs.contatos_hm
          set estagio_id = $2, apto_ativacao = false, pagamento_em = null,
              pagamento_forma = null, pagamento_parcelas = null, atualizado_em = now()
        where id = $1`,
      [ch.id, novo.id],
    );
    await addInteracaoHm(ch.id, "sistema", "Pagamento desfeito — de volta ao Comercial", autor);
    await addInteracaoHm(ch.id, "mudanca_estagio", `Movido para "${novo.nome}"`, autor, ch.estagio_id, novo.id);
    await reposicionarNaColuna(ch.id, novo.id, posicao);
    return { ok: true };
  }

  await query(
    `update cs.contatos_hm set estagio_id = $2, atualizado_em = now() where id = $1`,
    [ch.id, novo.id],
  );
  await addInteracaoHm(ch.id, "mudanca_estagio", `Movido para "${novo.nome}"`, autor, ch.estagio_id, novo.id);
  await reposicionarNaColuna(ch.id, novo.id, posicao);

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

// Nota manual / campos de acompanhamento da ficha HM.
export async function addNotaHm(compradorId: string, texto: string, autor: string) {
  const ch = await queryOne<{ id: string }>(`select id from cs.contatos_hm where comprador_id = $1`, [compradorId]);
  if (!ch) return;
  await addInteracaoHm(ch.id, "nota", texto, autor);
}
