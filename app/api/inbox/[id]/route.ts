import { NextResponse } from "next/server";
import { isAuthed } from "@/lib/auth";
import { query, queryOne } from "@/lib/db";
import { createContact, getContactMessages, sendMessage } from "@/lib/unnichat";
import { normalizePhone } from "@/lib/phone";

export const runtime = "nodejs";
export const maxDuration = 60;

type Contato = { comprador_id: string; nome: string; telefone: string | null };

// Obtém o id do contato na Unnichat: do disparo mais recente (já guardado) ou,
// na falta, via createContact (idempotente — retorna o existente pelo telefone).
async function resolverContactId(c: Contato): Promise<string | null> {
  const existente = await queryOne<{ unnichat_contact_id: string }>(
    `select unnichat_contact_id from cs.disparo_contatos
      where comprador_id = $1 and unnichat_contact_id is not null
      order by enviado_em desc nulls last limit 1`,
    [c.comprador_id],
  );
  if (existente?.unnichat_contact_id) return existente.unnichat_contact_id;
  const tel = normalizePhone(c.telefone);
  if (!tel) return null;
  const r = await createContact({ name: c.nome || tel, phone: tel });
  return r.contactId ?? null;
}

async function carregarContato(id: string): Promise<Contato | null> {
  return queryOne<Contato>(
    `select comprador_id, nome, telefone from cs.contatos_ht where comprador_id = $1`,
    [id],
  );
}

// GET — carrega a conversa (mensagens trocadas) do contato com a Unnichat.
export async function GET(_req: Request, { params }: { params: { id: string } }) {
  if (!isAuthed()) return NextResponse.json({ ok: false }, { status: 401 });

  const c = await carregarContato(params.id);
  if (!c) return NextResponse.json({ ok: false, reason: "contato não encontrado" }, { status: 404 });

  const contactId = await resolverContactId(c);
  if (!contactId) {
    return NextResponse.json({ ok: true, contato: c, mensagens: [], aviso: "Contato sem registro na Unnichat ainda." });
  }

  const { messages } = await getContactMessages(contactId);
  const mensagens = messages.map((m) => ({
    id: m.id,
    de: m.senderBy === "contact" ? "lead" : "cs",
    tipo: m.type,
    texto: m.type === "template" ? (m.text || "[template enviado]") : m.text,
    data: m.date ?? null,
  }));

  return NextResponse.json({ ok: true, contato: c, mensagens });
}

// POST — envia uma mensagem de texto livre ao contato (dentro da janela de 24h).
export async function POST(req: Request, { params }: { params: { id: string } }) {
  if (!isAuthed()) return NextResponse.json({ ok: false }, { status: 401 });

  const body = (await req.json().catch(() => ({}))) as { texto?: string; atendente?: string };
  const texto = String(body.texto ?? "").trim();
  if (!texto) return NextResponse.json({ ok: false, reason: "texto obrigatório" }, { status: 400 });

  const c = await carregarContato(params.id);
  if (!c) return NextResponse.json({ ok: false, reason: "contato não encontrado" }, { status: 404 });

  const tel = normalizePhone(c.telefone);
  if (!tel) return NextResponse.json({ ok: false, reason: "contato sem telefone" }, { status: 400 });

  // Estado da pendência antes de enviar (para o FRT do primeiro contato).
  const pend = await queryOne<{ aguardando_desde: string | null }>(
    `select aguardando_desde from cs.contatos where comprador_id = $1`,
    [c.comprador_id],
  );

  const r = await sendMessage({ phone: tel, text: texto });
  if (!r.ok) {
    return NextResponse.json({ ok: false, reason: r.erro || "falha ao enviar" }, { status: 400 });
  }

  const atendente = String(body.atendente ?? "").trim() || null;

  // Atendimento + FRT quando havia uma pergunta pendente do lead.
  let frtMin: number | null = null;
  if (pend?.aguardando_desde) {
    const at = await queryOne<{ frt_minutos: number }>(
      `insert into cs.atendimentos (comprador_id, atendente, pergunta_em, frt_minutos)
       values ($1, $2, $3, round(extract(epoch from (now() - $3::timestamptz)) / 60)::int)
       returning frt_minutos`,
      [c.comprador_id, atendente, pend.aguardando_desde],
    );
    frtMin = at?.frt_minutos ?? null;
  }

  // Resolve a conversa + registra a resposta na timeline (com o atendente).
  await query(
    `update cs.contatos set inbox_status = 'resolvido', aguardando_desde = null,
            ultimo_contato_em = now(), atualizado_em = now()
      where comprador_id = $1`,
    [c.comprador_id],
  );
  await query(
    `insert into cs.interacoes (contato_id, tipo, descricao, autor)
     select id, 'nota', $2, $3 from cs.contatos where comprador_id = $1`,
    [c.comprador_id, `CS respondeu: ${texto.slice(0, 200)}`, atendente || "cs"],
  );

  return NextResponse.json({ ok: true, frt_minutos: frtMin });
}

// PATCH — muda o status da conversa sem enviar (resolver / reabrir).
export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  if (!isAuthed()) return NextResponse.json({ ok: false }, { status: 401 });
  const b = (await req.json().catch(() => ({}))) as { status?: string };
  if (b.status === "resolvido") {
    await query(`update cs.contatos set inbox_status = 'resolvido', aguardando_desde = null, atualizado_em = now() where comprador_id = $1`, [params.id]);
  } else if (b.status === "pendente") {
    await query(`update cs.contatos set inbox_status = 'pendente', aguardando_desde = coalesce(aguardando_desde, now()), atualizado_em = now() where comprador_id = $1`, [params.id]);
  } else {
    return NextResponse.json({ ok: false, reason: "status inválido" }, { status: 400 });
  }
  return NextResponse.json({ ok: true });
}
