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

export const AuthSchema = z.object({ password: z.string().min(1) });

export const SendSchema = z.object({
  templateId: id,
  compradorIds: z.array(id).min(1),
  edicao: z.string().optional(),
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

export const KanbanMoverSchema = z.object({ compradorId: id, estagioChave: z.string().min(1) });
export const KanbanLoteSchema = z.object({
  compradorIds: z.array(id).min(1),
  addTag: z.string().optional(),
  responsavel: z.string().nullable().optional(),
});
