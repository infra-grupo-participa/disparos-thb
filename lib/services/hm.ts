import { query, queryOne } from "@/lib/db";

// Serviço do módulo Holding Masters (evento 'HM'). Opera o overlay isolado
// cs.contatos_hm (uma linha por comprador), reaproveitando cs.interacoes para
// a timeline. NÃO toca cs.contatos (HT/SEM). Sem disparos — só esteira/ficha.

export const HM_STAGE_PAGAMENTO = "hm_pagamento_realizado";
export const HM_STAGE_APTO = "hm_apto_ativacao";
export const HM_STAGE_ENTREVISTA = "hm_entrevista_agendada";

type EstagioHm = { id: number; chave: string; nome: string; aba: string | null };

async function estagioPorChave(chave: string): Promise<EstagioHm | null> {
  return queryOne<EstagioHm>(
    `select id, chave, nome, aba from cs.estagios where chave = $1 and evento = 'HM' and ativo`,
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

// Move o card HM de etapa. Regra especial: ao entrar em "Pagamento Realizado",
// registra o pagamento e joga automaticamente para a Ativação (1ª etapa —
// "Entrevista Agendada"), marcando o card como apto para ativação.
// Ao voltar para uma etapa da aba Comercial um card que estava apto/pago (veio
// da Ativação), limpa apto_ativacao/pagamento — mantém o estado consistente
// tanto no seletor livre quanto no "desfazer" (evita card "apto" no Comercial).
// Retorna false se a etapa/contato não existem.
export async function moverEstagioHm(compradorId: string, chave: string, autor = "cs"): Promise<boolean> {
  const novo = await estagioPorChave(chave);
  if (!novo) return false;

  const ch = await queryOne<{ id: string; estagio_id: number | null; apto_ativacao: boolean }>(
    `select id, estagio_id, apto_ativacao from cs.contatos_hm where comprador_id = $1`,
    [compradorId],
  );
  if (!ch) return false;
  if (ch.estagio_id === novo.id && chave !== HM_STAGE_PAGAMENTO) return true;

  // Transição automática Comercial → Ativação ao confirmar o pagamento do saldo.
  // O card cai em "Apto para Ativação" (ponto de partida da aba Ativação).
  if (chave === HM_STAGE_PAGAMENTO) {
    const apto = await estagioPorChave(HM_STAGE_APTO);
    if (!apto) return false;
    await query(
      `update cs.contatos_hm
          set estagio_id = $2, pagamento_em = coalesce(pagamento_em, now()),
              apto_ativacao = true, atualizado_em = now()
        where id = $1`,
      [ch.id, apto.id],
    );
    await addInteracaoHm(ch.id, "sistema", "Pagamento realizado — apto para ativação", autor);
    await addInteracaoHm(ch.id, "mudanca_estagio", `Movido para "${apto.nome}"`, autor, ch.estagio_id, apto.id);
    return true;
  }

  // Voltar para o Comercial um card apto/pago: limpa a marcação de pagamento.
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
    return true;
  }

  await query(
    `update cs.contatos_hm set estagio_id = $2, atualizado_em = now() where id = $1`,
    [ch.id, novo.id],
  );
  await addInteracaoHm(ch.id, "mudanca_estagio", `Movido para "${novo.nome}"`, autor, ch.estagio_id, novo.id);
  return true;
}

// Reverte o último movimento de etapa do card (miss click). Lê a interação
// `mudanca_estagio` mais recente — que guarda estagio_anterior_id — e devolve o
// card para lá via moverEstagioHm (que já limpa apto/pagamento se voltar ao
// Comercial). Retorna false se não há histórico de movimento.
export async function reverterEstagioHm(compradorId: string, autor = "cs"): Promise<boolean> {
  const ch = await queryOne<{ id: string }>(`select id from cs.contatos_hm where comprador_id = $1`, [compradorId]);
  if (!ch) return false;

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

  return moverEstagioHm(compradorId, anterior.chave, autor);
}

// Registra a forma de pagamento do saldo (14.700, à vista/parcelado) e dispara
// a transição para Ativação (via moverEstagioHm).
export async function registrarPagamentoHm(
  compradorId: string,
  forma: "avista" | "parcelado",
  parcelas: number | null,
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
  return moverEstagioHm(compradorId, HM_STAGE_PAGAMENTO, autor);
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

// Nota manual / campos de acompanhamento da ficha HM.
export async function addNotaHm(compradorId: string, texto: string, autor: string) {
  const ch = await queryOne<{ id: string }>(`select id from cs.contatos_hm where comprador_id = $1`, [compradorId]);
  if (!ch) return;
  await addInteracaoHm(ch.id, "nota", texto, autor);
}
