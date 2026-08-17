import { atividadeHm, atividadeAutomaticaHm, type EscopoAtividade } from "@/lib/services/hm-atividade";
import { podeVerTudo } from "@/lib/papeis";
import { dtHoraBr } from "@/lib/relatorios/fmt";
import type { ContextoRelatorio, DefinicaoRelatorio, ResultadoRelatorio, Secao } from "@/lib/relatorios/tipos";

// O escopo de LEITURA de atividade não é o mesmo tipo de escopoVisibilidade (EscopoAtividade
// recorta por NOME, não por id — cs.interacoes.autor é texto) — mesmo critério usado em
// app/api/atividade/route.ts e app/api/hm/atividade.
//
// `podeVerTudo` (não `nivelDe(...) === "master"`, achado INFO do pentester 16/08): o gerente
// distribuidor (a Kelly, hoje) enxerga a esteira inteira mesmo sem ser master — checar só o
// nível a deixava com um relatório sub-relatado, o mesmo tipo de "número dela sair errado" que
// já aconteceu antes neste projeto (ver B3, `carteira_usuario_id`).
function escopoAtividadeDe(ctx: ContextoRelatorio): EscopoAtividade {
  if (podeVerTudo(ctx.sessao)) return { modo: "tudo" };
  if (ctx.sessao.equipe_id) return { modo: "equipe", equipeId: ctx.sessao.equipe_id };
  return { modo: "operador", nome: (ctx.sessao as { nome?: string | null }).nome || "" };
}

async function gerar(ctx: ContextoRelatorio): Promise<ResultadoRelatorio> {
  const escopo = escopoAtividadeDe(ctx);
  const [r, automatica] = await Promise.all([
    atividadeHm({ de: ctx.de, ate: ctx.ate, produto: ctx.produto }, escopo),
    // Automação não recorta por nível: robô não é "trabalho de um colega" para esconder de
    // ninguém (ver lib/services/hm-atividade.ts:atividadeAutomaticaHm).
    atividadeAutomaticaHm({ de: ctx.de, ate: ctx.ate, produto: ctx.produto }),
  ]);

  const totalAcoesHumanas = r.colaboradores.reduce((s, c) => s + c.total, 0);

  const secaoTime: Secao = {
    titulo: "Ações do time",
    chamada: "O que cada pessoa registrou no sistema no período — movimentação de card, nota, disparo e demais ações assinadas.",
    colunas: [
      { chave: "colaborador", rotulo: "Colaborador", tipo: "texto", fonte: "cs.interacoes.autor" },
      { chave: "total", rotulo: "Total de ações", tipo: "numero", fonte: "cs.interacoes (contagem)" },
      { chave: "movimentacoes", rotulo: "Mudou de etapa", tipo: "numero", fonte: "cs.interacoes.tipo = 'mudanca_estagio'" },
      { chave: "notas", rotulo: "Notas", tipo: "numero", fonte: "cs.interacoes.tipo = 'nota'" },
      { chave: "disparos", rotulo: "Disparos", tipo: "numero", fonte: "cs.interacoes.tipo = 'disparo'" },
      { chave: "outras", rotulo: "Outras", tipo: "numero", fonte: "cs.interacoes.tipo = 'sistema' (assinado por gente)" },
      { chave: "cards", rotulo: "Cards distintos", tipo: "numero", fonte: "cs.interacoes (contagem distinta de alvo)" },
      { chave: "ultima", rotulo: "Última ação", tipo: "data", fonte: "cs.interacoes.criado_em (máx)" },
    ],
    linhas: r.colaboradores.map((c) => ({
      colaborador: c.colaborador,
      total: c.total,
      movimentacoes: c.movimentacoes,
      notas: c.notas,
      disparos: c.disparos,
      outras: c.outras,
      cards: c.cards,
      ultima: dtHoraBr(c.ultima),
    })),
    totais: { total: totalAcoesHumanas },
  };

  // NUNCA somado à seção acima — pedido explícito: este relatório vira conversa de
  // avaliação com pessoa, e evento automático não é trabalho de ninguém.
  const secaoAutomatica: Secao = {
    titulo: "Eventos automáticos (não é trabalho de ninguém)",
    chamada: "O que o sistema fez sozinho no mesmo período — webhook, automação e rastro legado. Fora do total do time de propósito.",
    colunas: [
      { chave: "autor", rotulo: "Origem", tipo: "texto", fonte: "cs.interacoes.autor" },
      { chave: "rotulo", rotulo: "Tipo", tipo: "selo", fonte: "lib/services/hm-atividade.ts:ROTULO_AUTOR_AUTOMATICO" },
      { chave: "total", rotulo: "Eventos", tipo: "numero", fonte: "cs.interacoes (contagem)" },
    ],
    linhas: automatica.itens.map((i) => ({
      autor: i.autor,
      rotulo: i.rotulo === "automacao" ? "Automação" : "Legado",
      total: i.total,
    })),
    totais: { total: automatica.total },
  };

  return {
    titulo: "Ações do comercial",
    subtitulo: `${ctx.produto ?? "HM"} · ${ctx.de ?? "início"} a ${ctx.ate ?? "hoje"} · ${ctx.protocolo}`,
    destaques: [
      { rotulo: "Colaboradores com ação", valor: String(r.colaboradores.length) },
      { rotulo: "Ações do time", valor: String(totalAcoesHumanas) },
      { rotulo: "Eventos automáticos", valor: String(automatica.total), auxiliar: "não soma ao total do time" },
    ],
    secoes: [secaoTime, secaoAutomatica],
    ressalvas: [
      "Mede o que foi registrado no sistema, não o resultado comercial.",
      "\"Colaborador\" é o nome assinado em cs.interacoes.autor. Medido em produção em 16/08/2026: 20 autores distintos, 0 duplicados em cs.usuarios — hoje é seguro creditar por nome. Se um dia dois usuários passarem a compartilhar o mesmo nome exato, as ações dos dois somam numa única linha (não é atribuída à pessoa errada, mas deixa de separar as duas) — ver cs.interacoes.autor_id (migration 0258), que já resolve por pessoa nos casos inequívocos e existe para o dia em que essa premissa deixar de valer.",
      "Não existe interação nenhuma antes de 08/06/2026 (cs.interacoes, medido). Período que cruza essa data mostra zero ação real, não \"comercial parado\" — é ausência de registro, não ausência de trabalho.",
    ],
    fontes: ["cs.interacoes", "lib/services/hm-atividade.ts:atividadeHm", "lib/services/hm-atividade.ts:atividadeAutomaticaHm"],
  };
}

export const acoesDoComercial: DefinicaoRelatorio = {
  id: "acoes-do-comercial",
  nome: "Relatório diário das ações do comercial",
  descricao: "O que cada colaborador registrou no sistema no período, separado do que o sistema fez sozinho.",
  params: ["periodo", "produto"],
  portais: ["HM", "AURUM", "ETHB"],
  gerar,
};
