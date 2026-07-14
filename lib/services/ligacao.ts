import { eq, desc, sql, and, gte } from "drizzle-orm";
import { getDb } from "@/lib/drizzle";
import { ligacoes, contatos, interacoes } from "@/db/schema";

// Serviço de Atendimento do operador. Depois que o Atende Simples saiu, ESTE é o
// único caminho de escrita em cs.ligacoes — não há mais webhook de discador.
//
// O registro vale para qualquer canal (ligação, WhatsApp, presencial): o que
// interessa ao funil é que houve um toque e o que saiu dele, não o meio.
//
// Dois defeitos que existiam aqui e sumiam com o trabalho do operador:
//  - a interação era gravada SEM `canal`, então caía no balde "outro" e o
//    atendimento não aparecia no ritmo da Visão Executiva nem na Jornada;
//  - o operador vinha do localStorage do navegador, não da sessão.

export const CANAIS = ["ligacao", "whatsapp", "presencial", "outro"] as const;
export type CanalAtendimento = (typeof CANAIS)[number];

export const RESULTADOS = ["atendeu", "nao_atendeu", "caixa_postal", "ocupado", "numero_errado"] as const;
export type ResultadoAtendimento = (typeof RESULTADOS)[number];

// 'atendeu' quer dizer o mesmo em todo canal — houve conversa. O que muda é como
// se fala disso: ninguém "atende" um WhatsApp, responde. Mesmo dado, rótulo certo.
const RESULTADO_LABEL: Record<CanalAtendimento, Record<ResultadoAtendimento, string>> = {
  ligacao:    { atendeu: "Atendeu",   nao_atendeu: "Não atendeu",   caixa_postal: "Caixa postal", ocupado: "Ocupado",       numero_errado: "Número errado" },
  whatsapp:   { atendeu: "Respondeu", nao_atendeu: "Sem resposta",  caixa_postal: "Caixa postal", ocupado: "Ocupado",       numero_errado: "Número errado" },
  presencial: { atendeu: "Compareceu", nao_atendeu: "Não compareceu", caixa_postal: "Caixa postal", ocupado: "Ocupado",     numero_errado: "Número errado" },
  outro:      { atendeu: "Falou",     nao_atendeu: "Não falou",     caixa_postal: "Caixa postal", ocupado: "Ocupado",       numero_errado: "Número errado" },
};

const ICONE: Record<CanalAtendimento, string> = {
  ligacao: "📞", whatsapp: "💬", presencial: "🤝", outro: "•",
};

export function rotuloResultado(canal: CanalAtendimento, resultado: ResultadoAtendimento): string {
  return RESULTADO_LABEL[canal]?.[resultado] ?? resultado;
}

async function contatoIdDe(compradorId: string): Promise<string | null> {
  const [c] = await getDb()
    .select({ id: contatos.id })
    .from(contatos)
    .where(eq(contatos.compradorId, compradorId))
    .limit(1);
  return c?.id ?? null;
}

export type RegistrarAtendimentoInput = {
  compradorId: string;
  telefone: string;
  operador: string;               // vem da SESSÃO, não do navegador
  canal?: CanalAtendimento;
  resultado?: ResultadoAtendimento;
  duracaoSeg?: number;
  anotacao?: string;
  retornoEm?: string | null;
};

export async function registrarAtendimento(i: RegistrarAtendimentoInput) {
  const db = getDb();
  const canal: CanalAtendimento = i.canal ?? "ligacao";
  const retorno = i.retornoEm ? new Date(i.retornoEm) : null;

  const [at] = await db
    .insert(ligacoes)
    .values({
      compradorId: i.compradorId,
      operador: i.operador,
      telefone: i.telefone,
      canal,
      resultado: i.resultado ?? null,
      duracaoSeg: i.duracaoSeg ?? null,
      anotacao: i.anotacao ?? null,
      retornoEm: retorno,
      provider: "manual",
      status: "concluida",
    })
    .returning();

  // Espelha na timeline do contato. `canal` preenchido é o que faz este toque
  // contar no ritmo por canal (Visão Executiva) e na Jornada.
  const contatoId = await contatoIdDe(i.compradorId);
  if (contatoId) {
    const partes = [i.resultado ? rotuloResultado(canal, i.resultado) : "Atendimento"];
    if (i.duracaoSeg) partes.push(`${Math.max(1, Math.round(i.duracaoSeg / 60))}min`);
    if (i.anotacao) partes.push(i.anotacao);
    await db.insert(interacoes).values({
      contatoId,
      tipo: "ligacao",
      canal,
      descricao: `${ICONE[canal]} ${partes.join(" · ")}`,
      autor: i.operador,
    });
  }

  // Marca o último contato; se houver retorno agendado, vira a próxima ação.
  await db
    .update(contatos)
    .set({
      ultimoContatoEm: sql`now()`,
      primeiroContatoEm: sql`coalesce(${contatos.primeiroContatoEm}, now())`,
      ...(retorno ? { proximaAcaoEm: retorno, proximaAcaoNota: "Retornar contato" } : {}),
      atualizadoEm: sql`now()`,
    })
    .where(eq(contatos.compradorId, i.compradorId));

  return at;
}

export async function listarPorComprador(compradorId: string) {
  return getDb()
    .select()
    .from(ligacoes)
    .where(eq(ligacoes.compradorId, compradorId))
    .orderBy(desc(ligacoes.criadoEm))
    .limit(50);
}

// O placar do dia do operador: o que ELE registrou desde a meia-noite. É o que a
// tela "Meu dia" mostra de volta — registrar deixa de ser burocracia e vira o
// painel do próprio trabalho.
export async function placarDoDia(operador: string) {
  const [r] = await getDb()
    .select({
      total: sql<number>`count(*)::int`,
      atendidos: sql<number>`count(*) filter (where ${ligacoes.resultado} = 'atendeu')::int`,
      tempoSeg: sql<number>`coalesce(sum(${ligacoes.duracaoSeg}), 0)::int`,
      retornos: sql<number>`count(*) filter (where ${ligacoes.retornoEm} is not null)::int`,
    })
    .from(ligacoes)
    .where(and(
      eq(ligacoes.operador, operador),
      gte(ligacoes.criadoEm, sql`date_trunc('day', now() at time zone 'America/Sao_Paulo') at time zone 'America/Sao_Paulo'`),
    ));
  return r ?? { total: 0, atendidos: 0, tempoSeg: 0, retornos: 0 };
}
