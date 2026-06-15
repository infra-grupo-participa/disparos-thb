import { NextResponse } from "next/server";
import { isAuthed } from "@/lib/auth";
import { getCanal } from "@/lib/services/canais";
import { listarTags } from "@/lib/activecampaign";

export const runtime = "nodejs";

// GET /api/email/tags?busca= — lista as tags do ActiveCampaign para o operador
// escolher ao cadastrar um template de e-mail (pelo NOME, não pelo ID). Falha
// graciosa: retorna ok:false (200) se o AC não responder, para a tela cair no
// fallback "digitar o ID manualmente".
export async function GET(req: Request) {
  if (!isAuthed()) return NextResponse.json({ ok: false }, { status: 401 });
  const busca = new URL(req.url).searchParams.get("busca") || undefined;
  try {
    const canal = await getCanal("HT", "activecampaign");
    const r = await listarTags({ busca, limit: 100, cfg: canal });
    if (!r.ok) return NextResponse.json({ ok: false, reason: r.erro || "não foi possível listar as tags do AC" });
    return NextResponse.json({ ok: true, tags: r.tags });
  } catch (e) {
    return NextResponse.json({ ok: false, reason: e instanceof Error ? e.message : "erro ao consultar o AC" });
  }
}
