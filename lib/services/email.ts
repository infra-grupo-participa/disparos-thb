import { query, queryOne } from "@/lib/db";
import { getCanal } from "@/lib/services/canais";
import {
  listarCampanhas, classificarEventoEmail, garantirContato, aplicarTag,
  buscarEngajamentoContato,
  type CampanhaAC,
} from "@/lib/activecampaign";
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

// ===== Disparo de e-mail (aplicar tag → automação) =========================
// Espelho de processarDisparo (WhatsApp), mas para o canal de e-mail. Uma fase:
// garantir o contato no AC (sync por e-mail) e aplicar a tag, que aciona a
// automação. IDEMPOTENTE — só age sobre o que falta (enviado=false), então
// serve para o envio inicial e para retomar disparos travados (cron).
const DELAY_EMAIL_MS = 250; // espaça as chamadas ao AC

type TemplateEmail = { ac_tag_id: string | null; nome: string; evento: string; operador: string | null };
type LinhaEmail = { id: string; comprador_id: string | null; email: string; nome: string | null };

export async function processarDisparoEmail(disparoId: string): Promise<void> {
  const template = await queryOne<TemplateEmail>(
    `select t.ac_tag_id, t.nome, coalesce(d.evento, 'HT') as evento, d.operador
       from cs.disparos_email d join cs.templates t on t.id = d.template_id
      where d.id = $1`,
    [disparoId],
  );
  if (!template || !template.ac_tag_id) {
    log.error("disparo de e-mail sem template/tag; abortando", null, { disparoId });
    await query(`update cs.disparos_email set status = 'erro' where id = $1`, [disparoId]);
    return;
  }

  const canal = await getCanal(template.evento, "activecampaign");
  const tagId = template.ac_tag_id;

  const pendentes = await query<LinhaEmail>(
    `select dec.id, dec.comprador_id, dec.email, v.nome
       from cs.disparo_email_contatos dec
       left join cs.contatos_evento v on v.comprador_id = dec.comprador_id and v.evento = $2
      where dec.disparo_id = $1 and dec.enviado = false`,
    [disparoId, template.evento],
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
      if (l.comprador_id) {
        await query(
          `insert into cs.interacoes (contato_id, tipo, descricao, autor)
           select id, 'disparo', $2, $3 from cs.contatos where comprador_id = $1`,
          [l.comprador_id, `E-mail disparado (${template.nome})`, template.operador || "cs"],
        );
      }
    } else {
      await query(
        `update cs.disparo_email_contatos set ac_contact_id = $2, erro = $3 where id = $1`,
        [l.id, c.contactId, t.erro || "falha ao aplicar tag no AC"],
      );
    }
    await query(
      `update cs.disparos_email set
         total_enviados = (select count(*) from cs.disparo_email_contatos where disparo_id = $1 and enviado),
         total_erros = (select count(*) from cs.disparo_email_contatos where disparo_id = $1 and not enviado and erro is not null)
       where id = $1`,
      [disparoId],
    );
    await sleepEmail();
  }

  await query(
    `update cs.disparos_email set status = 'concluido', concluido_em = now() where id = $1`,
    [disparoId],
  );
}

// Retoma disparos de e-mail travados (processo reiniciou no meio). Idempotente.
export async function retomarTravadosEmail(maxMinutos = 15): Promise<number> {
  const travados = await query<{ id: string }>(
    `select id from cs.disparos_email where status = 'em_andamento' and iniciado_em < now() - make_interval(mins => $1)`,
    [maxMinutos],
  );
  for (const d of travados) {
    log.info("retomando disparo de e-mail travado", { disparoId: d.id });
    await processarDisparoEmail(d.id).catch((e) => log.error("erro ao retomar disparo de e-mail", e, { disparoId: d.id }));
  }
  return travados.length;
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
