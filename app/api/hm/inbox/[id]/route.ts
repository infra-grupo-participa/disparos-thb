import { NextResponse } from "next/server";
import { guard } from "@/lib/guard";
import { produtoDaRequisicao } from "@/lib/produto-hm";
import { query, queryOne } from "@/lib/db";
import { createContact, getContactMessages, sendMessage, type CanalCfg } from "@/lib/unnichat";
import { getCanal } from "@/lib/services/canais";
import { normalizePhone } from "@/lib/phone";
import { parseBody, InboxMsgSchema, InboxStatusSchema } from "@/lib/validators";
import { podeVerCardHm, podeAgirCardHm, cancelamentoBloqueado } from "@/lib/services/hm";

export const runtime = "nodejs";
export const maxDuration = 60;

// Inbox do HM — thread de uma conversa. Espelha app/api/inbox/[id] mas no overlay
// isolado: o contato vem de cs.contatos_hm_kanban (evento fixo HM), o estado vive
// em cs.contatos_hm e a timeline em cs.interacoes.contato_hm_id. O canal é o do
// evento 'HM'. GATING por operador (podeVerCardHm): não abre/envia conversa de
// card de outra pessoa (403).

type ContatoHm = { comprador_id: string; nome: string; telefone: string | null };

// Id do contato na Unnichat, na mesma ordem de custo do inbox genérico:
// cache em cs.contatos_hm.unnichat_contact_id (0147) → disparo mais recente
// (índice da 0148) → createContact (idempotente pelo telefone). O resultado é
// persistido no cache: antes, contato sem disparo gerava um createContact na
// Unnichat a CADA poll da thread, e o lookup era um seq scan por abertura.
async function resolverContactId(c: ContatoHm, cfg: CanalCfg, produto: string): Promise<string | null> {
  // Deploy é automático no push, migration é aplicada à mão: enquanto a 0147
  // não estiver em produção a coluna não existe e o select estoura (42703),
  // quebrando a ABERTURA da conversa — não só o cache. Sem cache o fluxo segue
  // pelos passos 2/3, só mais caro. Remover quando a 0147 estiver aplicada.
  let cache: { unnichat_contact_id: string | null } | null = null;
  try {
    cache = await queryOne<{ unnichat_contact_id: string | null }>(
      `select unnichat_contact_id from cs.contatos_hm
        where comprador_id = $1 and produto = $2`,
      [c.comprador_id, produto],
    );
  } catch {
    cache = null;
  }
  if (cache?.unnichat_contact_id) return cache.unnichat_contact_id;

  // 0187: esta NÃO leva filtro de produto de propósito — cs.disparo_contatos não
  // tem a coluna, e não deveria: o contact_id do WhatsApp é da PESSOA, não do
  // board. Quem decide de qual card é a conversa é carregarContatoHm, que filtra.
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
    // Gravar o cache é otimização: falhar ao otimizar não pode impedir a
    // conversa de abrir (mesma razão do try/catch acima).
    await query(
      `update cs.contatos_hm set unnichat_contact_id = $2
        where comprador_id = $1 and unnichat_contact_id is distinct from $2
          and produto = $3`,
      [c.comprador_id, contactId, produto],
    ).catch(() => {});
  }
  return contactId;
}

async function carregarContatoHm(id: string, produto: string): Promise<ContatoHm | null> {
  // 0187: `and produto = $2` — é esta seleção que decide de QUEM é a conversa e
  // para quem o POST manda WhatsApp. Sem o filtro, o card de outro board podia ser
  // resolvido e a mensagem sair por um portal não autorizado.
  return queryOne<ContatoHm>(
    `select comprador_id, nome, telefone from cs.contatos_hm_kanban
      where comprador_id = $1 and produto = $2`,
    [id, produto],
  );
}

// GET — carrega a conversa (mensagens trocadas) do contato com a Unnichat.
// PAYLOAD enxuto (polling): { ok, mensagens, janela[, aviso] } — sem `contato`
// (o cliente já tem a linha da fila) e sem `senderBy` cru por mensagem (a UI só
// lê `de`/`origem`). Mesmo contrato do inbox genérico.
export async function GET(req: Request, { params }: { params: { id: string } }) {
  // 0187: o portal validado é o do produto PEDIDO. Com "HM" literal, quem tem
  // só HM lia o card do AURUM/ETHB de quem não tem card no HM.
  const produtoCard = produtoDaRequisicao(req);
  const g = await guard({ portal: produtoCard });
  if (!g.ok) return g.res;
  const sessao = g.sessao;
  if (!(await podeVerCardHm(sessao, params.id, produtoCard))) {
    return NextResponse.json({ ok: false, reason: "sem_acesso" }, { status: 403 });
  }
  // Card cancelado (Reclamada/Reembolsado): quem não é master não abre a ficha —
  // e a thread é conteúdo do mesmo card por outra porta. A conversa segue
  // LISTADA na fila (a decisão é sobre abrir, não sobre sumir com o card).
  if (await cancelamentoBloqueado(sessao, params.id)) {
    return NextResponse.json({ ok: false, reason: "cancelamento_so_admin_gp" }, { status: 403 });
  }

  const c = await carregarContatoHm(params.id, produtoCard);
  if (!c) return NextResponse.json({ ok: false, reason: "contato não encontrado" }, { status: 404 });

  const canal = await getCanal("HM");
  const contactId = await resolverContactId(c, canal, produtoCard);
  if (!contactId) {
    return NextResponse.json({ ok: true, mensagens: [], aviso: "Contato sem registro na Unnichat ainda." });
  }

  const { messages } = await getContactMessages(contactId, canal);
  const mensagens = messages.map((m) => {
    const ehLead = String(m.senderBy || "").toLowerCase() === "contact";
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

  return NextResponse.json({ ok: true, mensagens, janela });
}

// POST — envia texto livre ao contato (dentro da janela de 24h).
export async function POST(req: Request, { params }: { params: { id: string } }) {
  // 0187: o portal validado é o do produto PEDIDO. Com "HM" literal, quem tem
  // só HM agia sobre o card do AURUM/ETHB de quem não tem card no HM.
  const produtoCard = produtoDaRequisicao(req);
  const g = await guard({ portal: produtoCard });
  if (!g.ok) return g.res;
  const sessao = g.sessao;
  // Gate de AÇÃO (28/07, leitura ≠ ação): responder é ESCRITA — a conversa do
  // card de um colega ABRE (GET), mas não se responde por ela (403 traduzido).
  const acao = await podeAgirCardHm(sessao, params.id, produtoCard);
  if (acao !== "ok") {
    return NextResponse.json({ ok: false, reason: acao }, { status: 403 });
  }
  // Cancelado: não abre, logo também não manda mensagem (WhatsApp pra aluno
  // reembolsado é ação do master, não da equipe).
  if (await cancelamentoBloqueado(sessao, params.id)) {
    return NextResponse.json({ ok: false, reason: "cancelamento_so_admin_gp" }, { status: 403 });
  }

  const p = await parseBody(req, InboxMsgSchema);
  if (!p.ok) return p.res;
  const texto = p.data.texto.trim();

  const c = await carregarContatoHm(params.id, produtoCard);
  if (!c) return NextResponse.json({ ok: false, reason: "contato não encontrado" }, { status: 404 });

  // Opt-out do overlay HM: quem pediu para parar, parou.
  const bloqueado = await queryOne<{ opt_out: boolean }>(
    `select opt_out from cs.contatos_hm where comprador_id = $1 and produto = $2`,
    [c.comprador_id, produtoCard],
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
    // 0187: `and produto = $2` — este UPDATE não passa por um id intermediário,
    // então sem o filtro ele resolvia a conversa nos DOIS cards de uma vez.
    `update cs.contatos_hm set inbox_status = 'resolvido', aguardando_desde = null, atualizado_em = now()
      where comprador_id = $1 and produto = $2`,
    [c.comprador_id, produtoCard],
  );
  await query(
    `insert into cs.interacoes (contato_hm_id, tipo, descricao, autor)
     select id, 'nota', $2, $3 from cs.contatos_hm
      where comprador_id = $1 and produto = $4`,
    [c.comprador_id, `CS respondeu: ${texto.slice(0, 200)}`, atendente, produtoCard],
  );

  return NextResponse.json({ ok: true });
}

// PATCH — muda o status da conversa sem enviar (resolver / reabrir).
export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  // 0187: o portal validado é o do produto PEDIDO. Com "HM" literal, quem tem
  // só HM agia sobre o card do AURUM/ETHB de quem não tem card no HM.
  const produtoCard = produtoDaRequisicao(req);
  const g = await guard({ portal: produtoCard });
  if (!g.ok) return g.res;
  const sessao = g.sessao;
  // Gate de AÇÃO (28/07): resolver/reabrir muda o estado da conversa — escrita.
  const acao = await podeAgirCardHm(sessao, params.id, produtoCard);
  if (acao !== "ok") {
    return NextResponse.json({ ok: false, reason: acao }, { status: 403 });
  }
  // Cancelado: mudar status da conversa é escrita no card — só master.
  if (await cancelamentoBloqueado(sessao, params.id)) {
    return NextResponse.json({ ok: false, reason: "cancelamento_so_admin_gp" }, { status: 403 });
  }
  const p = await parseBody(req, InboxStatusSchema);
  if (!p.ok) return p.res;
  const novo = p.data.status; // pendente | resolvido
  await query(
    `update cs.contatos_hm
        set inbox_status = $2,
            aguardando_desde = case when $2 = 'pendente' then coalesce(aguardando_desde, now()) else null end,
            atualizado_em = now()
      where comprador_id = $1 and produto = $3`,
    [params.id, novo, produtoCard],
  );
  return NextResponse.json({ ok: true });
}
