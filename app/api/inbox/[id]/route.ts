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

  const body = (await req.json().catch(() => ({}))) as { texto?: string };
  const texto = String(body.texto ?? "").trim();
  if (!texto) return NextResponse.json({ ok: false, reason: "texto obrigatório" }, { status: 400 });

  const c = await carregarContato(params.id);
  if (!c) return NextResponse.json({ ok: false, reason: "contato não encontrado" }, { status: 404 });

  const tel = normalizePhone(c.telefone);
  if (!tel) return NextResponse.json({ ok: false, reason: "contato sem telefone" }, { status: 400 });

  const r = await sendMessage({ phone: tel, text: texto });
  if (!r.ok) {
    return NextResponse.json({ ok: false, reason: r.erro || "falha ao enviar" }, { status: 400 });
  }

  // Rastro no nosso sistema (timeline) + marca último contato.
  await query(
    `insert into cs.interacoes (contato_id, tipo, descricao, autor)
     select id, 'nota', $2, 'cs' from cs.contatos where comprador_id = $1`,
    [c.comprador_id, `CS respondeu: ${texto.slice(0, 200)}`],
  );
  await query(`update cs.contatos set ultimo_contato_em = now(), atualizado_em = now() where comprador_id = $1`, [
    c.comprador_id,
  ]);

  return NextResponse.json({ ok: true });
}
