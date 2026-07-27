import { NextResponse } from "next/server";
import { guard } from "@/lib/guard";
import { escopoVisibilidade, paramsEscopo } from "@/lib/papeis";
import { query, queryOne } from "@/lib/db";
import { sqlEscopo } from "@/lib/services/contato";
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
  // Portal do evento RESOLVIDO (cookie/query) contra a whitelist da conta (0145).
  const g = await guard({ portal: eventoDe(req) });
  if (!g.ok) return g.res;

  const { searchParams } = new URL(req.url);
  const desde = searchParams.get("desde") || null;
  const ate = searchParams.get("ate") || null;
  const edicao = searchParams.get("edicao") || null;
  const alvo = searchParams.get("alvo") || "ativado"; // North Star
  const evento = eventoDe(req);
  // Recorte por equipe (decisão do Marcio, 27/07): dashboards seguem a mesma
  // regra — master vê o portal inteiro; gestor, os números da equipe dele;
  // operador, os dele. O recorte entra na CTE `pessoas`, então funil, KPIs,
  // cobertura e ritmo saem todos da MESMA base recortada.
  const { verTudo, equipeId, usuarioId } = paramsEscopo(escopoVisibilidade(g.sessao));
  const ESCOPO_V = sqlEscopo({ rid: "v.responsavel_id", eq: "v.equipe_id", nome: "v.responsavel" }, { verTudo: 3, usuario: 4, equipe: 5 });

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
         and ${ESCOPO_V}
    )`;
  const fEscopo = [verTudo, usuarioId, equipeId];

  // --- Funil cumulativo por estágio ---------------------------------------
  const funil = await query<FunilEtapa>(
    `${cte}
     select e.chave, e.nome, e.ordem, e.cor,
            (select count(*) from pessoas p where p.ordem >= e.ordem)::int as qtd
       from cs.estagios e
      where e.evento = $1 and e.ativo
      order by e.ordem`,
    [evento, edicao, ...fEscopo],
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
          where ordem >= coalesce((select ordem from cs.estagios where evento = $1 and chave = $6), 1e9)
        )::int as ativados,
        (select round(avg(legado_t_ativacao_h)) from pessoas where legado_t_ativacao_h is not null)::int as tempo_ativacao_h`,
    [evento, edicao, ...fEscopo, alvo],
  );

  // Cobertura: quantos leads receberam ao menos uma ação (qualquer canal).
  const cob = await queryOne<{ tocados: number }>(
    `select count(distinct v.comprador_id)::int as tocados
       from cs.contatos_evento v
      where v.evento = $1 and ($2::text is null or v.edicao = $2)
        and ${ESCOPO_V}
        and exists (
          select 1 from cs.interacoes i
            join cs.contatos c on c.id = i.contato_id
           where c.comprador_id = v.comprador_id and c.evento = $1
        )`,
    [evento, edicao, ...fEscopo],
  );

  // --- Grupo do WhatsApp + pesquisa (indicadores HT30) ---------------------
  // Fontes NATIVAS (valem para turma nova):
  //   · No grupo  = tag 'No grupo' em cs.contatos, aplicada pelo webhook
  //     POST /api/eventos (evento `entrou_grupo`, automação do Make). O
  //     legado_no_grupo cobre só as turmas importadas da planilha (HT21–27) e
  //     entra por coalesce para não zerar o histórico ao filtrar edição antiga.
  //   · Pesquisa  = cs.formularios tipo 'matricula' (qualificação do HT via
  //     Respondi→Make, evento `respondeu_matricula`) ou 'pesquisa' (SEM/CNHF,
  //     0134). legado_pesquisa idem (planilha).
  // Se a automação do Make NÃO estiver apontada para o grupo/formulário da
  // turma nova, estes números ficam em zero — o dado nasce lá, não aqui.
  // LIMITAÇÃO (recompradores): tag e formulário são POR PESSOA, sem edição —
  // um recomprador que entrou no grupo do HT27 ainda carrega a tag e conta
  // aqui mesmo filtrando HT30 (mesma semântica do /api/comportamento, para as
  // duas telas não divergirem). O SLA de ativação abaixo NÃO tem esse problema
  // (descarta marco anterior à compra da edição).
  const grp = await queryOne<{ no_grupo: number; pesquisas: number }>(
    `select
        count(*) filter (where coalesce(ct.tags, '{}'::text[]) && array['No grupo']
                            or coalesce(v.legado_no_grupo, false))::int as no_grupo,
        count(*) filter (where coalesce(v.legado_pesquisa, false) or exists (
          select 1 from cs.formularios f
           where f.comprador_id = v.comprador_id and f.tipo in ('matricula','pesquisa')))::int as pesquisas
       from cs.contatos_evento v
       left join cs.contatos ct on ct.comprador_id = v.comprador_id and ct.evento = v.evento
      where v.evento = $1 and ($2::text is null or v.edicao = $2)
        and ${ESCOPO_V}`,
    [evento, edicao, ...fEscopo],
  );

  // --- SLAs (nativos, em horas) --------------------------------------------
  // Definição dos marcos (decisão desta rota — o número só significa algo com
  // isto escrito):
  //   · SLA de PRIMEIRO CONTATO: começa em v.ultima_compra_ht (data de
  //     aprovação da compra = momento em que o lead "bate no CRM": o webhook
  //     da Hotmart cria comprador/compra na hora) e termina em
  //     ct.primeiro_contato_em (primeiro toque da equipe: disparo WhatsApp/
  //     e-mail ou resposta no inbox — preenchido nativamente pelos serviços).
  //   · SLA de ATIVAÇÃO: começa na MESMA compra e termina na ENTRADA NO GRUPO
  //     do WhatsApp — o marco é a interação de sistema "Entrou no grupo do
  //     WhatsApp…" que POST /api/eventos grava na timeline (min por contato).
  //     Acoplamento deliberado com o texto da descrição daquela rota.
  // Recompradores: o card de cs.contatos é um só por pessoa — contato/entrada
  // ANTERIORES à compra desta edição são descartados (marco < compra), senão o
  // histórico de HT27 apareceria como SLA negativo no HT30.
  // Não mistura legado_t_*: o histórico da planilha já sai em tempo_ativacao_h.
  const sla = await queryOne<{
    pc_media_h: number | null; pc_mediana_h: number | null; pc_n: number;
    at_media_h: number | null; at_mediana_h: number | null; at_n: number;
  }>(
    `with grupo as (
        select c.comprador_id, min(i.criado_em) as entrou_em
          from cs.interacoes i
          join cs.contatos c on c.id = i.contato_id and c.evento = $1
         where i.tipo = 'sistema' and i.descricao like 'Entrou no grupo do WhatsApp%'
         group by c.comprador_id
     ),
     base as (
        select
          case when v.primeiro_contato_em >= v.ultima_compra_ht
               then extract(epoch from (v.primeiro_contato_em - v.ultima_compra_ht)) / 3600.0 end as pc_h,
          case when g.entrou_em >= v.ultima_compra_ht
               then extract(epoch from (g.entrou_em - v.ultima_compra_ht)) / 3600.0 end as at_h
          from cs.contatos_evento v
          left join grupo g on g.comprador_id = v.comprador_id
         where v.evento = $1 and v.ultima_compra_ht is not null
           and ($2::text is null or v.edicao = $2)
           and ${ESCOPO_V}
     )
     select
        round(avg(pc_h)::numeric, 1)::float8 as pc_media_h,
        round((percentile_cont(0.5) within group (order by pc_h))::numeric, 1)::float8 as pc_mediana_h,
        count(pc_h)::int as pc_n,
        round(avg(at_h)::numeric, 1)::float8 as at_media_h,
        round((percentile_cont(0.5) within group (order by at_h))::numeric, 1)::float8 as at_mediana_h,
        count(at_h)::int as at_n
       from base`,
    [evento, edicao, ...fEscopo],
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
        and ${ESCOPO_V}
        and ($6::timestamptz is null or i.criado_em >= $6)
        and ($7::timestamptz is null or i.criado_em <= $7)
      group by 1, 2
      order by 1`,
    [evento, edicao, ...fEscopo, desde, ate],
  );

  const leads = base?.leads ?? 0;
  const ativados = base?.ativados ?? 0;
  const engajados = base?.engajados ?? 0;
  const tocados = cob?.tocados ?? 0;
  const noGrupo = grp?.no_grupo ?? 0;
  const pesquisas = grp?.pesquisas ?? 0;
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
      // HT30 (fontes nativas — ver comentários das queries acima):
      no_grupo: noGrupo,
      taxa_no_grupo: pct(noGrupo),
      respostas_pesquisa: pesquisas,
      taxa_pesquisa: pct(pesquisas),
    },
    // SLAs em horas (média/mediana/n = pessoas com o marco medido). null =
    // nenhum caso medido ainda — o front deve mostrar "—", nunca 0.
    sla: {
      primeiro_contato: {
        media_h: sla?.pc_media_h ?? null,
        mediana_h: sla?.pc_mediana_h ?? null,
        n: sla?.pc_n ?? 0,
      },
      ativacao: {
        media_h: sla?.at_media_h ?? null,
        mediana_h: sla?.at_mediana_h ?? null,
        n: sla?.at_n ?? 0,
      },
    },
    funil,
    ritmo,
    alertas,
  });
}
