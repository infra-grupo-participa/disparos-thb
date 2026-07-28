import { NextResponse } from "next/server";
import { guard } from "@/lib/guard";
import { query, queryOne } from "@/lib/db";
import { parseBody, ContatoPatchSchema } from "@/lib/validators";
import { eventoDe } from "@/lib/services/evento";
import { moverEstagio, setTags, setOptOut, podeVerContato, podeAgirContato, atribuirResponsavel, type DestinoAtribuicao } from "@/lib/services/contato";

export const runtime = "nodejs";

// GET: detalhe do contato HT + estado de CS + timeline.
export async function GET(req: Request, { params }: { params: { id: string } }) {
  const g = await guard({ portal: eventoDe(req) });
  if (!g.ok) return g.res;
  const compradorId = params.id;
  // Filtra pelo evento do portal atual: uma pessoa pode existir em mais de um
  // evento (HT+SEM…) na view; sem o filtro, a linha vinha arbitrária e podia
  // abrir o contato de OUTRO portal (isolamento de portais, 27/07).
  const evento = eventoDe(req);
  // Gate de LEITURA (28/07, leitura ≠ ação): a ficha ABRE para quem VÊ o card
  // nas listagens — inclusive o operador abrindo o card de um colega da equipe
  // (em leitura; a escrita é o podeAgirContato do PATCH).
  if (!(await podeVerContato(g.sessao, compradorId, evento))) {
    return NextResponse.json({ ok: false, reason: "sem_acesso" }, { status: 403 });
  }

  const contato = await queryOne(
    `select v.comprador_id, v.nome, v.email, v.telefone, v.edicao, v.ultima_compra_ht,
            v.estagio_chave, v.estagio_nome, v.responsavel,
            v.responsavel_id, v.equipe_id, v.equipe_nome, v.proxima_acao_em,
            v.proxima_acao_nota, v.ultima_resposta_em, v.ultimo_contato_em, v.observacoes,
            v.edicao_ht, v.legado_ativado, v.legado_sla_h, v.legado_ativacao_em,
            v.legado_no_grupo, v.legado_pesquisa, v.legado_ja_ht, v.legado_qtd_ht,
            v.legado_ja_hm, v.legado_e_aluno, v.legado_instrucao, v.primeiro_contato_em,
            v.legado_t_primeiro_contato_h, v.legado_t_ativacao_h,
            ct.tags, ct.opt_out, ct.opt_out_em
       from cs.contatos_evento v
       -- ct.evento = v.evento: cs.contatos tem uma linha por (comprador, evento);
       -- sem o filtro, tags/opt_out podiam vir da linha de OUTRO portal.
       left join cs.contatos ct on ct.comprador_id = v.comprador_id and ct.evento = v.evento
      where v.comprador_id = $1 and v.evento = $2`,

    [compradorId, evento],
  );
  if (!contato) return NextResponse.json({ ok: false, reason: "não encontrado" }, { status: 404 });

  // Acordo e crédito (0149) em query SEPARADA e blindada: o deploy sobe no push
  // e a migration é aplicada à mão — enquanto as colunas não existirem (42703),
  // os campos voltam null e a ficha continua abrindo (padrão do cache 0147 em
  // inbox/[id]). Remover o try/catch quando a 0149 estiver aplicada.
  let acordoCredito: Record<string, unknown> = {
    acordo: null, pagamento_previsto_em: null,
    credito_oferta: null, credito_compra_em: null, credito_valor_pago: null,
  };
  try {
    const ac = await queryOne(
      `select acordo, pagamento_previsto_em, credito_oferta, credito_compra_em, credito_valor_pago
         from cs.contatos where comprador_id = $1 and evento = $2`,
      [compradorId, evento],
    );
    if (ac) acordoCredito = ac;
  } catch {
    /* pré-0149: colunas ainda não existem — campos seguem null */
  }

  const timeline = await query(
    `select i.tipo, i.descricao, i.autor, i.criado_em
       from cs.interacoes i
       join cs.contatos c on c.id = i.contato_id
      where c.comprador_id = $1
      order by i.criado_em desc
      limit 200`,
    [compradorId],
  );

  // Métricas de disparo do contato (acesso rápido no card/painel do Kanban).
  const metricas = await queryOne(
    `select
        count(*) filter (where enviado)::int   as disparos_recebidos,
        count(*) filter (where respondeu)::int as disparos_respondidos,
        round(avg(sla_minutos) filter (where respondeu))::int as sla_medio,
        max(respondeu_em) as ultima_resposta_disparo
       from cs.disparo_contatos
      where comprador_id = $1`,
    [compradorId],
  );

  // Respostas dos formulários (Matrícula / Ficha de Interesse HM).
  const formularios = await query(
    `select tipo, respostas, pontuacao, respondido_em
       from cs.formularios where comprador_id = $1
      order by respondido_em desc nulls last`,
    [compradorId],
  );

  // Termômetro de lead (score 0-100).
  const score = await queryOne<{ score: number }>(
    `select score from cs.lead_scores where comprador_id = $1`,
    [compradorId],
  );

  // Engajamento de e-mail (ActiveCampaign), sincronizado por pessoa. Pode ser
  // null se o contato ainda não foi sincronizado pelo cron.
  const emailAc = await queryOne(
    `select encontrado, recebidos, abriu_em, clicou_em, bounce_hard, bounce_soft, sincronizado_em
       from cs.email_contato where comprador_id = $1`,
    [compradorId],
  );

  return NextResponse.json({ ok: true, contato: { ...contato, ...acordoCredito }, timeline, metricas, formularios, score: score?.score ?? 0, emailAc });
}

// PATCH: atualiza estágio / próxima ação / observações / acordo e crédito;
// opcionalmente adiciona uma nota.
//
// ===== CONTRATO — Acordo e crédito (0149; o front monta a ficha contra isto) =
// Campos do body (todos opcionais; enviar só o que mudou; "" ou null LIMPAM):
//   acordo:                string|null  — o combinado com o cliente, texto livre
//                          (ex.: "12x no boleto, a partir do dia 15"). Mesmo
//                          nome/semântica do HM (cs.contatos_hm.acordo, 0056).
//   pagamento_previsto_em: "YYYY-MM-DD"|""|null — data prevista do pagamento
//                          combinado (date, sem hora; formato validado: outro
//                          formato → 400 do zod).
//   credito_oferta:        string|null  — de onde vem o crédito/saldo (nome da
//                          oferta ou compra anterior, ex.: "Renovação 2026").
//   credito_compra_em:     "YYYY-MM-DD"|""|null — data da compra que gerou o
//                          crédito.
//   credito_valor_pago:    number|null (>= 0) — quanto o cliente pagou = o
//                          SALDO a descontar na oferta. Nos genéricos não há
//                          pró-rata (isso é regra do HM): o valor não se
//                          consome com o tempo.
// GET desta rota devolve os 5 campos DENTRO de `contato` (null enquanto a
// migration 0149 não estiver aplicada). Se o PATCH receber esses campos ANTES
// da 0149 estar em produção, o resto do PATCH aplica normalmente e a resposta
// vem com `aviso: "acordo_nao_salvo_migration_pendente"` — nada estoura.
// Anotações NÃO têm campo novo: `observacoes` (texto corrido da ficha) e
// `nota` (entrada na timeline, cs.interacoes tipo 'nota') já cobrem.
// ============================================================================
export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  // Portal do evento RESOLVIDO (cookie/query) contra a whitelist da conta (0145).
  const evento = eventoDe(req);
  const g = await guard({ portal: evento });
  if (!g.ok) return g.res;
  const sessao = g.sessao;
  const operador = sessao.nome || "cs";
  const compradorId = params.id;
  const parsed = await parseBody(req, ContatoPatchSchema);
  if (!parsed.ok) return parsed.res;
  const b = parsed.data;

  // Gate de AÇÃO (28/07, leitura ≠ ação): editar é ESCRITA — operador só no
  // pool e nos cards DELE. A ficha do colega abre em leitura (GET), mas o PATCH
  // recusa com 403 'card_de_outro_operador' (o front traduz o reason).
  const acao = await podeAgirContato(sessao, compradorId, evento);
  if (acao !== "ok") {
    return NextResponse.json({ ok: false, reason: acao }, { status: 403 });
  }

  // TODA escrita abaixo é escopada pelo MESMO `evento` validado no guard: a
  // linha de cs.contatos é por (comprador, evento) e o PATCH de um portal não
  // pode escrever na linha de outro (isolamento de portais).
  // mudança de estágio (com log na timeline) — via serviço de contato
  if (b.estagio_chave) await moverEstagio(compradorId, evento, b.estagio_chave, operador);

  // campos de follow-up / observações (atualiza só os enviados)
  await query(
    `update cs.contatos
        set proxima_acao_em  = case when $2::text is not null then nullif($2,'')::timestamptz else proxima_acao_em end,
            proxima_acao_nota = coalesce($3, proxima_acao_nota),
            observacoes       = coalesce($4, observacoes),
            atualizado_em     = now()
      where comprador_id = $1 and evento = $5`,
    [
      compradorId,
      b.proxima_acao_em === undefined ? null : (b.proxima_acao_em ?? ""),
      b.proxima_acao_nota ?? null,
      b.observacoes ?? null,
      evento,
    ],
  );

  // Acordo e crédito (0149) — atualiza só os enviados ("" limpa), em UPDATE
  // SEPARADO e blindado: enquanto a 0149 não estiver aplicada as colunas não
  // existem (42703) e este bloco degrada com `aviso` na resposta, sem derrubar
  // o resto do PATCH (padrão 0147). Remover o try/catch quando aplicada.
  let aviso: string | undefined;
  {
    const setsAc: string[] = [];
    const valsAc: unknown[] = [compradorId, evento];
    const addAc = (col: string, v: unknown, cast = "") => {
      valsAc.push(v === "" ? null : v);
      setsAc.push(`${col} = $${valsAc.length}${cast}`);
    };
    if (b.acordo !== undefined) addAc("acordo", b.acordo);
    if (b.pagamento_previsto_em !== undefined) addAc("pagamento_previsto_em", b.pagamento_previsto_em, "::date");
    if (b.credito_oferta !== undefined) addAc("credito_oferta", b.credito_oferta);
    if (b.credito_compra_em !== undefined) addAc("credito_compra_em", b.credito_compra_em, "::date");
    if (b.credito_valor_pago !== undefined) addAc("credito_valor_pago", b.credito_valor_pago);
    if (setsAc.length) {
      try {
        await query(
          `update cs.contatos set ${setsAc.join(", ")}, atualizado_em = now()
            where comprador_id = $1 and evento = $2`,
          valsAc,
        );
      } catch {
        aviso = "acordo_nao_salvo_migration_pendente";
      }
    }
  }

  // tags / responsável / opt-out (atualiza só os campos enviados) — via serviço
  if (b.tags !== undefined) await setTags(compradorId, evento, b.tags);
  // Responsável pela HIERARQUIA (atribuirResponsavel, 0146) — o análogo do furo 5
  // que o HM fechou: o texto livre por nome contornava toda a regra de equipes.
  //   master → qualquer um; gestor → só membro da própria equipe; operador → só
  //   assume p/ si do pool / devolve o que é dele. Mesmos reasons do HM.
  if (b.responsavel !== undefined) {
    const destino: DestinoAtribuicao = (b.responsavel ?? "").trim() === ""
      ? { tipo: "pool" }
      : { tipo: "nome", nome: (b.responsavel as string).trim() };
    const r = await atribuirResponsavel(sessao, compradorId, destino, evento, operador);
    if (!r.ok) {
      const status = r.reason === "nao_encontrado" ? 404 : r.reason === "destino_invalido" ? 400 : 403;
      return NextResponse.json({ ok: false, reason: r.reason }, { status });
    }
  }
  if (b.opt_out !== undefined) await setOptOut(compradorId, evento, b.opt_out);

  // nota manual na timeline — na linha DESTE evento (sem o filtro, entrava uma
  // nota por portal em que o comprador existe).
  if (b.nota && b.nota.trim()) {
    await query(
      `insert into cs.interacoes (contato_id, tipo, descricao, autor)
       select id, 'nota', $2, $3 from cs.contatos where comprador_id = $1 and evento = $4`,
      [compradorId, b.nota.trim(), operador, evento],
    );
  }

  return NextResponse.json(aviso ? { ok: true, aviso } : { ok: true });
}
