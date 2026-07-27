import { NextResponse } from "next/server";
import { guard } from "@/lib/guard";
import { nivelDe } from "@/lib/papeis";
import { eventoDe } from "@/lib/services/evento";
import { atividadeEvento, type EscopoAtividade } from "@/lib/services/hm-atividade";

export const runtime = "nodejs";

// GET /api/atividade?de=YYYY-MM-DD&ate=YYYY-MM-DD[&evento=HT] — o que cada
// colaborador fez no portal (HT/SEM/CNHF) no período: o equivalente genérico de
// /api/hm/atividade, para o gestor ver as ações de cada operador. Datas
// opcionais; `ate` é exclusivo (o cliente manda o dia seguinte ao último que
// quer incluir).
// RECORTE por nível (mesma regra do HM): master vê todos os colaboradores;
// gestor só os membros da própria equipe; operador só a si mesmo —
// produtividade alheia é dado de gestão.
const DATA_RE = /^\d{4}-\d{2}-\d{2}(T[0-9:.+-]+Z?)?$/;

export async function GET(req: Request) {
  // Portal do evento RESOLVIDO (cookie/query) contra a whitelist da conta (0145).
  const evento = eventoDe(req);
  const g = await guard({ portal: evento });
  if (!g.ok) return g.res;

  const nivel = nivelDe(g.sessao);
  const escopo: EscopoAtividade =
    nivel === "master" ? { modo: "tudo" }
    : nivel === "gestor" ? { modo: "equipe", equipeId: g.sessao.equipe_id }
    : { modo: "operador", nome: g.sessao.nome || "" };

  const sp = new URL(req.url).searchParams;
  const de = sp.get("de");
  const ate = sp.get("ate");
  // Valida o formato antes de parametrizar: data inválida viraria erro 22007
  // do Postgres (500) — aqui é 400, que é o que a entrada malformada merece.
  if ((de && !DATA_RE.test(de)) || (ate && !DATA_RE.test(ate))) {
    return NextResponse.json({ ok: false, reason: "data_invalida" }, { status: 400 });
  }

  const r = await atividadeEvento(evento, { de, ate }, escopo);
  return NextResponse.json({ ok: true, evento, ...r });
}
