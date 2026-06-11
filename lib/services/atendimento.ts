import { eq, sql } from "drizzle-orm";
import { getDb } from "@/lib/drizzle";
import { contatos, atendimentos } from "@/db/schema";

// Serviço de Atendimento (Inbox): pendências e tempo de 1º contato (FRT).
// Queries type-safe via Drizzle. Usado pelo inbox e pelo webhook.

export async function marcarPendente(compradorId: string) {
  await getDb()
    .update(contatos)
    .set({ inboxStatus: "pendente", aguardandoDesde: sql`coalesce(${contatos.aguardandoDesde}, now())`, atualizadoEm: sql`now()` })
    .where(eq(contatos.compradorId, compradorId));
}

export async function mudarStatus(compradorId: string, status: "resolvido" | "pendente") {
  if (status === "resolvido") {
    await getDb()
      .update(contatos)
      .set({ inboxStatus: "resolvido", aguardandoDesde: null, atualizadoEm: sql`now()` })
      .where(eq(contatos.compradorId, compradorId));
  } else {
    await marcarPendente(compradorId);
  }
}

// Registra a resposta do CS: grava o atendimento com o FRT (se havia pendência)
// e resolve a conversa. Retorna o FRT em minutos (ou null se não havia espera).
export async function registrarRespostaCS(compradorId: string, atendente: string | null): Promise<number | null> {
  const db = getDb();
  const [pend] = await db
    .select({ aguardandoDesde: contatos.aguardandoDesde })
    .from(contatos)
    .where(eq(contatos.compradorId, compradorId))
    .limit(1);

  let frt: number | null = null;
  if (pend?.aguardandoDesde) {
    const [at] = await db
      .insert(atendimentos)
      .values({
        compradorId,
        atendente,
        perguntaEm: pend.aguardandoDesde,
        frtMinutos: sql`round(extract(epoch from (now() - ${pend.aguardandoDesde})) / 60)::int`,
      })
      .returning({ frtMinutos: atendimentos.frtMinutos });
    frt = at?.frtMinutos ?? null;
  }

  await db
    .update(contatos)
    .set({ inboxStatus: "resolvido", aguardandoDesde: null, ultimoContatoEm: sql`now()`, atualizadoEm: sql`now()` })
    .where(eq(contatos.compradorId, compradorId));
  return frt;
}
