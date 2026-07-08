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
export const HmMoverSchema = z.object({ compradorId: id, estagioChave: z.string().min(1) });

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
  // atalho de pagamento do saldo (14.700) — dispara a ida para a Ativação
  pagamento_forma: z.enum(["avista", "parcelado"]).optional(),
  pagamento_parcelas: z.number().int().positive().nullable().optional(),
  marcar_pagamento: z.boolean().optional(),
  // desfazer o último movimento de etapa (miss click)
  reverter: z.boolean().optional(),
});
export const KanbanLoteSchema = z.object({
  compradorIds: z.array(id).min(1),
  addTag: z.string().optional(),
  responsavel: z.string().nullable().optional(),
});
