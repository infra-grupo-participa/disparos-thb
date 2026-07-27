import { NextResponse } from "next/server";
import { podeDisparar } from "@/lib/auth";
import { guard } from "@/lib/guard";
import { eventoDe } from "@/lib/services/evento";
import { getCanal } from "@/lib/services/canais";
import { listTags, createTag, type UnniTag } from "@/lib/unnichat";

export const runtime = "nodejs";

// GET /api/unnichat/tags — lista as tags de contato do Unnichat (do canal do
// evento), para o seletor na tela de Templates. Pagina até esgotar (com teto).
export async function GET(req: Request) {
  const evento = eventoDe(req);
  // Portal do evento resolvido contra a whitelist da conta (0145).
  const g = await guard({ portal: evento });
  if (!g.ok) return g.res;
  const sessao = g.sessao;
  const canal = await getCanal(evento);
  const tags: UnniTag[] = [];
  for (let page = 1; page <= 12; page++) {
    const r = await listTags(canal, page, 100);
    if (!r.ok) { if (page === 1) return NextResponse.json({ ok: false, reason: "falha_unnichat", tags: [] }); break; }
    tags.push(...r.tags);
    if (!r.hasNext) break;
  }
  tags.sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
  return NextResponse.json({ ok: true, tags });
}

// POST /api/unnichat/tags { name } — cria uma tag de contato no Unnichat.
export async function POST(req: Request) {
  const evento = eventoDe(req);
  // Portal do evento resolvido contra a whitelist da conta (0145).
  const g = await guard({ portal: evento });
  if (!g.ok) return g.res;
  const sessao = g.sessao;
  if (!podeDisparar(sessao.papel, evento)) {
    return NextResponse.json({ ok: false, reason: "sem_permissao_disparo" }, { status: 403 });
  }
  const b = (await req.json().catch(() => ({}))) as { name?: string };
  const name = String(b.name ?? "").trim();
  if (!name) return NextResponse.json({ ok: false, reason: "nome_obrigatorio", motivo: "Dê um nome à tag." }, { status: 400 });

  const canal = await getCanal(evento);
  const r = await createTag(name, canal);
  if (!r.ok) return NextResponse.json({ ok: false, reason: "falha_unnichat", motivo: r.erro || "Não foi possível criar a tag." }, { status: 400 });
  return NextResponse.json({ ok: true, tag: { id: r.id, name } });
}
