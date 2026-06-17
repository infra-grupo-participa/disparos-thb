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
// IMPORTANTE — denominador = TODAS as vendas da edição:
// "lead no evento" = toda pessoa que comprou ingresso (cs.contatos_evento já é
// a base de compras HT). Quem comprou mas ainda não foi trabalhado no CS NÃO
// tem estágio (estagio_id nulo) → tratamos como o estágio INICIAL ("Comprou
// Ingresso"). Assim o topo do funil = total de vendas e a % de ativação mede a
// eficácia da equipe sobre a base inteira, não só sobre quem já está na esteira.
// Filtro de edição usa `v.edicao` (derivada da compra, existe p/ todos), não
// `edicao_ht` (overlay manual, nulo na maioria).
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

  // CTE compartilhada: uma linha por pessoa da edição, com a ORDEM do estágio
  // (nulo → estágio inicial). Repetida nas queries de funil e KPIs.
  const cte = `
    with est_inicial as (
      select coalesce(min(ordem), 0) as ordem_min
        from cs.estagios where evento = $1 and ativo
    ),
    pessoas as (
      select v.comprador_id, v.ultima_resposta_em, v.legado_t_ativacao_h,
             coalesce(e.ordem, (select ordem_min from est_inicial)) as ordem
        from cs.contatos_evento v
        left join cs.estagios e on e.id = v.estagio_id and e.evento = $1
       where v.evento = $1 and ($2::text is null or v.edicao = $2)
    )`;

  // --- Funil cumulativo por estágio ---------------------------------------
  const funil = await query<FunilEtapa>(
    `${cte}
     select e.chave, e.nome, e.ordem, e.cor,
            (select count(*) from pessoas p where p.ordem >= e.ordem)::int as qtd
       from cs.estagios e
      where e.evento = $1 and e.ativo
      order by e.ordem`,
    [evento, edicao],
  );

  // --- KPIs de topo --------------------------------------------------------
  // leads = total de vendas da edição / engajaram (responderam) / ativados
  // (>= estágio alvo) / tempo até ativar (horas, do histórico legado).
  const base = await queryOne<{
    leads: number; engajados: number; ativados: number; tempo_ativacao_h: number | null;
  }>(
    `${cte}
     select
        (select count(*) from pessoas)::int as leads,
        (select count(*) from pessoas where ultima_resposta_em is not null)::int as engajados,
        (select count(*) from pessoas
          where ordem >= coalesce((select ordem from cs.estagios where evento = $1 and chave = $3), 1e9)
        )::int as ativados,
        (select round(avg(legado_t_ativacao_h)) from pessoas where legado_t_ativacao_h is not null)::int as tempo_ativacao_h`,
    [evento, edicao, alvo],
  );

  // Cobertura: quantos leads receberam ao menos uma ação (qualquer canal).
  const cob = await queryOne<{ tocados: number }>(
    `select count(distinct v.comprador_id)::int as tocados
       from cs.contatos_evento v
      where v.evento = $1 and ($2::text is null or v.edicao = $2)
        and exists (
          select 1 from cs.interacoes i
            join cs.contatos c on c.id = i.contato_id
           where c.comprador_id = v.comprador_id and c.evento = $1
        )`,
    [evento, edicao],
  );

  // --- Ritmo: ações por dia por canal (respeita o período) ----------------
  const ritmo = await query<RitmoDia>(
    `select to_char(i.criado_em, 'YYYY-MM-DD') as dia,
            coalesce(i.canal, 'outro') as canal,
            count(*)::int as qtd
       from cs.interacoes i
       join cs.contatos c on c.id = i.contato_id and c.evento = $1
       join cs.contatos_evento v on v.comprador_id = c.comprador_id and v.evento = $1
      where ($2::text is null or v.edicao = $2)
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
