import { NextResponse } from "next/server";
import { guard } from "@/lib/guard";
import { nivelDe } from "@/lib/papeis";
import { parsePeriodo } from "@/lib/validators";
import { atividadeHm, type EscopoAtividade } from "@/lib/services/hm-atividade";

export const runtime = "nodejs";

// GET /api/hm/atividade?de=YYYY-MM-DD&ate=YYYY-MM-DD — o que cada colaborador
// fez na esteira HM no período. Datas opcionais; `ate` é exclusivo (o dia
// seguinte ao último que se quer incluir vem tratado no cliente).
// RECORTE de LEITURA (28/07, leitura ≠ ação): master vê todos os colaboradores;
// quem tem equipe — gestor OU operador — vê os colegas da própria equipe (a
// tela de Atividade mostra o trabalho do time, decisão do Marcio); quem NÃO tem
// equipe vê só a própria linha (equipe nula jamais casa com "todo mundo").
export async function GET(req: Request) {
  const g = await guard({ portal: "HM" });
  if (!g.ok) return g.res;
  const sessao = g.sessao;

  const escopo: EscopoAtividade =
    nivelDe(sessao) === "master" ? { modo: "tudo" }
    : sessao.equipe_id ? { modo: "equipe", equipeId: sessao.equipe_id }
    : { modo: "operador", nome: sessao.nome || "" };

  // Validação de período compartilhada (lib/validators): sem ela, ?ate=invalido
  // virava 22007 do Postgres e derrubava o painel com 500 — agora é 400
  // data_invalida, a MESMA resposta do /api/atividade genérico.
  const periodo = parsePeriodo(new URL(req.url).searchParams);
  if (!periodo.ok) return periodo.res;

  // Board do produto (0164): sem isso a Atividade do Aurum somava o movimento do HM.
  const pAtv = (new URL(req.url).searchParams.get("produto") || "").toUpperCase();
  const r = await atividadeHm(
    { de: periodo.de, ate: periodo.ate, produto: pAtv === "AURUM" || pAtv === "ETHB" || pAtv === "HM" ? pAtv : null },
    escopo,
  );
  return NextResponse.json({ ok: true, ...r });
}
