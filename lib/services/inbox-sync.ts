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
// `evento` (opcional): escopa as escritas em cs.contatos à linha DAQUELE portal
// — a tabela é uma linha por (comprador, evento) e, sem o filtro, a resposta de
// um lead do SEM podia abrir pendência/avançar estágio na linha do CNHF do
// mesmo comprador. O sync passa o evento do disparo; o WEBHOOK ainda chama sem
// evento (comportamento de sempre — segue o fluxo dele, flag para o futuro).
export async function registrarRespostaLead(
  compradorId: string,
  descricao: string,
  disparoId: string | null,
  optOut: boolean,
  evento?: string | null,
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
      where comprador_id = $1 and ($2::text is null or evento = $2)`,
    [compradorId, evento ?? null],
  );
  await query(
    `insert into cs.interacoes (contato_id, tipo, descricao, disparo_id, autor)
     select id, 'resposta', $2, $3, 'lead' from cs.contatos
      where comprador_id = $1 and ($4::text is null or evento = $4)`,
    [compradorId, descricao, disparoId, evento ?? null],
  );
  if (optOut) {
    await query(
      `update cs.contatos set opt_out = true, opt_out_em = coalesce(opt_out_em, now()),
              inbox_status = 'resolvido', aguardando_desde = null, atualizado_em = now()
        where comprador_id = $1 and ($2::text is null or evento = $2)`,
      [compradorId, evento ?? null],
    );
    await query(
      `insert into cs.interacoes (contato_id, tipo, descricao, autor)
       select id, 'sistema', 'Pediu para parar de receber (opt-out)', 'sistema' from cs.contatos
        where comprador_id = $1 and ($2::text is null or evento = $2)`,
      [compradorId, evento ?? null],
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
//
// DELTA por agendamento (0147): a API do Unnichat não expõe "mensagens desde X"
// (getContactMessages traz o histórico inteiro), então o delta é feito do NOSSO
// lado — cada alvo carrega `sync_verificado_em` e só volta à fila de verificação
// quando o intervalo da sua faixa etária vence:
//   envio < 1h  → reverifica a cada 90s  (conversa quente, quase tempo real)
//   envio < 24h → a cada 10min
//   mais velho  → a cada 2h (até sair da janela de 21 dias)
// Antes, os MESMOS 40 envios mais recentes eram reconsultados a cada execução
// (~120 chamadas/min por evento com o inbox aberto); com o backoff o custo cai
// ~4-10× já na primeira hora e ~duas ordens de grandeza depois de um dia, sem
// perder nenhuma resposta (só muda a latência de detecção dos alvos frios — e o
// webhook continua sendo a ponte de tempo real quando configurado).
export async function sincronizarRespostasInbox(limite = 40, eventos: string[] = EVENTOS_PADRAO): Promise<ResultadoInboxSync> {
  const lim = Math.min(Math.max(limite, 1), 120);
  // O deploy é AUTOMÁTICO no push e a migration é aplicada à mão — então este
  // código precisa rodar nos dois mundos. Com a 0147 aplicada usamos o delta;
  // sem ela, `sync_verificado_em` não existe e a query estoura (42703), o que
  // derrubaria o sync inteiro. Neste caso caímos no comportamento ANTERIOR
  // (reconsulta os mais recentes) — mais caro, porém correto: nenhuma resposta
  // se perde. Remover este fallback quando a 0147 estiver aplicada em produção.
  const SELECT_ALVOS = `select dc.id as dc_id, dc.disparo_id, dc.comprador_id, dc.unnichat_contact_id,
            dc.enviado_em, d.evento
       from cs.disparo_contatos dc
       join cs.disparos d on d.id = dc.disparo_id
      where dc.enviado = true and dc.respondeu = false
        and dc.unnichat_contact_id is not null
        and d.evento = any($2::text[])
        and dc.enviado_em > now() - interval '21 days'`;

  let alvos: Alvo[];
  try {
    alvos = await query<Alvo>(
      `${SELECT_ALVOS}
        and (dc.sync_verificado_em is null
             or dc.sync_verificado_em < now() - (case
                  when dc.enviado_em > now() - interval '1 hour'   then interval '90 seconds'
                  when dc.enviado_em > now() - interval '24 hours' then interval '10 minutes'
                  else interval '2 hours' end))
      order by dc.sync_verificado_em asc nulls first, dc.enviado_em desc
      limit $1`,
      [lim, eventos],
    );
  } catch (e) {
    log.warn("delta do inbox indisponível (0147 aplicada?) — reconsultando os envios recentes", { erro: String(e) });
    alvos = await query<Alvo>(`${SELECT_ALVOS} order by dc.enviado_em desc limit $1`, [lim, eventos]);
  }
  if (alvos.length === 0) return { verificados: 0, novas: 0, erros: 0 };

  // Credencial por evento (SEM e CNHF hoje compartilham o mesmo número, mas o
  // cache respeita quando forem contas distintas).
  const canalCache: Record<string, Awaited<ReturnType<typeof getCanal>>> = {};
  const canalDe = async (evento: string) => (canalCache[evento] ??= await getCanal(evento));

  let novas = 0, erros = 0;
  const verificadosIds: string[] = []; // consultados com sucesso → carimbam sync_verificado_em
  for (let i = 0; i < alvos.length; i += CONCORRENCIA) {
    await Promise.all(
      alvos.slice(i, i + CONCORRENCIA).map(async (a) => {
        try {
          const canal = await canalDe(a.evento);
          const { ok, messages } = await getContactMessages(a.unnichat_contact_id, canal);
          if (!ok) { erros++; return; } // sem carimbo: volta à fila na próxima passada
          verificadosIds.push(a.dc_id);

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
              a.evento,
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

  // Carimbo do backoff em lote (uma escrita por execução, não por alvo). Falha
  // aqui não pode derrubar o sync — no pior caso os alvos voltam mais cedo.
  if (verificadosIds.length > 0) {
    await query(
      `update cs.disparo_contatos set sync_verificado_em = now() where id = any($1::uuid[])`,
      [verificadosIds],
    ).catch((e) => log.error("falha ao carimbar sync_verificado_em (0147 aplicada?)", e));
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
// Trava em DUAS camadas:
//   1. Memória do processo (barata, zero I/O): corta a maioria dos ticks do
//      polling sem tocar o banco, e impede duas execuções simultâneas na mesma
//      instância. Só vale com processo persistente (Hostinger hoje).
//   2. cs.sync_controle (0147, autoritativa): um UPSERT condicional atômico —
//      só UMA instância "vence" a janela de `minIntervalMs`, por mais réplicas
//      que existam. A camada 1 sozinha não segura nada com 2+ instâncias (cada
//      processo tem a própria memória); a 2 fecha isso no banco.
// Se a claim no banco falhar (ex.: 0147 ainda não aplicada), degrada para a
// camada 1 com log — o sync é idempotente, o pior caso é consulta duplicada.
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

  // Claim global no banco: vence quem mover ultima_exec para "agora" — o WHERE
  // do ON CONFLICT garante que só um concorrente por janela consegue.
  try {
    const claim = await queryOne<{ chave: string }>(
      `insert into cs.sync_controle as sc (chave, ultima_exec)
       values ($1, now())
       on conflict (chave) do update set ultima_exec = now()
       where sc.ultima_exec < now() - make_interval(secs => $2)
       returning chave`,
      [`inbox:${chave}`, minIntervalMs / 1000],
    );
    if (!claim) {
      // Outra instância sincronizou dentro da janela: registra na memória para
      // os próximos ticks nem baterem no banco.
      ultimaExecPorChave.set(chave, agora);
      return { executou: false, novas: 0 };
    }
  } catch (e) {
    log.warn("claim em cs.sync_controle falhou (0147 aplicada?) — usando só a trava de memória", {
      erro: e instanceof Error ? e.message : String(e),
    });
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
