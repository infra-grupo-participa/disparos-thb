import { query } from "@/lib/db";
import { GRANULARIDADES, type Granularidade } from "@/lib/validators";
import { escopoVisibilidade, type Ator, type EscopoVisibilidade } from "@/lib/papeis";

// Registro de atividade por colaborador (A1). A captura já existe — cada linha
// de cs.interacoes é assinada por quem a fez (`autor`). Aqui está a LEITURA:
// quem fez o quê, em quanto card, no período. É a mesma trilha que a ficha
// mostra, agregada por pessoa em vez de por card.
//
// `autor` guarda tanto gente quanto atores do sistema (o webhook, o Make, o
// gatilho). O relatório é de GENTE: os atores automáticos ficam de fora por uma
// lista de exclusão — assim um colaborador novo aparece sozinho, sem precisar
// ser cadastrado em lugar nenhum.
// `respondi` (12/08): a automação do formulário HM (app/api/hm/formularios/route.ts
// e db/migrations/0029_fn_respondi_hm_form.sql) grava a interação assinada com
// esse autor — sem entrar aqui, aparecia na tabela como se fosse um operador
// humano de carne e osso. ⚠️ lib/services/hm-notificacoes.ts tem o MESMO array
// invertido (ATORES_AUTOMATICOS, "quem eu SEI que é robô") com o mesmo buraco —
// arquivo de outro agente em paralelo, não mexido aqui; reportado à parte.
const ATORES_SISTEMA = ["sistema", "make", "hotmart", "lead", "cs", "respondi"];

// Breakdown por estágio DESTINO (D3-a) — "o que este colaborador fez com cada
// aluno", sem quebrar por período (agregado do período inteiro consultado).
// Pendurado em AtividadeColaborador.porColuna (ver porEstagioNucleo, abaixo).
export type AtividadeColunaResumo = {
  estagio_id: number;
  estagio_nome: string | null;
  estagio_chave: string | null;
  /** Comercial/Ativação (cs.estagios.aba) — null nos 23 estágios legados sem aba definida. */
  estagio_aba: string | null;
  total: number;
};

export type AtividadeColaborador = {
  colaborador: string;
  total: number;
  movimentacoes: number;   // mudou card de etapa
  notas: number;           // escreveu nota na timeline
  disparos: number;        // disparou mensagem
  outras: number;          // responsável, tag, pagamento, cadastro… (tipo 'sistema' assinado)
  cards: number;           // cards distintos que tocou
  ultima: string | null;   // última atividade no período
  /**
   * Mensagens que ELE disparou e NÃO saíram (D-falha, pedido do Marcio 12/08:
   * "o que está acontecendo em cada parada, ações E falhas"). Nunca contado
   * dentro de `disparos` — um envio que falha não gera cs.interacoes (só o
   * sucesso grava a timeline, ver disparo.ts), então sem isto a falha
   * simplesmente desaparecia, e "disparos" media só o que deu certo. Ver
   * falhasDisparoNucleo. Ausente/0 = não buscado ou nenhuma falha.
   */
  falhas?: number;
  /**
   * Compromissos que ELE marcou no período — "o que a gente promete e o que a
   * gente propõe a fazer" (pedido literal do Marcio 12/08). Só na esteira HM
   * (cs.hm_agendamentos). Ver agendamentosNucleo.
   */
  agendamentos?: AtividadeAgendamentosResumo;
  /** Para o que quantos cards moveu — só na esteira HM (lib/services/hm-atividade.ts atividadeHm). */
  porColuna?: AtividadeColunaResumo[];
  /**
   * Quanto agiu em cards hoje no Comercial vs. na Ativação (aba de cs.estagios)
   * — só na esteira HM. Sempre 2-3 entradas (comercial/ativacao/null), nunca
   * fatiado por período. Ver porAbaNucleo para o critério (estágio ATUAL do
   * card, não o estágio no momento da ação).
   */
  porAba?: AtividadeAbaResumo[];
  /**
   * "O que este colaborador fez com CADA ALUNO no período" — TOP 8 cards por
   * nº de ações (ver TOP_ALUNOS_POR_COLABORADOR/porAlunoNucleo), só na esteira
   * HM. `porAlunoTotal` é quantos alunos DISTINTOS ele tocou no total (para o
   * "e mais X" quando excede o corte) — sempre presente junto de `porAluno`.
   */
  porAluno?: AtividadeAlunoResumo[];
  porAlunoTotal?: number;
};

// Série por período (D1). `date_trunc` no bucket pedido — o mesmo agregado de
// AtividadeColaborador, mas por FATIA DE TEMPO em vez de por pessoa (ou pelas
// duas juntas, se o chamador quiser). `periodo` sai em ISO (date_trunc devolve
// timestamptz) — o cliente decide o rótulo (dia/semana/mês em pt-BR).
export type AtividadePeriodo = {
  periodo: string;
  colaborador: string;
  total: number;
  movimentacoes: number;
  notas: number;
  disparos: number;
  outras: number;
  cards: number;
};

// `Granularidade`/`GRANULARIDADES` vêm de lib/validators (fonte única — ver o
// comentário lá; era triplicada aqui, em validators e no componente do front).
export type { Granularidade };
function granularidadeValida(g?: string | null): Granularidade {
  return GRANULARIDADES.includes(g as Granularidade) ? (g as Granularidade) : "dia";
}
// `date_trunc` do Postgres não fala português: os units são 'day'/'week'/'month'
// ('semana' literal dá erro 22023, "unit not recognized"). O parâmetro da API
// e do front fica em pt-BR (o resto do domínio é todo em português); só aqui,
// na borda do SQL, vira o nome que o banco entende. Nunca interpolar o valor
// pt-BR direto num date_trunc.
const UNIT_SQL: Record<Granularidade, string> = { dia: "day", semana: "week", mes: "month" };

export type Atividade = {
  de: string | null;
  ate: string | null;
  colaboradores: AtividadeColaborador[];
  /** Série por período (D1) — presente quando `granularidade` foi pedida. */
  serie?: AtividadePeriodo[];
};

// Recorte de LEITURA (quem pode ver a atividade de quem — 28/07: leitura por
// equipe vale para gestor E operador; ver o trabalho do time não é agir nele):
//   tudo     → master: todos os colaboradores.
//   equipe   → quem TEM equipe (gestor ou operador): os membros da PRÓPRIA
//              equipe. A trilha é assinada por NOME (i.autor é texto), então o
//              recorte casa o autor contra os nomes dos usuários da equipe.
//              equipeId null não casa ninguém — lista vazia, nunca "todo mundo".
//   operador → sem equipe: só a própria linha.
export type EscopoAtividade =
  | { modo: "tudo" }
  | { modo: "equipe"; equipeId: string | null }
  | { modo: "operador"; nome: string };

// O WHERE do recorte + higiene de autor, UM só para o HM e para os genéricos
// (placeholders fixos: $1 de, $2 ate, $3 atores de sistema, $4 modo, $5 equipe,
// $6 nome). Divergir aqui é o gestor ver gente de outra equipe num painel e
// não no outro.
const SQL_RECORTE_AUTOR = `
      where i.autor is not null
        and btrim(lower(i.autor)) <> all($3::text[])
        and i.autor not ilike 'migration%'
        and ($1::timestamptz is null or i.criado_em >= $1)
        and ($2::timestamptz is null or i.criado_em <  $2)
        -- Recorte por nível: master tudo; gestor só a equipe dele (autor casa
        -- por nome com um usuário da equipe); operador só a própria linha.
        and ($4::text = 'tudo'
             or ($4 = 'equipe' and exists (
                   select 1 from cs.usuarios u
                    where u.equipe_id = $5::uuid
                      and lower(btrim(u.nome)) = lower(btrim(i.autor))))
             or ($4 = 'operador' and lower(btrim(i.autor)) = lower(btrim($6::text))))`;

// ===== Núcleo fundido (OTIMIZAÇÃO) ==========================================
// atividadeHm e atividadeEvento eram dois SQLs quase idênticos — só divergiam
// no JOIN (contato_hm_id×cs.contatos_hm vs. contato_id×cs.contatos, este com o
// filtro extra de evento) e no bucket `ligacoes` (só existe nos genéricos: o
// atendimento manual por telefone/WhatsApp, lib/services/ligacao.ts — no HM
// não existe esse tipo e cai em `outras`). Mantê-los como dois arquivos
// convidava os dois a divergir sozinhos (um ganha um bucket, o outro não).
// Aqui entram fundidos num SQL com discriminante `fonte`; atividadeHm e
// atividadeEvento seguem existindo como wrappers finos — a API pública não
// muda uma vírgula.
type Fonte = "hm" | "evento";

// O bucket `ligacoes` só é somado quando fonte='evento' — no HM, `case when`
// devolve 0 (não existe esse tipo de interação lá, e não deveria contar em
// `outras` por engano). Mesma lista de exclusão de atores automáticos e mesmo
// recorte por nível (SQL_RECORTE_AUTOR) para as duas fontes.
async function atividadeNucleo(
  fonte: Fonte,
  f: { de?: string | null; ate?: string | null; produto?: string | null; evento?: string | null },
  escopo: EscopoAtividade,
  granularidade?: Granularidade | null,
): Promise<{ de: string | null; ate: string | null; colaboradores: (AtividadeColaborador & { ligacoes: number })[]; serie?: AtividadePeriodo[] }> {
  const de = f.de || null;
  const ate = f.ate || null;
  const produto = f.produto || null;
  const evento = f.evento || null;
  const modo = escopo.modo;
  const equipeId = escopo.modo === "equipe" ? escopo.equipeId : null;
  const nome = escopo.modo === "operador" ? escopo.nome : null;

  // JOIN e filtro de board variam por fonte; o resto do SQL (SELECT, recorte,
  // GROUP BY) é literal o mesmo texto para as duas.
  //
  // ⚠️ $7 (evento) e $8 (produto) precisam aparecer no texto da query MESMO
  // do lado que não usa — o driver `pg` infere o tipo de cada placeholder pela
  // ocorrência dele no SQL (42P18 "could not determine data type of parameter"
  // se um número nunca aparece). Por isso o `and true` inócuo do lado que não
  // filtra por aquele parâmetro: mantém os DOIS placeholders sempre presentes,
  // com cast explícito, sem mudar o resultado.
  const join = fonte === "hm"
    ? `join cs.contatos_hm ch on ch.id = i.contato_hm_id and ($7::text is null or true)`
    : `join cs.contatos c on c.id = i.contato_id and c.evento = $7::text`;
  const filtroBoard = fonte === "hm"
    ? `and ($8::text is null or ch.produto = $8)`
    : `and ($8::text is null or true)`;
  const cardId = fonte === "hm" ? "i.contato_hm_id" : "i.contato_id";
  const params = fonte === "hm"
    ? [de, ate, ATORES_SISTEMA, modo, equipeId, nome, null, produto]
    : [de, ate, ATORES_SISTEMA, modo, equipeId, nome, evento, null];

  const colaboradores = await query<AtividadeColaborador & { ligacoes: number }>(
    `select
        btrim(i.autor)                                                    as colaborador,
        count(*)::int                                                     as total,
        count(*) filter (where i.tipo = 'mudanca_estagio')::int           as movimentacoes,
        count(*) filter (where i.tipo = 'nota')::int                      as notas,
        count(*) filter (where i.tipo = 'disparo')::int                   as disparos,
        count(*) filter (where i.tipo = 'ligacao')::int                   as ligacoes,
        count(*) filter (where i.tipo not in ('mudanca_estagio','nota','disparo','ligacao'))::int as outras,
        count(distinct ${cardId})::int                                    as cards,
        max(i.criado_em)                                                  as ultima
       from cs.interacoes i
       ${join}
      ${SQL_RECORTE_AUTOR}
        ${filtroBoard}
      group by btrim(i.autor)
      order by count(*) desc, btrim(i.autor)`,
    params,
  );

  if (!granularidade) return { de, ate, colaboradores };

  // Série por período (D1): mesmo agregado, com date_trunc(bucket, criado_em)
  // no GROUP BY junto do autor — uma linha por (período, colaborador).
  // `unit` já é o valor validado (granularidadeValida) traduzido para o que o
  // Postgres entende (UNIT_SQL) — nunca interpolar a string pt-BR ou qualquer
  // valor vindo do cliente direto num date_trunc.
  const unit = UNIT_SQL[granularidade];
  const serie = await query<AtividadePeriodo>(
    `select
        date_trunc('${unit}', i.criado_em)                                as periodo,
        btrim(i.autor)                                                    as colaborador,
        count(*)::int                                                     as total,
        count(*) filter (where i.tipo = 'mudanca_estagio')::int           as movimentacoes,
        count(*) filter (where i.tipo = 'nota')::int                      as notas,
        count(*) filter (where i.tipo = 'disparo')::int                   as disparos,
        count(*) filter (where i.tipo not in ('mudanca_estagio','nota','disparo'))::int as outras,
        count(distinct ${cardId})::int                                    as cards
       from cs.interacoes i
       ${join}
      ${SQL_RECORTE_AUTOR}
        ${filtroBoard}
      group by date_trunc('${unit}', i.criado_em), btrim(i.autor)
      order by periodo asc, btrim(i.autor)`,
    params,
  );

  return { de, ate, colaboradores, serie };
}

// ===== Falhas de disparo — "o que deu errado", separado do que funcionou ===
// (D-falha, pedido literal do Marcio 12/08: "ações da automação... falhas...
// não acho interessante deixar como ações da automação"). cs.disparo_contatos
// guarda `erro` por contato desde a 0001, mas NUNCA aparecia na Atividade
// porque um envio que FALHA não grava cs.interacoes (só o sucesso grava a
// timeline — ver disparo.ts, `if (r.ok) { ...insert cs.interacoes... }`). Sem
// isto a tela via só o que deu certo: "Ana disparou 40" quando 12 dos 40
// falharam parecia trabalho perfeito. Atribuído por cs.disparos.operador — o
// MESMO texto de `autor` nas interações (os dois vêm de sessao.nome, ver
// app/api/send/route.ts). Período pela data do DISPARO em si (iniciado_em),
// não do contato individual — um disparo é um evento só.
export type AtividadeFalhas = { colaborador: string; falhas: number };

async function falhasDisparoNucleo(
  fonte: Fonte,
  f: { de?: string | null; ate?: string | null; evento?: string | null },
  escopo: EscopoAtividade,
): Promise<{ itens: AtividadeFalhas[] }> {
  const de = f.de || null;
  const ate = f.ate || null;
  // fonte='hm': cs.disparos.evento é sempre o literal 'HM' (disparo.ts,
  // `template.evento === "HM"`) — a tabela não guarda produto (HM/AURUM/ETHB),
  // então a contagem cobre a esteira HM inteira, não separada por produto.
  // Mesmo critério de "gap de instrumentação" documentado em porAbaNucleo.
  const evento = fonte === "hm" ? "HM" : (f.evento || null);
  const modo = escopo.modo;
  const equipeId = escopo.modo === "equipe" ? escopo.equipeId : null;
  const nome = escopo.modo === "operador" ? escopo.nome : null;

  // CTE renomeia disparos->i (autor/criado_em) só para reaproveitar
  // SQL_RECORTE_AUTOR literal, sem duplicar o WHERE de recorte por nível.
  const itens = await query<AtividadeFalhas>(
    `with i as (
        select d.id, d.operador as autor, d.iniciado_em as criado_em
          from cs.disparos d
         where ($7::text is null or d.evento = $7)
     )
     select btrim(i.autor)  as colaborador,
            count(*)::int   as falhas
       from i
       join cs.disparo_contatos dc on dc.disparo_id = i.id and dc.erro is not null
      ${SQL_RECORTE_AUTOR}
      group by btrim(i.autor)`,
    [de, ate, ATORES_SISTEMA, modo, equipeId, nome, evento],
  );
  return { itens };
}

// `produto` (0164): a esteira é a mesma para HM/AURUM/ETHB, então sem o recorte a
// tela de Atividade do Aurum mostrava o movimento do HM.
// `granularidade` (D1, opcional): quando informada, devolve também `serie` — o
// total por (período, colaborador) no bucket pedido — E `colaboradores[].porColuna`
// (D3-a) — o breakdown por estágio destino do MESMO colaborador, agregado do
// período inteiro (não quebrado por dia/semana/mês: a pergunta de porColuna é
// "para onde cada um moveu no período", não uma série) — E `colaboradores[].porAba`
// (eixo comercial × ativação, pedido do Marcio 12/08): quanto o colaborador agiu
// em cards que hoje estão em cada aba, mesmo critério de "agregado do período
// inteiro, não série" — E `colaboradores[].porAluno`/`porAlunoTotal` (pedido
// literal do Marcio 12/08, ver porAlunoNucleo): o que o colaborador fez com
// CADA ALUNO — TOP 8 cards por nº de ações, mais o total de alunos distintos
// tocados. Ausente = comportamento histórico (só `colaboradores`, sem
// porColuna/porAba/porAluno), ninguém que já consome esta função quebra — os
// quatro vêm juntos porque hoje só a tela de Atividade (que já pede
// granularidade) consome o breakdown.
export async function atividadeHm(
  f: { de?: string | null; ate?: string | null; produto?: string | null },
  escopo: EscopoAtividade = { modo: "tudo" },
  granularidade?: Granularidade | null,
): Promise<Atividade> {
  const g = granularidade ? granularidadeValida(granularidade) : null;
  // ⚠️ Pooler Supavisor em modo TRANSAÇÃO: NÃO paralelizar (Promise.all) as
  // duas queries — reabrir handshake piora a latência (~7s medido em outras
  // rotas do projeto). Em série, de propósito.
  const r = await atividadeNucleo("hm", f, escopo, g);
  // `ligacoes` não existe no HM (sempre 0 no SQL fundido) — devolve o shape
  // histórico de AtividadeColaborador, sem o campo espúrio.
  const colaboradores = r.colaboradores.map(({ ligacoes: _ligacoes, ...c }) => c);

  // `porColuna` (D3-a) só é buscado quando a granularidade foi pedida — mesmo
  // critério de `serie`: sem isso, toda chamada de atividadeHm (inclusive as
  // que só querem o total puro) pagaria uma segunda query que não usa.
  if (!g) return { de: r.de, ate: r.ate, colaboradores };

  // Duas queries extras, em série (mesmo motivo do comentário do pooler acima:
  // Supavisor em modo transação não tolera paralelizar aqui).
  const brk = await porEstagioNucleo(f, escopo);
  const porColunaPorAutor = new Map<string, AtividadeColunaResumo[]>();
  for (const it of brk.itens) {
    const lista = porColunaPorAutor.get(it.colaborador) ?? [];
    lista.push({ estagio_id: it.estagio_id, estagio_nome: it.estagio_nome, estagio_chave: it.estagio_chave, estagio_aba: it.estagio_aba, total: it.total });
    porColunaPorAutor.set(it.colaborador, lista);
  }

  const abaBrk = await porAbaNucleo(f, escopo);
  const porAbaPorAutor = new Map<string, AtividadeAbaResumo[]>();
  for (const it of abaBrk.itens) {
    const lista = porAbaPorAutor.get(it.colaborador) ?? [];
    lista.push({ colaborador: it.colaborador, estagio_aba: it.estagio_aba, total: it.total });
    porAbaPorAutor.set(it.colaborador, lista);
  }

  // "O que cada operador fez com cada aluno" (pedido literal do Marcio,
  // 12/08) — mesmo critério de porColuna/porAba: só busca quando a
  // granularidade foi pedida, agregado do período inteiro (não é série).
  const alunoBrk = await porAlunoNucleo(f, escopo);
  const porAlunoPorAutor = new Map<string, AtividadeAlunoResumo[]>();
  for (const it of alunoBrk.itens) {
    const lista = porAlunoPorAutor.get(it.colaborador) ?? [];
    lista.push(it);
    porAlunoPorAutor.set(it.colaborador, lista);
  }

  // Falhas de disparo (D-falha) e agendamentos marcados (promessa cumprida x
  // remarcada) — mesmo critério de "só busca quando granularidade foi pedida",
  // em série (pooler não tolera Promise.all aqui, ver comentário acima).
  const falhasBrk = await falhasDisparoNucleo("hm", f, escopo);
  const falhasPorAutor = new Map(falhasBrk.itens.map((it) => [it.colaborador, it.falhas]));

  const agBrk = await agendamentosNucleo(f, escopo);
  const agendamentosPorAutor = new Map(agBrk.itens.map((it) => [it.colaborador, it]));

  const colaboradoresComColuna = colaboradores.map((c) => ({
    ...c,
    porColuna: porColunaPorAutor.get(c.colaborador) ?? [],
    porAba: porAbaPorAutor.get(c.colaborador) ?? [],
    porAluno: porAlunoPorAutor.get(c.colaborador) ?? [],
    porAlunoTotal: alunoBrk.totalAlunosPorColaborador.get(c.colaborador) ?? 0,
    falhas: falhasPorAutor.get(c.colaborador) ?? 0,
    ...(agendamentosPorAutor.has(c.colaborador) ? { agendamentos: agendamentosPorAutor.get(c.colaborador)!.resumo } : {}),
  }));

  return { de: r.de, ate: r.ate, colaboradores: colaboradoresComColuna, ...(r.serie ? { serie: r.serie } : {}) };
}

// ===== Atividade nos portais genéricos (HT/SEM/CNHF) ========================
// O espelho de atividadeHm sobre a timeline dos GENÉRICOS: cs.interacoes
// assinada em contato_id → cs.contatos, filtrada pelo EVENTO do portal (a
// linha de cs.contatos é por evento — sem o filtro a atividade do CNHF vazaria
// para o painel do HT). Mesmo recorte por nível (EscopoAtividade) e mesma
// lista de exclusão de atores automáticos.
// Bucket extra `ligacoes`: nos genéricos o atendimento por telefone/WhatsApp
// manual entra como tipo 'ligacao' (lib/services/ligacao.ts) — no HM isso não
// existe e cai em `outras`.
export type AtividadeEventoColaborador = AtividadeColaborador & { ligacoes: number };

export type AtividadeEvento = {
  de: string | null;
  ate: string | null;
  colaboradores: AtividadeEventoColaborador[];
  serie?: AtividadePeriodo[];
};

export async function atividadeEvento(
  evento: string,
  f: { de?: string | null; ate?: string | null },
  escopo: EscopoAtividade = { modo: "tudo" },
  granularidade?: Granularidade | null,
): Promise<AtividadeEvento> {
  const g = granularidade ? granularidadeValida(granularidade) : null;
  const r = await atividadeNucleo("evento", { ...f, evento }, escopo, g);
  if (!g) return { de: r.de, ate: r.ate, colaboradores: r.colaboradores };

  // Falhas de disparo (D-falha) — mesmo indicador do HM, ver falhasDisparoNucleo.
  const falhasBrk = await falhasDisparoNucleo("evento", { ...f, evento }, escopo);
  const falhasPorAutor = new Map(falhasBrk.itens.map((it) => [it.colaborador, it.falhas]));
  const colaboradoresComFalhas = r.colaboradores.map((c) => ({ ...c, falhas: falhasPorAutor.get(c.colaborador) ?? 0 }));

  return { de: r.de, ate: r.ate, colaboradores: colaboradoresComFalhas, ...(r.serie ? { serie: r.serie } : {}) };
}

// ===== Atividade por estágio/coluna (D3-a) ==================================
// "O que o operador fez com cada aluno no dia": agrega por (autor, estágio
// DESTINO) sobre as mudanças de etapa já registradas em cs.interacoes —
// estagio_anterior_id/estagio_novo_id são preenchidas desde a migration que
// introduziu mudanca_estagio (conferido: 1262/1278 linhas do tipo têm
// estagio_novo_id, o resto é ruído anterior ao preenchimento). Não precisa de
// migration: o dado já existe, isto é só a leitura agregada.
// Só faz sentido para a esteira HM (estágio é conceito do board HM/AURUM/ETHB;
// os genéricos não têm cs.estagios).
export type AtividadeEstagio = {
  colaborador: string;
  estagio_id: number;
  estagio_nome: string | null;
  estagio_chave: string | null;
  /** Comercial/Ativação (cs.estagios.aba) — null nos estágios legados sem aba. */
  estagio_aba: string | null;
  total: number;
};

// Único chamador: atividadeHm pendura o resultado em `colaboradores[].porColuna`
// (não quebra por período — a pergunta de porColuna é "quanto cada um moveu
// para cada coluna NO PERÍODO CONSULTADO", não uma série temporal).
async function porEstagioNucleo(
  f: { de?: string | null; ate?: string | null; produto?: string | null },
  escopo: EscopoAtividade,
): Promise<{ de: string | null; ate: string | null; itens: AtividadeEstagio[] }> {
  const de = f.de || null;
  const ate = f.ate || null;
  const produto = f.produto || null;
  const modo = escopo.modo;
  const equipeId = escopo.modo === "equipe" ? escopo.equipeId : null;
  const nome = escopo.modo === "operador" ? escopo.nome : null;

  const itens = await query<AtividadeEstagio>(
    `select
        btrim(i.autor)                     as colaborador,
        i.estagio_novo_id                  as estagio_id,
        est.nome                           as estagio_nome,
        est.chave                          as estagio_chave,
        est.aba                            as estagio_aba,
        count(*)::int                      as total
       from cs.interacoes i
       join cs.contatos_hm ch on ch.id = i.contato_hm_id
       left join cs.estagios est on est.id = i.estagio_novo_id
      ${SQL_RECORTE_AUTOR}
        and i.tipo = 'mudanca_estagio'
        and i.estagio_novo_id is not null
        and ($7::text is null or ch.produto = $7)
      group by btrim(i.autor), i.estagio_novo_id, est.nome, est.chave, est.aba
      order by btrim(i.autor)`,
    [de, ate, ATORES_SISTEMA, modo, equipeId, nome, produto],
  );

  return { de, ate, itens };
}

// ===== Atividade por ABA — comercial × ativação (pedido do Marcio, 12/08) ===
// "Equipes de Ativação e Comercial responsáveis por cada parte da esteira,
// mapeadas de forma coerente": quanto CADA colaborador agiu em cards que hoje
// estão no Comercial vs. na Ativação, no período. Ao contrário de porColuna
// (que só soma MOVIMENTAÇÕES, porque só elas carregam estagio_novo_id), aqui
// entra QUALQUER interação — nota, disparo, edição de ficha — porque o que se
// quer saber é "quanto esse operador trabalhou hoje na fila da Ativação",
// não só "quantas vezes ele arrastou um card para lá". A contrapartida: usa o
// estágio ATUAL do card (ch.estagio_id), não o estágio de quando a ação
// aconteceu — cs.interacoes não guarda "em que estágio o card estava" para
// tipos que não são mudança de etapa, e instrumentar isso agora é fora do
// escopo desta leitura (reportado como gap de instrumentação). Cards cujo
// estágio atual não tem `aba` definida (23 estágios legados/órfãos) somam em
// `estagio_aba: null` — NUNCA são jogados dentro de comercial/ativação por
// aproximação.
export type AtividadeAbaResumo = {
  colaborador: string;
  /** 'comercial' | 'ativacao' | null (estágio sem aba definida). */
  estagio_aba: string | null;
  total: number;
};

async function porAbaNucleo(
  f: { de?: string | null; ate?: string | null; produto?: string | null },
  escopo: EscopoAtividade,
): Promise<{ de: string | null; ate: string | null; itens: AtividadeAbaResumo[] }> {
  const de = f.de || null;
  const ate = f.ate || null;
  const produto = f.produto || null;
  const modo = escopo.modo;
  const equipeId = escopo.modo === "equipe" ? escopo.equipeId : null;
  const nome = escopo.modo === "operador" ? escopo.nome : null;

  const itens = await query<AtividadeAbaResumo>(
    `select
        btrim(i.autor)                     as colaborador,
        est.aba                            as estagio_aba,
        count(*)::int                      as total
       from cs.interacoes i
       join cs.contatos_hm ch on ch.id = i.contato_hm_id
       left join cs.estagios est on est.id = ch.estagio_id
      ${SQL_RECORTE_AUTOR}
        and ($7::text is null or ch.produto = $7)
      group by btrim(i.autor), est.aba
      order by btrim(i.autor)`,
    [de, ate, ATORES_SISTEMA, modo, equipeId, nome, produto],
  );

  return { de, ate, itens };
}

// ===== Atividade por ALUNO — "o que o operador fez COM CADA aluno" (pedido =
// literal do Marcio, 12/08) ===================================================
// porEstagioNucleo (D3-a) e porAbaNucleo respondem "para onde"/"em que aba" —
// o ALUNO em si nunca aparecia, só o `count(*)` agregado. Aqui a granularidade
// é (autor, contato_hm_id): nome do aluno + quantas ações + em quantos TIPOS
// distintos de ação (nota/movimentação/disparo/outras) naquele card, no período.
//
// ⚠️ VOLUME: um operador ativo toca dezenas de alunos por dia — devolver a
// lista INTEIRA por colaborador estufaria o payload e a UI (uma tabela dentro
// de outra tabela, para cada linha expandida). Corte: TOP 8 alunos por
// operador, ordenado por nº de ações desc, mais o contador "e mais X". O corte
// é feito NO BANCO (row_number() + filtro), não trazendo tudo e cortando no
// Node — evitar egress de linhas que a tela nunca mostra é a mesma régua de
// "sem paginação full-table" das outras queries deste arquivo.
//
// Índice usado: `cs_interacoes_contato_hm_idx` (contato_hm_id) — o JOIN com
// cs.contatos_hm é pela FK indexada; o agrupamento por (autor, contato_hm_id)
// não precisa de índice novo (agregação sobre o recorte já filtrado por data).
export type AtividadeAlunoResumo = {
  colaborador: string;
  contato_hm_id: string;
  aluno_nome: string;
  total: number;
  /** Quantos tipos distintos de ação (nota, mudança de etapa, disparo, outras) naquele card. */
  tipos_distintos: number;
  ultima: string;
};

// Top N por colaborador — ver o comentário acima sobre o corte de volume.
const TOP_ALUNOS_POR_COLABORADOR = 8;

async function porAlunoNucleo(
  f: { de?: string | null; ate?: string | null; produto?: string | null },
  escopo: EscopoAtividade,
): Promise<{ de: string | null; ate: string | null; itens: AtividadeAlunoResumo[]; totalAlunosPorColaborador: Map<string, number> }> {
  const de = f.de || null;
  const ate = f.ate || null;
  const produto = f.produto || null;
  const modo = escopo.modo;
  const equipeId = escopo.modo === "equipe" ? escopo.equipeId : null;
  const nome = escopo.modo === "operador" ? escopo.nome : null;

  // Duas peças: (1) o TOP 8 em si, já ordenado e limitado por operador via
  // row_number() na CTE; (2) quantos alunos DISTINTOS cada operador tocou no
  // total (para o "e mais X" da UI) — mesma agregação, sem o corte.
  const itens = await query<AtividadeAlunoResumo>(
    `with base as (
        select
            btrim(i.autor)                                as colaborador,
            i.contato_hm_id                                as contato_hm_id,
            cmp.nome                                        as aluno_nome,
            count(*)::int                                   as total,
            count(distinct i.tipo)::int                     as tipos_distintos,
            max(i.criado_em)                                as ultima
           from cs.interacoes i
           join cs.contatos_hm ch on ch.id = i.contato_hm_id
           join compradores cmp on cmp.id = ch.comprador_id
          ${SQL_RECORTE_AUTOR}
            and ($7::text is null or ch.produto = $7)
          group by btrim(i.autor), i.contato_hm_id, cmp.nome
     ), ranqueado as (
        select base.*,
               row_number() over (partition by colaborador order by total desc, ultima desc) as rn
          from base
     )
     select colaborador, contato_hm_id, aluno_nome, total, tipos_distintos, ultima
       from ranqueado
      where rn <= ${TOP_ALUNOS_POR_COLABORADOR}
      order by colaborador, total desc`,
    [de, ate, ATORES_SISTEMA, modo, equipeId, nome, produto],
  );

  const totais = await query<{ colaborador: string; total_alunos: number }>(
    `select btrim(i.autor) as colaborador, count(distinct i.contato_hm_id)::int as total_alunos
       from cs.interacoes i
       join cs.contatos_hm ch on ch.id = i.contato_hm_id
      ${SQL_RECORTE_AUTOR}
        and ($7::text is null or ch.produto = $7)
      group by btrim(i.autor)`,
    [de, ate, ATORES_SISTEMA, modo, equipeId, nome, produto],
  );
  const totalAlunosPorColaborador = new Map(totais.map((t) => [t.colaborador, t.total_alunos]));

  return { de, ate, itens, totalAlunosPorColaborador };
}

// ===== Agendamentos marcados — cumprido x remarcado (pedido literal do ======
// Marcio, 12/08): "quem tá seguindo de fato na risca, o que a gente promete e
// o que a gente propõe a fazer". Cada linha de cs.hm_agendamentos (0064) é UMA
// marcação (reunião/entrevista); `status` já registra o desfecho:
//   realizado       → aconteceu — a promessa foi cumprida.
//   nao_compareceu  → o aluno não veio (no-show na data combinada).
//   reagendado      → a marcação caiu e uma nova foi aberta em cima dela.
//   agendado        → ainda em aberto (marcação futura, sem desfecho ainda).
// `cancelado` (desmarcada sem nova data) fica FORA do resumo de propósito: não
// é promessa cumprida nem quebrada, é a marcação sendo retirada — misturar
// inflaria o "resolvidos" com algo que não é nem acerto nem falha.
// Atribuído a quem MARCOU (`autor`), no período em que a marcação foi CRIADA
// — não quando ela deveria acontecer, para não misturar marcação antiga que só
// mudou de status agora com o trabalho do período consultado. Só HM: o
// conceito de agendamento (reunião/entrevista) é da esteira comercial do HM.
export type AtividadeAgendamentosResumo = {
  realizados: number;
  nao_compareceu: number;
  remarcados: number;
  em_aberto: number;
};
type AtividadeAgendamentosItem = { colaborador: string; resumo: AtividadeAgendamentosResumo };

async function agendamentosNucleo(
  f: { de?: string | null; ate?: string | null; produto?: string | null },
  escopo: EscopoAtividade,
): Promise<{ itens: AtividadeAgendamentosItem[] }> {
  const de = f.de || null;
  const ate = f.ate || null;
  const produto = f.produto || null;
  const modo = escopo.modo;
  const equipeId = escopo.modo === "equipe" ? escopo.equipeId : null;
  const nome = escopo.modo === "operador" ? escopo.nome : null;

  const linhas = await query<{ colaborador: string; realizados: number; nao_compareceu: number; remarcados: number; em_aberto: number }>(
    `select
        btrim(i.autor)                                             as colaborador,
        count(*) filter (where i.status = 'realizado')::int        as realizados,
        count(*) filter (where i.status = 'nao_compareceu')::int   as nao_compareceu,
        count(*) filter (where i.status = 'reagendado')::int       as remarcados,
        count(*) filter (where i.status = 'agendado')::int         as em_aberto
       from cs.hm_agendamentos i
       join cs.contatos_hm ch on ch.id = i.contato_hm_id
      ${SQL_RECORTE_AUTOR}
        and ($7::text is null or ch.produto = $7)
      group by btrim(i.autor)`,
    [de, ate, ATORES_SISTEMA, modo, equipeId, nome, produto],
  );

  const itens: AtividadeAgendamentosItem[] = linhas.map((l) => ({
    colaborador: l.colaborador,
    resumo: { realizados: l.realizados, nao_compareceu: l.nao_compareceu, remarcados: l.remarcados, em_aberto: l.em_aberto },
  }));
  return { itens };
}

// ===== Desempenho comercial × ativação (D-desempenho, pedido do Marcio 12/08 =
// à noite) ====================================================================
// "O dashboard é nosso carro-chefe: bater o olho e entender quem tá performando
// bem, quem não tá tanto." Diferente do resto deste arquivo (que agrega por
// AUTOR — texto livre assinado em cs.interacoes), aqui a agregação é por
// RESPONSÁVEL — uma FK de verdade (cs.contatos_hm.responsavel_comercial_id /
// responsavel_ativacao_id, histórico imutável por aba, 0211/0212). É a
// diferença entre "quem mexeu no card" e "de quem é o resultado do card" — e é
// esta segunda pergunta que uma KPI de vendas responde.
//
// Duplo responsável, dois eixos SEPARADOS (nunca somados num número só):
//   COMERCIAL  → quem vendeu (fechou o card). KPI é dinheiro: quanto entrou,
//                dos pagamentos atribuídos ao card que ele fechou, e quanto
//                tempo levou até o aluno quitar o saldo.
//   ATIVAÇÃO   → quem libera o acesso depois da venda. KPI não é dinheiro (a
//                ativação não fecha venda) — é quantos alunos ela levou até a
//                quitação enquanto era a responsável, e em quanto tempo.
// Um card pode ter os dois preenchidos (histórico por aba, 0211) — a mesma
// quitação NUNCA aparece como "dinheiro do ativador": o ativador é medido pelo
// CARD chegar lá, não pelo valor do pagamento (isso seria contar o mesmo real
// duas vezes, uma vez como venda e outra como ativação).

const numero = (v: unknown): number => {
  if (v === null || v === undefined) return 0;
  const n = typeof v === "string" ? Number(v) : (v as number);
  return Number.isFinite(n) ? n : 0;
};
const numeroOuNull = (v: unknown): number | null => {
  if (v === null || v === undefined) return null;
  const n = typeof v === "string" ? Number(v) : (v as number);
  return Number.isFinite(n) ? n : null;
};

// Achata EscopoVisibilidade (lib/papeis.ts — a MESMA função que rege o que o
// board/kanban deixa cada nível enxergar) em 3 parâmetros de bind. Nunca
// reimplementar a regra aqui: a visibilidade sai da sessão do servidor, e
// escopoVisibilidade já decide master=tudo, quem-tem-equipe=equipe (com
// equipeId eventualmente null, que não casa ninguém — fail-closed) e
// sem-equipe=operador. Ver o comentário da própria função em lib/papeis.ts.
function paramsRecorteResponsavel(escopo: EscopoVisibilidade): { modo: string; usuarioId: string | null; equipeId: string | null } {
  if (escopo.modo === "tudo") return { modo: "tudo", usuarioId: null, equipeId: null };
  if (escopo.modo === "equipe") return { modo: "equipe", usuarioId: escopo.usuarioId, equipeId: escopo.equipeId };
  return { modo: "operador", usuarioId: escopo.usuarioId, equipeId: null };
}

// O WHERE do recorte por RESPONSÁVEL — mesmo espírito de SQL_RECORTE_AUTOR,
// mas por FK (uuid), não por nome. `coluna` é sempre um dos 2 literais fixos
// abaixo (nunca vindo de request) — identificador de coluna não é bind param,
// então isto NÃO é injeção: é escolha de uma string interna, não da query.
function sqlRecorteResponsavel(coluna: "responsavel_comercial_id" | "responsavel_ativacao_id", pModo: number, pUsuario: number, pEquipe: number): string {
  return `
        and ($${pModo}::text = 'tudo'
             or ($${pModo} = 'equipe' and (
                   ch.${coluna} = $${pUsuario}::uuid
                   or exists (select 1 from cs.usuarios ur where ur.id = ch.${coluna} and ur.equipe_id = $${pEquipe}::uuid)
                 ))
             or ($${pModo} = 'operador' and ch.${coluna} = $${pUsuario}::uuid))`;
}

export type DesempenhoComercial = {
  usuario_id: string | null;
  pessoa: string;
  /** Cards distintos com AO MENOS UM pagamento no período (não é "cards atribuídos hoje" — é quem gerou caixa). */
  cards: number;
  /** Soma de TODOS os pagamentos do período atribuídos ao card que ele fechou (sinal+saldo+compra_cheia+mensalidade). Nunca inclui `ajuste` (correção manual, não é venda nova). */
  total_fechado: number;
  total_sinal: number;
  /** O pedido literal do Marcio: "quanto de saldo ele conseguiu de quem estava com ele". `categoria='saldo'` é a diferença paga de uma vez (cs.hm_pagamentos, ver 0075/fn_hm_natureza_pagamento). */
  total_saldo: number;
  total_compra_cheia: number;
  total_mensalidade: number;
  /** Quantos saldos (categoria='saldo') o comercial recebeu no período — base do tempo médio abaixo. */
  n_saldos: number;
  /** Dos `n_saldos`, quantos têm entrada_em/criado_em anterior ao pagamento (prazo computável — timestamp corrompido/retroativo fica de fora, nunca inventa um dia negativo). */
  n_saldos_com_prazo_valido: number;
  /** MEDIANA de dias entre a entrada do card (entrada_em, ou criado_em quando nula) e o pagamento do saldo — mediana, não média: com N pequeno por pessoa, um outlier (aluno que demorou 400 dias) distorceria a média inteira. null = nenhum saldo com prazo computável no período. */
  mediana_dias_ate_saldo: number | null;
};

export type DesempenhoAtivacao = {
  usuario_id: string | null;
  pessoa: string;
  /** Cards quitados no período enquanto ele era o responsável de ativação — o resultado do trabalho de ativação, não o dinheiro (ver o cabeçalho da seção: dinheiro é métrica do comercial). */
  alunos_ativados: number;
  n_com_prazo_valido: number;
  /** MEDIANA de dias entre a entrada do card e a quitação. */
  mediana_dias_ate_quitacao: number | null;
};

export type Desempenho = {
  de: string | null;
  ate: string | null;
  comercial: DesempenhoComercial[];
  ativacao: DesempenhoAtivacao[];
};

// Dinheiro fechado por responsável COMERCIAL, com o mesmo filtro de produto
// (`cs.fn_hm_pagamento_do_produto`) que o resto do financeiro do HM usa (0196/
// 0197/0199, e o histórico financeiro da ficha, hoje) — sem ele, o dinheiro do
// AURUM entraria no placar de quem vende HM (comprador com card nos dois
// boards, 0163). `categoria in (...)` exclui `ajuste` de propósito: é correção
// manual de abertura de conta (0075), não uma venda que o comercial fechou.
async function desempenhoComercialDinheiroNucleo(
  f: { de?: string | null; ate?: string | null; produto?: string | null },
  escopo: EscopoVisibilidade,
): Promise<{ usuario_id: string | null; pessoa: string; cards: number; total_fechado: number; total_sinal: number; total_saldo: number; total_compra_cheia: number; total_mensalidade: number }[]> {
  const { modo, usuarioId, equipeId } = paramsRecorteResponsavel(escopo);
  const rows = await query<Record<string, unknown>>(
    `select ch.responsavel_comercial_id                                          as usuario_id,
            coalesce(u.nome, 'Sem responsável comercial')                        as pessoa,
            count(distinct ch.id)::int                                           as cards,
            coalesce(sum(p.valor), 0)                                            as total_fechado,
            coalesce(sum(p.valor) filter (where p.categoria = 'sinal'), 0)       as total_sinal,
            coalesce(sum(p.valor) filter (where p.categoria = 'saldo'), 0)       as total_saldo,
            coalesce(sum(p.valor) filter (where p.categoria = 'compra_cheia'), 0) as total_compra_cheia,
            coalesce(sum(p.valor) filter (where p.categoria = 'mensalidade'), 0) as total_mensalidade
       from cs.hm_pagamentos p
       join cs.contatos_hm ch
         on ch.comprador_id = p.comprador_id
        and cs.fn_hm_pagamento_do_produto(p.oferta_codigo, ch.produto)
       left join cs.usuarios u on u.id = ch.responsavel_comercial_id
      where p.categoria in ('sinal','saldo','compra_cheia','mensalidade')
        and ($1::timestamptz is null or p.pago_em >= $1)
        and ($2::timestamptz is null or p.pago_em <  $2)
        and ($3::text is null or ch.produto = $3)
        ${sqlRecorteResponsavel("responsavel_comercial_id", 4, 5, 6)}
      group by ch.responsavel_comercial_id, u.nome
      order by total_fechado desc nulls last`,
    [f.de || null, f.ate || null, f.produto || null, modo, usuarioId, equipeId],
  );
  return rows.map((r) => ({
    usuario_id: (r.usuario_id as string | null) ?? null,
    pessoa: r.pessoa as string,
    cards: numero(r.cards),
    total_fechado: numero(r.total_fechado),
    total_sinal: numero(r.total_sinal),
    total_saldo: numero(r.total_saldo),
    total_compra_cheia: numero(r.total_compra_cheia),
    total_mensalidade: numero(r.total_mensalidade),
  }));
}

// Tempo até o saldo — mediana de dias entre a entrada do card e o pagamento do
// PRIMEIRO saldo (categoria='saldo') no período, por responsável comercial.
// `entrada_em` (0180) é quando a entrada que produziu o card foi paga; cai para
// `criado_em` nos cards que nasceram antes da coluna existir (backfill de
// 0180 já cobriu 230/230 — o coalesce é rede de segurança, não caminho normal).
// Prazo NEGATIVO (saldo pago antes da "entrada" registrada — dado retroativo/
// import) fica de fora da mediana: contar um prazo negativo mentiria a
// eficiência do time. `n_saldos` conta TODO saldo do período (não filtra pelo
// prazo); `n_saldos_com_prazo_valido` é o denominador real da mediana — os dois
// aparecem para a tela nunca confundir "0 saldos" com "saldos sem prazo".
async function desempenhoComercialTempoNucleo(
  f: { de?: string | null; ate?: string | null; produto?: string | null },
  escopo: EscopoVisibilidade,
): Promise<{ usuario_id: string | null; pessoa: string; n_saldos: number; n_saldos_com_prazo_valido: number; mediana_dias_ate_saldo: number | null }[]> {
  const { modo, usuarioId, equipeId } = paramsRecorteResponsavel(escopo);
  const rows = await query<Record<string, unknown>>(
    `with primeiro_saldo as (
        select ch.id as contato_hm_id, ch.responsavel_comercial_id, min(p.pago_em) as saldo_pago_em
          from cs.hm_pagamentos p
          join cs.contatos_hm ch
            on ch.comprador_id = p.comprador_id
           and cs.fn_hm_pagamento_do_produto(p.oferta_codigo, ch.produto)
         where p.categoria = 'saldo'
           and ($1::timestamptz is null or p.pago_em >= $1)
           and ($2::timestamptz is null or p.pago_em <  $2)
           and ($3::text is null or ch.produto = $3)
           ${sqlRecorteResponsavel("responsavel_comercial_id", 4, 5, 6)}
         group by ch.id, ch.responsavel_comercial_id
     ), dias as (
        select ps.responsavel_comercial_id,
               case when ps.saldo_pago_em >= coalesce(ch.entrada_em, ch.criado_em)
                    then extract(epoch from (ps.saldo_pago_em - coalesce(ch.entrada_em, ch.criado_em))) / 86400.0
                    else null end as dias
          from primeiro_saldo ps
          join cs.contatos_hm ch on ch.id = ps.contato_hm_id
     )
     select d.responsavel_comercial_id                                           as usuario_id,
            coalesce(u.nome, 'Sem responsável comercial')                        as pessoa,
            count(*)::int                                                       as n_saldos,
            count(d.dias)::int                                                  as n_saldos_com_prazo_valido,
            percentile_cont(0.5) within group (order by d.dias) filter (where d.dias is not null) as mediana_dias_ate_saldo
       from dias d
       left join cs.usuarios u on u.id = d.responsavel_comercial_id
      group by d.responsavel_comercial_id, u.nome`,
    [f.de || null, f.ate || null, f.produto || null, modo, usuarioId, equipeId],
  );
  return rows.map((r) => ({
    usuario_id: (r.usuario_id as string | null) ?? null,
    pessoa: r.pessoa as string,
    n_saldos: numero(r.n_saldos),
    n_saldos_com_prazo_valido: numero(r.n_saldos_com_prazo_valido),
    mediana_dias_ate_saldo: numeroOuNull(r.mediana_dias_ate_saldo),
  }));
}

// Ativação: quantos cards um responsável de ativação levou até a QUITAÇÃO no
// período (`quitado_em`), e em quanto tempo (mediana, entrada→quitação). Nunca
// dinheiro — a ativação não vende, libera acesso; o card pode até ter sido
// fechado por OUTRO comercial (histórico por aba, 0211) e isso é o ponto: os
// dois eixos medem coisas diferentes do MESMO card sem duplicar o resultado.
async function desempenhoAtivacaoNucleo(
  f: { de?: string | null; ate?: string | null; produto?: string | null },
  escopo: EscopoVisibilidade,
): Promise<DesempenhoAtivacao[]> {
  const { modo, usuarioId, equipeId } = paramsRecorteResponsavel(escopo);
  const rows = await query<Record<string, unknown>>(
    `with quit as (
        select ch.responsavel_ativacao_id,
               case when ch.quitado_em >= coalesce(ch.entrada_em, ch.criado_em)
                    then extract(epoch from (ch.quitado_em - coalesce(ch.entrada_em, ch.criado_em))) / 86400.0
                    else null end as dias
          from cs.contatos_hm ch
         where ch.quitado_em is not null
           and ($1::timestamptz is null or ch.quitado_em >= $1)
           and ($2::timestamptz is null or ch.quitado_em <  $2)
           and ($3::text is null or ch.produto = $3)
           ${sqlRecorteResponsavel("responsavel_ativacao_id", 4, 5, 6)}
     )
     select q.responsavel_ativacao_id                                           as usuario_id,
            coalesce(u.nome, 'Sem responsável de ativação')                     as pessoa,
            count(*)::int                                                       as alunos_ativados,
            count(q.dias)::int                                                  as n_com_prazo_valido,
            percentile_cont(0.5) within group (order by q.dias) filter (where q.dias is not null) as mediana_dias_ate_quitacao
       from quit q
       left join cs.usuarios u on u.id = q.responsavel_ativacao_id
      group by q.responsavel_ativacao_id, u.nome
      order by alunos_ativados desc`,
    [f.de || null, f.ate || null, f.produto || null, modo, usuarioId, equipeId],
  );
  return rows.map((r) => ({
    usuario_id: (r.usuario_id as string | null) ?? null,
    pessoa: r.pessoa as string,
    alunos_ativados: numero(r.alunos_ativados),
    n_com_prazo_valido: numero(r.n_com_prazo_valido),
    mediana_dias_ate_quitacao: numeroOuNull(r.mediana_dias_ate_quitacao),
  }));
}

// Porta única do dashboard: junta dinheiro+tempo do comercial (2 queries, por
// granularidade de GROUP BY diferente — dinheiro soma pagamentos, tempo soma
// cards únicos) num só registro por pessoa, e devolve a ativação à parte. Em
// SÉRIE — mesmo motivo documentado no topo do arquivo (Supavisor em modo
// transação não tolera Promise.all).
export async function desempenhoHm(
  f: { de?: string | null; ate?: string | null; produto?: string | null },
  ator: Ator,
): Promise<Desempenho> {
  const escopo = escopoVisibilidade(ator);
  const dinheiro = await desempenhoComercialDinheiroNucleo(f, escopo);
  const tempo = await desempenhoComercialTempoNucleo(f, escopo);
  const ativacao = await desempenhoAtivacaoNucleo(f, escopo);

  const tempoPorUsuario = new Map(tempo.map((t) => [t.usuario_id, t]));
  // UNION dos dois conjuntos de chaves: alguém pode ter fechado dinheiro sem
  // nenhum saldo no período (n_saldos=0) ou — mais raro, mas possível se um
  // saldo foi pago sem nenhum OUTRO pagamento no card no período — aparecer só
  // no tempo. Nenhuma pessoa com atividade real fica de fora por causa da
  // interseção dos dois SELECTs.
  const chaves = new Set<string | null>([...dinheiro.map((d) => d.usuario_id), ...tempo.map((t) => t.usuario_id)]);
  const comercial: DesempenhoComercial[] = [...chaves].map((usuarioId) => {
    const d = dinheiro.find((x) => x.usuario_id === usuarioId);
    const t = tempoPorUsuario.get(usuarioId);
    return {
      usuario_id: usuarioId,
      pessoa: d?.pessoa ?? t?.pessoa ?? "Sem responsável comercial",
      cards: d?.cards ?? 0,
      total_fechado: d?.total_fechado ?? 0,
      total_sinal: d?.total_sinal ?? 0,
      total_saldo: d?.total_saldo ?? 0,
      total_compra_cheia: d?.total_compra_cheia ?? 0,
      total_mensalidade: d?.total_mensalidade ?? 0,
      n_saldos: t?.n_saldos ?? 0,
      n_saldos_com_prazo_valido: t?.n_saldos_com_prazo_valido ?? 0,
      mediana_dias_ate_saldo: t?.mediana_dias_ate_saldo ?? null,
    };
  }).sort((a, b) => b.total_fechado - a.total_fechado);

  return { de: f.de || null, ate: f.ate || null, comercial, ativacao };
}
