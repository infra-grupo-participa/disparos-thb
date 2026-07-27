import { query, queryOne } from "@/lib/db";
import { getContactMessages } from "@/lib/unnichat";
import { getCanal } from "@/lib/services/canais";
import { ehOptOut } from "@/lib/classificar";
import { logger } from "@/lib/log";

// Sincronizador de RESPOSTAS do inbox (rede de segurança do webhook).
//
// A resposta de um lead entra no sistema por DUAS pontes: o webhook do Unnichat
// (empurra, tempo real) e este sync (puxa, no cron). Enquanto o webhook depende
// de uma automação configurada no painel do Unnichat para CADA número, este aqui
// só precisa do cron externo rodando — a mesma peça que já retoma disparos. Ter
// as duas é o ideal; ter só esta já faz a resposta aparecer no inbox em ~1-2min.
//
// Ele varre os contatos que RECEBERAM disparo (têm unnichat_contact_id) e ainda
// não constam como respondidos, pergunta ao Unnichat as mensagens de cada um e,
// se houver mensagem do LEAD depois do envio, registra a resposta — a mesma
// lógica do webhook, centralizada aqui (registrarRespostaLead).
const log = logger("inbox-sync");

const CONCORRENCIA = 5;
const EVENTOS_PADRAO = ["SEM", "CNHF"];

// Marca a resposta do lead no contato: timeline + ultima_resposta_em + reabre a
// pendência do inbox + avança o estágio. É a fonte única usada pelo webhook E
// pelo sync, para as duas pontes não divergirem.
export async function registrarRespostaLead(
  compradorId: string,
  descricao: string,
  disparoId: string | null,
  optOut: boolean,
): Promise<void> {
  // HM vive no overlay isolado (cs.contatos_hm), com a timeline em
  // cs.interacoes.contato_hm_id. Se o comprador é um card HM, segue o ramo HM;
  // senão, o caminho genérico (cs.contatos/contato_id) — intacto, é o do SEM.
  const ehHm = await queryOne<{ id: string }>(
    `select id from cs.contatos_hm where comprador_id = $1`,
    [compradorId],
  );
  if (ehHm) {
    // NÃO avança estágio: o HM tem esteira própria (o avanço comprou→onboarding é
    // dos portais genéricos). Só abre a pendência do inbox e carimba a resposta.
    await query(
      `update cs.contatos_hm
          set ultima_resposta_em = now(),
              inbox_status = 'pendente',
              aguardando_desde = coalesce(aguardando_desde, now()),
              atualizado_em = now()
        where comprador_id = $1`,
      [compradorId],
    );
    await query(
      `insert into cs.interacoes (contato_hm_id, tipo, descricao, disparo_id, autor)
       select id, 'resposta', $2, $3, 'lead' from cs.contatos_hm where comprador_id = $1`,
      [compradorId, descricao, disparoId],
    );
    if (optOut) {
      await query(
        `update cs.contatos_hm set opt_out = true, opt_out_em = coalesce(opt_out_em, now()),
                inbox_status = 'resolvido', aguardando_desde = null, atualizado_em = now()
          where comprador_id = $1`,
        [compradorId],
      );
      await query(
        `insert into cs.interacoes (contato_hm_id, tipo, descricao, autor)
         select id, 'sistema', 'Pediu para parar de receber (opt-out)', 'sistema' from cs.contatos_hm where comprador_id = $1`,
        [compradorId],
      );
    }
    return;
  }

  await query(
    `update cs.contatos
        set ultima_resposta_em = now(),
            estagio_id = case
              when estagio_id = (select id from cs.estagios where chave = 'comprou_ingresso')
              then (select id from cs.estagios where chave = 'em_onboarding')
              else estagio_id end,
            inbox_status = 'pendente',
            aguardando_desde = coalesce(aguardando_desde, now()),
            atualizado_em = now()
      where comprador_id = $1`,
    [compradorId],
  );
  await query(
    `insert into cs.interacoes (contato_id, tipo, descricao, disparo_id, autor)
     select id, 'resposta', $2, $3, 'lead' from cs.contatos where comprador_id = $1`,
    [compradorId, descricao, disparoId],
  );
  if (optOut) {
    await query(
      `update cs.contatos set opt_out = true, opt_out_em = coalesce(opt_out_em, now()),
              inbox_status = 'resolvido', aguardando_desde = null, atualizado_em = now()
        where comprador_id = $1`,
      [compradorId],
    );
    await query(
      `insert into cs.interacoes (contato_id, tipo, descricao, autor)
       select id, 'sistema', 'Pediu para parar de receber (opt-out)', 'sistema' from cs.contatos where comprador_id = $1`,
      [compradorId],
    );
  }
}

type Alvo = {
  dc_id: string;
  disparo_id: string;
  comprador_id: string | null;
  unnichat_contact_id: string;
  enviado_em: string;
  evento: string;
};

export type ResultadoInboxSync = { verificados: number; novas: number; erros: number };

// Puxa do Unnichat as respostas dos contatos que receberam disparo (SEM/CNHF) e
// ainda não responderam. Idempotente: o UPDATE só vence com respondeu=false, e um
// lead já registrado não é reprocessado (fica fora do alvo).
export async function sincronizarRespostasInbox(limite = 40, eventos: string[] = EVENTOS_PADRAO): Promise<ResultadoInboxSync> {
  const lim = Math.min(Math.max(limite, 1), 120);
  const alvos = await query<Alvo>(
    `select dc.id as dc_id, dc.disparo_id, dc.comprador_id, dc.unnichat_contact_id,
            dc.enviado_em, d.evento
       from cs.disparo_contatos dc
       join cs.disparos d on d.id = dc.disparo_id
      where dc.enviado = true and dc.respondeu = false
        and dc.unnichat_contact_id is not null
        and d.evento = any($2::text[])
        and dc.enviado_em > now() - interval '21 days'
      order by dc.enviado_em desc
      limit $1`,
    [lim, eventos],
  );
  if (alvos.length === 0) return { verificados: 0, novas: 0, erros: 0 };

  // Credencial por evento (SEM e CNHF hoje compartilham o mesmo número, mas o
  // cache respeita quando forem contas distintas).
  const canalCache: Record<string, Awaited<ReturnType<typeof getCanal>>> = {};
  const canalDe = async (evento: string) => (canalCache[evento] ??= await getCanal(evento));

  let novas = 0, erros = 0;
  for (let i = 0; i < alvos.length; i += CONCORRENCIA) {
    await Promise.all(
      alvos.slice(i, i + CONCORRENCIA).map(async (a) => {
        try {
          const canal = await canalDe(a.evento);
          const { ok, messages } = await getContactMessages(a.unnichat_contact_id, canal);
          if (!ok) { erros++; return; }

          const envioMs = new Date(a.enviado_em).getTime();
          // Mensagem do LEAD depois do envio = resposta ao disparo. Pega a mais
          // recente (é o que interessa para o preview e o opt-out).
          const respostas = messages
            .filter((m) => String(m.senderBy || "").toLowerCase() === "contact" && m.date)
            .filter((m) => { const t = new Date(m.date!).getTime(); return Number.isFinite(t) && t > envioMs; })
            .sort((x, y) => new Date(y.date!).getTime() - new Date(x.date!).getTime());
          if (respostas.length === 0) return;

          const texto = (respostas[0].text || "").slice(0, 140);
          const optOut = ehOptOut(texto);

          // Fecha o SLA no disparo_contatos (idempotente).
          const upd = await queryOne<{ id: string }>(
            `update cs.disparo_contatos
                set respondeu = true, respondeu_em = now(),
                    sla_minutos = round(extract(epoch from (now() - enviado_em)) / 60)::int
              where id = $1 and respondeu = false
              returning id`,
            [a.dc_id],
          );
          if (!upd) return; // outra ponte (webhook) já registrou

          await query(`update cs.disparos set total_respondidos = total_respondidos + 1 where id = $1`, [a.disparo_id]);
          if (a.comprador_id) {
            await registrarRespostaLead(
              a.comprador_id,
              texto ? `Respondeu: ${texto}` : "Respondeu (sem texto)",
              a.disparo_id,
              optOut,
            );
          }
          novas++;
        } catch (e) {
          erros++;
          log.error("falha ao sincronizar resposta de um contato", e, { dc_id: a.dc_id });
        }
      }),
    );
  }

  if (novas > 0) log.info("respostas sincronizadas do Unnichat", { verificados: alvos.length, novas, erros });
  return { verificados: alvos.length, novas, erros };
}

// ----- Gatilho on-demand (o inbox aberto puxa as respostas sozinho) ----------
//
// Independência de infra: além do cron, o próprio inbox dispara este sync quando
// o operador está com a tela aberta (o polling chama /api/inbox/sync). Com isto,
// a resposta do lead aparece em segundos MESMO sem cron externo nem webhook — a
// única coisa necessária é ter alguém trabalhando no inbox.
//
// Trava de servidor (memória do processo): por mais que 3 operadores puxem a cada
// 12s, o Unnichat só é consultado no máximo 1x a cada `minIntervalMs` por conjunto
// de eventos — e nunca duas execuções simultâneas. Processo persistente (Hostinger)
// mantém este estado entre requisições; se rodar duplicado, o sync é idempotente.
const ultimaExecPorChave = new Map<string, number>();
const emExecucao = new Set<string>();

export async function sincronizarRespostasInboxOnDemand(
  eventos: string[] = EVENTOS_PADRAO,
  minIntervalMs = 20_000,
): Promise<{ executou: boolean; novas: number }> {
  const chave = eventos.slice().sort().join(",");
  const agora = Date.now();
  const ultima = ultimaExecPorChave.get(chave) ?? 0;
  if (emExecucao.has(chave) || agora - ultima < minIntervalMs) {
    return { executou: false, novas: 0 };
  }
  emExecucao.add(chave);
  ultimaExecPorChave.set(chave, agora);
  try {
    const r = await sincronizarRespostasInbox(40, eventos);
    return { executou: true, novas: r.novas };
  } finally {
    emExecucao.delete(chave);
  }
}
