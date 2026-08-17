import { NextResponse } from "next/server";
import { guard } from "@/lib/guard";
import { parseBody, HmOfertaPatchSchema } from "@/lib/validators";
import { listarCatalogo, atualizarCatalogo } from "@/lib/services/hm-ofertas";

export const runtime = "nodejs";

// GET /api/hm/ofertas — o catálogo (public.hm_product_catalog), MASTER-ONLY
// (0255/B6): é a tabela que decide o que 242 pessoas devem — leitura ampla,
// mas só para quem já gere o sistema. `disparos_app` não tem SELECT direto na
// tabela; a leitura passa pela ponte SECURITY DEFINER cs.fn_hm_catalogo_listar.
export async function GET(req: Request) {
  const g = await guard({ portal: "HM", nivel: "master" });
  if (!g.ok) return g.res;

  const sp = new URL(req.url).searchParams;
  const busca = (sp.get("q") ?? "").trim();
  const ativoParam = sp.get("ativo"); // '' | 'true' | 'false'
  const ativo = ativoParam === "true" ? true : ativoParam === "false" ? false : null;
  const papel = sp.get("papel") || null;
  const origem = sp.get("origem") || null;

  const ofertas = await listarCatalogo({ busca, ativo, papel, origem, limite: 1000 });
  return NextResponse.json({ ok: true, ofertas });
}

// PATCH /api/hm/ofertas — edita SÓ colunas descritivas de uma oferta
// (HmOfertaPatchSchema já exclui a régua financeira do formato aceito — a
// rota não filtra campo perigoso, ela simplesmente não tem como recebê-lo).
export async function PATCH(req: Request) {
  const g = await guard({ portal: "HM", nivel: "master" });
  if (!g.ok) return g.res;
  const sessao = g.sessao;

  const p = await parseBody(req, HmOfertaPatchSchema);
  if (!p.ok) return p.res;

  const r = await atualizarCatalogo(p.data.offer_code, p.data.patch, sessao.nome || sessao.email);
  if (!r.ok) {
    return NextResponse.json({ ok: false, reason: r.motivo ?? "não foi possível atualizar" }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}
