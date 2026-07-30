import { NextResponse } from "next/server";
import { guard } from "@/lib/guard";
import { ehMaster } from "@/lib/papeis";
import { parseBody, HmCadastroSchema } from "@/lib/validators";
import { cadastrarManualHm, setResponsavelHmPorId } from "@/lib/services/hm";

export const runtime = "nodejs";

// POST /api/hm/cadastrar — coloca alguém na esteira HM à mão.
//   • quem o seed não pegou (boleto do sinal aprovado num UPDATE — a trigger é
//     AFTER INSERT e não re-dispara);
//   • quem entra sem compra na Hotmart (indicação, acordo por fora).
// Idempotente: se a pessoa já tem card, devolve o mesmo (`jaExistia`), não duplica.
export async function POST(req: Request) {
  const g = await guard({ portal: "HM" });
  if (!g.ok) return g.res;
  const sessao = g.sessao;

  // Card é reflexo da Hotmart (30/07): colaborador NÃO cria card à mão. Quando o
  // seed não pega uma venda, a causa é oferta fora do catálogo — corrige-se lá,
  // não fabricando card. O cadastro manual (indicação / acordo por fora) fica
  // restrito ao master (admin do GP), que responde pela exceção. Foi o cadastro
  // manual que gerou os cards fantasma (Mauricio/Samantha/Márcia, 27/07).
  const souMaster = ehMaster(sessao);
  if (!souMaster) {
    return NextResponse.json({ ok: false, reason: "cadastro_manual_so_admin" }, { status: 403 });
  }

  const parsed = await parseBody(req, HmCadastroSchema);
  if (!parsed.ok) return parsed.res;
  const b = parsed.data;

  // Quem NÃO é master cadastra para SI: o card nasce com o criador como
  // responsável — senão o operador cadastra e o card some da vista dele (ou
  // pior, cai no pool de todo mundo). Também ignora o `responsavel` do body
  // para não-master: aceitar nome livre aqui reabriria o desvio da hierarquia.
  // Master segue podendo criar no pool (sem responsável) ou com quem indicar.
  const r = await cadastrarManualHm(
    {
      nome: b.nome, email: b.email, telefone: b.telefone, documento: b.documento,
      turma: b.turma, categoria: b.categoria ?? null,
      responsavel: souMaster ? (b.responsavel ?? null) : (sessao.nome || null),
      estagioChave: b.estagio_chave,
      produto: b.produto,
    },
    sessao.nome || "cs",
  );

  if (!r.ok) return NextResponse.json({ ok: false, reason: r.reason }, { status: 400 });

  // Vincula o responsavel_id do criador (a fn grava só o TEXTO; a visibilidade
  // usa o id). Só em card NOVO — se já existia, não rouba o card de ninguém.
  if (!souMaster && r.compradorId && !r.jaExistia) {
    await setResponsavelHmPorId(r.compradorId, sessao.id, sessao.nome || "cs", false);
  }
  return NextResponse.json({
    ok: true,
    compradorId: r.compradorId,
    jaExistia: r.jaExistia,
    criouComprador: r.criouComprador,
    nome: r.nome,
  });
}
