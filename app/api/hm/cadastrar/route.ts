import { NextResponse } from "next/server";
import { getSessao } from "@/lib/auth";
import { parseBody, HmCadastroSchema } from "@/lib/validators";
import { cadastrarManualHm } from "@/lib/services/hm";

export const runtime = "nodejs";

// POST /api/hm/cadastrar — coloca alguém na esteira HM à mão.
//   • quem o seed não pegou (boleto do sinal aprovado num UPDATE — a trigger é
//     AFTER INSERT e não re-dispara);
//   • quem entra sem compra na Hotmart (indicação, acordo por fora).
// Idempotente: se a pessoa já tem card, devolve o mesmo (`jaExistia`), não duplica.
export async function POST(req: Request) {
  const sessao = await getSessao();
  if (!sessao) return NextResponse.json({ ok: false }, { status: 401 });

  const parsed = await parseBody(req, HmCadastroSchema);
  if (!parsed.ok) return parsed.res;
  const b = parsed.data;

  const r = await cadastrarManualHm(
    {
      nome: b.nome, email: b.email, telefone: b.telefone, documento: b.documento,
      turma: b.turma, categoria: b.categoria ?? null, responsavel: b.responsavel ?? null,
      estagioChave: b.estagio_chave,
    },
    sessao.nome || "cs",
  );

  if (!r.ok) return NextResponse.json({ ok: false, reason: r.reason }, { status: 400 });
  return NextResponse.json({
    ok: true,
    compradorId: r.compradorId,
    jaExistia: r.jaExistia,
    criouComprador: r.criouComprador,
    nome: r.nome,
  });
}
