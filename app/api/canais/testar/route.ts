import { NextResponse } from "next/server";
import { getSessao } from "@/lib/auth";
import { podeGerirAcesso } from "@/lib/papeis";
import { queryOne } from "@/lib/db";
import { validarCredencial } from "@/lib/unnichat";
import { listarTags } from "@/lib/activecampaign";

export const runtime = "nodejs";

// POST /api/canais/testar — valida uma credencial de canal SEM disparar nada
// (admin). Aceita { id } (testa o canal salvo, lendo a chave no servidor) ou
// { api_key, base_url?, provider? } (testa a chave digitada antes de salvar).
// WhatsApp: busca read-only na Unnichat. E-mail: lista 1 tag no AC.
export async function POST(req: Request) {
  const sessao = await getSessao();
  if (!sessao) return NextResponse.json({ ok: false }, { status: 401 });
  if (!podeGerirAcesso(sessao.papel, sessao.equipe_tipo)) return NextResponse.json({ ok: false, reason: "forbidden" }, { status: 403 });

  const b = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  let apiKey = b.api_key ? String(b.api_key) : null;
  let baseUrl = b.base_url ? String(b.base_url) : null;
  let provider = b.provider ? String(b.provider) : "unnichat";

  if (b.id) {
    const c = await queryOne<{ api_key: string; base_url: string | null; provider: string }>(
      `select api_key, base_url, provider from cs.canais_disparo where id = $1`,
      [String(b.id)],
    );
    if (!c) return NextResponse.json({ ok: false, reason: "canal não encontrado" }, { status: 404 });
    apiKey = c.api_key; baseUrl = c.base_url; provider = c.provider;
  }

  if (!apiKey) return NextResponse.json({ ok: false, reason: "informe a chave de API" }, { status: 400 });
  const cfg = { apiKey, baseUrl };

  try {
    if (provider === "activecampaign") {
      const r = await listarTags({ limit: 1, cfg });
      return NextResponse.json({ ok: r.ok, provider, detalhe: r.ok ? "Credencial válida — conexão com o ActiveCampaign OK." : (r.erro || "Falha ao validar no AC.") });
    }
    const r = await validarCredencial(cfg);
    return NextResponse.json({ ok: r.ok, provider, status: r.status, detalhe: r.ok ? "Credencial válida — conexão com a Unnichat OK." : (r.erro || "Falha ao validar.") });
  } catch (e) {
    return NextResponse.json({ ok: false, provider, detalhe: e instanceof Error ? e.message : "erro ao testar" });
  }
}
