import { query, queryOne } from "@/lib/db";
import { getCanal } from "@/lib/services/canais";
import {
  listarCampanhas, classificarEventoEmail, garantirContato, aplicarTag,
  buscarEngajamentoContato, inscreverNaLista, listarDescadastrados,
  type CampanhaAC,
} from "@/lib/activecampaign";
import { criarLista, criarMensagem, criarCampanha, type Remetente } from "@/lib/activecampaign-v1";
import { getConfig } from "@/lib/services/config";
import { logger } from "@/lib/log";

// Serviço de E-mail (ActiveCampaign): sincroniza as métricas das campanhas para
// cs.campanhas_email. Espelha lib/services/disparo-status.ts — o AC não tem
// webhook de métricas confiável, então fazemos POLLING (cron) e reescrevemos as
// contagens a cada passada. Idempotente: upsert por ac_campaign_id.
const log = logger("email");

const PAGINA = 100; // limite do AC por página
const PADRAO_PAGINAS = 5; // ~500 campanhas mais recentes por execução do cron

type Resultado = { sincronizadas: number; casadas: number; varridas: number; total: number };

// Sincroniza as campanhas mais recentes do AC. `maxPaginas` controla o alcance:
// o cron usa o padrão (recentes); um backfill manual pode pedir mais páginas.
export async function sincronizarCampanhasEmail(maxPaginas = PADRAO_PAGINAS): Promise<Resultado> {
  // Credencial do canal de e-mail (provider 'activecampaign'); sem canal
  // cadastrado, cai nas envs ACTIVECAMPAIGN_* (ver lib/activecampaign.ts).
  const canal = await getCanal("HT", "activecampaign");

  let varridas = 0;
  let casadas = 0;
  let sincronizadas = 0;
  let total = 0;

  for (let pagina = 0; pagina < maxPaginas; pagina++) {
    const r = await listarCampanhas({ limit: PAGINA, offset: pagina * PAGINA, cfg: canal });
    if (!r.ok) {
      log.error("falha ao listar campanhas do AC", null, { pagina, erro: r.erro });
      break;
    }
    total = r.total;
    varridas += r.campanhas.length;

    for (const c of r.campanhas) {
      const evento = classificarEventoEmail(c.nome);
      if (evento) casadas++;
      // Persiste TODAS (mesmo evento=null) para não re-buscar e ter o panorama;
      // os portais filtram por evento, então campanhas sem evento ficam ocultas.
      await upsertCampanha(c, evento);
      sincronizadas++;
    }

    // Chegou ao fim da conta antes de esgotar as páginas pedidas.
    if (r.campanhas.length < PAGINA) break;
  }

  log.info("campanhas de e-mail sincronizadas", { sincronizadas, casadas, varridas, total });
  return { sincronizadas, casadas, varridas, total };
}

// ===== Disparo de e-mail ===================================================
// Dois modos convivem (ver migration 0079):
//
//   'tag'      — legado: aplica a tag no contato e TORCE para que uma automação
//                do AC a capture. Exige montar automação lá dentro a cada
//                campanha; quando o cabo tag→automação está solto, nada sai.
//   'campanha' — o operador escreve assunto e corpo AQUI, e o disparo cria a
//                mensagem e lança a campanha pela API v1. Sem automação.
//
// Os dois são IDEMPOTENTES (só agem sobre o que falta) e protegidos por
// heartbeat: dois processos no mesmo disparo criariam duas campanhas no AC, e o
// contato receberia o e-mail duas vezes.
const DELAY_EMAIL_MS = 250; // espaça as chamadas ao AC (limite: 5 req/s)
const BATIMENTO_MS = 30_000;
const CORACAO_PARADO_SEG = 300;

type TemplateEmail = {
  modo: string;
  ac_tag_id: string | null;
  nome: string;
  assunto: string | null;
  corpo_html: string | null;
  corpo_texto: string | null;
  evento: string;
  operador: string | null;
  edicao_ht: string | null;
  ac_list_id: string | null;
  ac_message_id: string | null;
  ac_campaign_id: string | null;
};
type LinhaEmail = { id: string; comprador_id: string | null; email: string; nome: string | null };

async function carregarDisparo(disparoId: string): Promise<TemplateEmail | null> {
  return queryOne<TemplateEmail>(
    `select t.modo, t.ac_tag_id, t.nome, t.assunto, t.corpo_html, t.corpo_texto,
            coalesce(d.evento, 'HT') as evento, d.operador, d.edicao_ht,
            d.ac_list_id, d.ac_message_id, d.ac_campaign_id
       from cs.disparos_email d join cs.templates t on t.id = d.template_id
      where d.id = $1`,
    [disparoId],
  );
}

// Ponto de entrada único: lê o modo do template e encaminha. Quem chama (a rota
// e o cron) não precisa saber qual é qual.
export async function processarDisparoEmail(disparoId: string): Promise<void> {
  const d = await carregarDisparo(disparoId);
  if (!d) {
    log.error("disparo de e-mail sem template; abortando", null, { disparoId });
    await falhar(disparoId);
    return;
  }
  if (!(await reivindicarEmail(disparoId))) {
    log.info("disparo de e-mail já está sendo processado por outro processo", { disparoId });
    return;
  }
  try {
    if (d.modo === "campanha") await porCampanha(disparoId, d);
    else await porTag(disparoId, d);
  } catch (e) {
    await query(`update cs.disparos_email set processando_em = null where id = $1`, [disparoId]).catch(() => {});
    throw e;
  }
}

// ----- Modo 'campanha': escreve o corpo e lança ------------------------------
async function porCampanha(disparoId: string, d: TemplateEmail): Promise<void> {
  if (!d.assunto || !d.corpo_html) {
    log.error("template de campanha sem assunto/corpo; abortando", null, { disparoId });
    await falhar(disparoId);
    return;
  }

  const remetente = await getRemetente();
  if (!remetente) {
    log.error("remetente de e-mail não configurado; abortando", null, { disparoId });
    await falhar(disparoId);
    return;
  }

  const canal = await getCanal(d.evento, "activecampaign");
  const bater = baterCoracao(disparoId);

  // 1) A lista técnica do disparo — o público exato que o operador selecionou.
  //    Só nasce uma vez: retomar um disparo não cria outra lista.
  let listId = d.ac_list_id;
  if (!listId) {
    const nome = nomeDaCampanha(d);
    const r = await criarLista({ nome, remetente, cfg: canal });
    if (!r.ok || !r.listId) {
      log.error("falha ao criar a lista do disparo no AC", null, { disparoId, erro: r.erro });
      await falhar(disparoId, r.erro);
      return;
    }
    listId = r.listId;
    await query(`update cs.disparos_email set ac_list_id = $2 where id = $1`, [disparoId, listId]);
  }

  // 2) Inscrever os contatos. `enviado` aqui significa "entrou no público da
  //    campanha" — a entrega real vem depois, nas métricas da campanha.
  const pendentes = await query<LinhaEmail>(
    `select dec.id, dec.comprador_id, dec.email, v.nome
       from cs.disparo_email_contatos dec
       left join cs.contatos_evento v on v.comprador_id = dec.comprador_id and v.evento = $2
      where dec.disparo_id = $1 and dec.enviado = false`,
    [disparoId, d.evento],
  );

  for (const l of pendentes) {
    const c = await garantirContato({ email: l.email, nome: l.nome, cfg: canal });
    if (!c.ok || !c.contactId) {
      await query(`update cs.disparo_email_contatos set erro = $2 where id = $1`, [l.id, c.erro || "falha ao criar contato no AC"]);
      await sleepEmail();
      continue;
    }
    const i = await inscreverNaLista({ contactId: c.contactId, listId, cfg: canal });
    if (i.ok) {
      await query(
        `update cs.disparo_email_contatos set enviado = true, enviado_em = now(), ac_contact_id = $2, erro = null where id = $1`,
        [l.id, c.contactId],
      );
      await registrarInteracao(l, d);
    } else {
      await query(
        `update cs.disparo_email_contatos set ac_contact_id = $2, erro = $3 where id = $1`,
        [l.id, c.contactId, i.erro || "falha ao inscrever o contato na lista do AC"],
      );
    }
    await atualizarContagem(disparoId);
    await bater();
    await sleepEmail();
  }

  // 3) Sem ninguém no público, não há campanha a lançar.
  const inscritos = await queryOne<{ n: number }>(
    `select count(*)::int as n from cs.disparo_email_contatos where disparo_id = $1 and enviado`,
    [disparoId],
  );
  if ((inscritos?.n ?? 0) === 0) {
    log.error("nenhum contato entrou na lista; campanha não será criada", null, { disparoId });
    await falhar(disparoId, "nenhum contato pôde ser inscrito na lista do AC");
    return;
  }

  // 4) O corpo do e-mail.
  let messageId = d.ac_message_id;
  if (!messageId) {
    const r = await criarMensagem({
      assunto: d.assunto,
      html: d.corpo_html,
      texto: d.corpo_texto || textoDoHtml(d.corpo_html),
      listId,
      remetente,
      cfg: canal,
    });
    if (!r.ok || !r.messageId) {
      log.error("falha ao criar a mensagem no AC", null, { disparoId, erro: r.erro });
      await falhar(disparoId, r.erro);
      return;
    }
    messageId = r.messageId;
    await query(`update cs.disparos_email set ac_message_id = $2 where id = $1`, [disparoId, messageId]);
  }

  // 5) Lança. É o último passo de propósito: a campanha só existe quando o
  //    público já está completo. Criar antes enviaria para uma lista parcial.
  if (!d.ac_campaign_id) {
    const r = await criarCampanha({
      nome: nomeDaCampanha(d),
      listId,
      messageId,
      quando: new Date(),
      cfg: canal,
    });
    if (!r.ok || !r.campaignId) {
      log.error("falha ao lançar a campanha no AC", null, { disparoId, erro: r.erro });
      await falhar(disparoId, r.erro);
      return;
    }
    await query(`update cs.disparos_email set ac_campaign_id = $2 where id = $1`, [disparoId, r.campaignId]);
    log.info("campanha de e-mail lançada no AC", { disparoId, campaignId: r.campaignId, publico: inscritos?.n });
  }

  await concluir(disparoId);
}

// ----- Modo 'tag' (legado): aplica a tag e depende da automação --------------
async function porTag(disparoId: string, d: TemplateEmail): Promise<void> {
  if (!d.ac_tag_id) {
    log.error("disparo de e-mail sem tag; abortando", null, { disparoId });
    await falhar(disparoId);
    return;
  }

  const canal = await getCanal(d.evento, "activecampaign");
  const tagId = d.ac_tag_id;
  const bater = baterCoracao(disparoId);

  const pendentes = await query<LinhaEmail>(
    `select dec.id, dec.comprador_id, dec.email, v.nome
       from cs.disparo_email_contatos dec
       left join cs.contatos_evento v on v.comprador_id = dec.comprador_id and v.evento = $2
      where dec.disparo_id = $1 and dec.enviado = false`,
    [disparoId, d.evento],
  );

  for (const l of pendentes) {
    const c = await garantirContato({ email: l.email, nome: l.nome, cfg: canal });
    if (!c.ok || !c.contactId) {
      await query(`update cs.disparo_email_contatos set erro = $2 where id = $1`, [l.id, c.erro || "falha ao criar contato no AC"]);
      await sleepEmail();
      continue;
    }
    const t = await aplicarTag({ contactId: c.contactId, tagId, cfg: canal });
    if (t.ok) {
      await query(
        `update cs.disparo_email_contatos set enviado = true, enviado_em = now(), ac_contact_id = $2, erro = null where id = $1`,
        [l.id, c.contactId],
      );
      await registrarInteracao(l, d);
    } else {
      await query(
        `update cs.disparo_email_contatos set ac_contact_id = $2, erro = $3 where id = $1`,
        [l.id, c.contactId, t.erro || "falha ao aplicar tag no AC"],
      );
    }
    await atualizarContagem(disparoId);
    await bater();
    await sleepEmail();
  }

  await concluir(disparoId);
}

// ----- Peças comuns ---------------------------------------------------------

// Nome que a campanha vai ter no AC. O prefixo em colchete importa: é por ele
// que classificarEventoEmail() casa a campanha com o evento na hora de puxar as
// métricas de volta.
function nomeDaCampanha(d: TemplateEmail): string {
  const quando = new Date().toISOString().slice(0, 16).replace("T", " ");
  const edicao = d.edicao_ht ? ` ${d.edicao_ht}` : "";
  return `[${d.evento}${edicao}] ${d.nome} · ${quando}`;
}

// Texto puro a partir do HTML, para o cliente de e-mail que não renderiza HTML
// (e para o filtro de spam, que desconfia de e-mail só-HTML).
function textoDoHtml(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

async function registrarInteracao(l: LinhaEmail, d: TemplateEmail): Promise<void> {
  if (!l.comprador_id) return;
  await query(
    `insert into cs.interacoes (contato_id, tipo, canal, descricao, autor)
     select id, 'disparo', 'email', $2, $3 from cs.contatos where comprador_id = $1`,
    [l.comprador_id, `E-mail disparado (${d.nome})`, d.operador || "cs"],
  );
}

async function atualizarContagem(disparoId: string): Promise<void> {
  await query(
    `update cs.disparos_email set
       total_enviados = (select count(*) from cs.disparo_email_contatos where disparo_id = $1 and enviado),
       total_erros = (select count(*) from cs.disparo_email_contatos where disparo_id = $1 and not enviado and erro is not null)
     where id = $1`,
    [disparoId],
  );
}

// Heartbeat com folga: um update a cada 30s, não a cada contato.
function baterCoracao(disparoId: string): () => Promise<void> {
  let ultimo = Date.now();
  return async () => {
    if (Date.now() - ultimo < BATIMENTO_MS) return;
    ultimo = Date.now();
    await query(`update cs.disparos_email set processando_em = now() where id = $1`, [disparoId]);
  };
}

async function reivindicarEmail(disparoId: string): Promise<boolean> {
  const r = await queryOne<{ id: string }>(
    `update cs.disparos_email
        set processando_em = now()
      where id = $1
        and status = 'em_andamento'
        and (processando_em is null or processando_em < now() - make_interval(secs => $2))
      returning id`,
    [disparoId, CORACAO_PARADO_SEG],
  );
  return !!r;
}

async function concluir(disparoId: string): Promise<void> {
  await query(
    `update cs.disparos_email set status = 'concluido', concluido_em = now(), processando_em = null where id = $1`,
    [disparoId],
  );
}

// O motivo fica gravado: o painel mostra POR QUE o disparo morreu, em vez de um
// 'erro' mudo que ninguém sabe destravar.
async function falhar(disparoId: string, motivo?: string): Promise<void> {
  await query(
    `update cs.disparos_email set status = 'erro', processando_em = null, erro = $2 where id = $1`,
    [disparoId, motivo ?? null],
  );
}

// ----- Remetente ------------------------------------------------------------
// Exigido pelo AC (e pela lei anti-spam): quem envia, de onde, e por que a
// pessoa está recebendo. Configurado uma vez pelo admin, em cs.config. Sem isso
// o disparo por campanha não sai — e é melhor recusar aqui, com a causa escrita,
// do que descobrir no meio do envio.
export async function getRemetente(): Promise<Remetente | null> {
  const r = await getConfig<Partial<Remetente> | null>("email_remetente", null);
  if (!r) return null;
  const faltando = (["nome", "email", "url", "lembrete", "endereco", "cidade"] as const).filter((k) => !String(r[k] ?? "").trim());
  if (faltando.length) {
    log.error("remetente de e-mail incompleto", null, { faltando });
    return null;
  }
  return r as Remetente;
}

// Retoma disparos de e-mail cujo processo MORREU (heartbeat parado). Antes isto
// olhava `iniciado_em`, o que retomava disparos vivos — e criava campanha dupla.
export async function retomarTravadosEmail(): Promise<number> {
  const travados = await query<{ id: string }>(
    `select id from cs.disparos_email
      where status = 'em_andamento'
        and (processando_em is null or processando_em < now() - make_interval(secs => $1))`,
    [CORACAO_PARADO_SEG],
  );
  for (const d of travados) {
    log.info("retomando disparo de e-mail abandonado (heartbeat parado)", { disparoId: d.id });
    await processarDisparoEmail(d.id).catch((e) => log.error("erro ao retomar disparo de e-mail", e, { disparoId: d.id }));
  }
  return travados.length;
}

// ===== Descadastro: traz o opt-out do AC para o nosso banco ================
// A campanha direta manda para uma lista técnica descartável. O link de
// descadastro do e-mail remove a pessoa DAQUELA lista — que nunca mais será
// usada. Sem isto, o pedido de saída se perderia e ela receberia o próximo
// disparo: é assim que se coleciona denúncia de spam.
//
// O opt-out de verdade mora em cs.contatos.opt_out, o MESMO campo que o
// WhatsApp respeita. Quem pediu para sair, saiu — dos dois canais.
export async function sincronizarOptOutEmail(maxListas = 10): Promise<{ listas: number; novos: number }> {
  const canal = await getCanal("HT", "activecampaign");

  // Listas de disparos recentes: o descadastro chega nos dias seguintes ao envio.
  const alvos = await query<{ id: string; ac_list_id: string }>(
    `select id, ac_list_id from cs.disparos_email
      where ac_list_id is not null
        and iniciado_em > now() - interval '30 days'
        and (optout_sincronizado_em is null or optout_sincronizado_em < now() - interval '6 hours')
      order by optout_sincronizado_em asc nulls first
      limit $1`,
    [maxListas],
  );

  let novos = 0;
  for (const a of alvos) {
    const r = await listarDescadastrados(a.ac_list_id, canal);
    if (!r.ok) {
      log.warn("falha ao ler descadastros da lista", { disparoId: a.id, listId: a.ac_list_id, erro: r.erro });
      continue;
    }
    if (r.emails.length) {
      // Casa por e-mail (o AC só conhece a pessoa por e-mail) e marca o opt-out
      // em quem ainda não estava marcado — daí o `and not opt_out`, que também
      // preserva a data original de quem já tinha pedido para sair.
      const marcados = await query<{ id: string }>(
        `update cs.contatos c
            set opt_out = true, opt_out_em = now(), atualizado_em = now()
           from cs.contatos_evento v
          where v.comprador_id = c.comprador_id
            and lower(v.email) = any($1::text[])
            and not c.opt_out
        returning c.id`,
        [r.emails],
      );
      novos += marcados.length;
      if (marcados.length) {
        log.info("descadastros do e-mail viraram opt-out", { disparoId: a.id, novos: marcados.length });
      }
    }
    await query(`update cs.disparos_email set optout_sincronizado_em = now() where id = $1`, [a.id]);
    await sleepEmail();
  }

  return { listas: alvos.length, novos };
}

const sleepEmail = () => new Promise((r) => setTimeout(r, DELAY_EMAIL_MS));

// ===== Engajamento de e-mail por pessoa do sistema =========================
// Espelha sincronizarStatusRecentes (Meta/WhatsApp): em lote, busca no AC o
// engajamento de cada contato do sistema (por e-mail) e persiste em
// cs.email_contato. Prioriza os nunca sincronizados e depois os mais antigos
// (>24h), para manter fresco sem repuxar tudo a cada ciclo. O evento NÃO entra
// aqui — vem do cruzamento por comprador_id em cs.contatos_evento na leitura.
type AlvoEngajamento = { comprador_id: string; email: string };

export async function sincronizarEngajamentoEmail(lote = 60): Promise<{ verificados: number; encontrados: number }> {
  const canal = await getCanal("HT", "activecampaign");

  const alvos = await query<AlvoEngajamento>(
    `select v.comprador_id, v.email
       from (
         select distinct on (comprador_id) comprador_id, email
           from cs.contatos_evento
          where email is not null and email like '%@%'
          order by comprador_id
       ) v
       left join cs.email_contato ec on ec.comprador_id = v.comprador_id
      where ec.sincronizado_em is null or ec.sincronizado_em < now() - interval '24 hours'
      order by ec.sincronizado_em asc nulls first
      limit $1`,
    [lote],
  );

  let encontrados = 0;
  for (const a of alvos) {
    const r = await buscarEngajamentoContato(a.email, canal);
    if (!r.ok || !r.dados) {
      // Não trava o lote por uma falha pontual; tenta de novo no próximo ciclo.
      await sleepEmail();
      continue;
    }
    const d = r.dados;
    if (d.encontrado) encontrados++;
    await query(
      `insert into cs.email_contato (comprador_id, ac_contact_id, encontrado, recebidos, abriu_em, clicou_em, bounce_hard, bounce_soft, sincronizado_em)
       values ($1, $2, $3, $4, $5, $6, $7, $8, now())
       on conflict (comprador_id) do update set
         ac_contact_id = excluded.ac_contact_id,
         encontrado = excluded.encontrado,
         recebidos = excluded.recebidos,
         abriu_em = excluded.abriu_em,
         clicou_em = excluded.clicou_em,
         bounce_hard = excluded.bounce_hard,
         bounce_soft = excluded.bounce_soft,
         sincronizado_em = now()`,
      [a.comprador_id, d.contactId ?? null, d.encontrado, d.recebidos, d.abriuEm, d.clicouEm, d.bounceHard, d.bounceSoft],
    );
    await sleepEmail();
  }

  log.info("engajamento de e-mail sincronizado", { verificados: alvos.length, encontrados });
  return { verificados: alvos.length, encontrados };
}

async function upsertCampanha(c: CampanhaAC, evento: string | null): Promise<void> {
  await query(
    `insert into cs.campanhas_email (
       ac_campaign_id, evento, nome, tipo, status,
       enviados, processados, aberturas, aberturas_unicas, cliques, cliques_unicos,
       hardbounces, softbounces, unsubscribes, forwards, replies,
       enviada_em, sincronizado_em
     ) values (
       $1, $2, $3, $4, $5,
       $6, $7, $8, $9, $10, $11,
       $12, $13, $14, $15, $16,
       $17, now()
     )
     on conflict (ac_campaign_id) do update set
       evento = excluded.evento,
       nome = excluded.nome,
       tipo = excluded.tipo,
       status = excluded.status,
       enviados = excluded.enviados,
       processados = excluded.processados,
       aberturas = excluded.aberturas,
       aberturas_unicas = excluded.aberturas_unicas,
       cliques = excluded.cliques,
       cliques_unicos = excluded.cliques_unicos,
       hardbounces = excluded.hardbounces,
       softbounces = excluded.softbounces,
       unsubscribes = excluded.unsubscribes,
       forwards = excluded.forwards,
       replies = excluded.replies,
       enviada_em = excluded.enviada_em,
       sincronizado_em = now()`,
    [
      c.id, evento, c.nome, c.tipo, c.status,
      c.enviados, c.processados, c.aberturas, c.aberturasUnicas, c.cliques, c.cliquesUnicos,
      c.hardbounces, c.softbounces, c.unsubscribes, c.forwards, c.replies,
      c.enviadaEm,
    ],
  );
}
