import { and, eq, inArray, sql } from "drizzle-orm";
import { getDb } from "@/lib/drizzle";
import { query, queryOne } from "@/lib/db";
import { contatos, estagios, interacoes } from "@/db/schema";
import { ehMaster, escopoVisibilidade, nivelDe, podeAtribuirPara, type Ator } from "@/lib/papeis";
import { podeVerPorEscopo, veredictoAcao, type VeredictoAcao } from "@/lib/services/visibilidade";
import type { AtribuicaoResultado, DestinoAtribuicao } from "@/lib/services/hm";

// O contrato de atribuição é UM só, HM e genéricos — mesmos reasons, mesma
// forma de destino. Reexportado para as rotas genéricas não importarem de hm.
export type { AtribuicaoErro, AtribuicaoResultado, DestinoAtribuicao } from "@/lib/services/hm";
// O predicado de escopo é UM só, HM e genéricos — vive em visibilidade.ts.
// Reexportado para os ~14 call sites existentes não mudarem de import.
export { sqlEscopo } from "@/lib/services/visibilidade";

// Serviço de Contato (CRM): regras de negócio reutilizadas pelas rotas (detalhe,
// Kanban, lote). Queries type-safe via Drizzle sobre o pool pg existente.

// TODA leitura/escrita em cs.contatos é escopada por (comprador_id, evento):
// a tabela tem UMA linha por comprador POR EVENTO (0019) — sem o evento, um
// UPDATE "por comprador" atravessa o isolamento de portal e escreve na linha
// do HT a partir do portal SEM (e vice-versa). O evento vem da rota, que já o
// validou no guard({ portal }) — o que se valida é o que se escreve.
async function contatoIdDe(compradorId: string, evento: string): Promise<string | null> {
  const [c] = await getDb()
    .select({ id: contatos.id })
    .from(contatos)
    .where(and(eq(contatos.compradorId, compradorId), eq(contatos.evento, evento)))
    .limit(1);
  return c?.id ?? null;
}

// Move o contato de etapa (valida etapa ativa DO EVENTO) e registra na timeline
// com os estágios anterior/novo. Retorna false se a etapa não existe/está
// inativa. Escopado por evento nas DUAS pontas: o estágio (cs.estagios tem
// chaves por evento) e a linha do contato (uma por evento — sem isto o LIMIT 1
// podia mover a linha do evento errado, em silêncio).
export async function moverEstagio(compradorId: string, evento: string, estagioChave: string, autor = "cs"): Promise<boolean> {
  const db = getDb();
  const [novo] = await db
    .select({ id: estagios.id, nome: estagios.nome })
    .from(estagios)
    .where(and(eq(estagios.chave, estagioChave), eq(estagios.ativo, true), eq(estagios.evento, evento)))
    .limit(1);
  if (!novo) return false;

  const [c] = await db
    .select({ id: contatos.id, estagioId: contatos.estagioId })
    .from(contatos)
    .where(and(eq(contatos.compradorId, compradorId), eq(contatos.evento, evento)))
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

export async function setTags(compradorId: string, evento: string, tags: string[]) {
  await getDb()
    .update(contatos)
    .set({ tags, atualizadoEm: sql`now()` })
    .where(and(eq(contatos.compradorId, compradorId), eq(contatos.evento, evento)));
}

export async function addTagEmLote(compradorIds: string[], evento: string, tag: string) {
  await getDb()
    .update(contatos)
    .set({ tags: sql`array_append(${contatos.tags}, ${tag})`, atualizadoEm: sql`now()` })
    .where(and(inArray(contatos.compradorId, compradorIds), eq(contatos.evento, evento), sql`not (${tag} = any(${contatos.tags}))`));
}

// (O legado `setResponsavel` por NOME foi REMOVIDO: escrevia em TODOS os
// eventos do comprador — o caminho vivo é setResponsavelPorId/atribuirResponsavel,
// escopados por evento e pela hierarquia. Não reintroduzir um writer sem evento.)

// ===== Equipes / visibilidade nos portais genéricos (0146) ==================
// O espelho do que lib/services/hm.ts faz para o HM, sobre cs.contatos. A
// diferença estrutural: os genéricos NÃO têm a trava do admin (atribuicao_admin
// é coluna só de cs.contatos_hm) nem roteamento canal→equipe — a equipe do card
// deriva exclusivamente do dono (cs.usuarios.equipe_id, views da 0146).
//
// POOL "de verdade" = responsavel_id NULL **e** equipe NULL **e** texto vazio.
// Card com texto órfão (nome que o backfill não casou: apelido, typo, ex-
// operador) NÃO é pool — fica visível só a master até ser reatribuído por id.
// O predicado (SQL e JS) vive em lib/services/visibilidade.ts, compartilhado
// com o HM: duas respostas para "quem vê este card?" era o bug.

// ===== Leitura ≠ ação (28/07): DOIS gates, um por pergunta ==================
// podeVerContato  → LEITURA: quem pode ABRIR o contato (ficha, conversa 1:1,
//                   histórico de ligações). Espelha o WHERE das listagens
//                   (escopoVisibilidade): master tudo; gestor E OPERADOR o
//                   pool + a equipe inteira.
// podeAgirContato → ESCRITA: quem pode EDITAR/mover/atribuir/responder/registrar
//                   (escopoAcao): operador SÓ no pool e nos cards DELE — card
//                   de colega abre em leitura e recusa escrita com 403
//                   'card_de_outro_operador'. O análogo exato do par do HM
//                   (podeVerCardHm/podeAgirCardHm). NÃO reunificar as duas.
async function contatoEscopo(compradorId: string, evento: string) {
  return queryOne<{ responsavel_id: string | null; equipe_id: string | null; responsavel: string | null }>(
    `select v.responsavel_id, v.equipe_id, v.responsavel
       from cs.contatos_evento v
      where v.comprador_id = $1 and v.evento = $2`,
    [compradorId, evento],
  );
}

export async function podeVerContato(sessao: Ator, compradorId: string, evento: string): Promise<boolean> {
  const escopo = escopoVisibilidade(sessao);
  if (escopo.modo === "tudo") return true;
  const c = await contatoEscopo(compradorId, evento);
  if (!c) return true; // inexistente → deixa o 404 acontecer no fluxo normal
  // O MESMO predicado do sqlEscopo das listagens (visibilidade.ts) — a lista
  // não mostra, a ficha não abre, pela mesma regra e pelo mesmo código.
  return podeVerPorEscopo(escopo, c);
}

// Gate de AÇÃO das rotas de escrita (PATCH da ficha, mover no kanban, lote,
// inbox POST/PATCH, registrar atendimento). As rotas respondem 403 com o
// próprio veredicto como reason ('card_de_outro_operador' | 'sem_acesso').
export async function podeAgirContato(sessao: Ator, compradorId: string, evento: string): Promise<VeredictoAcao> {
  if (ehMaster(sessao)) return "ok";
  const c = await contatoEscopo(compradorId, evento);
  if (!c) return "ok"; // inexistente → deixa o 404 acontecer no fluxo normal
  return veredictoAcao(sessao, c);
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
  // `tem_portal` sai na mesma query: atribuir um card do HT a quem não tem 'HT'
  // na whitelist (0145) faria o card sumir da vista do destino no instante
  // seguinte — recusado para TODOS os níveis (28/07: equipes são globais, o
  // isolamento é do portal). O portal checado é o EVENTO do card.
  type DestinoUser = { id: string; equipe_id: string | null; tem_portal: boolean };
  const SEL_DESTINO = `select u.id, u.equipe_id,
      exists (select 1 from cs.usuario_portais up where up.usuario_id = u.id and up.portal = $2) as tem_portal
    from cs.usuarios u`;
  let user: DestinoUser | null;
  if (destino.tipo === "id") {
    user = await queryOne<DestinoUser>(
      `${SEL_DESTINO} where u.id = $1 and u.ativo`,
      [destino.id, evento],
    );
    if (!user) return { ok: false, reason: "destino_invalido" };
  } else {
    user = await queryOne<DestinoUser>(
      `${SEL_DESTINO} where lower(btrim(u.nome)) = lower(btrim($1)) and u.ativo limit 1`,
      [destino.nome, evento],
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

  // Portal antes da hierarquia: sem o portal do card na whitelist não há
  // destino válido — nem para o master (libere o portal da conta antes).
  if (!user.tem_portal) return { ok: false, reason: "destino_sem_portal" };

  // Hierarquia do DESTINO (lib/papeis) + estado do card.
  if (!podeAtribuirPara(sessao, user)) {
    return { ok: false, reason: nivel === "gestor" ? "destino_fora_da_equipe" : "sem_permissao_para_atribuir" };
  }
  // Operador: só assume do pool (ou re-assume o próprio, que é no-op). Card com
  // outro dono — por id ou por texto órfão — não é dele para pegar. Sem trim,
  // como o ehCardLivre/sqlEscopo: a escrita espelha a leitura exatamente.
  if (nivel === "operador" && ((atual.responsavel_id !== null && atual.responsavel_id !== sessao.id)
      || (atual.responsavel_id === null && (atual.responsavel ?? "") !== ""))) {
    return { ok: false, reason: "atribuicao_travada" };
  }
  await setResponsavelPorId([compradorId], evento, user.id, autor);
  return { ok: true };
}

// Opt-out é POR EVENTO (a linha de cs.contatos é por portal): marcar/desmarcar
// no SEM não pode silenciar nem reabilitar disparo no HT — cruzar isso é
// exatamente o tipo de escrita que viola a decisão do lead em outro portal.
export async function setOptOut(compradorId: string, evento: string, optOut: boolean) {
  const db = getDb();
  await db
    .update(contatos)
    .set({ optOut, optOutEm: optOut ? sql`now()` : null, atualizadoEm: sql`now()` })
    .where(and(eq(contatos.compradorId, compradorId), eq(contatos.evento, evento)));
  const contatoId = await contatoIdDe(compradorId, evento);
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
        -- Só a linha do HT: a edição (HT27…) vem de cs.contatos_ht — sem este
        -- filtro a tag da turma vazava para a linha do MESMO comprador em outro
        -- portal (SEM/CNHF), corrompendo a segmentação de lá.
        and ct.evento = 'HT'
        and v.edicao is not null and v.edicao <> ''
        and not (v.edicao = any(ct.tags))
      returning ct.id`,
  );
  return r.length;
}
