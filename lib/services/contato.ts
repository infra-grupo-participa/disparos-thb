import { and, eq, inArray, sql } from "drizzle-orm";
import { getDb } from "@/lib/drizzle";
import { query, queryOne } from "@/lib/db";
import { contatos, estagios, interacoes } from "@/db/schema";
import { escopoVisibilidade, nivelDe, podeAtribuirPara, type Ator } from "@/lib/papeis";
import type { AtribuicaoResultado, DestinoAtribuicao } from "@/lib/services/hm";

// O contrato de atribuição é UM só, HM e genéricos — mesmos reasons, mesma
// forma de destino. Reexportado para as rotas genéricas não importarem de hm.
export type { AtribuicaoErro, AtribuicaoResultado, DestinoAtribuicao } from "@/lib/services/hm";

// Serviço de Contato (CRM): regras de negócio reutilizadas pelas rotas (detalhe,
// Kanban, lote). Queries type-safe via Drizzle sobre o pool pg existente.

async function contatoIdDe(compradorId: string): Promise<string | null> {
  const [c] = await getDb().select({ id: contatos.id }).from(contatos).where(eq(contatos.compradorId, compradorId)).limit(1);
  return c?.id ?? null;
}

// Move o contato de etapa (valida etapa ativa) e registra na timeline com os
// estágios anterior/novo. Retorna false se a etapa não existe/está inativa.
export async function moverEstagio(compradorId: string, estagioChave: string, autor = "cs"): Promise<boolean> {
  const db = getDb();
  const [novo] = await db
    .select({ id: estagios.id, nome: estagios.nome })
    .from(estagios)
    .where(and(eq(estagios.chave, estagioChave), eq(estagios.ativo, true)))
    .limit(1);
  if (!novo) return false;

  const [c] = await db
    .select({ id: contatos.id, estagioId: contatos.estagioId })
    .from(contatos)
    .where(eq(contatos.compradorId, compradorId))
    .limit(1);
  if (!c) return false;

  await db.update(contatos).set({ estagioId: novo.id, atualizadoEm: sql`now()` }).where(eq(contatos.id, c.id));
  await db.insert(interacoes).values({
    contatoId: c.id,
    tipo: "mudanca_estagio",
    descricao: `Movido para "${novo.nome}"`,
    estagioAnteriorId: c.estagioId ?? null,
    estagioNovoId: novo.id,
    autor,
  });
  return true;
}

export async function setTags(compradorId: string, tags: string[]) {
  await getDb().update(contatos).set({ tags, atualizadoEm: sql`now()` }).where(eq(contatos.compradorId, compradorId));
}

export async function addTagEmLote(compradorIds: string[], tag: string) {
  await getDb()
    .update(contatos)
    .set({ tags: sql`array_append(${contatos.tags}, ${tag})`, atualizadoEm: sql`now()` })
    .where(and(inArray(contatos.compradorId, compradorIds), sql`not (${tag} = any(${contatos.tags}))`));
}

// Atribui (ou reatribui) o responsável de um ou mais contatos e registra a
// mudança na timeline de cada um — controle de quem passou a responder por quem.
// Só loga os contatos cujo responsável de fato mudou.
export async function setResponsavel(compradorIds: string[], responsavel: string | null, autor = "cs") {
  const db = getDb();
  const antes = await db
    .select({ id: contatos.id, compradorId: contatos.compradorId, responsavel: contatos.responsavel })
    .from(contatos)
    .where(inArray(contatos.compradorId, compradorIds));

  await db.update(contatos).set({ responsavel, atualizadoEm: sql`now()` }).where(inArray(contatos.compradorId, compradorIds));

  const novo = responsavel?.trim() || null;
  for (const c of antes) {
    const anterior = c.responsavel?.trim() || null;
    if (anterior === novo) continue;
    await db.insert(interacoes).values({
      contatoId: c.id,
      tipo: "sistema",
      descricao: novo
        ? anterior
          ? `Responsável alterado de "${anterior}" para "${novo}"`
          : `Responsável atribuído: "${novo}"`
        : `Responsável removido (era "${anterior}")`,
      autor,
    });
  }
}

// ===== Equipes / visibilidade nos portais genéricos (0146) ==================
// O espelho do que lib/services/hm.ts faz para o HM, sobre cs.contatos. A
// diferença estrutural: os genéricos NÃO têm a trava do admin (atribuicao_admin
// é coluna só de cs.contatos_hm) nem roteamento canal→equipe — a equipe do card
// deriva exclusivamente do dono (cs.usuarios.equipe_id, views da 0146).
//
// POOL "de verdade" nos genéricos = responsavel_id NULL **e** texto vazio.
// Card com texto órfão (nome que o backfill não casou: apelido, typo, ex-
// operador) NÃO é pool: no mundo antigo ele era o card de alguém, e soltá-lo
// como "livre para todos" vazaria o lead para qualquer equipe assumir. Ele fica
// visível só a master até ser reatribuído por id (decisão documentada na 0146).

// Fragmento SQL do predicado padrão de escopo, para as rotas montarem o WHERE
// com os MESMOS placeholders sempre (verTudo boolean, usuarioId uuid, equipeId
// uuid — a ordem do paramsEscopo). `a` = alias que expõe responsavel_id,
// equipe_id e responsavel (cs.contatos_evento/cs.contatos_ht; para cs.contatos
// cru, o chamador junta cs.usuarios para ter a equipe).
export function sqlEscopo(a: { rid: string; eq: string; nome: string }, p: { verTudo: number; usuario: number; equipe: number }): string {
  return `($${p.verTudo}::boolean
       or (${a.rid} is null and ${a.eq} is null and coalesce(${a.nome}, '') = '')
       or ${a.eq} = $${p.equipe}::uuid
       or ${a.rid} = $${p.usuario}::uuid)`;
}

// Quem pode ABRIR/EDITAR o contato deste evento — o análogo de podeVerCardHm.
// Chamado em TODA rota que age sobre um contato específico (ficha, inbox 1:1,
// mover no kanban, registrar atendimento): sem isto o recorte da listagem é
// cosmético — bastaria forçar o comprador_id na rota unitária.
export async function podeVerContato(sessao: Ator, compradorId: string, evento: string): Promise<boolean> {
  const escopo = escopoVisibilidade(sessao);
  if (escopo.modo === "tudo") return true;
  const c = await queryOne<{ responsavel_id: string | null; equipe_id: string | null; responsavel: string | null }>(
    `select v.responsavel_id, v.equipe_id, v.responsavel
       from cs.contatos_evento v
      where v.comprador_id = $1 and v.evento = $2`,
    [compradorId, evento],
  );
  if (!c) return true; // inexistente → deixa o 404 acontecer no fluxo normal
  const ehPool = c.responsavel_id === null && c.equipe_id === null && (c.responsavel ?? "").trim() === "";
  if (ehPool) return true;
  // `equipe_id !== null` de propósito: gestor sem equipe (equipeId null) não
  // pode casar com card de equipe nula — "null === null" viraria vazamento.
  return escopo.modo === "equipe"
    ? c.equipe_id !== null && c.equipe_id === escopo.equipeId
    : c.responsavel_id === escopo.usuarioId;
}

// Atribui por ID (o caminho das equipes): grava responsavel_id — o texto deriva
// da trigger da 0146 (id vence). null = devolve ao pool (limpa id E texto: a
// trigger não dispara quando o id já era nulo, então o texto órfão é limpo aqui).
// Escopado por EVENTO: cs.contatos tem uma linha por (comprador, evento) e o
// gesto de atribuição é do portal em que ele aconteceu.
export async function setResponsavelPorId(compradorIds: string[], evento: string, responsavelId: string | null, autor = "cs") {
  const db = getDb();
  const antes = await query<{ id: string; responsavel: string | null; responsavel_id: string | null }>(
    `select id, responsavel, responsavel_id from cs.contatos where comprador_id = any($1::uuid[]) and evento = $2`,
    [compradorIds, evento],
  );
  const nomeNovo = responsavelId
    ? (await queryOne<{ nome: string }>(`select nome from cs.usuarios where id = $1`, [responsavelId]))?.nome ?? null
    : null;
  await query(
    `update cs.contatos
        set responsavel_id = $3,
            responsavel    = case when $3::uuid is null then null else responsavel end,
            atualizado_em  = now()
      where comprador_id = any($1::uuid[]) and evento = $2`,
    [compradorIds, evento, responsavelId],
  );
  for (const c of antes) {
    const mudouId = (c.responsavel_id ?? null) !== (responsavelId ?? null);
    const tinhaTextoOrfao = !responsavelId && !c.responsavel_id && (c.responsavel ?? "").trim() !== "";
    if (!mudouId && !tinhaTextoOrfao) continue;
    const anterior = c.responsavel?.trim() || null;
    await db.insert(interacoes).values({
      contatoId: c.id,
      tipo: "sistema",
      descricao: nomeNovo
        ? anterior
          ? `Responsável alterado de "${anterior}" para "${nomeNovo}"`
          : `Responsável atribuído: "${nomeNovo}"`
        : `Responsável removido (era "${anterior}") — devolvido ao pool`,
      autor,
    });
  }
}

// A hierarquia de atribuição dos genéricos — o espelho de atribuirResponsavelHm
// (mesma semântica, mesmos reasons), aplicado nas rotas que mexem em responsável
// (PATCH da ficha, lote do kanban). O caminho legado por NOME passa por aqui
// também: era ele que contornava a hierarquia inteira (furo 5 dos genéricos).
//
//   master   → atribui a qualquer um (e é o único que grava texto livre quando
//              o nome não casa com usuário ativo).
//   gestor   → só a membro da PRÓPRIA equipe.
//   operador → só assume para SI; devolve ao pool só o que é dele.
//
// Sem trava aqui: atribuicao_admin não existe em cs.contatos — `atribuicao_
// travada` sinaliza operador tentando mexer em card que já tem outro dono.
// O gate de visibilidade (podeVerContato) é da ROTA, antes de chamar isto.
export async function atribuirResponsavel(
  sessao: Ator,
  compradorId: string,
  destino: DestinoAtribuicao,
  evento: string,
  autor = "cs",
): Promise<AtribuicaoResultado> {
  const nivel = nivelDe(sessao);
  const atual = await queryOne<{ id: string; responsavel_id: string | null; responsavel: string | null }>(
    `select id, responsavel_id, responsavel from cs.contatos where comprador_id = $1 and evento = $2`,
    [compradorId, evento],
  );
  if (!atual) return { ok: false, reason: "nao_encontrado" };

  // Devolver ao pool: master/gestor sempre (a rota já garantiu que só chegam a
  // card que enxergam); operador só devolve o card que é DELE.
  if (destino.tipo === "pool") {
    if (nivel === "operador" && atual.responsavel_id !== sessao.id) {
      return { ok: false, reason: "sem_permissao_para_atribuir" };
    }
    await setResponsavelPorId([compradorId], evento, null, autor);
    return { ok: true };
  }

  // Resolve o destino para um usuário ATIVO. Nome que não casa: só o master
  // grava texto livre — para os demais o nome solto era o desvio da hierarquia.
  let user: { id: string; equipe_id: string | null } | null;
  if (destino.tipo === "id") {
    user = await queryOne<{ id: string; equipe_id: string | null }>(
      `select id, equipe_id from cs.usuarios where id = $1 and ativo`,
      [destino.id],
    );
    if (!user) return { ok: false, reason: "destino_invalido" };
  } else {
    user = await queryOne<{ id: string; equipe_id: string | null }>(
      `select id, equipe_id from cs.usuarios
        where lower(btrim(nome)) = lower(btrim($1)) and ativo
        limit 1`,
      [destino.nome],
    );
    if (!user) {
      if (nivel !== "master") return { ok: false, reason: "sem_permissao_para_atribuir" };
      // Texto livre do master: limpa o id ANTES (senão id e texto divergem — e
      // num único UPDATE a trigger da 0146 sobrescreveria o texto com null ao
      // ver o id mudar). Depois grava o texto, escopado pelo evento.
      if (atual.responsavel_id) {
        await query(`update cs.contatos set responsavel_id = null, atualizado_em = now() where id = $1`, [atual.id]);
      }
      const nome = destino.nome.trim();
      await query(`update cs.contatos set responsavel = $2, atualizado_em = now() where id = $1`, [atual.id, nome]);
      if ((atual.responsavel?.trim() || null) !== nome) {
        await getDb().insert(interacoes).values({
          contatoId: atual.id,
          tipo: "sistema",
          descricao: atual.responsavel?.trim()
            ? `Responsável alterado de "${atual.responsavel.trim()}" para "${nome}"`
            : `Responsável atribuído: "${nome}"`,
          autor,
        });
      }
      return { ok: true };
    }
  }

  // Hierarquia do DESTINO (lib/papeis) + estado do card.
  if (!podeAtribuirPara(sessao, user)) {
    return { ok: false, reason: nivel === "gestor" ? "destino_fora_da_equipe" : "sem_permissao_para_atribuir" };
  }
  // Operador: só assume do pool (ou re-assume o próprio, que é no-op). Card com
  // outro dono — por id ou por texto órfão — não é dele para pegar.
  if (nivel === "operador" && ((atual.responsavel_id !== null && atual.responsavel_id !== sessao.id)
      || (atual.responsavel_id === null && (atual.responsavel ?? "").trim() !== ""))) {
    return { ok: false, reason: "atribuicao_travada" };
  }
  await setResponsavelPorId([compradorId], evento, user.id, autor);
  return { ok: true };
}

export async function setOptOut(compradorId: string, optOut: boolean) {
  const db = getDb();
  await db
    .update(contatos)
    .set({ optOut, optOutEm: optOut ? sql`now()` : null, atualizadoEm: sql`now()` })
    .where(eq(contatos.compradorId, compradorId));
  const contatoId = await contatoIdDe(compradorId);
  if (contatoId) {
    await db.insert(interacoes).values({
      contatoId,
      tipo: "sistema",
      descricao: optOut ? "Marcado como opt-out (manual)" : "Opt-out removido (manual)",
      autor: "cs",
    });
  }
}

// Garante que cada contato tem a tag da sua edição do HT (ex: "HT27"), derivada
// de cs.contatos_ht. Idempotente — só adiciona onde falta. Roda no backfill e no
// cron, para que novos alunos recebam a tag da turma automaticamente.
export async function sincronizarTagsEdicao(): Promise<number> {
  const r = await query(
    `update cs.contatos ct
        set tags = array_append(ct.tags, v.edicao), atualizado_em = now()
       from cs.contatos_ht v
      where v.comprador_id = ct.comprador_id
        and v.edicao is not null and v.edicao <> ''
        and not (v.edicao = any(ct.tags))
      returning ct.id`,
  );
  return r.length;
}
