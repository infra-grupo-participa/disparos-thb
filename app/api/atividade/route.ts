import { NextResponse } from "next/server";
import { guard } from "@/lib/guard";
import { nivelDe } from "@/lib/papeis";
import { parsePeriodo } from "@/lib/validators";
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

  // Validação de período compartilhada (lib/validators): 400 data_invalida em
  // vez de 22007/500 do Postgres — a mesma regra do /api/hm/atividade.
  const periodo = parsePeriodo(new URL(req.url).searchParams);
  if (!periodo.ok) return periodo.res;

  const r = await atividadeEvento(evento, { de: periodo.de, ate: periodo.ate }, escopo);
  return NextResponse.json({ ok: true, evento, ...r });
}
