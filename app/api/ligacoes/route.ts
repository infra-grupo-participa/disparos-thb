import { NextResponse } from "next/server";
import { isAuthed, getSessao } from "@/lib/auth";
import { parseBody, AtendimentoRegistrarSchema } from "@/lib/validators";
import { registrarAtendimento, listarPorComprador } from "@/lib/services/ligacao";

export const runtime = "nodejs";

// GET /api/ligacoes?comprador_id=... — histórico de atendimentos do contato.
export async function GET(req: Request) {
  if (!isAuthed()) return NextResponse.json({ ok: false }, { status: 401 });
  const compradorId = new URL(req.url).searchParams.get("comprador_id");
  if (!compradorId) return NextResponse.json({ ok: false, reason: "comprador_id obrigatório" }, { status: 400 });
  const ligacoes = await listarPorComprador(compradorId);
  return NextResponse.json({ ok: true, ligacoes });
}

// POST /api/ligacoes — registra um atendimento (ligação, WhatsApp, presencial).
// O operador vem da SESSÃO. Antes vinha do localStorage do navegador, o que
// significa que o nome no relatório de produtividade era o que o próprio
// navegador dissesse — e ficava vazio em qualquer máquina nova.
export async function POST(req: Request) {
  const sessao = await getSessao();
  if (!sessao) return NextResponse.json({ ok: false }, { status: 401 });

  const p = await parseBody(req, AtendimentoRegistrarSchema);
  if (!p.ok) return p.res;

  const atendimento = await registrarAtendimento({ ...p.data, operador: sessao.nome || "cs" });
  return NextResponse.json({ ok: true, atendimento });
}
