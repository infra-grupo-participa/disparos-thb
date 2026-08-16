import { query } from "@/lib/db";
import { escopoVisibilidade, type Ator, type EscopoVisibilidade } from "@/lib/papeis";
import { GRANULARIDADES, type Granularidade } from "@/lib/validators";

// PAINEL — "como estamos no período", separado do "o que eu faço agora" (kanban/agenda).
//
// Pedido do João, literal (16/08): "A nave está muito confusa (...) misturado com as
// atividades do sistema (...) não consigo analisar no longo prazo. Quero separar o que eu
// faço agora de como estamos no período, e enxergar evolução no tempo."
//
// O painel de dinheiro que hoje vive dentro de `/atividade` (AtividadeDesempenho) sai de lá
// (F3, frontend) e o número que ele mostra passa a vir DAQUI — mas o cálculo em si já mudou
// de fonte na B3 (lib/services/hm-atividade.ts): a carteira reconstruída
// (`cs.vw_hm_carteira.carteira_usuario_id`), nunca `responsavel_comercial_id`. As DUAS telas
// (este painel e `/carteira`) leem a MESMA view pelo MESMO critério — divergência deixa de
// ser possível por construção, que era a queixa central.
//
// Medido em produção por quem tem MCP do Supabase (16/08, antes×depois da B3): 174 pessoas
// divergem entre os dois critérios; 111 têm carteira reconstruída e NENHUM
// `responsavel_comercial_id` (não são "sem dono" — o dono existe, só não estava naquela
// coluna); 28 não têm carteira nenhuma, e essas ficam num bucket PRÓPRIO, nomeado
// ("Sem responsável comercial"), nunca somadas a outra pessoa nem escondidas.
//
// ---------------------------------------------------------------------------------------
// FLUXO × ESTADO — os 5 KPIs não são a mesma espécie de número, e tratá-los igual foi
// justamente o erro que fez `/atividade` virar 3 painéis com 3 eixos e 3 períodos soltos:
//
//   FLUXO (Recebido · Entraram · Quitaram) — soma de eventos DENTRO do período. Sempre
//   reconstruível do razão (`cs.hm_pagamentos`, `cs.vw_hm_carteira.sinal_pago_em/quitado_em`),
//   para QUALQUER janela passada. `valor_anterior` é a mesma soma na janela imediatamente
//   anterior, de mesma duração — nunca comparado contra uma janela de tamanho diferente
//   (disparos-brain/"Métrica de funil: coorte, nunca janela de evento").
//
//   ESTADO (A receber · Precisam de ação) — uma FOTO do agora, não uma soma. O valor "do
//   período" é sempre o AGORA (bate com o topo de `/carteira` no mesmo minuto, é a condição
//   de aceite do bloco). A comparação com o passado, e a série, dependem de
//   `cs.hm_fechamento_diario` (migration 0260) — que só existe a partir de 16/08/2026, porque
//   o pró-rata usa `CURRENT_DATE` (o saldo de 73 pessoas se move ~R$1.110,94/dia: perguntar
//   "quanto faltava em 01/08" devolveria um número que nunca existiu). Dia sem fechamento
//   (feriado sem cron, outage) mostra null, nunca o valor do dia anterior carregado adiante —
//   fingir continuidade seria mentir sobre um buraco de medição.
//
// A série de ESTADO é sempre DIÁRIA, mesmo quando `granularidade` pedida é semana/mês: hoje
// a tabela tem 1 dia de histórico, e reamostrar um snapshot de poucos dias em buckets maiores
// não ganha nada — é complexidade sem retorno (o critério de otimização do Fable). Quando a
// série crescer, o front decide se quer agregar client-side.

export type PeriodoAtalho = "hoje" | "7d" | "30d" | "mes" | "livre";

type Janela = { de: string; ate: string }; // YYYY-MM-DD, ambos INCLUSIVOS

export type SeriePonto = { data: string; valor: number | null };

export type KpiPainel = {
  chave: "recebido" | "a_receber" | "entraram" | "quitaram" | "precisam_de_acao";
  rotulo: string;
  /** fluxo = soma de eventos no período; estado = foto do agora, comparada com o passado. */
  tipo: "fluxo" | "estado";
  valor: number | null;
  /** Mesmo recorte, na janela anterior de MESMA duração. null = sem dado (nunca 0 fingido). */
  valor_anterior: number | null;
  variacao_absoluta: number | null;
  variacao_pct: number | null;
  /** Granularidade real da série: sempre "dia" para KPIs de estado, a pedida para fluxo. */
  serie_granularidade: Granularidade;
  serie: SeriePonto[];
};

export type PainelHm = {
  produto: string | null;
  periodo: Janela;
  periodo_anterior: Janela;
  /** Primeiro dia com snapshot em cs.hm_fechamento_diario, ou null se a tabela ainda está
   *  vazia. O front usa isto para desenhar "sem dado antes de DD/MM" nos KPIs de estado —
   *  nunca inferir isso do primeiro ponto não-nulo da série (pode faltar um dia específico
   *  por outage, o que é diferente de "a série não existe antes disso"). */
  serie_estado_comeca_em: string | null;
  kpis: KpiPainel[];
};

const numero = (v: unknown): number => (v === null || v === undefined ? 0 : Number(v));
const numeroOuNull = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));

// ----- datas de calendário (YYYY-MM-DD), aritmética em UTC para não flutuar com o fuso -----
const hojeIso = (): string => new Date().toISOString().slice(0, 10);
function addDias(iso: string, dias: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + dias);
  return d.toISOString().slice(0, 10);
}
function diasEntreIso(a: string, b: string): number {
  return Math.round((Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / 86_400_000);
}

/** Resolve a janela atual + a anterior (mesma duração, imediatamente antes). Já validado
 *  pela rota (parsePeriodoAtalho, lib/validators.ts) — aqui só a aritmética de calendário. */
export function resolveJanela(f: { periodo: PeriodoAtalho; de: string | null; ate: string | null }): {
  atual: Janela;
  anterior: Janela;
} {
  const hoje = hojeIso();
  let atual: Janela;
  if (f.periodo === "hoje") atual = { de: hoje, ate: hoje };
  else if (f.periodo === "7d") atual = { de: addDias(hoje, -6), ate: hoje };
  else if (f.periodo === "30d") atual = { de: addDias(hoje, -29), ate: hoje };
  else if (f.periodo === "mes") atual = { de: `${hoje.slice(0, 7)}-01`, ate: hoje };
  else atual = { de: f.de ?? addDias(hoje, -29), ate: f.ate ?? hoje }; // "livre" — a rota já garantiu de/ate presentes

  const duracaoDias = diasEntreIso(atual.ate, atual.de) + 1;
  const anterior: Janela = { de: addDias(atual.de, -duracaoDias), ate: addDias(atual.de, -1) };
  return { atual, anterior };
}

function truncCampo(g: Granularidade): "day" | "week" | "month" {
  return g === "dia" ? "day" : g === "semana" ? "week" : "month";
}

function paramsEscopo(escopo: EscopoVisibilidade): { modo: string; usuarioId: string | null; equipeId: string | null } {
  if (escopo.modo === "tudo") return { modo: "tudo", usuarioId: null, equipeId: null };
  if (escopo.modo === "equipe") return { modo: "equipe", usuarioId: escopo.usuarioId, equipeId: escopo.equipeId };
  return { modo: "operador", usuarioId: escopo.usuarioId, equipeId: null };
}

/** Mesmo espírito de sqlRecorteResponsavel (hm-atividade.ts) e sqlRecorteCarteira lá — mas
 *  parametrizado pela COLUNA (nunca vinda de request, sempre um dos 2 literais fixos abaixo:
 *  `v.carteira_usuario_id` na leitura ao vivo, `fd.carteira_usuario_id` no snapshot). */
function sqlRecorteCarteira(coluna: string, pModo: number, pUsuario: number, pEquipe: number): string {
  return `
        and ($${pModo}::text = 'tudo'
             or ($${pModo} = 'equipe' and (
                   ${coluna} = $${pUsuario}::uuid
                   or exists (select 1 from cs.usuarios ur where ur.id = ${coluna} and ur.equipe_id = $${pEquipe}::uuid)
                 ))
             or ($${pModo} = 'operador' and ${coluna} = $${pUsuario}::uuid))`;
}

// ---------------------------------------------------------------------------------------
// FLUXO — Recebido / Entraram / Quitaram. Reconstruível para qualquer janela do passado.

type ColunaFluxo = "sinal_pago_em" | "quitado_em";

async function fluxoContagemNucleo(
  coluna: ColunaFluxo,
  f: { produto: string | null; atual: Janela; anterior: Janela },
  escopo: EscopoVisibilidade,
): Promise<{ atual: number; anterior: number }> {
  const { modo, usuarioId, equipeId } = paramsEscopo(escopo);
  const linha = (await query<Record<string, unknown>>(
    `select
        count(*) filter (where v.${coluna} >= $2::date and v.${coluna} < ($3::date + 1)) as atual,
        count(*) filter (where v.${coluna} >= $4::date and v.${coluna} < ($5::date + 1)) as anterior
       from cs.vw_hm_carteira v
      where v.pagou_entrada_do_programa
        and ($1::text is null or v.produto = $1)
        ${sqlRecorteCarteira("v.carteira_usuario_id", 6, 7, 8)}`,
    [f.produto, f.atual.de, f.atual.ate, f.anterior.de, f.anterior.ate, modo, usuarioId, equipeId],
  ))[0];
  return { atual: numero(linha?.atual), anterior: numero(linha?.anterior) };
}

async function fluxoContagemSerie(
  coluna: ColunaFluxo,
  f: { produto: string | null; atual: Janela; granularidade: Granularidade },
  escopo: EscopoVisibilidade,
): Promise<SeriePonto[]> {
  const { modo, usuarioId, equipeId } = paramsEscopo(escopo);
  const rows = await query<Record<string, unknown>>(
    `select date_trunc('${truncCampo(f.granularidade)}', v.${coluna})::date as bucket,
            count(*)::int as valor
       from cs.vw_hm_carteira v
      where v.pagou_entrada_do_programa
        and v.${coluna} >= $2::date and v.${coluna} < ($3::date + 1)
        and ($1::text is null or v.produto = $1)
        ${sqlRecorteCarteira("v.carteira_usuario_id", 4, 5, 6)}
      group by 1
      order by 1`,
    [f.produto, f.atual.de, f.atual.ate, modo, usuarioId, equipeId],
  );
  return rows.map((r) => ({ data: String(r.bucket), valor: numero(r.valor) }));
}

async function recebidoNucleo(
  f: { produto: string | null; atual: Janela; anterior: Janela },
  escopo: EscopoVisibilidade,
): Promise<{ atual: number; anterior: number }> {
  const { modo, usuarioId, equipeId } = paramsEscopo(escopo);
  const linha = (await query<Record<string, unknown>>(
    `select
        coalesce(sum(p.valor) filter (where p.pago_em >= $2::date and p.pago_em < ($3::date + 1)), 0) as atual,
        coalesce(sum(p.valor) filter (where p.pago_em >= $4::date and p.pago_em < ($5::date + 1)), 0) as anterior
       from cs.hm_pagamentos p
       join cs.vw_hm_carteira v
         on v.comprador_id = p.comprador_id
        and cs.fn_hm_pagamento_do_produto(p.oferta_codigo, v.produto)
      where p.categoria in ('sinal','saldo','compra_cheia','mensalidade')
        and ($1::text is null or v.produto = $1)
        ${sqlRecorteCarteira("v.carteira_usuario_id", 6, 7, 8)}`,
    [f.produto, f.atual.de, f.atual.ate, f.anterior.de, f.anterior.ate, modo, usuarioId, equipeId],
  ))[0];
  return { atual: numero(linha?.atual), anterior: numero(linha?.anterior) };
}

async function recebidoSerie(
  f: { produto: string | null; atual: Janela; granularidade: Granularidade },
  escopo: EscopoVisibilidade,
): Promise<SeriePonto[]> {
  const { modo, usuarioId, equipeId } = paramsEscopo(escopo);
  const rows = await query<Record<string, unknown>>(
    `select date_trunc('${truncCampo(f.granularidade)}', p.pago_em)::date as bucket,
            coalesce(sum(p.valor), 0) as valor
       from cs.hm_pagamentos p
       join cs.vw_hm_carteira v
         on v.comprador_id = p.comprador_id
        and cs.fn_hm_pagamento_do_produto(p.oferta_codigo, v.produto)
      where p.categoria in ('sinal','saldo','compra_cheia','mensalidade')
        and p.pago_em >= $2::date and p.pago_em < ($3::date + 1)
        and ($1::text is null or v.produto = $1)
        ${sqlRecorteCarteira("v.carteira_usuario_id", 4, 5, 6)}
      group by 1
      order by 1`,
    [f.produto, f.atual.de, f.atual.ate, modo, usuarioId, equipeId],
  );
  return rows.map((r) => ({ data: String(r.bucket), valor: numero(r.valor) }));
}

// ---------------------------------------------------------------------------------------
// ESTADO — A receber / Precisam de ação. "Agora" é sempre ao vivo (bate com /carteira no
// mesmo minuto); "anterior" e a série vêm do snapshot append-only (cs.hm_fechamento_diario).
//
// "Precisam de ação" replica em SQL a MESMA régua de cobrancaDe() em hm-carteira.ts
// (urgência 0/1: sem data combinada, data vencida, ou parcelando sem pagar há mais de
// JANELA_PARCELA_DIAS=35 dias) — não importa o cálculo linha a linha porque o painel não
// precisa da lista nominal, só do total; mas a régua tem que ser A MESMA, senão o painel e a
// Carteira voltam a divergir pela porta dos fundos. Mudar um dos dois exige mudar o outro.

async function estadoAoVivoNucleo(
  f: { produto: string | null },
  escopo: EscopoVisibilidade,
): Promise<{ a_receber: number; precisam_de_acao: number }> {
  const { modo, usuarioId, equipeId } = paramsEscopo(escopo);
  const linha = (await query<Record<string, unknown>>(
    `select
        coalesce(sum(v.falta_pagar) filter (where v.status not in ('cancelado','entrada_estornada')), 0) as a_receber,
        count(*) filter (
          where v.status not in ('quitado','cancelado','entrada_estornada')
            and coalesce(v.falta_pagar, 0) > 1
            and (
              f.pagamento_previsto_em is null
              or extract(year from f.pagamento_previsto_em) not between 2025 and 2026
              or f.pagamento_previsto_em::date < current_date
              or (v.restante_situacao = 'parcelando' and v.parcelas_ultima_em is not null
                  and current_date - v.parcelas_ultima_em::date > 35)
            )
        ) as precisam_de_acao
       from cs.vw_hm_carteira v
       left join cs.vw_hm_financeiro f on f.contato_hm_id = v.contato_hm_id
      where v.pagou_entrada_do_programa
        and ($1::text is null or v.produto = $1)
        ${sqlRecorteCarteira("v.carteira_usuario_id", 2, 3, 4)}`,
    [f.produto, modo, usuarioId, equipeId],
  ))[0];
  return { a_receber: numero(linha?.a_receber), precisam_de_acao: numero(linha?.precisam_de_acao) };
}

async function estadoSnapshotNucleo(
  f: { produto: string | null; dia: string },
  escopo: EscopoVisibilidade,
): Promise<{ a_receber: number | null; precisam_de_acao: number | null }> {
  const { modo, usuarioId, equipeId } = paramsEscopo(escopo);
  const linha = (await query<Record<string, unknown>>(
    `select count(*)::int as n_linhas,
            coalesce(sum(fd.a_receber), 0) as a_receber,
            coalesce(sum(fd.parou_de_pagar + fd.sem_data), 0) as precisam_de_acao
       from cs.hm_fechamento_diario fd
      where fd.dia = $2::date
        and ($1::text is null or fd.produto = $1)
        ${sqlRecorteCarteira("fd.carteira_usuario_id", 3, 4, 5)}`,
    [f.produto, f.dia, modo, usuarioId, equipeId],
  ))[0];
  if (!linha || numero(linha.n_linhas) === 0) return { a_receber: null, precisam_de_acao: null };
  return { a_receber: numero(linha.a_receber), precisam_de_acao: numero(linha.precisam_de_acao) };
}

async function estadoSerieNucleo(
  f: { produto: string | null; atual: Janela },
  escopo: EscopoVisibilidade,
): Promise<{ a_receber: SeriePonto[]; precisam_de_acao: SeriePonto[] }> {
  const { modo, usuarioId, equipeId } = paramsEscopo(escopo);
  const rows = await query<Record<string, unknown>>(
    `with dias as (
        select generate_series($2::date, $3::date, interval '1 day')::date as dia
     ), fech as (
        select fd.dia,
               sum(fd.a_receber) as a_receber,
               sum(fd.parou_de_pagar + fd.sem_data) as precisam_de_acao
          from cs.hm_fechamento_diario fd
         where fd.dia between $2::date and $3::date
           and ($1::text is null or fd.produto = $1)
           ${sqlRecorteCarteira("fd.carteira_usuario_id", 4, 5, 6)}
         group by fd.dia
     )
     select d.dia, f.a_receber, f.precisam_de_acao
       from dias d
       left join fech f on f.dia = d.dia
      order by d.dia`,
    [f.produto, f.atual.de, f.atual.ate, modo, usuarioId, equipeId],
  );
  const a_receber: SeriePonto[] = [];
  const precisam_de_acao: SeriePonto[] = [];
  for (const r of rows) {
    const data = String(r.dia);
    a_receber.push({ data, valor: numeroOuNull(r.a_receber) });
    precisam_de_acao.push({ data, valor: numeroOuNull(r.precisam_de_acao) });
  }
  return { a_receber, precisam_de_acao };
}

async function serieEstadoComecaEm(produto: string | null): Promise<string | null> {
  const linha = (await query<Record<string, unknown>>(
    `select min(dia)::text as comeca_em from cs.hm_fechamento_diario where ($1::text is null or produto = $1)`,
    [produto],
  ))[0];
  return (linha?.comeca_em as string | null) ?? null;
}

// ---------------------------------------------------------------------------------------

function variacao(atual: number | null, anterior: number | null): { abs: number | null; pct: number | null } {
  if (atual === null || anterior === null) return { abs: null, pct: null };
  const abs = Math.round((atual - anterior) * 100) / 100;
  const pct = anterior !== 0 ? Math.round((abs / Math.abs(anterior)) * 1000) / 10 : null;
  return { abs, pct };
}

/**
 * Porta única do painel. TODAS as consultas em SÉRIE — nunca Promise.all (o pooler
 * Supavisor em modo transação não tolera paralelizar conexão, mesma regra documentada no
 * topo de hm-atividade.ts).
 */
export async function painelHm(
  f: { periodo: PeriodoAtalho; de: string | null; ate: string | null; granularidade: Granularidade | null; produto: string | null },
  ator: Ator,
): Promise<PainelHm> {
  const escopo = escopoVisibilidade(ator);
  const granularidade: Granularidade = f.granularidade ?? "dia";
  const { atual, anterior } = resolveJanela(f);
  const produto = f.produto;

  const recebido = await recebidoNucleo({ produto, atual, anterior }, escopo);
  const recebidoSer = await recebidoSerie({ produto, atual, granularidade }, escopo);
  const entraram = await fluxoContagemNucleo("sinal_pago_em", { produto, atual, anterior }, escopo);
  const entraramSer = await fluxoContagemSerie("sinal_pago_em", { produto, atual, granularidade }, escopo);
  const quitaram = await fluxoContagemNucleo("quitado_em", { produto, atual, anterior }, escopo);
  const quitaramSer = await fluxoContagemSerie("quitado_em", { produto, atual, granularidade }, escopo);
  const estadoAgora = await estadoAoVivoNucleo({ produto }, escopo);
  const estadoAnterior = await estadoSnapshotNucleo({ produto, dia: anterior.ate }, escopo);
  const estadoSerie = await estadoSerieNucleo({ produto, atual }, escopo);
  const comecaEm = await serieEstadoComecaEm(produto);

  const kpis: KpiPainel[] = [
    (() => {
      const v = variacao(recebido.atual, recebido.anterior);
      return {
        chave: "recebido", rotulo: "Recebido no período", tipo: "fluxo",
        valor: recebido.atual, valor_anterior: recebido.anterior,
        variacao_absoluta: v.abs, variacao_pct: v.pct,
        serie_granularidade: granularidade, serie: recebidoSer,
      } as KpiPainel;
    })(),
    (() => {
      const v = variacao(estadoAgora.a_receber, estadoAnterior.a_receber);
      return {
        chave: "a_receber", rotulo: "A receber", tipo: "estado",
        valor: estadoAgora.a_receber, valor_anterior: estadoAnterior.a_receber,
        variacao_absoluta: v.abs, variacao_pct: v.pct,
        serie_granularidade: "dia", serie: estadoSerie.a_receber,
      } as KpiPainel;
    })(),
    (() => {
      const v = variacao(entraram.atual, entraram.anterior);
      return {
        chave: "entraram", rotulo: "Entraram", tipo: "fluxo",
        valor: entraram.atual, valor_anterior: entraram.anterior,
        variacao_absoluta: v.abs, variacao_pct: v.pct,
        serie_granularidade: granularidade, serie: entraramSer,
      } as KpiPainel;
    })(),
    (() => {
      const v = variacao(quitaram.atual, quitaram.anterior);
      return {
        chave: "quitaram", rotulo: "Quitaram", tipo: "fluxo",
        valor: quitaram.atual, valor_anterior: quitaram.anterior,
        variacao_absoluta: v.abs, variacao_pct: v.pct,
        serie_granularidade: granularidade, serie: quitaramSer,
      } as KpiPainel;
    })(),
    (() => {
      const v = variacao(estadoAgora.precisam_de_acao, estadoAnterior.precisam_de_acao);
      return {
        chave: "precisam_de_acao", rotulo: "Precisam de ação", tipo: "estado",
        valor: estadoAgora.precisam_de_acao, valor_anterior: estadoAnterior.precisam_de_acao,
        variacao_absoluta: v.abs, variacao_pct: v.pct,
        serie_granularidade: "dia", serie: estadoSerie.precisam_de_acao,
      } as KpiPainel;
    })(),
  ];

  return { produto, periodo: atual, periodo_anterior: anterior, serie_estado_comeca_em: comecaEm, kpis };
}

// Reexportado para a rota validar granularidade sem duplicar a whitelist.
export { GRANULARIDADES };

/**
 * Gancho do cron (B5-lite, 16/08): fecha o dia de HOJE em cs.hm_fechamento_diario
 * (migration 0260). `on conflict do nothing` na função cobre o cron rodando várias vezes —
 * chamar isto de novo no mesmo dia é gratuito, nunca reescreve o que já foi fechado.
 * Nunca derruba o cron: quem chama decide o `.catch()` (ver app/api/cron/route.ts).
 */
export async function fecharDiaHm(): Promise<{ linhas: number }> {
  const r = (await query<{ fn_hm_fechar_dia: number }>("select cs.fn_hm_fechar_dia() as fn_hm_fechar_dia"))[0];
  return { linhas: r?.fn_hm_fechar_dia ?? 0 };
}
