import { NextResponse } from "next/server";
import { guard } from "@/lib/guard";
import { nivelDe } from "@/lib/papeis";
import { parsePeriodo } from "@/lib/validators";
import { atividadeHm, type EscopoAtividade } from "@/lib/services/hm-atividade";

export const runtime = "nodejs";

// GET /api/hm/atividade?de=YYYY-MM-DD&ate=YYYY-MM-DD — o que cada colaborador
// fez na esteira HM no período. Datas opcionais; `ate` é exclusivo (o dia
// seguinte ao último que se quer incluir vem tratado no cliente).
// RECORTE por nível: master vê todos os colaboradores; gestor só os membros da
// própria equipe; operador só a si mesmo — produtividade alheia é dado de gestão.
export async function GET(req: Request) {
  const g = await guard({ portal: "HM" });
  if (!g.ok) return g.res;
  const sessao = g.sessao;

  const nivel = nivelDe(sessao);
  const escopo: EscopoAtividade =
    nivel === "master" ? { modo: "tudo" }
    : nivel === "gestor" ? { modo: "equipe", equipeId: sessao.equipe_id }
    : { modo: "operador", nome: sessao.nome || "" };

  // Validação de período compartilhada (lib/validators): sem ela, ?ate=invalido
  // virava 22007 do Postgres e derrubava o painel com 500 — agora é 400
  // data_invalida, a MESMA resposta do /api/atividade genérico.
  const periodo = parsePeriodo(new URL(req.url).searchParams);
  if (!periodo.ok) return periodo.res;

  const r = await atividadeHm({ de: periodo.de, ate: periodo.ate }, escopo);
  return NextResponse.json({ ok: true, ...r });
}
