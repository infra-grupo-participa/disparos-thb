import { NextResponse } from "next/server";
import { guard } from "@/lib/guard";
import { query, queryOne } from "@/lib/db";
import { parseBody, ContatoPatchSchema } from "@/lib/validators";
import { eventoDe } from "@/lib/services/evento";
import { moverEstagio, setTags, setOptOut, podeVerContato, atribuirResponsavel, type DestinoAtribuicao } from "@/lib/services/contato";

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
  // Gating de equipe (0146): a lista não mostra, a ficha não abre — sem isto o
  // recorte da listagem era cosmético (bastava forçar o comprador_id aqui).
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
       left join cs.contatos ct on ct.comprador_id = v.comprador_id
      where v.comprador_id = $1 and v.evento = $2`,

    [compradorId, evento],
  );
  if (!contato) return NextResponse.json({ ok: false, reason: "não encontrado" }, { status: 404 });

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

  return NextResponse.json({ ok: true, contato, timeline, metricas, formularios, score: score?.score ?? 0, emailAc });
}

// PATCH: atualiza estágio / próxima ação / observações; opcionalmente adiciona uma nota.
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

  // Gating de equipe (0146): só mexe no contato quem pode vê-lo (pool / própria
  // equipe / os dele). O análogo do podeVerCardHm do PATCH da ficha HM.
  if (!(await podeVerContato(sessao, compradorId, evento))) {
    return NextResponse.json({ ok: false, reason: "sem_acesso" }, { status: 403 });
  }

  // mudança de estágio (com log na timeline) — via serviço de contato
  if (b.estagio_chave) await moverEstagio(compradorId, b.estagio_chave, operador);

  // campos de follow-up / observações (atualiza só os enviados)
  await query(
    `update cs.contatos
        set proxima_acao_em  = case when $2::text is not null then nullif($2,'')::timestamptz else proxima_acao_em end,
            proxima_acao_nota = coalesce($3, proxima_acao_nota),
            observacoes       = coalesce($4, observacoes),
            atualizado_em     = now()
      where comprador_id = $1`,
    [
      compradorId,
      b.proxima_acao_em === undefined ? null : (b.proxima_acao_em ?? ""),
      b.proxima_acao_nota ?? null,
      b.observacoes ?? null,
    ],
  );

  // tags / responsável / opt-out (atualiza só os campos enviados) — via serviço
  if (b.tags !== undefined) await setTags(compradorId, b.tags);
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
  if (b.opt_out !== undefined) await setOptOut(compradorId, b.opt_out);

  // nota manual na timeline
  if (b.nota && b.nota.trim()) {
    await query(
      `insert into cs.interacoes (contato_id, tipo, descricao, autor)
       select id, 'nota', $2, $3 from cs.contatos where comprador_id = $1`,
      [compradorId, b.nota.trim(), operador],
    );
  }

  return NextResponse.json({ ok: true });
}
