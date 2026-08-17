import { NextResponse } from "next/server";
import { guard } from "@/lib/guard";
import { parseBody, HmOfertaPromoverSchema } from "@/lib/validators";
import { promoverLote } from "@/lib/services/hm-ofertas";
import { logger } from "@/lib/log";

export const runtime = "nodejs";
const log = logger("hm-ofertas-promover");

// POST /api/hm/ofertas/promover — promove 1 ou várias linhas de staging para
// o catálogo (0257), uma por uma, linha a linha; nunca em bloco cego. Cada
// staging_id recusado (quarentena, sem código, já promovido) volta com o
// motivo — a tela mostra o que passou e o que não passou, não um "sucesso"
// genérico para a lista inteira.
export async function POST(req: Request) {
  const g = await guard({ portal: "HM", nivel: "master" });
  if (!g.ok) return g.res;
  const sessao = g.sessao;

  const p = await parseBody(req, HmOfertaPromoverSchema);
  if (!p.ok) return p.res;

  // Achado BAIXO do security-pentester (16/08): `cs.fn_oferta_planilha_promover_lote` é UM
  // statement só — uma linha do lote violando um CHECK do catálogo (ex.: link fora de
  // https://, mesmo que `classificarQuarentena` na importação já reduza a chance) derrubava a
  // rota inteira num 500 sem forma, arrastando junto as demais ofertas boas do mesmo lote.
  try {
    const resultados = await promoverLote(p.data.staging_ids, sessao.nome || sessao.email);
    return NextResponse.json({ ok: true, resultados });
  } catch (e) {
    log.error("falha ao promover lote de ofertas", e, { staging_ids: p.data.staging_ids });
    const codigoPg = (e as { code?: string } | null)?.code;
    if (codigoPg === "23514") {
      // check_violation — uma ou mais ofertas do lote violam uma regra do catálogo (ex.:
      // hm_product_catalog_link_https). Nenhuma foi promovida (o statement inteiro reverte).
      return NextResponse.json(
        { ok: false, reason: "lote_invalido", detalhe: "uma ou mais ofertas deste lote violam uma regra do catálogo (ex.: link fora do formato https://) — nenhuma foi promovida; corrija a linha e tente de novo" },
        { status: 422 },
      );
    }
    return NextResponse.json({ ok: false, reason: "erro_ao_promover" }, { status: 500 });
  }
}
