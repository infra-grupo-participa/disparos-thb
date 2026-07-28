import { NextResponse } from "next/server";
import { guard } from "@/lib/guard";
import { query, queryOne } from "@/lib/db";
import { createContact, getContactMessages, sendMessage, type CanalCfg } from "@/lib/unnichat";
import { getCanal } from "@/lib/services/canais";
import { normalizePhone } from "@/lib/phone";
import { parseBody, InboxMsgSchema, InboxStatusSchema } from "@/lib/validators";
import { registrarRespostaCS, mudarStatus } from "@/lib/services/atendimento";
import { podeVerContato, podeAgirContato } from "@/lib/services/contato";
import { eventoDe } from "@/lib/services/evento";

export const runtime = "nodejs";
export const maxDuration = 60;

type Contato = { comprador_id: string; nome: string; telefone: string | null; evento: string };

// Obtém o id do contato na Unnichat, nesta ordem de custo:
//   1. cache em cs.contatos.unnichat_contact_id (0147) — 1 SELECT por poll;
//   2. do disparo mais recente (cs.disparo_contatos, índice da 0148);
//   3. createContact (idempotente — retorna o existente pelo telefone).
// O que 2/3 resolvem é PERSISTIDO no cache: antes, um contato sem disparo
// gerava um createContact na Unnichat A CADA POLL da thread (escrita externa
// escondida no caminho de leitura), e o lookup em disparo_contatos era um seq
// scan por abertura. Cache por (comprador, evento): o contact id pertence à
// CONTA Unnichat do canal, e o canal é por evento.
async function resolverContactId(c: Contato, cfg: CanalCfg): Promise<string | null> {
  // O deploy é AUTOMÁTICO no push e a migration é aplicada à mão: enquanto a
  // 0147 não estiver em produção, a coluna de cache não existe e o select
  // estoura (42703) — o que quebraria a ABERTURA DA CONVERSA, não só o cache.
  // Sem cache o fluxo continua correto pelos passos 2/3, só mais caro.
  // Remover o try/catch quando a 0147 estiver aplicada.
  let cache: { unnichat_contact_id: string | null } | null = null;
  try {
    cache = await queryOne<{ unnichat_contact_id: string | null }>(
      `select unnichat_contact_id from cs.contatos where comprador_id = $1 and evento = $2`,
      [c.comprador_id, c.evento],
    );
  } catch {
    cache = null;
  }
  if (cache?.unnichat_contact_id) return cache.unnichat_contact_id;

  const existente = await queryOne<{ unnichat_contact_id: string }>(
    `select unnichat_contact_id from cs.disparo_contatos
      where comprador_id = $1 and unnichat_contact_id is not null
      order by enviado_em desc nulls last limit 1`,
    [c.comprador_id],
  );
  let contactId = existente?.unnichat_contact_id ?? null;
  if (!contactId) {
    const tel = normalizePhone(c.telefone);
    if (!tel) return null;
    const r = await createContact({ name: c.nome || tel, phone: tel, cfg });
    contactId = r.contactId ?? null;
  }
  if (contactId) {
    // Mesma razão do try/catch acima: gravar o cache é otimização, e falhar ao
    // otimizar não pode impedir a conversa de abrir.
    await query(
      `update cs.contatos set unnichat_contact_id = $3
        where comprador_id = $1 and evento = $2 and unnichat_contact_id is distinct from $3`,
      [c.comprador_id, c.evento, contactId],
    ).catch(() => {});
  }
  return contactId;
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
// PAYLOAD enxuto (polling): devolve { ok, mensagens, janela[, aviso] }. Não
// devolve mais `contato` (o cliente já tem a linha da fila) nem `senderBy` cru
// por mensagem (a UI só lê `de`/`origem`; se um dia precisarmos distinguir
// automação de humano, reintroduzir mapeado, não cru).
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
    return NextResponse.json({ ok: true, mensagens: [], aviso: "Contato sem registro na Unnichat ainda." });
  }

  const { messages } = await getContactMessages(contactId, canal);
  const mensagens = messages.map((m) => {
    const ehLead = String(m.senderBy || "").toLowerCase() === "contact";
    // Origem da bolha, para o operador saber de onde veio cada mensagem do lado
    // "nosso": um TEMPLATE (disparo/abertura, type=template) vs texto livre que
    // saiu da equipe pelo chat.
    const origem = ehLead ? "lead" : m.type === "template" ? "template" : "equipe";
    return {
      id: m.id,
      de: ehLead ? "lead" : "cs",
      origem,
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

  return NextResponse.json({ ok: true, mensagens, janela });
}

// POST — envia uma mensagem de texto livre ao contato (dentro da janela de 24h).
export async function POST(req: Request, { params }: { params: { id: string } }) {
  // Portal do evento RESOLVIDO (cookie/query) contra a whitelist da conta (0145).
  const g = await guard({ portal: eventoDe(req) });
  if (!g.ok) return g.res;
  // Gate de AÇÃO (28/07, leitura ≠ ação): responder é ESCRITA — a conversa do
  // card de um colega ABRE (GET, escopo de leitura), mas não se responde por
  // ela: 403 'card_de_outro_operador' (o front traduz).
  const acao = await podeAgirContato(g.sessao, params.id, eventoDe(req));
  if (acao !== "ok") {
    return NextResponse.json({ ok: false, reason: acao }, { status: 403 });
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

  // Quem atendeu = quem está LOGADO (sessao.nome), como o inbox do HM já fazia.
  // O campo `atendente` do corpo é IGNORADO: era texto livre do cliente, dava
  // para forjar quem atendeu — e isso alimenta a métrica de FRT/SLA por
  // atendente. (O cliente pode parar de enviá-lo; o schema só o tolera.)
  const atendente = (g.sessao.nome || "").trim() || "cs";

  // Fecha a pendência + grava o atendimento com o FRT (serviço de atendimento),
  // na linha DESTE evento.
  const frtMin = await registrarRespostaCS(c.comprador_id, c.evento, atendente);

  // Registra a resposta na timeline (com o atendente) — na linha DESTE evento
  // (sem o filtro, entrava uma nota por portal em que o comprador existe).
  await query(
    `insert into cs.interacoes (contato_id, tipo, descricao, autor)
     select id, 'nota', $2, $3 from cs.contatos where comprador_id = $1 and evento = $4`,
    [c.comprador_id, `CS respondeu: ${texto.slice(0, 200)}`, atendente, c.evento],
  );

  return NextResponse.json({ ok: true, frt_minutos: frtMin });
}

// PATCH — muda o status da conversa sem enviar (resolver / reabrir).
export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  // Portal do evento RESOLVIDO (cookie/query) contra a whitelist da conta (0145).
  const g = await guard({ portal: eventoDe(req) });
  if (!g.ok) return g.res;
  // Gate de AÇÃO (28/07): resolver/reabrir muda o estado da conversa — escrita.
  const acao = await podeAgirContato(g.sessao, params.id, eventoDe(req));
  if (acao !== "ok") {
    return NextResponse.json({ ok: false, reason: acao }, { status: 403 });
  }
  const p = await parseBody(req, InboxStatusSchema);
  if (!p.ok) return p.res;
  await mudarStatus(params.id, eventoDe(req), p.data.status);
  return NextResponse.json({ ok: true });
}
