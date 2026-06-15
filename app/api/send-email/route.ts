import { NextResponse } from "next/server";
import { getSessao, podeDisparar } from "@/lib/auth";
import { query, queryOne } from "@/lib/db";
import { logger } from "@/lib/log";
import { processarDisparoEmail } from "@/lib/services/email";
import { eventoDe } from "@/lib/services/evento";

export const runtime = "nodejs";
export const maxDuration = 300;
const log = logger("send-email");

// POST /api/send-email — disparo de e-mail (ActiveCampaign). Espelha /api/send:
// mesma trava de papel (só admin/disparador), mesmo respeito a opt-out, mesmo
// padrão de campanha (disparo + linhas) processado em background e retomável
// pelo cron. O envio efetivo é por TAG → automação (ver lib/services/email.ts).
export async function POST(req: Request) {
  const sessao = await getSessao();
  if (!sessao) return NextResponse.json({ ok: false }, { status: 401 });
  if (!podeDisparar(sessao.papel)) {
    return NextResponse.json({ ok: false, reason: "sem_permissao_disparo" }, { status: 403 });
  }

  const b = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const templateId = b.templateId ? String(b.templateId) : "";
  const compradorIds = Array.isArray(b.compradorIds) ? b.compradorIds.map(String) : [];
  const edicao = b.edicao ? String(b.edicao) : null;
  const evento = eventoDe(req);

  if (!templateId || compradorIds.length === 0) {
    return NextResponse.json({ ok: false, reason: "templateId e compradorIds são obrigatórios" }, { status: 400 });
  }

  // O template precisa ser de e-mail, ativo e apontar para uma tag do AC.
  const template = await queryOne<{ id: string; ac_tag_id: string | null }>(
    `select id, ac_tag_id from cs.templates where id = $1 and ativo and canal = 'email'`,
    [templateId],
  );
  if (!template) {
    return NextResponse.json({ ok: false, reason: "template de e-mail inválido ou inativo" }, { status: 400 });
  }
  if (!template.ac_tag_id) {
    return NextResponse.json({ ok: false, reason: "template de e-mail sem tag do AC configurada" }, { status: 400 });
  }

  // Contatos do evento com e-mail válido e que não pediram opt-out.
  const contatos = await query<{ comprador_id: string; email: string; edicao: string | null }>(
    `select comprador_id, email, edicao from cs.contatos_evento
      where evento = $2 and comprador_id = any($1::uuid[])
        and email is not null and email like '%@%'
        and comprador_id not in (select comprador_id from cs.contatos where opt_out)`,
    [compradorIds, evento],
  );
  const optOut = await queryOne<{ n: number }>(
    `select count(*)::int as n from cs.contatos where comprador_id = any($1::uuid[]) and opt_out`,
    [compradorIds],
  );
  if (contatos.length === 0) {
    return NextResponse.json({
      ok: false,
      reason: (optOut?.n ?? 0) > 0 ? "todos os contatos selecionados pediram para não receber (opt-out)" : "nenhum contato com e-mail válido",
    }, { status: 400 });
  }

  // Edição: a explícita, ou derivada quando todos são da mesma.
  let edicaoFinal = edicao;
  if (!edicaoFinal) {
    const distintas = [...new Set(contatos.map((c) => c.edicao).filter(Boolean))];
    if (distintas.length === 1) edicaoFinal = distintas[0] as string;
  }

  const disparo = await queryOne<{ id: string }>(
    `insert into cs.disparos_email (template_id, edicao_ht, status, operador, evento, total_contatos)
     values ($1, $2, 'em_andamento', $3, $4, $5) returning id`,
    [templateId, edicaoFinal, sessao.nome || "cs", evento, contatos.length],
  );
  const disparoId = disparo!.id;

  for (const c of contatos) {
    await query(
      `insert into cs.disparo_email_contatos (disparo_id, comprador_id, email, enviado)
       values ($1, $2, $3, false)`,
      [disparoId, c.comprador_id, c.email],
    );
  }

  void processarDisparoEmail(disparoId).catch((e) => log.error("erro ao processar disparo de e-mail", e, { disparoId }));

  return NextResponse.json({ ok: true, disparoId, total: contatos.length, pulados_opt_out: optOut?.n ?? 0 });
}
