import { NextResponse } from "next/server";
import { guard } from "@/lib/guard";
import { query, queryOne } from "@/lib/db";
import { createContact, getContactMessages, sendMessage, type CanalCfg } from "@/lib/unnichat";
import { getCanal } from "@/lib/services/canais";
import { normalizePhone } from "@/lib/phone";
import { parseBody, InboxMsgSchema, InboxStatusSchema } from "@/lib/validators";
import { registrarRespostaCS, mudarStatus } from "@/lib/services/atendimento";
import { podeVerContato } from "@/lib/services/contato";
import { eventoDe } from "@/lib/services/evento";

export const runtime = "nodejs";
export const maxDuration = 60;

type Contato = { comprador_id: string; nome: string; telefone: string | null; evento: string };

// Obtém o id do contato na Unnichat: do disparo mais recente (já guardado) ou,
// na falta, via createContact (idempotente — retorna o existente pelo telefone).
// Usa a credencial do canal do evento (HT vs Seminário podem ter contas distintas).
async function resolverContactId(c: Contato, cfg: CanalCfg): Promise<string | null> {
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

async function carregarContato(id: string, evento: string): Promise<Contato | null> {
  // Via unificada (HT + Seminário): leads do Seminário não estão em contatos_ht,
  // então usamos contatos_evento. FILTRA por evento: uma pessoa pode existir em
  // mais de um portal na view — sem o filtro, o thread abriria pela conta/canal do
  // portal errado (isolamento de portais, 27/07).
  return queryOne<Contato>(
    `select comprador_id, nome, telefone, evento from cs.contatos_evento where comprador_id = $1 and evento = $2`,
    [id, evento],
  );
}

// GET — carrega a conversa (mensagens trocadas) do contato com a Unnichat.
export async function GET(req: Request, { params }: { params: { id: string } }) {
  // Portal do evento RESOLVIDO (cookie/query) contra a whitelist da conta (0145).
  const g = await guard({ portal: eventoDe(req) });
  if (!g.ok) return g.res;
  // Gating de equipe (0146): a conversa 1:1 só abre para quem VÊ o contato —
  // sem isto, o recorte da fila era cosmético (bastava forçar o id aqui).
  if (!(await podeVerContato(g.sessao, params.id, eventoDe(req)))) {
    return NextResponse.json({ ok: false, reason: "sem_acesso" }, { status: 403 });
  }

  const c = await carregarContato(params.id, eventoDe(req));
  if (!c) return NextResponse.json({ ok: false, reason: "contato não encontrado" }, { status: 404 });

  const canal = await getCanal(c.evento);
  const contactId = await resolverContactId(c, canal);
  if (!contactId) {
    return NextResponse.json({ ok: true, contato: c, mensagens: [], aviso: "Contato sem registro na Unnichat ainda." });
  }

  const { messages } = await getContactMessages(contactId, canal);
  const mensagens = messages.map((m) => {
    const ehLead = String(m.senderBy || "").toLowerCase() === "contact";
    // Origem da bolha, para o operador saber de onde veio cada mensagem do lado
    // "nosso": um TEMPLATE (disparo/abertura, type=template) vs texto livre que
    // saiu da equipe pelo chat. `senderBy` cru vai junto para refinar depois
    // (distinguir automação de humano) quando confirmarmos os valores do Unnichat.
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

  // Janela de atendimento (Meta): texto livre só vale até 24h após a ÚLTIMA
  // mensagem que o LEAD enviou. Fora disso, só um template de abertura reabre a
  // conversa. O front usa isto para guiar o SDR (input livre × enviar template).
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

// POST — envia uma mensagem de texto livre ao contato (dentro da janela de 24h).
export async function POST(req: Request, { params }: { params: { id: string } }) {
  // Portal do evento RESOLVIDO (cookie/query) contra a whitelist da conta (0145).
  const g = await guard({ portal: eventoDe(req) });
  if (!g.ok) return g.res;
  // Mesmo gating do GET: não se responde a uma conversa fora do próprio escopo.
  if (!(await podeVerContato(g.sessao, params.id, eventoDe(req)))) {
    return NextResponse.json({ ok: false, reason: "sem_acesso" }, { status: 403 });
  }

  const p = await parseBody(req, InboxMsgSchema);
  if (!p.ok) return p.res;
  const texto = p.data.texto.trim();

  const c = await carregarContato(params.id, eventoDe(req));
  if (!c) return NextResponse.json({ ok: false, reason: "contato não encontrado" }, { status: 404 });

  // Quem pediu para parar, parou — inclusive na conversa 1:1. Insistir com quem
  // deu opt-out é exatamente o que gera denúncia e queima o número. O opt-out
  // pode ter vindo de um falso positivo do classificador (o lead escreveu algo
  // curto que pareceu "pare"); nesse caso o operador desfaz na ficha do contato,
  // conscientemente, e volta a conversar.
  // Escopado por evento: a linha de cs.contatos é por (comprador, evento) e a
  // intenção aqui é "NESTE portal ele pediu para parar?" — sem o filtro, o
  // LIMIT implícito do queryOne podia ler a linha de OUTRO portal e deixar sair
  // mensagem para quem deu opt-out aqui (ou bloquear quem não deu).
  const bloqueado = await queryOne<{ opt_out: boolean }>(
    `select opt_out from cs.contatos where comprador_id = $1 and evento = $2`,
    [c.comprador_id, c.evento],
  );
  if (bloqueado?.opt_out) {
    return NextResponse.json(
      { ok: false, reason: "contato_opt_out", motivo: "Este contato pediu para não receber mensagens. Para retomar a conversa, desfaça o opt-out na ficha dele." },
      { status: 409 },
    );
  }

  const tel = normalizePhone(c.telefone);
  if (!tel) return NextResponse.json({ ok: false, reason: "contato sem telefone" }, { status: 400 });

  const canal = await getCanal(c.evento);
  const r = await sendMessage({ phone: tel, text: texto, cfg: canal });
  if (!r.ok) {
    return NextResponse.json({ ok: false, reason: r.erro || "falha ao enviar" }, { status: 400 });
  }

  const atendente = (p.data.atendente ?? "").trim() || null;

  // Fecha a pendência + grava o atendimento com o FRT (serviço de atendimento).
  const frtMin = await registrarRespostaCS(c.comprador_id, atendente);

  // Registra a resposta na timeline (com o atendente) — na linha DESTE evento
  // (sem o filtro, entrava uma nota por portal em que o comprador existe).
  await query(
    `insert into cs.interacoes (contato_id, tipo, descricao, autor)
     select id, 'nota', $2, $3 from cs.contatos where comprador_id = $1 and evento = $4`,
    [c.comprador_id, `CS respondeu: ${texto.slice(0, 200)}`, atendente || "cs", c.evento],
  );

  return NextResponse.json({ ok: true, frt_minutos: frtMin });
}

// PATCH — muda o status da conversa sem enviar (resolver / reabrir).
export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  // Portal do evento RESOLVIDO (cookie/query) contra a whitelist da conta (0145).
  const g = await guard({ portal: eventoDe(req) });
  if (!g.ok) return g.res;
  // Mesmo gating do GET: resolver/reabrir é agir sobre a conversa.
  if (!(await podeVerContato(g.sessao, params.id, eventoDe(req)))) {
    return NextResponse.json({ ok: false, reason: "sem_acesso" }, { status: 403 });
  }
  const p = await parseBody(req, InboxStatusSchema);
  if (!p.ok) return p.res;
  await mudarStatus(params.id, p.data.status);
  return NextResponse.json({ ok: true });
}
