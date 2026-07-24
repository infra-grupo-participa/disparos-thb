import { query, queryOne } from "@/lib/db";
import { sendTemplate, createContact, addTagToContact, type BodyParam, type CanalCfg, type EnvioResultado } from "@/lib/unnichat";
import { getCanal } from "@/lib/services/canais";
import { getConfig } from "@/lib/services/config";
import { primeiroNome } from "@/lib/phone";
import { logger } from "@/lib/log";

// Serviço de Disparo: processamento das duas fases (garantir contatos na
// Unnichat → enviar template). Carrega o estado do BANCO e é IDEMPOTENTE — só
// age sobre o que falta (enviado=false). Por isso serve tanto para o envio
// inicial quanto para retomar disparos que ficaram travados (resiliência).
//
// EXCLUSÃO MÚTUA (0074): idempotente não basta. Dois loops no mesmo disparo se
// atropelam na janela entre o `select enviado = false` e o `update enviado =
// true` — e o contato recebe a mensagem duas vezes. Quem processa REIVINDICA o
// disparo e mantém um heartbeat (cs.disparos.processando_em); o cron só assume
// o que parou de bater. Ver retomarTravados, embaixo.
const log = logger("disparo");

const DELAY_CRIAR_MS = 200;
const DELAY_429_MS = 5000;
const RETRY_BACKOFF_MS = [1000, 3000, 8000];
const FALLBACK_VAR = "tudo bem";
// Jitter na criação de contatos (fase 1). Já o intervalo entre ENVIOS (fase 2) é
// configurável em cs.config (disparo_intervalo_seg_min/max) — ver processarDisparo.
const DELAY_CRIAR_JITTER_MS = 400; // criação: 200–600ms
const comJitter = (base: number, extra: number) => base + Math.floor(Math.random() * extra);
// Um batimento a cada 30s é folgado para o cron e barato: um update de uma
// coluna, não a cada contato.
const BATIMENTO_MS = 30_000;
// Um disparo cujo processo MORREU (heartbeat congelado) é resgatado pelo cron
// após ~2min de silêncio (era 5min) — retomada mais rápida.
const CORACAO_PARADO_SEG = 120;
// A fila durável é a própria cs.disparo_contatos (enviado=false = pendente). Cada
// passada processa por no máximo isto e então DEVOLVE a fila ao cron (grava o
// progresso, solta a reivindicação). Assim um restart do servidor perde no
// máximo um lote — o cron continua de onde parou, e o disparo sempre completa.
const LIMITE_EXEC_MS = 180_000; // 3 min por lote
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const ehTransitorio = (status: number) => status === 0 || status === 429 || status >= 500;

type Template = {
  id: string;
  nome: string;
  unnichat_id: string;
  variaveis: number;
  variaveis_map: unknown;
  evento: string;
  operador: string | null;
  unnichat_tag_id: string | null;
};
type LinhaDB = {
  id: string;
  comprador_id: string;
  telefone: string;
  contato_criado: boolean;
  nome: string | null;
  edicao: string | null;
  unnichat_contact_id: string | null;
};

// De onde o serviço sabe tirar o valor de uma variável do template.
const CAMPOS_VARIAVEL = ["primeiro_nome", "nome", "edicao", "evento"] as const;
type CampoVariavel = (typeof CAMPOS_VARIAVEL)[number];

export async function processarDisparo(disparoId: string): Promise<void> {
  const template = await queryOne<Template>(
    `select t.id, t.nome, t.unnichat_id, t.variaveis, t.variaveis_map, t.unnichat_tag_id,
            coalesce(d.evento, 'HT') as evento, d.operador
       from cs.disparos d join cs.templates t on t.id = d.template_id
      where d.id = $1`,
    [disparoId],
  );
  if (!template) {
    log.error("disparo sem template; abortando", null, { disparoId });
    await query(`update cs.disparos set status = 'erro', processando_em = null where id = $1`, [disparoId]);
    return;
  }

  // Configuração das variáveis ANTES de tocar na Unnichat: um template que
  // declara 2 variáveis e não diz de onde elas saem sempre foi rejeitado pela
  // Meta, contato a contato. Falha aqui, uma vez, com a causa escrita.
  const mapa = mapaDoTemplate(template);
  if ("erro" in mapa) {
    log.error("template mal configurado; abortando o disparo", null, { disparoId, motivo: mapa.erro });
    await query(`update cs.disparos set status = 'erro', processando_em = null where id = $1`, [disparoId]);
    return;
  }

  // Exclusão mútua: se outro processo já cuida deste disparo (heartbeat vivo),
  // sai sem enviar nada. É isto que impede o cron de duplicar mensagem em cima
  // de um disparo grande que ainda está rodando.
  if (!(await reivindicar(disparoId))) {
    log.info("disparo já está sendo processado por outro processo; nada a fazer", { disparoId });
    return;
  }

  // Credencial do canal do evento (ex.: número do HT vs número do Seminário).
  // Sem canal cadastrado, getCanal devolve {} e a unnichat cai na env global.
  const canal = await getCanal(template.evento);

  // Intervalo entre ENVIOS (anti-ban), configurável em cs.config e em SEGUNDOS.
  // Ritmo humano: cada envio espera um tempo aleatório entre o mínimo e o máximo,
  // em vez de um ritmo fixo (padrão robótico que a Meta detecta). Folgado por
  // padrão, para número em aquecimento; o admin ajusta em cs.config sem deploy.
  const intMinMs = Math.max(0, (await getConfig<number>("disparo_intervalo_seg_min", 6)) * 1000);
  const intMaxMs = Math.max(intMinMs, (await getConfig<number>("disparo_intervalo_seg_max", 15)) * 1000);
  const intervaloEnvio = () => intMinMs + Math.floor(Math.random() * (intMaxMs - intMinMs + 1));

  let ultimoBatimento = Date.now(); // a reivindicação acabou de carimbar
  const baterCoracao = async () => {
    if (Date.now() - ultimoBatimento < BATIMENTO_MS) return;
    ultimoBatimento = Date.now();
    await query(`update cs.disparos set processando_em = now() where id = $1`, [disparoId]);
  };

  try {
    // Só o que ainda não foi enviado (idempotência / retomada). O nome e a edição
    // (variáveis do template) vêm de cs.contatos_evento (HT/SEM) OU da tabela base
    // `compradores` (HM, que não está em contatos_evento) — coalesce cobre os dois.
    const pendentes = await query<LinhaDB>(
      `select dc.id, dc.comprador_id, dc.telefone, dc.contato_criado, dc.unnichat_contact_id,
              coalesce(v.nome, cmp.nome) as nome, v.edicao
         from cs.disparo_contatos dc
         left join cs.contatos_evento v on v.comprador_id = dc.comprador_id
         left join compradores cmp on cmp.id = dc.comprador_id
        where dc.disparo_id = $1 and dc.enviado = false`,
      [disparoId],
    );

    const inicioExec = Date.now();
    let interrompido = false; // true quando o lote atinge o tempo-limite com fila restante

    // ===== Fase 1: garantir os contatos na Unnichat (idempotente) =====
    await query(`update cs.disparos set fase = 'criando_contatos' where id = $1`, [disparoId]);
    for (const l of pendentes) {
      if (l.contato_criado) continue;
      if (Date.now() - inicioExec > LIMITE_EXEC_MS) { interrompido = true; break; }
      const r = await createContact({ name: l.nome || l.telefone, phone: l.telefone, cfg: canal });
      if (r.ok) {
        l.contato_criado = true;
        l.unnichat_contact_id = r.contactId ?? null;
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
      await baterCoracao();
      await sleep(comJitter(DELAY_CRIAR_MS, DELAY_CRIAR_JITTER_MS));
    }
    await query(
      `update cs.disparos set total_contatos_criados = (select count(*) from cs.disparo_contatos where disparo_id = $1 and contato_criado) where id = $1`,
      [disparoId],
    );

    // Estourou o tempo do lote ainda garantindo contatos: devolve ao cron.
    if (interrompido) { await continuarLote(disparoId); return; }

    // ===== Fase 2: enviar o template (só para quem foi criado) =====
    await query(`update cs.disparos set fase = 'enviando' where id = $1`, [disparoId]);
    for (const l of pendentes) {
      if (!l.contato_criado) continue;
      if (Date.now() - inicioExec > LIMITE_EXEC_MS) { interrompido = true; break; }

      // Uma variável sem valor (ex.: template pede a edição e o contato não tem)
      // é problema DAQUELE contato, não do disparo: a Meta recusa parâmetro
      // vazio. Marca o erro e segue para o próximo.
      const p = resolverParams(mapa, l, template.evento);
      if ("erro" in p) {
        await query(`update cs.disparo_contatos set enviado = false, erro = $2 where id = $1`, [l.id, p.erro]);
        continue;
      }

      const r = await enviarComRetry(l.telefone, template.unnichat_id, p.params, l.id, canal);
      const pausaProximo = r.status === 429 ? DELAY_429_MS : intervaloEnvio();

      if (r.ok) {
        await query(`update cs.disparo_contatos set enviado = true, enviado_em = now(), erro = null where id = $1`, [l.id]);
        if (template.evento === "HM") {
          // HM: registra na timeline do overlay (contato_hm_id); não há linha em
          // cs.contatos para atualizar ultimo_contato_em.
          await query(
            `insert into cs.interacoes (contato_hm_id, tipo, canal, descricao, disparo_id, autor)
             select id, 'disparo', 'whatsapp', $2, $3, $4 from cs.contatos_hm where comprador_id = $1`,
            [l.comprador_id, `Template "${template.nome}" enviado`, disparoId, template.operador || "cs"],
          );
        } else {
          await query(
            `update cs.contatos
                set ultimo_contato_em = now(), primeiro_contato_em = coalesce(primeiro_contato_em, now()), atualizado_em = now()
              where comprador_id = $1`,
            [l.comprador_id],
          );
          await query(
            `insert into cs.interacoes (contato_id, tipo, canal, descricao, disparo_id, autor)
             select id, 'disparo', 'whatsapp', $2, $3, $4 from cs.contatos where comprador_id = $1`,
            [l.comprador_id, `Template "${template.nome}" enviado`, disparoId, template.operador || "cs"],
          );
        }

        // Carimba a tag do Unnichat, se o template define uma. A mensagem já saiu;
        // se a tag falhar, apenas registra o aviso — não derruba o disparo.
        if (template.unnichat_tag_id && l.unnichat_contact_id) {
          const tg = await addTagToContact(l.unnichat_contact_id, template.unnichat_tag_id, canal);
          if (!tg.ok) log.warn("template enviado, mas falhou ao aplicar a tag no Unnichat", { disparoId, comprador: l.comprador_id, erro: tg.erro });
        }
      } else {
        await query(`update cs.disparo_contatos set enviado = false, erro = $2 where id = $1`, [l.id, r.erro || "falha no envio"]);
      }
      // O progresso carrega o batimento junto: uma escrita, dois propósitos.
      await query(
        `update cs.disparos
            set total_enviados = (select count(*) from cs.disparo_contatos where disparo_id = $1 and enviado),
                processando_em = now()
          where id = $1`,
        [disparoId],
      );
      ultimoBatimento = Date.now();
      await sleep(pausaProximo);
    }

    // Estourou o tempo do lote com fila restante: devolve ao cron (o disparo
    // segue 'em_andamento'; o próximo lote continua de onde parou).
    if (interrompido) { await continuarLote(disparoId); return; }

    await finalizar(disparoId);
  } catch (e) {
    // Solta a reivindicação para o cron poder retomar já na próxima passada, em
    // vez de esperar o heartbeat expirar.
    await query(`update cs.disparos set processando_em = null where id = $1`, [disparoId]).catch(() => {});
    throw e;
  }
}

// Fim de um lote com fila restante: solta a reivindicação e AUTO-CONTINUA o
// próximo lote imediatamente (sem esperar o cron), para o disparo rodar contínuo
// no caminho feliz. Se ESTE processo morrer antes do próximo lote, o cron
// (avancarDisparos) é a rede de segurança. reivindicar evita processamento dobrado.
async function continuarLote(disparoId: string): Promise<void> {
  await query(`update cs.disparos set processando_em = null where id = $1`, [disparoId]).catch(() => {});
  log.info("lote concluído; continuando o próximo", { disparoId });
  setTimeout(() => {
    void processarDisparo(disparoId).catch((e) => log.error("erro ao continuar lote", e, { disparoId }));
  }, 200);
}

// Consumidor da fila (chamado pelo cron): pega TODOS os disparos que ainda têm
// contatos pendentes e não estão sob um processo vivo — os devolvidos (heartbeat
// nulo) e os que MORRERAM (heartbeat congelado > CORACAO_PARADO_SEG) — e processa
// o próximo lote de cada. processarDisparo reivindica: sem duplicação.
export async function avancarDisparos(): Promise<number> {
  const abertos = await query<{ id: string }>(
    `select distinct d.id
       from cs.disparos d
       join cs.disparo_contatos dc on dc.disparo_id = d.id and dc.enviado = false
      where d.status = 'em_andamento'
        and (d.processando_em is null or d.processando_em < now() - make_interval(secs => $1))`,
    [CORACAO_PARADO_SEG],
  );
  for (const d of abertos) {
    await processarDisparo(d.id).catch((e) => log.error("erro ao avançar disparo", e, { disparoId: d.id }));
  }
  return abertos.length;
}

// Retomada MANUAL, pelo operador (botão na tela de Disparos). Diferente do cron,
// não espera o heartbeat morrer: reabre o disparo (mesmo que tenha sido fechado
// como 'erro' ou 'concluido' com pendentes), solta a reivindicação e reprocessa
// já. Só age se ainda há o que enviar — idempotente e seguro de clicar de novo.
export async function retomarDisparo(
  disparoId: string,
): Promise<{ ok: boolean; motivo?: string; pendentes: number }> {
  const d = await queryOne<{ status: string; pendentes: number }>(
    `select d.status,
            (select count(*)::int from cs.disparo_contatos dc
              where dc.disparo_id = d.id and dc.enviado = false) as pendentes
       from cs.disparos d where d.id = $1`,
    [disparoId],
  );
  if (!d) return { ok: false, motivo: "Disparo não encontrado.", pendentes: 0 };
  if (d.pendentes === 0) {
    return { ok: false, motivo: "Este disparo já enviou para todos — não há o que retomar.", pendentes: 0 };
  }
  // Reabre e libera a reivindicação num update só. Se um processo ainda estiver
  // vivo (heartbeat recente), processarDisparo recusa a reivindicação e nada
  // duplica; se morreu, este clique o traz de volta imediatamente.
  await query(
    `update cs.disparos
        set status = 'em_andamento', fase = 'enviando', concluido_em = null, processando_em = null
      where id = $1`,
    [disparoId],
  );
  log.info("disparo retomado manualmente pelo operador", { disparoId, pendentes: d.pendentes });
  // Processa em background (servidor persistente): a UI recebe a resposta na hora
  // e a fila vai andando em lotes auto-continuados.
  void processarDisparo(disparoId).catch((e) => log.error("erro ao retomar disparo (manual)", e, { disparoId }));
  return { ok: true, pendentes: d.pendentes };
}

// Fecha o disparo. Um disparo em que NADA foi enviado é um disparo com erro —
// marcá-lo 'concluido' (o que o código fazia) esconde a falha do painel.
async function finalizar(disparoId: string): Promise<void> {
  const r = await queryOne<{ enviados: number; total: number }>(
    `select count(*) filter (where enviado)::int as enviados, count(*)::int as total
       from cs.disparo_contatos where disparo_id = $1`,
    [disparoId],
  );
  const fracassou = (r?.total ?? 0) > 0 && (r?.enviados ?? 0) === 0;
  if (fracassou) log.error("disparo terminou sem nenhum envio", null, { disparoId, total: r?.total });
  await query(
    `update cs.disparos
        set status = $2, fase = 'concluido', concluido_em = now(), processando_em = null
      where id = $1`,
    [disparoId, fracassou ? "erro" : "concluido"],
  );
}

// Reivindica o disparo para este processo. `returning id` vazio = outro processo
// está com ele e o heartbeat está vivo. É um update condicional, atômico: dois
// processos disputando, só um leva.
async function reivindicar(disparoId: string): Promise<boolean> {
  const r = await queryOne<{ id: string }>(
    `update cs.disparos
        set processando_em = now()
      where id = $1
        and status = 'em_andamento'
        and (processando_em is null or processando_em < now() - make_interval(secs => $2))
      returning id`,
    [disparoId, CORACAO_PARADO_SEG],
  );
  return !!r;
}

// Retoma disparos cujo processo MORREU — o heartbeat parou de bater. Antes isto
// olhava `iniciado_em`, que não sabe se o processo está vivo: um disparo grande
// e saudável (>15 min) era "retomado" em cima de si mesmo, duplicando mensagem.
export async function retomarTravados(): Promise<number> {
  const travados = await query<{ id: string }>(
    `select id from cs.disparos
      where status = 'em_andamento'
        and (processando_em is null or processando_em < now() - make_interval(secs => $1))`,
    [CORACAO_PARADO_SEG],
  );
  for (const d of travados) {
    log.info("retomando disparo abandonado (heartbeat parado)", { disparoId: d.id });
    await processarDisparo(d.id).catch((e) => log.error("erro ao retomar disparo", e, { disparoId: d.id }));
  }
  return travados.length;
}

// ----- Variáveis do template -------------------------------------------------

// Lê o variaveis_map e confere que ele descreve exatamente o que o template
// declara. Devolve o erro (em vez de lançar) para o chamador marcar o disparo.
function mapaDoTemplate(t: Template): CampoVariavel[] | { erro: string } {
  const n = Number(t.variaveis) || 0;
  if (n <= 0) return [];

  const bruto = t.variaveis_map;
  // Sem map e uma variável só: é o contrato histórico (o primeiro nome).
  const map = Array.isArray(bruto) ? bruto.map(String) : n === 1 ? ["primeiro_nome"] : [];

  if (map.length !== n) {
    return {
      erro: `template "${t.nome}" declara ${n} variáve${n === 1 ? "l" : "is"}, mas variaveis_map descreve ${map.length}. Preencha o mapa das variáveis no cadastro do template.`,
    };
  }
  const desconhecida = map.find((c) => !(CAMPOS_VARIAVEL as readonly string[]).includes(c));
  if (desconhecida) {
    return {
      erro: `template "${t.nome}" usa a variável desconhecida "${desconhecida}". Disponíveis: ${CAMPOS_VARIAVEL.join(", ")}.`,
    };
  }
  return map as CampoVariavel[];
}

// Resolve os parâmetros para UM contato, na ordem do template. A Meta recusa
// parâmetro vazio, então um valor que não existe vira erro do contato — nunca
// uma string vazia no corpo da mensagem.
function resolverParams(
  mapa: CampoVariavel[],
  l: LinhaDB,
  evento: string,
): { params: BodyParam[] | undefined } | { erro: string } {
  if (mapa.length === 0) return { params: undefined };

  const params: BodyParam[] = [];
  for (const campo of mapa) {
    let texto = "";
    switch (campo) {
      case "primeiro_nome":
        // Contato sem nome recebe o fallback neutro: "Olá tudo bem" em vez de
        // "Olá " — comportamento que já existia e é deliberado.
        texto = primeiroNome(l.nome) || FALLBACK_VAR;
        break;
      case "nome":
        texto = (l.nome ?? "").trim() || FALLBACK_VAR;
        break;
      case "edicao":
        texto = (l.edicao ?? "").trim();
        break;
      case "evento":
        texto = evento;
        break;
    }
    if (!texto) return { erro: `sem valor para a variável "${campo}" deste contato` };
    params.push({ type: "text", text: texto });
  }
  return { params };
}

async function enviarComRetry(
  phone: string,
  templateId: string,
  bodyParameters: BodyParam[] | undefined,
  contatoId: string,
  cfg?: CanalCfg,
): Promise<EnvioResultado> {
  let r = await sendTemplate({ phone, templateId, bodyParameters, cfg });
  let tentativa = 0;
  while (!r.ok && ehTransitorio(r.status) && tentativa < RETRY_BACKOFF_MS.length) {
    const espera = RETRY_BACKOFF_MS[tentativa];
    log.warn("envio falhou; agendando retry", { contatoId, status: r.status, erro: r.erro, tentativa: tentativa + 1, de: RETRY_BACKOFF_MS.length, esperaMs: espera });
    await sleep(espera);
    r = await sendTemplate({ phone, templateId, bodyParameters, cfg });
    tentativa++;
  }
  if (!r.ok && tentativa > 0) {
    r = { ...r, erro: `${r.erro || `HTTP ${r.status}`} (após ${tentativa + 1} tentativas)` };
  }
  return r;
}
