import { NextResponse } from "next/server";
import { guard } from "@/lib/guard";
import { listarAlertasAbertos, listarCancelamentosHotmart, resolverAlerta } from "@/lib/services/hm-alertas";

export const runtime = "nodejs";

// GET /api/hm/alertas — o que o sistema detectou e não resolve sozinho, mais os
// cancelamentos que a Hotmart mandou. Só master: é leitura de saúde do sistema
// inteiro (todos os boards), não de um portal.
export async function GET() {
  const g = await guard({ nivel: "master" });
  if (!g.ok) return g.res;
  const [alertas, cancelamentos] = await Promise.all([
    listarAlertasAbertos(),
    listarCancelamentosHotmart(30),
  ]);
  return NextResponse.json({ ok: true, alertas, cancelamentos });
}

// PATCH /api/hm/alertas — baixa manual. O alerta cuja causa o sistema consegue
// verificar se fecha sozinho (catalogar a oferta baixa o oferta_orfa, 0190); este
// caminho é para os que dependem de decisão humana.
export async function PATCH(req: Request) {
  const g = await guard({ nivel: "master" });
  if (!g.ok) return g.res;
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, reason: "json_invalido" }, { status: 400 });
  }
  const id = (body as { id?: unknown } | null)?.id;
  if (typeof id !== "string" || !/^[0-9a-f-]{36}$/i.test(id)) {
    return NextResponse.json({ ok: false, reason: "id_invalido" }, { status: 400 });
  }
  const ok = await resolverAlerta(id);
  return NextResponse.json({ ok, reason: ok ? undefined : "ja_resolvido" }, { status: ok ? 200 : 409 });
}
