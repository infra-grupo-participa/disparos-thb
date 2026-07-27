import { NextResponse } from "next/server";
import { guard } from "@/lib/guard";
import { query, queryOne } from "@/lib/db";
import { createContact, getContactMessages, sendMessage, type CanalCfg } from "@/lib/unnichat";
import { getCanal } from "@/lib/services/canais";
import { normalizePhone } from "@/lib/phone";
import { parseBody, InboxMsgSchema, InboxStatusSchema } from "@/lib/validators";
import { podeVerCardHm } from "@/lib/services/hm";

export const runtime = "nodejs";
export const maxDuration = 60;

// Inbox do HM — thread de uma conversa. Espelha app/api/inbox/[id] mas no overlay
// isolado: o contato vem de cs.contatos_hm_kanban (evento fixo HM), o estado vive
// em cs.contatos_hm e a timeline em cs.interacoes.contato_hm_id. O canal é o do
// evento 'HM'. GATING por operador (podeVerCardHm): não abre/envia conversa de
// card de outra pessoa (403).

type ContatoHm = { comprador_id: string; nome: string; telefone: string | null };

// Id do contato na Unnichat: do disparo mais recente (já guardado) ou via
// createContact (idempotente pelo telefone). Igual ao inbox genérico.
async function resolverContactId(c: ContatoHm, cfg: CanalCfg): Promise<string | null> {
  const existente = await queryOne<{ unnichat_contact_id: string }>(
    `select unnichat_contact_id from cs.disparo_contatos
      where comprador_id = $1 and unnichat_contact_id is not null
      order by enviado_em desc nulls last limit 1`,
    [c.comprador_id],
  );
  if (existente?.unnichat_contact_id) return existente.unnichat_contact_id;
  const tel = normalizePhone(c.telefone);
  if (!tel) return null;
  const r = await createContact({ name: c.nome || tel, phone: tel, cfg });
  return r.contactId ?? null;
}

async function carregarContatoHm(id: string): Promise<ContatoHm | null> {
  return queryOne<ContatoHm>(
    `select comprador_id, nome, telefone from cs.contatos_hm_kanban where comprador_id = $1`,
    [id],
  );
}

// GET — carrega a conversa (mensagens trocadas) do contato com a Unnichat.
export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const g = await guard({ portal: "HM" });
  if (!g.ok) return g.res;
  const sessao = g.sessao;
  if (!(await podeVerCardHm(sessao, params.id))) {
    return NextResponse.json({ ok: false, reason: "sem_acesso" }, { status: 403 });
  }

  const c = await carregarContatoHm(params.id);
  if (!c) return NextResponse.json({ ok: false, reason: "contato não encontrado" }, { status: 404 });

  const canal = await getCanal("HM");
  const contactId = await resolverContactId(c, canal);
  if (!contactId) {
    return NextResponse.json({ ok: true, contato: c, mensagens: [], aviso: "Contato sem registro na Unnichat ainda." });
  }

  const { messages } = await getContactMessages(contactId, canal);
  const mensagens = messages.map((m) => {
    const ehLead = String(m.senderBy || "").toLowerCase() === "contact";
    const origem = ehLead ? "lead" : m.type === "template" ? "template" : "equipe";
    return {
      id: m.id,
      de: ehLead ? "lead" : "cs",
      origem,
      senderBy: m.senderBy ?? null,
      tipo: m.type,
      texto: m.type === "template" ? (m.text || "[template enviado]") : m.text,
      data: m.date ?? null,
    };
  });

  // Janela de 24h da Meta (texto livre só até 24h após a última msg do lead).
  const JANELA_MS = 24 * 60 * 60 * 1000;
  const ultimaEntradaMs = messages.reduce((max, m) => {
    if (m.senderBy !== "contact" || !m.date) return max;
    const t = new Date(m.date).getTime();
    return Number.isFinite(t) && t > max ? t : max;
  }, 0);
  const janelaAberta = ultimaEntradaMs > 0 && Date.now() - ultimaEntradaMs < JANELA_MS;
  const janela = {
    aberta: janelaAberta,
    ultimaEntrada: ultimaEntradaMs > 0 ? new Date(ultimaEntradaMs).toISOString() : null,
    expiraEm: ultimaEntradaMs > 0 ? new Date(ultimaEntradaMs + JANELA_MS).toISOString() : null,
  };

  return NextResponse.json({ ok: true, contato: c, mensagens, janela });
}

// POST — envia texto livre ao contato (dentro da janela de 24h).
export async function POST(req: Request, { params }: { params: { id: string } }) {
  const g = await guard({ portal: "HM" });
  if (!g.ok) return g.res;
  const sessao = g.sessao;
  if (!(await podeVerCardHm(sessao, params.id))) {
    return NextResponse.json({ ok: false, reason: "sem_acesso" }, { status: 403 });
  }

  const p = await parseBody(req, InboxMsgSchema);
  if (!p.ok) return p.res;
  const texto = p.data.texto.trim();

  const c = await carregarContatoHm(params.id);
  if (!c) return NextResponse.json({ ok: false, reason: "contato não encontrado" }, { status: 404 });

  // Opt-out do overlay HM: quem pediu para parar, parou.
  const bloqueado = await queryOne<{ opt_out: boolean }>(
    `select opt_out from cs.contatos_hm where comprador_id = $1`,
    [c.comprador_id],
  );
  if (bloqueado?.opt_out) {
    return NextResponse.json(
      { ok: false, reason: "contato_opt_out", motivo: "Este contato pediu para não receber mensagens. Desfaça o opt-out na ficha para retomar." },
      { status: 409 },
    );
  }

  const tel = normalizePhone(c.telefone);
  if (!tel) return NextResponse.json({ ok: false, reason: "contato sem telefone" }, { status: 400 });

  const canal = await getCanal("HM");
  const r = await sendMessage({ phone: tel, text: texto, cfg: canal });
  if (!r.ok) {
    return NextResponse.json({ ok: false, reason: r.erro || "falha ao enviar" }, { status: 400 });
  }

  const atendente = sessao.nome || "cs";

  // Resposta do CS: fecha a pendência do inbox HM e registra na timeline (contato_hm_id).
  await query(
    `update cs.contatos_hm set inbox_status = 'resolvido', aguardando_desde = null, atualizado_em = now()
      where comprador_id = $1`,
    [c.comprador_id],
  );
  await query(
    `insert into cs.interacoes (contato_hm_id, tipo, descricao, autor)
     select id, 'nota', $2, $3 from cs.contatos_hm where comprador_id = $1`,
    [c.comprador_id, `CS respondeu: ${texto.slice(0, 200)}`, atendente],
  );

  return NextResponse.json({ ok: true });
}

// PATCH — muda o status da conversa sem enviar (resolver / reabrir).
export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const g = await guard({ portal: "HM" });
  if (!g.ok) return g.res;
  const sessao = g.sessao;
  if (!(await podeVerCardHm(sessao, params.id))) {
    return NextResponse.json({ ok: false, reason: "sem_acesso" }, { status: 403 });
  }
  const p = await parseBody(req, InboxStatusSchema);
  if (!p.ok) return p.res;
  const novo = p.data.status; // pendente | resolvido
  await query(
    `update cs.contatos_hm
        set inbox_status = $2,
            aguardando_desde = case when $2 = 'pendente' then coalesce(aguardando_desde, now()) else null end,
            atualizado_em = now()
      where comprador_id = $1`,
    [params.id, novo],
  );
  return NextResponse.json({ ok: true });
}
