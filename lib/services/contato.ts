import { and, eq, inArray, sql } from "drizzle-orm";
import { getDb } from "@/lib/drizzle";
import { query } from "@/lib/db";
import { contatos, estagios, interacoes } from "@/db/schema";

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

export async function setResponsavel(compradorIds: string[], responsavel: string | null) {
  await getDb().update(contatos).set({ responsavel, atualizadoEm: sql`now()` }).where(inArray(contatos.compradorId, compradorIds));
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
