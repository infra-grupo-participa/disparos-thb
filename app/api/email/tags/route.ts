import { NextResponse } from "next/server";
import { guard } from "@/lib/guard";
import { eventoDe } from "@/lib/services/evento";
import { getCanal } from "@/lib/services/canais";
import { listarTags } from "@/lib/activecampaign";
import { query } from "@/lib/db";
import { montarVeredito, type AutoMatch } from "@/lib/services/ac-automacoes";

export const runtime = "nodejs";

// GET /api/email/tags?busca= — lista as tags do ActiveCampaign para o operador
// escolher ao cadastrar um template de e-mail (pelo NOME, não pelo ID). Cada tag
// vem com o VEREDITO da automação (raio-x): se aquela tag realmente envia, está
// pausada ou não tem automação — para o operador não criar template às cegas.
// Falha graciosa: retorna ok:false (200) se o AC não responder, para a tela cair
// no fallback "digitar o ID manualmente".
export async function GET(req: Request) {
  // Portal do evento RESOLVIDO (cookie/query) contra a whitelist da conta (0145).
  const g = await guard({ portal: eventoDe(req) });
  if (!g.ok) return g.res;
  const busca = new URL(req.url).searchParams.get("busca") || undefined;
  try {
    const canal = await getCanal("HT", "activecampaign");
    const r = await listarTags({ busca, limit: 100, cfg: canal });
    if (!r.ok) return NextResponse.json({ ok: false, reason: r.erro || "não foi possível listar as tags do AC" });

    // Casa cada tag (por nome) com as automações em cache → veredito. Uma só
    // consulta ao banco; se a tabela ainda não existe (migration pendente), cai
    // em mapa vazio e o veredito fica "desconhecido".
    const nomes = r.tags.map((t) => t.nome);
    const linhas = nomes.length
      ? await query<{ trigger_tag: string; nome: string; ativa: boolean; multientry: boolean }>(
          `select trigger_tag, nome, ativa, multientry from cs.ac_automacoes where trigger_tag = any($1::text[])`,
          [nomes],
        ).catch(() => [])
      : [];
    const porTag = new Map<string, AutoMatch[]>();
    for (const l of linhas) {
      const arr = porTag.get(l.trigger_tag) ?? [];
      arr.push({ nome: l.nome, ativa: l.ativa, multientry: l.multientry });
      porTag.set(l.trigger_tag, arr);
    }
    const melhor = (arr: AutoMatch[] | undefined): AutoMatch => arr?.find((a) => a?.ativa) ?? arr?.[0] ?? null;

    const tags = r.tags.map((t) => ({ ...t, veredito: montarVeredito(t.nome, melhor(porTag.get(t.nome))) }));
    return NextResponse.json({ ok: true, tags });
  } catch (e) {
    return NextResponse.json({ ok: false, reason: e instanceof Error ? e.message : "erro ao consultar o AC" });
  }
}
