import { z } from "zod";
import { NextResponse } from "next/server";

// Validação de entrada das rotas (substitui os casts `as {...}` inseguros).
// parseBody devolve os dados já tipados ou uma resposta 400 pronta.
export async function parseBody<T extends z.ZodTypeAny>(
  req: Request,
  schema: T,
): Promise<{ ok: true; data: z.infer<T> } | { ok: false; res: NextResponse }> {
  const body = await req.json().catch(() => ({}));
  const r = schema.safeParse(body);
  if (!r.success) {
    return {
      ok: false,
      res: NextResponse.json(
        { ok: false, reason: "dados inválidos", detalhes: r.error.issues.map((i) => ({ campo: i.path.join("."), erro: i.message })) },
        { status: 400 },
      ),
    };
  }
  return { ok: true, data: r.data };
}

const id = z.string().min(1);

export const AuthSchema = z.object({
  email: z.string().trim().min(1).email(),
  senha: z.string().min(1),
});

// ----- Usuários (gestão por admin + perfil) -----
const senhaForte = z.string().min(6, "mínimo de 6 caracteres");

export const UsuarioCriarSchema = z.object({
  nome: z.string().trim().min(2),
  email: z.string().trim().email(),
  senha: senhaForte,
  papel: z.enum(["admin", "disparador", "operador"]).default("operador"),
});

export const UsuarioPatchSchema = z.object({
  nome: z.string().trim().min(2).optional(),
  papel: z.enum(["admin", "disparador", "operador"]).optional(),
  ativo: z.boolean().optional(),
});

// Troca de senha: admin reseta (só novaSenha) ou o próprio usuário troca
// (atualSenha + novaSenha — validado na rota).
export const SenhaSchema = z.object({
  atualSenha: z.string().optional(),
  novaSenha: senhaForte,
});

export const SendSchema = z.object({
  templateId: id,
  compradorIds: z.array(id).min(1),
  edicao: z.string().optional(),
});

// ----- Canais de disparo (credencial de API por evento, admin) -----
export const CanalCriarSchema = z.object({
  evento_chave: z.string().trim().min(1),
  nome: z.string().trim().min(2),
  provider: z.string().trim().min(1).default("unnichat"),
  api_key: z.string().trim().min(1),
  base_url: z.string().trim().url().optional().or(z.literal("")),
  numero: z.string().trim().optional(),
});

export const CanalPatchSchema = z.object({
  nome: z.string().trim().min(2).optional(),
  api_key: z.string().trim().min(1).optional(),
  base_url: z.string().trim().optional(),
  numero: z.string().trim().optional(),
  ativo: z.boolean().optional(),
});

export const InboxMsgSchema = z.object({ texto: z.string().trim().min(1), atendente: z.string().optional() });
export const InboxStatusSchema = z.object({ status: z.enum(["resolvido", "pendente"]) });

export const ContatoPatchSchema = z.object({
  estagio_chave: z.string().optional(),
  proxima_acao_em: z.string().nullable().optional(),
  proxima_acao_nota: z.string().nullable().optional(),
  observacoes: z.string().nullable().optional(),
  nota: z.string().optional(),
  tags: z.array(z.string()).optional(),
  responsavel: z.string().nullable().optional(),
  opt_out: z.boolean().optional(),
});

export const LigacaoRegistrarSchema = z.object({
  compradorId: id,
  telefone: z.string().trim().min(1),
  operador: z.string().nullable().optional(),
  resultado: z.enum(["atendeu", "nao_atendeu", "caixa_postal", "ocupado", "numero_errado"]).optional(),
  duracaoSeg: z.number().int().nonnegative().optional(),
  anotacao: z.string().trim().optional(),
  retornoEm: z.string().nullable().optional(),
});

export const KanbanMoverSchema = z.object({ compradorId: id, estagioChave: z.string().min(1) });

// ----- Holding Masters (módulo de ativação, evento HM) -----
// `antesDe` posiciona o card na vertical da coluna: é o comprador_id do card que
// deve ficar logo abaixo dele, ou null para o fim da fila. Âncora, e não índice,
// porque o board pode estar filtrado — "antes do João" vale na coluna inteira, o
// índice 3 da tela não. Campo ausente = sem gesto de posição (o card vai ao topo).
export const HmMoverSchema = z.object({
  compradorId: id,
  estagioChave: z.string().min(1),
  antesDe: id.nullable().optional(),
});

export const HmContatoPatchSchema = z.object({
  estagio_chave: z.string().optional(),
  responsavel: z.string().nullable().optional(),
  observacoes: z.string().nullable().optional(),
  nota: z.string().optional(),
  tags: z.array(z.string()).optional(),
  plano: z.string().nullable().optional(),
  reuniao_em: z.string().nullable().optional(),
  reuniao_resultado: z.string().nullable().optional(),
  entrevista_em: z.string().nullable().optional(),
  entrevista_resultado: z.string().nullable().optional(),
  // ----- acordo do saldo (o que o comercial combina com o aluno) -----
  pagamento_meio: z.enum(["boleto", "cartao", "cartao_recorrente", "pix", "avista"]).nullable().optional(),
  pagamento_previsto_em: z.string().nullable().optional(),   // "vai pagar dia 17"
  acordo: z.string().nullable().optional(),                  // o combinado, em texto
  oferta_saldo_codigo: z.string().nullable().optional(),     // link de saldo escolhido
  link_saldo_enviado: z.boolean().optional(),                // marca/desmarca o envio (carimba a hora)
  // ----- travas operacionais -----
  nao_contatar: z.boolean().optional(),
  nao_contatar_motivo: z.string().nullable().optional(),
  revisar: z.boolean().optional(),
  revisar_motivo: z.string().nullable().optional(),
  // ----- checklist de ativação (trava a saída de "Acesso Liberado") -----
  ativ_searchie: z.boolean().optional(),
  ativ_comunidade: z.boolean().optional(),
  ativ_grupo: z.boolean().optional(),
  ativ_pesquisa: z.boolean().optional(),
  grupo_informes: z.string().nullable().optional(),          // qual grupo ("THB #27")
  pendencia: z.string().nullable().optional(),
  // ----- cancelamento -----
  cancelamento_motivo: z.string().nullable().optional(),
  link_facebook: z.string().nullable().optional(),
  // turma do aluno NO HM (a atual, T39 por padrão) — editável para exceções
  turma: z.string().nullable().optional(),
  // ----- crédito pró-rata (insumos; o crédito é calculado) -----
  credito_oferta: z.string().nullable().optional(),
  credito_compra_em: z.string().nullable().optional(),
  credito_valor_pago: z.number().nonnegative().nullable().optional(),
  credito_dias_totais: z.number().int().positive().nullable().optional(),
  // atalho de pagamento do saldo (14.700) — dispara a ida para a Ativação e o
  // provisionamento do aluno na base THB (os valores viram o bloco financeiro)
  pagamento_forma: z.enum(["avista", "parcelado"]).optional(),
  pagamento_parcelas: z.number().int().positive().nullable().optional(),
  valor_total: z.number().nonnegative().nullable().optional(),
  valor_pago: z.number().nonnegative().nullable().optional(),
  marcar_pagamento: z.boolean().optional(),
  // desfazer o último movimento de etapa (miss click)
  reverter: z.boolean().optional(),
});
// ----- Sócios do HM (aba "SÓCIOS T39") -----
// O sócio tem checklist próprio: ele também é ativado, pendurado no titular.
export const HmSocioCriarSchema = z.object({
  nome: z.string().trim().min(2),
  email: z.string().trim().email().nullable().optional().or(z.literal("")),
  telefone: z.string().trim().nullable().optional(),
});

export const HmSocioPatchSchema = z.object({
  socioId: id,
  nome: z.string().trim().min(2).optional(),
  email: z.string().trim().nullable().optional(),
  telefone: z.string().trim().nullable().optional(),
  link_facebook: z.string().nullable().optional(),
  ativ_searchie: z.boolean().optional(),
  ativ_comunidade: z.boolean().optional(),
  ativ_grupo: z.boolean().optional(),
});

export const KanbanLoteSchema = z.object({
  compradorIds: z.array(id).min(1),
  addTag: z.string().optional(),
  responsavel: z.string().nullable().optional(),
});
