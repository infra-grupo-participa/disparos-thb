import { NextResponse } from "next/server";
import { isAuthed } from "@/lib/auth";
import { query, queryOne } from "@/lib/db";
import { eventoDe } from "@/lib/services/evento";

export const runtime = "nodejs";

// GET /api/dashboard/executivo — a "Visão Executiva": funil de ativação +
// KPIs de topo + ritmo (ações/dia por canal) + alertas derivados. Tudo do
// evento ativo (portal), filtrável por edição; o ritmo respeita o período.
// Só dados reais (cs.contatos_evento, cs.estagios, cs.interacoes) — nada de seed.
//
// O funil é CUMULATIVO: cada etapa conta quem está nela OU adiante (estágios
// ordenados por `ordem`), dando a curva clássica monotônica decrescente que
// revela onde o lead trava. North Star = estágio `alvo` (default 'ativado').
type FunilEtapa = { chave: string; nome: string; ordem: number; cor: string | null; qtd: number };
type RitmoDia = { dia: string; canal: string; qtd: number };

export async function GET(req: Request) {
  if (!isAuthed()) return NextResponse.json({ ok: false }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const desde = searchParams.get("desde") || null;
  const ate = searchParams.get("ate") || null;
  const edicao = searchParams.get("edicao") || null;
  const alvo = searchParams.get("alvo") || "ativado"; // North Star
  const evento = eventoDe(req);

  // --- Funil cumulativo por estágio ---------------------------------------
  const funil = await query<FunilEtapa>(
    `with leads as (
       select v.comprador_id, e.ordem
         from cs.contatos_evento v
         join cs.estagios e on e.id = v.estagio_id and e.evento = $1
        where v.evento = $1 and ($2::text is null or v.edicao_ht = $2)
     )
     select e.chave, e.nome, e.ordem, e.cor,
            (select count(*) from leads l where l.ordem >= e.ordem)::int as qtd
       from cs.estagios e
      where e.evento = $1 and e.ativo
      order by e.ordem`,
    [evento, edicao],
  );

  // --- KPIs de topo --------------------------------------------------------
  // leads / engajaram (responderam em algum canal) / ativados (>= estágio alvo)
  // / tempo até ativar (horas, do histórico legado quando houver).
  const base = await queryOne<{
    leads: number; engajados: number; ativados: number; tempo_ativacao_h: number | null;
  }>(
    `select
        count(*)::int as leads,
        count(*) filter (where v.ultima_resposta_em is not null)::int as engajados,
        count(*) filter (
          where e.ordem >= coalesce(
            (select ordem from cs.estagios where evento = $1 and chave = $3), 1e9
          )
        )::int as ativados,
        round(avg(v.legado_t_ativacao_h) filter (where v.legado_t_ativacao_h is not null))::int as tempo_ativacao_h
       from cs.contatos_evento v
       join cs.estagios e on e.id = v.estagio_id and e.evento = $1
      where v.evento = $1 and ($2::text is null or v.edicao_ht = $2)`,
    [evento, edicao, alvo],
  );

  // Cobertura: quantos leads receberam ao menos uma ação (qualquer canal).
  const cob = await queryOne<{ tocados: number }>(
    `select count(distinct c.comprador_id)::int as tocados
       from cs.interacoes i
       join cs.contatos c on c.id = i.contato_id and c.evento = $1
      where ($2::text is null or c.edicao_ht = $2)`,
    [evento, edicao],
  );

  // --- Ritmo: ações por dia por canal (respeita o período) ----------------
  const ritmo = await query<RitmoDia>(
    `select to_char(i.criado_em, 'YYYY-MM-DD') as dia,
            coalesce(i.canal, 'outro') as canal,
            count(*)::int as qtd
       from cs.interacoes i
       join cs.contatos c on c.id = i.contato_id and c.evento = $1
      where ($2::text is null or c.edicao_ht = $2)
        and ($3::timestamptz is null or i.criado_em >= $3)
        and ($4::timestamptz is null or i.criado_em <= $4)
      group by 1, 2
      order by 1`,
    [evento, edicao, desde, ate],
  );

  const leads = base?.leads ?? 0;
  const ativados = base?.ativados ?? 0;
  const engajados = base?.engajados ?? 0;
  const tocados = cob?.tocados ?? 0;
  const pct = (n: number) => (leads > 0 ? Math.round((n / leads) * 100) : 0);

  // --- Alertas derivados (acionáveis) -------------------------------------
  const alertas: { tom: "alerta" | "sugestao"; titulo: string; descricao: string }[] = [];

  // 1) Maior queda entre etapas consecutivas do funil (o gargalo).
  let pior: { de: string; para: string; perda: number; restante: number } | null = null;
  for (let i = 0; i < funil.length - 1; i++) {
    const a = funil[i], b = funil[i + 1];
    if (a.qtd <= 0) continue;
    const perda = Math.round(((a.qtd - b.qtd) / a.qtd) * 100);
    if (!pior || perda > pior.perda) pior = { de: a.nome, para: b.nome, perda, restante: b.qtd };
  }
  if (pior && pior.perda >= 40) {
    alertas.push({
      tom: "alerta",
      titulo: `Maior gargalo: ${pior.de} → ${pior.para} (−${pior.perda}%)`,
      descricao: `Só ${pior.restante} seguiram para ${pior.para}. É aqui que mais se perde — concentre esforço nesta passagem.`,
    });
  }

  // 2) Leads que nunca receberam nenhuma ação (dinheiro na mesa).
  const semAcao = Math.max(0, leads - tocados);
  if (semAcao > 0) {
    alertas.push({
      tom: "sugestao",
      titulo: `${semAcao} ${semAcao === 1 ? "lead sem nenhum contato" : "leads sem nenhum contato"}`,
      descricao: `${pct(tocados)}% da base foi tocada. Os ${semAcao} restantes ainda não receberam WhatsApp, e-mail nem ligação.`,
    });
  }

  return NextResponse.json({
    ok: true,
    alvo,
    kpis: {
      leads,
      ativados,
      taxa_ativacao: pct(ativados),
      engajados,
      taxa_engajamento: pct(engajados),
      tocados,
      cobertura: pct(tocados),
      tempo_ativacao_h: base?.tempo_ativacao_h ?? null,
    },
    funil,
    ritmo,
    alertas,
  });
}
