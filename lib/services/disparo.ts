import { query, queryOne } from "@/lib/db";
import { sendTemplate, createContact, type BodyParam, type EnvioResultado } from "@/lib/unnichat";
import { primeiroNome } from "@/lib/phone";
import { logger } from "@/lib/log";

// Serviço de Disparo: processamento das duas fases (garantir contatos na
// Unnichat → enviar template). Carrega o estado do BANCO e é IDEMPOTENTE — só
// age sobre o que falta (enviado=false). Por isso serve tanto para o envio
// inicial quanto para retomar disparos que ficaram travados (resiliência).
const log = logger("disparo");

const DELAY_MS = 350;
const DELAY_CRIAR_MS = 200;
const DELAY_429_MS = 5000;
const RETRY_BACKOFF_MS = [1000, 3000, 8000];
const FALLBACK_VAR = "tudo bem";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const ehTransitorio = (status: number) => status === 0 || status === 429 || status >= 500;

type Template = { id: string; nome: string; unnichat_id: string; variaveis: number };
type LinhaDB = { id: string; comprador_id: string; telefone: string; contato_criado: boolean; nome: string | null };

export async function processarDisparo(disparoId: string): Promise<void> {
  const template = await queryOne<Template>(
    `select t.id, t.nome, t.unnichat_id, t.variaveis
       from cs.disparos d join cs.templates t on t.id = d.template_id
      where d.id = $1`,
    [disparoId],
  );
  if (!template) {
    log.error("disparo sem template; abortando", null, { disparoId });
    await query(`update cs.disparos set status = 'erro' where id = $1`, [disparoId]);
    return;
  }

  // Só o que ainda não foi enviado (idempotência / retomada).
  const pendentes = await query<LinhaDB>(
    `select dc.id, dc.comprador_id, dc.telefone, dc.contato_criado, v.nome
       from cs.disparo_contatos dc
       left join cs.contatos_ht v on v.comprador_id = dc.comprador_id
      where dc.disparo_id = $1 and dc.enviado = false`,
    [disparoId],
  );

  // ===== Fase 1: garantir os contatos na Unnichat (idempotente) =====
  await query(`update cs.disparos set fase = 'criando_contatos' where id = $1`, [disparoId]);
  for (const l of pendentes) {
    if (l.contato_criado) continue;
    const r = await createContact({ name: l.nome || l.telefone, phone: l.telefone });
    if (r.ok) {
      l.contato_criado = true;
      await query(
        `update cs.disparo_contatos set contato_criado = true, erro_contato = null, unnichat_contact_id = $2 where id = $1`,
        [l.id, r.contactId ?? null],
      );
    } else {
      await query(
        `update cs.disparo_contatos set contato_criado = false, erro_contato = $2, erro = $2 where id = $1`,
        [l.id, r.erro || "falha ao criar contato na Unnichat"],
      );
    }
    await sleep(DELAY_CRIAR_MS);
  }
  await query(
    `update cs.disparos set total_contatos_criados = (select count(*) from cs.disparo_contatos where disparo_id = $1 and contato_criado) where id = $1`,
    [disparoId],
  );

  // ===== Fase 2: enviar o template (só para quem foi criado) =====
  await query(`update cs.disparos set fase = 'enviando' where id = $1`, [disparoId]);
  for (const l of pendentes) {
    if (!l.contato_criado) continue;

    let params: BodyParam[] | undefined;
    if (Number(template.variaveis) >= 1) {
      let texto = primeiroNome(l.nome);
      if (!texto) {
        texto = FALLBACK_VAR;
        log.warn("contato sem nome para a variável; usando fallback neutro", { contatoId: l.id, template: template.nome });
      }
      params = [{ type: "text", text: texto }];
    }

    const r = await enviarComRetry(l.telefone, template.unnichat_id, params, l.id);
    const pausaProximo = r.status === 429 ? DELAY_429_MS : DELAY_MS;

    if (r.ok) {
      await query(`update cs.disparo_contatos set enviado = true, enviado_em = now(), erro = null where id = $1`, [l.id]);
      await query(
        `update cs.contatos
            set ultimo_contato_em = now(), primeiro_contato_em = coalesce(primeiro_contato_em, now()), atualizado_em = now()
          where comprador_id = $1`,
        [l.comprador_id],
      );
      await query(
        `insert into cs.interacoes (contato_id, tipo, descricao, disparo_id, autor)
         select id, 'disparo', $2, $3, 'cs' from cs.contatos where comprador_id = $1`,
        [l.comprador_id, `Template "${template.nome}" enviado`, disparoId],
      );
    } else {
      await query(`update cs.disparo_contatos set enviado = false, erro = $2 where id = $1`, [l.id, r.erro || "falha no envio"]);
    }
    await query(
      `update cs.disparos set total_enviados = (select count(*) from cs.disparo_contatos where disparo_id = $1 and enviado) where id = $1`,
      [disparoId],
    );
    await sleep(pausaProximo);
  }

  await query(
    `update cs.disparos set status = 'concluido', fase = 'concluido', concluido_em = now() where id = $1`,
    [disparoId],
  );
}

// Retoma disparos que ficaram 'em_andamento' parados (ex.: o processo reiniciou
// no meio). Idempotente: processarDisparo só age sobre o que falta.
export async function retomarTravados(maxMinutos = 15): Promise<number> {
  const travados = await query<{ id: string }>(
    `select id from cs.disparos where status = 'em_andamento' and iniciado_em < now() - make_interval(mins => $1)`,
    [maxMinutos],
  );
  for (const d of travados) {
    log.info("retomando disparo travado", { disparoId: d.id });
    await processarDisparo(d.id).catch((e) => log.error("erro ao retomar disparo", e, { disparoId: d.id }));
  }
  return travados.length;
}

async function enviarComRetry(
  phone: string,
  templateId: string,
  bodyParameters: BodyParam[] | undefined,
  contatoId: string,
): Promise<EnvioResultado> {
  let r = await sendTemplate({ phone, templateId, bodyParameters });
  let tentativa = 0;
  while (!r.ok && ehTransitorio(r.status) && tentativa < RETRY_BACKOFF_MS.length) {
    const espera = RETRY_BACKOFF_MS[tentativa];
    log.warn("envio falhou; agendando retry", { contatoId, status: r.status, erro: r.erro, tentativa: tentativa + 1, de: RETRY_BACKOFF_MS.length, esperaMs: espera });
    await sleep(espera);
    r = await sendTemplate({ phone, templateId, bodyParameters });
    tentativa++;
  }
  if (!r.ok && tentativa > 0) {
    r = { ...r, erro: `${r.erro || `HTTP ${r.status}`} (após ${tentativa + 1} tentativas)` };
  }
  return r;
}
