import { query, queryOne } from "@/lib/db";

// Serviço de Contato (CRM): regras de negócio reutilizadas pelas rotas de
// detalhe do contato, do Kanban e de ações em lote. Centraliza a escrita para
// manter a timeline e os campos consistentes (DRY — antes duplicado por rota).

// Move o contato de etapa (valida etapa ativa) e registra na timeline com os
// estágios anterior/novo. Retorna false se a etapa não existe/está inativa.
export async function moverEstagio(compradorId: string, estagioChave: string): Promise<boolean> {
  const novo = await queryOne<{ id: number; nome: string }>(
    `select id, nome from cs.estagios where chave = $1 and ativo`,
    [estagioChave],
  );
  if (!novo) return false;
  const atual = await queryOne<{ estagio_id: number | null }>(
    `select estagio_id from cs.contatos where comprador_id = $1`,
    [compradorId],
  );
  await query(`update cs.contatos set estagio_id = $2, atualizado_em = now() where comprador_id = $1`, [compradorId, novo.id]);
  await query(
    `insert into cs.interacoes (contato_id, tipo, descricao, estagio_anterior_id, estagio_novo_id, autor)
     select id, 'mudanca_estagio', $2, $3, $4, 'cs' from cs.contatos where comprador_id = $1`,
    [compradorId, `Movido para "${novo.nome}"`, atual?.estagio_id ?? null, novo.id],
  );
  return true;
}

export async function setTags(compradorId: string, tags: string[]) {
  await query(`update cs.contatos set tags = $2, atualizado_em = now() where comprador_id = $1`, [compradorId, tags]);
}

export async function addTagEmLote(compradorIds: string[], tag: string) {
  await query(
    `update cs.contatos set tags = array_append(tags, $2), atualizado_em = now()
      where comprador_id = any($1::uuid[]) and not ($2 = any(tags))`,
    [compradorIds, tag],
  );
}

export async function setResponsavel(compradorIds: string[], responsavel: string | null) {
  await query(
    `update cs.contatos set responsavel = $2, atualizado_em = now() where comprador_id = any($1::uuid[])`,
    [compradorIds, responsavel],
  );
}

export async function setOptOut(compradorId: string, optOut: boolean) {
  await query(
    `update cs.contatos set opt_out = $2, opt_out_em = case when $2 then now() else null end, atualizado_em = now() where comprador_id = $1`,
    [compradorId, optOut],
  );
  await query(
    `insert into cs.interacoes (contato_id, tipo, descricao, autor)
     select id, 'sistema', $2, 'cs' from cs.contatos where comprador_id = $1`,
    [compradorId, optOut ? "Marcado como opt-out (manual)" : "Opt-out removido (manual)"],
  );
}
