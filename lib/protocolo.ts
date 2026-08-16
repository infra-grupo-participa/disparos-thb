import type { PoolClient } from "pg";
import { query, queryOne, withTransaction } from "@/lib/db";
import { escopoVisibilidade, podeVerTudo, podeAcessarPortal, type Ator } from "@/lib/papeis";
import type { ContextoRelatorio, DefinicaoRelatorio, ResultadoRelatorio } from "@/lib/relatorios/tipos";

// ============================================================================
// O helper ÚNICO de burocracia (migration 0258). `cs.interacoes` proíbe registrar ação sem
// pessoa como alvo (`interacoes_alvo_unico`, 0028) — então nada do que NÃO tem pessoa como
// alvo é registrado hoje: emitir relatório, importar planilha, ativar/desativar oferta,
// mudar equipe, exportar XLSX. Se cada rota escrevesse em cs.protocolo_operacao por conta
// própria, metade ia esquecer em duas semanas — é por isso que existe um arquivo só.
// ============================================================================

export type AcaoProtocolo =
  | "relatorio.emitir"
  | "oferta.importar"
  | "oferta.promover"
  | "oferta.ativar"
  | "oferta.desativar"
  | "oferta.editar"
  | "equipe.editar";

type AtorComNome = Ator & { nome?: string | null };

/** Grava 1 linha em cs.protocolo_operacao. Aceita um `client` de transação (para nascer
 *  junto de outra escrita, como a emissão de relatório abaixo) — sem ele, usa o pool direto. */
export async function registrarProtocolo(
  args: {
    acao: AcaoProtocolo;
    alvoTipo?: string | null;
    alvoId?: string | null;
    detalhe?: Record<string, unknown>;
    portal?: string | null;
  },
  sessao: AtorComNome,
  client?: PoolClient,
): Promise<void> {
  const sql = `insert into cs.protocolo_operacao (acao, alvo_tipo, alvo_id, detalhe, autor, autor_id, portal)
               values ($1,$2,$3,$4::jsonb,$5,$6,$7)`;
  const params = [
    args.acao,
    args.alvoTipo ?? null,
    args.alvoId ?? null,
    JSON.stringify(args.detalhe ?? {}),
    sessao.nome || sessao.id,
    sessao.id,
    args.portal ?? null,
  ];
  if (client) await client.query(sql, params);
  else await query(sql, params);
}

/**
 * Numeração estável e verificável: `PORTAL-AAAAMMDD-NNNN`, sequencial por dia×portal.
 * PRECISA rodar dentro da MESMA transação da INSERT em cs.relatorio_emitido — o lock é de
 * transação (`pg_advisory_xact_lock`) e libera sozinho no commit/rollback, então dois POSTs
 * simultâneos do mesmo portal/dia nunca saem com o mesmo número (o segundo espera o primeiro
 * commitar e conta 1 a mais).
 */
export async function proximoProtocolo(portal: string, client: PoolClient): Promise<string> {
  const dia = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  await client.query("select pg_advisory_xact_lock(hashtextextended($1, 0))", [`protocolo:${portal}:${dia}`]);
  const { rows } = await client.query<{ n: number }>(
    `select count(*)::int as n from cs.relatorio_emitido where protocolo like $1`,
    [`${portal}-${dia}-%`],
  );
  const seq = String((rows[0]?.n ?? 0) + 1).padStart(4, "0");
  return `${portal}-${dia}-${seq}`;
}

/**
 * Gera, numera e PROTOCOLA um relatório — numeração + gravação em cs.relatorio_emitido +
 * cs.protocolo_operacao acontecem na MESMA transação: ou os três nascem juntos, ou nenhum
 * nasce. `def.gerar` roda DEPOIS de reservado o protocolo (para poder carimbar o número na
 * própria folha) mas ANTES do commit — se `gerar` lançar, a transação desfaz e o número
 * nunca aparece "usado" sem relatório correspondente.
 */
export async function emitirRelatorio(
  def: DefinicaoRelatorio,
  ctx: Omit<ContextoRelatorio, "protocolo">,
  opts: { portal: string },
): Promise<{ protocolo: string; resultado: ResultadoRelatorio }> {
  return withTransaction(async (client) => {
    const protocolo = await proximoProtocolo(opts.portal, client);
    const resultado = await def.gerar({ ...ctx, protocolo });

    // O portão do §4.1 (tipos.ts): todo relatório declara o que NÃO afirma. Vazio é bug do
    // gerador, não dado de produção — falha aqui, não em silêncio.
    if (!resultado.ressalvas.length) {
      throw new Error(`relatorio '${def.id}' gerou sem ressalvas — todo relatorio declara o que nao afirma`);
    }

    const linhas = resultado.secoes.reduce((s, sec) => s + sec.linhas.length, 0);
    const escopo = escopoVisibilidade(ctx.sessao).modo;
    const nome = (ctx.sessao as AtorComNome).nome || String(ctx.sessao.id);

    await client.query(
      `insert into cs.relatorio_emitido
         (protocolo, tipo, produto, de, ate, params, escopo, emitido_por, emitido_por_id, emitido_por_equipe_id, linhas, conteudo)
       values ($1,$2,$3,$4,$5,$6::jsonb,$7,$8,$9,$10,$11,$12::jsonb)`,
      [
        protocolo,
        def.id,
        ctx.produto,
        ctx.de,
        ctx.ate,
        JSON.stringify({ de: ctx.de, ate: ctx.ate, produto: ctx.produto }),
        escopo,
        nome,
        ctx.sessao.id,
        // CONGELADA no instante da emissão (0261) — nunca lida ao vivo na reabertura. Achado
        // ALTO do pentester: ler `cs.usuarios.equipe_id` na hora de reabrir autorizava pela
        // equipe DE HOJE do emissor, não a de quando ele gerou o relatório.
        ctx.sessao.equipe_id,
        linhas,
        JSON.stringify(resultado),
      ],
    );

    await registrarProtocolo(
      {
        acao: "relatorio.emitir",
        alvoTipo: "relatorio",
        alvoId: protocolo,
        detalhe: { tipo: def.id, linhas, de: ctx.de, ate: ctx.ate, produto: ctx.produto },
        portal: opts.portal,
      },
      ctx.sessao as AtorComNome,
      client,
    );

    return { protocolo, resultado };
  });
}

type LinhaRelatorioEmitido = {
  conteudo: ResultadoRelatorio;
  escopo: "tudo" | "equipe" | "operador";
  emitido_por: string;
  emitido_por_id: string | null;
  emitido_em: string;
  tipo: string;
  produto: string | null;
  emitido_por_equipe_id: string | null;
};

export type BuscaRelatorioEmitido =
  | {
      ok: true;
      resultado: ResultadoRelatorio;
      meta: { tipo: string; emitido_por: string; emitido_em: string; escopo: string };
    }
  | { ok: false; motivo: "nao_encontrado" | "sem_permissao" };

/**
 * O conteúdo CONGELADO de um relatório já emitido. Nunca regenera — é sempre 1 select por
 * PK. Quem pode ver decide pelo ESCOPO gravado na linha e pelo PORTAL do relatório, NUNCA
 * pela sessão de agora reavaliada contra o dado vivo:
 *   · escopo 'tudo'     → quem TEM visão de tudo agora (master ou gerente_distribuidor).
 *   · escopo 'equipe'   → o próprio emissor, ou quem está na MESMA equipe que o emissor
 *                         TINHA ao emitir (nunca null===null — mesmo critério de paramsEscopo
 *                         em lib/papeis.ts: pessoa sem equipe não "casa" com outra sem equipe).
 *   · escopo 'operador' → só o próprio emissor.
 * Em todos os casos, a conta também precisa ter o PORTAL do relatório na whitelist (0145) —
 * um protocolo do AURUM não abre para quem não tem o portal AURUM, ainda que veja "tudo" no HM.
 */
export async function buscarRelatorioEmitido(protocolo: string, sessao: Ator): Promise<BuscaRelatorioEmitido> {
  // `emitido_por_equipe_id` é a equipe CONGELADA no instante da emissão (coluna própria,
  // gravada por emitirRelatorio — migration 0261), nunca a equipe atual do emissor. Achado do
  // pentester (16/08): um `left join cs.usuarios` lendo `equipe_id` ao vivo autorizava pela
  // equipe de HOJE — se o emissor trocasse de equipe, os colegas novos passavam a ler a folha
  // com dinheiro e nome de aluno da equipe antiga, e os colegas antigos perdiam o acesso que
  // deveriam manter. O escopo gravado tem que decidir com o dado que existia NA HORA.
  const row = await queryOne<LinhaRelatorioEmitido>(
    `select r.conteudo, r.escopo, r.emitido_por, r.emitido_por_id, r.emitido_em, r.tipo, r.produto,
            r.emitido_por_equipe_id
       from cs.relatorio_emitido r
      where r.protocolo = $1`,
    [protocolo],
  );
  if (!row) return { ok: false, motivo: "nao_encontrado" };

  if (!podeAcessarPortal(sessao.portais, row.produto || "HM")) return { ok: false, motivo: "sem_permissao" };

  const autorizado =
    podeVerTudo(sessao) ||
    (row.escopo === "operador" && row.emitido_por_id === sessao.id) ||
    (row.escopo === "equipe" &&
      (row.emitido_por_id === sessao.id ||
        (sessao.equipe_id !== null && sessao.equipe_id === row.emitido_por_equipe_id)));
  if (!autorizado) return { ok: false, motivo: "sem_permissao" };

  return {
    ok: true,
    resultado: row.conteudo,
    meta: { tipo: row.tipo, emitido_por: row.emitido_por, emitido_em: String(row.emitido_em), escopo: row.escopo },
  };
}
