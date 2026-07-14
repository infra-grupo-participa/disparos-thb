import { NextResponse } from "next/server";
import { getSessao, podeDisparar } from "@/lib/auth";
import { query, queryOne } from "@/lib/db";
import { logger } from "@/lib/log";
import { processarDisparoEmail, getRemetente } from "@/lib/services/email";
import { diagnosticarTemplate } from "@/lib/services/ac-automacoes";
import { eventoDe } from "@/lib/services/evento";

export const runtime = "nodejs";
export const maxDuration = 300;
const log = logger("send-email");

// POST /api/send-email — disparo de e-mail (ActiveCampaign). Espelha /api/send:
// mesma trava de papel (só admin/disparador), mesmo respeito a opt-out, mesmo
// padrão de campanha (disparo + linhas) processado em background e retomável
// pelo cron.
//
// Dois modos de template (ver 0079):
//   'campanha' — escreve o corpo aqui e lança a campanha no AC. Sem automação.
//   'tag'      — legado: aplica a tag e depende de uma automação montada no AC,
//                que precisa existir e estar ativa (senão o e-mail não sai).
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

  const template = await queryOne<{ id: string; modo: string; ac_tag_id: string | null; assunto: string | null; corpo_html: string | null }>(
    `select id, modo, ac_tag_id, assunto, corpo_html
       from cs.templates where id = $1 and ativo and canal = 'email'`,
    [templateId],
  );
  if (!template) {
    return NextResponse.json({ ok: false, reason: "template de e-mail inválido ou inativo" }, { status: 400 });
  }

  if (template.modo === "campanha") {
    // Campanha direta: o corpo é nosso, e o remetente (nome, e-mail, endereço e
    // a frase de lembrete) é exigência do AC e da lei anti-spam. Recusar aqui,
    // com a causa escrita, é melhor do que descobrir no meio do envio.
    if (!template.assunto || !template.corpo_html) {
      return NextResponse.json({ ok: false, reason: "o template não tem assunto ou corpo do e-mail" }, { status: 400 });
    }
    if (!(await getRemetente())) {
      return NextResponse.json(
        { ok: false, reason: "remetente_nao_configurado", motivo: "Configure o remetente do e-mail (nome, e-mail, site, endereço e a frase de lembrete) na tela de Canais antes de disparar." },
        { status: 409 },
      );
    }
  } else {
    // Modo tag (legado): sem tag, ou com uma tag que não aciona automação ATIVA,
    // aplicar a tag não envia nada (incidente 2026-06-16). Bloqueia de vez.
    if (!template.ac_tag_id) {
      return NextResponse.json({ ok: false, reason: "template de e-mail sem tag do AC configurada" }, { status: 400 });
    }
    const diag = await diagnosticarTemplate(templateId, evento).catch(() => null);
    if (diag && !diag.pronto) {
      return NextResponse.json({ ok: false, reason: diag.detalhe, veredito: diag }, { status: 409 });
    }
  }

  // Contatos do evento com e-mail válido, sem opt-out e sem hard bounce. O hard
  // bounce é endereço morto: insistir só piora a reputação do domínio, que é o
  // que decide se o e-mail dos outros cai na caixa de entrada ou no spam.
  const contatos = await query<{ comprador_id: string; email: string; edicao: string | null }>(
    `select v.comprador_id, v.email, v.edicao from cs.contatos_evento v
      where v.evento = $2 and v.comprador_id = any($1::uuid[])
        and v.email is not null and v.email like '%@%'
        and v.comprador_id not in (select comprador_id from cs.contatos where opt_out)
        and v.comprador_id not in (select comprador_id from cs.email_contato where bounce_hard > 0)`,
    [compradorIds, evento],
  );

  const pulados = (await queryOne<{ opt_out: number; bounce: number }>(
    `select
       (select count(*) from cs.contatos where comprador_id = any($1::uuid[]) and opt_out)::int as opt_out,
       (select count(*) from cs.email_contato where comprador_id = any($1::uuid[]) and bounce_hard > 0)::int as bounce`,
    [compradorIds],
  )) ?? { opt_out: 0, bounce: 0 };

  if (contatos.length === 0) {
    const barrados = pulados.opt_out + pulados.bounce;
    return NextResponse.json({
      ok: false,
      reason: barrados > 0
        ? "todos os contatos selecionados estão bloqueados (opt-out ou e-mail que não existe mais)"
        : "nenhum contato com e-mail válido",
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

  // Insert único, com a trava de duplicata de 0080.
  await query(
    `insert into cs.disparo_email_contatos (disparo_id, comprador_id, email, enviado)
     select $1, c.comprador_id, c.email, false
       from unnest($2::uuid[], $3::text[]) as c(comprador_id, email)
     on conflict (disparo_id, comprador_id) where comprador_id is not null do nothing`,
    [disparoId, contatos.map((c) => c.comprador_id), contatos.map((c) => c.email)],
  );

  void processarDisparoEmail(disparoId).catch((e) => log.error("erro ao processar disparo de e-mail", e, { disparoId }));

  return NextResponse.json({
    ok: true,
    disparoId,
    total: contatos.length,
    modo: template.modo,
    pulados_opt_out: pulados.opt_out,
    pulados_bounce: pulados.bounce,
  });
}
