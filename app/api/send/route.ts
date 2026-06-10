import { NextResponse } from "next/server";
import { isAuthed } from "@/lib/auth";
import { query, queryOne } from "@/lib/db";
import { sendTemplate, createContact, type BodyParam, type EnvioResultado } from "@/lib/unnichat";
import { normalizePhone, primeiroNome } from "@/lib/phone";
import { logger } from "@/lib/log";
import { parseBody, SendSchema } from "@/lib/validators";

export const runtime = "nodejs";
const log = logger("send");
export const maxDuration = 300;

const DELAY_MS = 350; // pausa entre envios (rate limit gentil)
const DELAY_CRIAR_MS = 200; // pausa entre criações de contato na Unnichat
const DELAY_429_MS = 5000; // pausa extra após 429 (respeita rate limit do Unnichat)
const RETRY_BACKOFF_MS = [1000, 3000, 8000]; // espera crescente entre tentativas
const FALLBACK_VAR = "tudo bem"; // texto neutro quando não há nome para a variável
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Decide se um erro é transitório (vale retry): rede/timeout (status 0),
// rate limit (429) e erros de servidor (5xx). 4xx (exceto 429) são definitivos.
function ehTransitorio(status: number): boolean {
  return status === 0 || status === 429 || status >= 500;
}

type Template = { id: string; nome: string; unnichat_id: string; variaveis: number };
type Linha = { id: string; comprador_id: string; nome: string; telefone: string };

export async function POST(req: Request) {
  if (!isAuthed()) return NextResponse.json({ ok: false }, { status: 401 });

  const p = await parseBody(req, SendSchema);
  if (!p.ok) return p.res;
  const { templateId, compradorIds } = p.data;
  const edicao = p.data.edicao ? String(p.data.edicao) : null;

  const template = await queryOne<Template>(
    `select id, nome, unnichat_id, variaveis from cs.templates where id = $1 and ativo`,
    [templateId],
  );
  if (!template) {
    return NextResponse.json({ ok: false, reason: "template inválido ou inativo" }, { status: 400 });
  }

  const contatos = await query<{ comprador_id: string; nome: string; telefone: string; edicao: string | null }>(
    `select comprador_id, nome, telefone, edicao from cs.contatos_ht
      where comprador_id = any($1::uuid[]) and telefone is not null and telefone <> ''
        and comprador_id not in (select comprador_id from cs.contatos where opt_out)`,
    [compradorIds],
  );
  // Quantos da seleção foram bloqueados por opt-out (informativo para o front).
  const optOut = await queryOne<{ n: number }>(
    `select count(*)::int as n from cs.contatos where comprador_id = any($1::uuid[]) and opt_out`,
    [compradorIds],
  );
  if (contatos.length === 0) {
    return NextResponse.json({
      ok: false,
      reason: (optOut?.n ?? 0) > 0 ? "todos os contatos selecionados pediram para não receber (opt-out)" : "nenhum contato com telefone",
    }, { status: 400 });
  }

  // Edição da campanha: usa a explícita do body; se ausente, deriva dos contatos
  // selecionados quando todos pertencem à mesma edição (caso típico). Mistura de
  // edições deixa null. Isso alimenta o filtro por edição do dashboard (Fase 6).
  let edicaoFinal = edicao;
  if (!edicaoFinal) {
    const distintas = [...new Set(contatos.map((c) => c.edicao).filter(Boolean))];
    if (distintas.length === 1) edicaoFinal = distintas[0] as string;
  }

  const disparo = await queryOne<{ id: string }>(
    `insert into cs.disparos (template_id, edicao_ht, status, operador)
     values ($1, $2, 'em_andamento', 'cs') returning id`,
    [templateId, edicaoFinal],
  );
  const disparoId = disparo!.id;

  const linhas: Linha[] = [];
  for (const c of contatos) {
    const tel = normalizePhone(c.telefone)!;
    const row = await queryOne<{ id: string }>(
      `insert into cs.disparo_contatos (disparo_id, comprador_id, telefone, enviado)
       values ($1, $2, $3, false) returning id`,
      [disparoId, c.comprador_id, tel],
    );
    linhas.push({ id: row!.id, comprador_id: c.comprador_id, nome: c.nome, telefone: tel });
  }

  // Processamento em background (servidor persistente — Hostinger Node / next start).
  void processar(disparoId, template, linhas).catch((e) =>
    log.error("erro ao processar disparo", e, { disparoId }),
  );

  return NextResponse.json({ ok: true, disparoId, total: linhas.length, pulados_opt_out: optOut?.n ?? 0 });
}

async function processar(disparoId: string, template: Template, linhas: Linha[]) {
  // ===== Fase 1: garantir os contatos na Unnichat (idempotente) =====
  // O template só pode ser enviado para um contato que existe na Unnichat.
  // Compradores HT entram no nosso sistema automaticamente, mas podem não existir
  // lá — então criamos/garantimos cada um antes de disparar.
  await query(`update cs.disparos set fase = 'criando_contatos' where id = $1`, [disparoId]);
  let criados = 0;
  const prontos: Linha[] = [];
  for (const l of linhas) {
    const r = await createContact({ name: l.nome || l.telefone, phone: l.telefone });
    if (r.ok) {
      criados++;
      prontos.push(l);
      // Guarda o contactId da Unnichat para consultar o status de entrega depois.
      await query(
        `update cs.disparo_contatos set contato_criado = true, erro_contato = null, unnichat_contact_id = $2 where id = $1`,
        [l.id, r.contactId ?? null],
      );
    } else {
      // Não conseguiu criar o contato → não será disparado; registra o motivo.
      await query(
        `update cs.disparo_contatos set contato_criado = false, erro_contato = $2, erro = $2 where id = $1`,
        [l.id, r.erro || "falha ao criar contato na Unnichat"],
      );
    }
    await query(`update cs.disparos set total_contatos_criados = $2 where id = $1`, [disparoId, criados]);
    await sleep(DELAY_CRIAR_MS);
  }

  // ===== Fase 2: enviar o template (só para quem foi criado com sucesso) =====
  await query(`update cs.disparos set fase = 'enviando' where id = $1`, [disparoId]);
  let enviados = 0;
  for (const l of prontos) {
    // Validação variáveis↔parâmetros: o template declara N variáveis no body.
    // Se declara >=1 mas não há nome para preencher, usa texto neutro (fallback
    // seguro) em vez de mandar variável vazia — que o WhatsApp pode rejeitar.
    let params: BodyParam[] | undefined;
    if (Number(template.variaveis) >= 1) {
      let texto = primeiroNome(l.nome);
      if (!texto) {
        texto = FALLBACK_VAR;
        log.warn("contato sem nome para a variável do template; usando fallback neutro", { contatoId: l.id, template: template.nome });
      }
      params = [{ type: "text", text: texto }];
    }

    const r = await enviarComRetry(l.telefone, template.unnichat_id, params, l.id);

    // Respeita rate limit: se o último resultado foi 429, dá uma pausa maior
    // antes do próximo contato para não insistir contra o limite do Unnichat.
    const pausaProximo = r.status === 429 ? DELAY_429_MS : DELAY_MS;

    if (r.ok) {
      enviados++;
      await query(`update cs.disparo_contatos set enviado = true, enviado_em = now(), erro = null where id = $1`, [l.id]);
      // avança estágio (inicial -> contatado) + marca contato
      // Registra o contato; a movimentação na jornada (→ Em Onboarding) acontece
      // quando o lead responde (webhook), não apenas por ter recebido o disparo.
      await query(
        `update cs.contatos
            set ultimo_contato_em = now(),
                primeiro_contato_em = coalesce(primeiro_contato_em, now()),
                atualizado_em = now()
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

    await query(`update cs.disparos set total_enviados = $2 where id = $1`, [disparoId, enviados]);
    await sleep(pausaProximo);
  }

  await query(
    `update cs.disparos set status = 'concluido', fase = 'concluido', concluido_em = now(), total_enviados = $2 where id = $1`,
    [disparoId, enviados],
  );
}

// Envia um template com retry/backoff para erros transitórios (rede, 429, 5xx).
// Tenta até 1 + RETRY_BACKOFF_MS.length vezes. Erros 4xx (exceto 429) abortam
// imediatamente (são definitivos). Retorna o último EnvioResultado.
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

  // Anota no erro a contagem de tentativas para diagnóstico, quando houve retry.
  if (!r.ok && tentativa > 0) {
    r = { ...r, erro: `${r.erro || `HTTP ${r.status}`} (após ${tentativa + 1} tentativas)` };
  }
  return r;
}
