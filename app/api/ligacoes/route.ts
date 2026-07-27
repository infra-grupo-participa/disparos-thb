import { NextResponse } from "next/server";
import { guard } from "@/lib/guard";
import { eventoDe } from "@/lib/services/evento";
import { parseBody, AtendimentoRegistrarSchema } from "@/lib/validators";
import { registrarAtendimento, listarPorComprador } from "@/lib/services/ligacao";
import { podeVerContato } from "@/lib/services/contato";

export const runtime = "nodejs";

// GET /api/ligacoes?comprador_id=... — histórico de atendimentos do contato.
export async function GET(req: Request) {
  // Portal do evento RESOLVIDO (cookie/query) contra a whitelist da conta (0145).
  const g = await guard({ portal: eventoDe(req) });
  if (!g.ok) return g.res;
  const compradorId = new URL(req.url).searchParams.get("comprador_id");
  if (!compradorId) return NextResponse.json({ ok: false, reason: "comprador_id obrigatório" }, { status: 400 });
  // Gating de equipe (0146): o histórico é do CONTATO — só abre para quem o vê.
  if (!(await podeVerContato(g.sessao, compradorId, eventoDe(req)))) {
    return NextResponse.json({ ok: false, reason: "sem_acesso" }, { status: 403 });
  }
  const ligacoes = await listarPorComprador(compradorId);
  return NextResponse.json({ ok: true, ligacoes });
}

// POST /api/ligacoes — registra um atendimento (ligação, WhatsApp, presencial).
// O operador vem da SESSÃO. Antes vinha do localStorage do navegador, o que
// significa que o nome no relatório de produtividade era o que o próprio
// navegador dissesse — e ficava vazio em qualquer máquina nova.
export async function POST(req: Request) {
  // Portal do evento RESOLVIDO (cookie/query) contra a whitelist da conta (0145).
  const g = await guard({ portal: eventoDe(req) });
  if (!g.ok) return g.res;
  const sessao = g.sessao;

  const p = await parseBody(req, AtendimentoRegistrarSchema);
  if (!p.ok) return p.res;

  // Gating de equipe (0146): registrar um atendimento é agir sobre o contato —
  // só em card que o ator VÊ (pool / própria equipe / os dele).
  if (!(await podeVerContato(sessao, p.data.compradorId, eventoDe(req)))) {
    return NextResponse.json({ ok: false, reason: "sem_acesso" }, { status: 403 });
  }

  const atendimento = await registrarAtendimento({ ...p.data, operador: sessao.nome || "cs" });
  return NextResponse.json({ ok: true, atendimento });
}
