import { NextResponse } from "next/server";
import { guard } from "@/lib/guard";
import { parseBody, HmOfertaImportarSchema } from "@/lib/validators";
import { importarPlanilha } from "@/lib/services/hm-ofertas";

export const runtime = "nodejs";

// POST /api/hm/ofertas/importar — a planilha entra em QUARENTENA
// (cs.oferta_planilha_staging), NUNCA direto no catálogo (0256/0257). O
// PARSE do arquivo (xlsx/csv) acontece no cliente ({base}/ofertas, F6) — esta
// rota recebe linhas já em JSON, já com um limite (HmOfertaImportarSchema:
// máx. 2000 linhas) que fecha a porta de um CSV de 50MB virar payload.
export async function POST(req: Request) {
  const g = await guard({ portal: "HM", nivel: "master" });
  if (!g.ok) return g.res;
  const sessao = g.sessao;

  const p = await parseBody(req, HmOfertaImportarSchema);
  if (!p.ok) return p.res;

  const r = await importarPlanilha(p.data.arquivo, p.data.linhas, sessao.nome || sessao.email);
  return NextResponse.json({ ok: true, ...r });
}
