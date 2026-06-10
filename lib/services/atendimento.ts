import { query, queryOne } from "@/lib/db";

// Serviço de Atendimento (Inbox): pendências e tempo de 1º contato (FRT).
// Usado pelo webhook (lead respondeu → pendente) e pelo inbox (CS respondeu).

export async function marcarPendente(compradorId: string) {
  await query(
    `update cs.contatos set inbox_status = 'pendente', aguardando_desde = coalesce(aguardando_desde, now()), atualizado_em = now() where comprador_id = $1`,
    [compradorId],
  );
}

export async function mudarStatus(compradorId: string, status: "resolvido" | "pendente") {
  if (status === "resolvido") {
    await query(`update cs.contatos set inbox_status = 'resolvido', aguardando_desde = null, atualizado_em = now() where comprador_id = $1`, [compradorId]);
  } else {
    await marcarPendente(compradorId);
  }
}

// Registra a resposta do CS: grava o atendimento com o FRT (se havia pendência)
// e resolve a conversa. Retorna o FRT em minutos (ou null se não havia espera).
export async function registrarRespostaCS(compradorId: string, atendente: string | null): Promise<number | null> {
  const pend = await queryOne<{ aguardando_desde: string | null }>(
    `select aguardando_desde from cs.contatos where comprador_id = $1`,
    [compradorId],
  );
  let frt: number | null = null;
  if (pend?.aguardando_desde) {
    const at = await queryOne<{ frt_minutos: number }>(
      `insert into cs.atendimentos (comprador_id, atendente, pergunta_em, frt_minutos)
       values ($1, $2, $3, round(extract(epoch from (now() - $3::timestamptz)) / 60)::int)
       returning frt_minutos`,
      [compradorId, atendente, pend.aguardando_desde],
    );
    frt = at?.frt_minutos ?? null;
  }
  await query(
    `update cs.contatos set inbox_status = 'resolvido', aguardando_desde = null, ultimo_contato_em = now(), atualizado_em = now() where comprador_id = $1`,
    [compradorId],
  );
  return frt;
}
