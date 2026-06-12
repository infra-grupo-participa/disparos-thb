import { eq, desc, sql } from "drizzle-orm";
import { getDb } from "@/lib/drizzle";
import { ligacoes, contatos, interacoes } from "@/db/schema";

// Serviço de Ligações. Desacoplado do discador: a ligação pode ser registrada
// à mão (modo tel:) ou iniciada por um provedor (Nvoip) e completada pelo
// webhook. Espelha no timeline (cs.interacoes) e atualiza o último contato.

const RESULTADO_LABEL: Record<string, string> = {
  atendeu: "Atendeu",
  nao_atendeu: "Não atendeu",
  caixa_postal: "Caixa postal",
  ocupado: "Ocupado",
  numero_errado: "Número errado",
};

async function contatoIdDe(compradorId: string): Promise<string | null> {
  const [c] = await getDb()
    .select({ id: contatos.id })
    .from(contatos)
    .where(eq(contatos.compradorId, compradorId))
    .limit(1);
  return c?.id ?? null;
}

export type RegistrarLigacaoInput = {
  compradorId: string;
  telefone: string;
  operador?: string | null;
  resultado?: keyof typeof RESULTADO_LABEL;
  duracaoSeg?: number;
  anotacao?: string;
  retornoEm?: string | null;
  provider?: string;
  providerCallId?: string;
  status?: "iniciada" | "concluida" | "falhou";
};

export async function registrarLigacao(i: RegistrarLigacaoInput) {
  const db = getDb();
  const retorno = i.retornoEm ? new Date(i.retornoEm) : null;

  const [lig] = await db
    .insert(ligacoes)
    .values({
      compradorId: i.compradorId,
      operador: i.operador ?? null,
      telefone: i.telefone,
      resultado: i.resultado ?? null,
      duracaoSeg: i.duracaoSeg ?? null,
      anotacao: i.anotacao ?? null,
      retornoEm: retorno,
      provider: i.provider ?? "manual",
      providerCallId: i.providerCallId ?? null,
      status: i.status ?? "concluida",
    })
    .returning();

  // Espelha no histórico do contato (timeline).
  const contatoId = await contatoIdDe(i.compradorId);
  if (contatoId) {
    const partes = [i.resultado ? RESULTADO_LABEL[i.resultado] : "Ligação"];
    if (i.duracaoSeg) partes.push(`${Math.max(1, Math.round(i.duracaoSeg / 60))}min`);
    if (i.anotacao) partes.push(i.anotacao);
    await db.insert(interacoes).values({
      contatoId,
      tipo: "ligacao",
      descricao: `📞 ${partes.join(" · ")}`,
      autor: i.operador ?? "cs",
    });
  }

  // Marca último contato; se houver retorno agendado, vira a próxima ação.
  await db
    .update(contatos)
    .set({
      ultimoContatoEm: sql`now()`,
      ...(retorno ? { proximaAcaoEm: retorno, proximaAcaoNota: "Retornar ligação" } : {}),
      atualizadoEm: sql`now()`,
    })
    .where(eq(contatos.compradorId, i.compradorId));

  return lig;
}

export async function listarPorComprador(compradorId: string) {
  return getDb()
    .select()
    .from(ligacoes)
    .where(eq(ligacoes.compradorId, compradorId))
    .orderBy(desc(ligacoes.criadoEm))
    .limit(50);
}

// Usado pelo webhook do provedor: completa uma ligação iniciada via discador.
export async function atualizarPorProviderCallId(
  providerCallId: string,
  patch: { resultado?: string; duracaoSeg?: number; urlGravacao?: string; status?: string },
) {
  await getDb()
    .update(ligacoes)
    .set({ ...patch, atualizadoEm: sql`now()` })
    .where(eq(ligacoes.providerCallId, providerCallId));
}
