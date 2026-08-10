import { NextResponse } from "next/server";
import { guard } from "@/lib/guard";
import { parseBody, HmTagCriarSchema } from "@/lib/validators";
import { listarTagsHm, criarTagHm } from "@/lib/services/hm-tags";

export const runtime = "nodejs";

// GET /api/hm/tags — o catálogo (nome, cor, tipo, quantos cards usam).
export async function GET(req: Request) {
  const g = await guard({ portal: "HM" });
  if (!g.ok) return g.res;
  // Board do produto (0155/10-08): o catálogo é único, mas cada portal só lista as
  // tags que valem NELE — senão o Aurum mostra "HT ATM", "Origem T35" etc.
  const p = (new URL(req.url).searchParams.get("produto") || "HM").toUpperCase();
  const produto = p === "AURUM" || p === "ETHB" ? (p as "AURUM" | "ETHB") : "HM";
  return NextResponse.json({ ok: true, tags: await listarTagsHm(produto) });
}

// POST /api/hm/tags — cria uma tag livre. Qualquer papel: criar tag é gesto do
// dia a dia (o destrutivo — renomear/excluir — é que exige admin, em [id]).
export async function POST(req: Request) {
  const g = await guard({ portal: "HM" });
  if (!g.ok) return g.res;
  const sessao = g.sessao;
  const p = await parseBody(req, HmTagCriarSchema);
  if (!p.ok) return p.res;
  const r = await criarTagHm(p.data.nome, p.data.cor ?? null, sessao.nome || "cs");
  if (!r.ok) {
    const msg = r.reason === "nome_gerenciado" ? "prefixo reservado (Origem/Turma/Aurum são do sistema)" : "já existe uma tag com esse nome";
    return NextResponse.json({ ok: false, reason: msg }, { status: 400 });
  }
  return NextResponse.json({ ok: true, id: r.id });
}
