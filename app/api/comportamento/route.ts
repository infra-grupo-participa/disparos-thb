import { NextResponse } from "next/server";
import { isAuthed } from "@/lib/auth";
import { query, queryOne } from "@/lib/db";
import { eventoDe } from "@/lib/services/evento";
import { metaAssunto, extrairPalavrasChave } from "@/lib/classificar";

export const runtime = "nodejs";

// Inteligência de comportamento dos leads. Lê cs.lead_mensagens (populada pela
// sincronização da Unnichat) e devolve as métricas executivas. As agregações que
// dependem de prioridade/extração de texto são feitas em JS; onboarding e funil
// vêm de SQL direto (outras tabelas).

const CATEGORIA_LABEL: Record<string, string> = {
  agradecimento: "Agradecendo",
  pergunta: "Perguntando",
  confirmacao: "Confirmando",
  objecao: "Objeção / atrito",
  saudacao: "Saudação",
  outro: "Outros",
};

type MsgRow = {
  telefone_norm: string;
  assunto: string | null;
  categoria: string | null;
  sentimento: string | null;
  texto: string | null;
  enviada_em: string | null;
};

export async function GET(req: Request) {
  if (!isAuthed()) return NextResponse.json({ ok: false }, { status: 401 });

  const edicao = new URL(req.url).searchParams.get("edicao") || null;
  const evento = eventoDe(req);
  const f = [edicao, evento];

  // 1) Onboarding (≤30d) x Ongoing (>30d) — base com data de compra (HT). No
  // Seminário não há compra, então estes números ficam naturalmente zerados.
  const ciclo = await queryOne<{ onboarding: number; ongoing: number; total: number }>(
    `select
        count(*) filter (where ultima_compra_ht >= now() - interval '30 days')::int as onboarding,
        count(*) filter (where ultima_compra_ht <  now() - interval '30 days')::int as ongoing,
        count(*)::int as total
       from cs.contatos_evento
      where evento = $2 and ultima_compra_ht is not null
        and ($1::text is null or edicao = $1)`,
    f,
  );

  // 1b) Engajamento: no grupo, formulários respondidos e distribuição do termômetro.
  const engajamento = await queryOne<{ total: number; no_grupo: number; matricula: number; ficha_hm: number; quentes: number; mornos: number }>(
    `select
        count(*)::int as total,
        count(*) filter (where (coalesce(ct.tags, '{}'::text[]) && array['No grupo'] or coalesce(h.legado_no_grupo, false)))::int as no_grupo,
        count(fm.comprador_id)::int as matricula,
        count(ff.comprador_id)::int as ficha_hm,
        count(*) filter (where ls.score >= 60)::int as quentes,
        count(*) filter (where ls.score >= 30 and ls.score < 60)::int as mornos
       from cs.contatos_evento h
       left join cs.contatos ct on ct.comprador_id = h.comprador_id and ct.evento = h.evento
       left join cs.formularios fm on fm.comprador_id = h.comprador_id and fm.tipo = 'matricula'
       left join cs.formularios ff on ff.comprador_id = h.comprador_id and ff.tipo = 'ficha_hm'
       left join cs.lead_scores ls on ls.comprador_id = h.comprador_id
      where h.evento = $2 and ($1::text is null or h.edicao = $1)`,
    f,
  );

  // 2) Funil — distribuição atual por estágio.
  const funil = await query<{ chave: string; nome: string; cor: string | null; qtd: number }>(
    `select e.chave, e.nome, e.cor, count(ct.id)::int as qtd
       from cs.estagios e
       left join cs.contatos ct on ct.estagio_id = e.id and ct.evento = $2
        and ($1::text is null or ct.comprador_id in (select comprador_id from cs.contatos_evento where evento = $2 and edicao = $1))
      where e.ativo and e.evento = $2
      group by e.id, e.chave, e.nome, e.cor, e.ordem
      order by e.ordem`,
    f,
  );

  // 3) Mensagens de lead (para assunto dominante, horário, categoria, sentimento, palavras-chave).
  const msgs = await query<MsgRow>(
    `select m.telefone_norm, m.assunto, m.categoria, m.sentimento, m.texto, m.enviada_em
       from cs.lead_mensagens m
      where m.direcao = 'lead'
        and exists (
              select 1 from cs.contatos_evento h
               where h.comprador_id = m.comprador_id and h.evento = $2
                 and ($1::text is null or h.edicao = $1))`,
    f,
  );

  // --- Conversas por assunto (assunto dominante de cada lead = maior prioridade) ---
  const assuntoPorLead = new Map<string, { chave: string; prio: number }>();
  const horas = new Array(24).fill(0);
  const categorias = new Map<string, number>();
  const sentimentos = { positivo: 0, neutro: 0, negativo: 0 };
  const palavras = new Map<string, number>();

  for (const m of msgs) {
    // Assunto dominante por lead (menor prioridade numérica vence).
    if (m.assunto) {
      const meta = metaAssunto(m.assunto);
      const atual = assuntoPorLead.get(m.telefone_norm);
      if (!atual || meta.prioridade < atual.prio) {
        assuntoPorLead.set(m.telefone_norm, { chave: m.assunto, prio: meta.prioridade });
      }
    }
    // Horário do dia (BR = UTC-3 fixo).
    if (m.enviada_em) {
      const h = (new Date(m.enviada_em).getUTCHours() - 3 + 24) % 24;
      horas[h]++;
    }
    // Categoria de resposta.
    if (m.categoria) categorias.set(m.categoria, (categorias.get(m.categoria) || 0) + 1);
    // Sentimento.
    if (m.sentimento && m.sentimento in sentimentos) sentimentos[m.sentimento as keyof typeof sentimentos]++;
    // Palavras-chave das mensagens que "colaram" (positivas / engajamento / prova social).
    const colou = m.sentimento === "positivo" || ["elogio", "prova_social", "compromisso", "desafio_trilha"].includes(m.assunto || "");
    if (colou && m.texto) {
      for (const w of extrairPalavrasChave(m.texto)) palavras.set(w, (palavras.get(w) || 0) + 1);
    }
  }

  const totalConversas = assuntoPorLead.size;
  const porAssunto = [...assuntoPorLead.values()].reduce((acc, v) => {
    acc.set(v.chave, (acc.get(v.chave) || 0) + 1);
    return acc;
  }, new Map<string, number>());

  const conversasPorAssunto = [...porAssunto.entries()]
    .map(([chave, conversas]) => {
      const meta = metaAssunto(chave);
      return { chave, label: meta.label, emoji: meta.emoji, conversas, pct: totalConversas ? Math.round((conversas / totalConversas) * 1000) / 10 : 0 };
    })
    .sort((a, b) => b.conversas - a.conversas);

  const categoriasResp = [...categorias.entries()]
    .map(([chave, qtd]) => ({ chave, label: CATEGORIA_LABEL[chave] || chave, qtd }))
    .sort((a, b) => b.qtd - a.qtd);

  const palavrasChave = [...palavras.entries()]
    .map(([palavra, qtd]) => ({ palavra, qtd }))
    .sort((a, b) => b.qtd - a.qtd)
    .slice(0, 24);

  // Pico de horário (faixa de 3 melhores horas consecutivas é ruído com pouco dado;
  // devolvemos a melhor hora isolada e o total por hora para o gráfico).
  const melhorHora = horas.reduce((best, q, h) => (q > horas[best] ? h : best), 0);

  // Meta do sync para o usuário saber a frescura dos dados.
  const sync = await queryOne<{ ultima: string | null; contatos: number; pendentes: number }>(
    `select max(ultima_sincronizacao) as ultima,
            count(*) filter (where ultima_sincronizacao is not null)::int as contatos,
            (select count(*)::int from cs.contatos_evento h
              left join cs.sync_conversas s on s.telefone_norm = h.telefone
             where h.evento = $1 and h.telefone is not null and s.ultima_sincronizacao is null) as pendentes
       from cs.sync_conversas`,
    [evento],
  );

  return NextResponse.json({
    ok: true,
    ciclo: ciclo ?? { onboarding: 0, ongoing: 0, total: 0 },
    engajamento: engajamento ?? { total: 0, no_grupo: 0, matricula: 0, ficha_hm: 0, quentes: 0, mornos: 0 },
    funil,
    totalConversas,
    totalMensagens: msgs.length,
    conversasPorAssunto,
    categoriasResp,
    sentimentos,
    horas,
    melhorHora,
    palavrasChave,
    sync: sync ?? { ultima: null, contatos: 0, pendentes: 0 },
  });
}
