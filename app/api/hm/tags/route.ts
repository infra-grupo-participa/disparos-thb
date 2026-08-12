import { NextResponse } from "next/server";
import { guard } from "@/lib/guard";
import { produtoDaRequisicao } from "@/lib/produto-hm";
import { parseBody, HmTagCriarSchema } from "@/lib/validators";
import { listarTagsHm, criarTagHm } from "@/lib/services/hm-tags";

export const runtime = "nodejs";

// GET /api/hm/tags — o catálogo (nome, cor, tipo, quantos cards usam) + o
// dicionário (0206): categoria, rótulo da categoria, descrição e cor_efetiva
// (override da tag OU cor herdada de cs.tag_categoria).
export async function GET(req: Request) {
  // 0187: o portal validado e o do produto PEDIDO, nao "HM" literal — HM/AURUM/ETHB
  // sao portais distintos em cs.usuario_portais. Vem no topo: nada pode ler g.sessao
  // antes do gate.
  const produto = produtoDaRequisicao(req);
  const g = await guard({ portal: produto });
  if (!g.ok) return g.res;
  // Board do produto (0155/10-08): o catálogo é único, mas cada portal só lista as
  // tags que valem NELE — senão o Aurum mostra "HT ATM", "Origem T35" etc.
  return NextResponse.json({ ok: true, tags: await listarTagsHm(produto) });
}

// POST /api/hm/tags — cria uma tag livre. Qualquer papel: criar tag é gesto do
// dia a dia (o destrutivo — renomear/excluir — é que exige admin, em [id]).
export async function POST(req: Request) {
  // Aqui o "HM" literal está CERTO e não é o furo da 0187: criar tag mexe no
  // catálogo, que é ÚNICO para os três boards — não há `?produto=` a validar. Quem
  // tem o portal HM pode criar tag; o recorte por board acontece só na LISTAGEM (GET).
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
