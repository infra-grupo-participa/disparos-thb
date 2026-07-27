import { NextResponse } from "next/server";
import { podeDisparar } from "@/lib/auth";
import { guard } from "@/lib/guard";
import { query, queryOne } from "@/lib/db";
import { eventoDe } from "@/lib/services/evento";
import { getCanal } from "@/lib/services/canais";
import { createContact, sendTemplate, type BodyParam } from "@/lib/unnichat";
import { normalizePhone, primeiroNome } from "@/lib/phone";

export const runtime = "nodejs";

// POST /api/templates/teste { templateId, telefone? } — dispara o template para o
// WhatsApp do PRÓPRIO operador, para ele ver a mensagem antes de mandar em massa.
// Se o operador ainda não tem número, informa aqui e o sistema salva no perfil
// (fica guardado para os próximos testes). Não passa pelo guarda de volume: é uma
// única mensagem para si mesmo, um ensaio.
export async function POST(req: Request) {
  const evento = eventoDe(req);
  // Portal do evento resolvido contra a whitelist da conta (0145).
  const g = await guard({ portal: evento });
  if (!g.ok) return g.res;
  const sessao = g.sessao;
  if (!podeDisparar(sessao.papel, evento)) {
    return NextResponse.json({ ok: false, reason: "sem_permissao_disparo" }, { status: 403 });
  }

  const b = (await req.json().catch(() => ({}))) as { templateId?: string; telefone?: string };
  if (!b.templateId) return NextResponse.json({ ok: false, reason: "template_obrigatorio" }, { status: 400 });

  // Número: o informado (e salvo no perfil) ou o já cadastrado. Sem número, pede.
  let tel = b.telefone ? normalizePhone(b.telefone) : null;
  if (b.telefone && !tel) {
    return NextResponse.json({ ok: false, reason: "telefone_invalido", motivo: "Número inválido. Use DDD + número, ex.: 21999998888." }, { status: 400 });
  }
  if (tel) {
    await query(`update cs.usuarios set telefone = $2, atualizado_em = now() where id = $1`, [sessao.id, tel]);
  } else {
    tel = sessao.telefone ? normalizePhone(sessao.telefone) : null;
  }
  if (!tel) {
    return NextResponse.json({ ok: false, reason: "sem_telefone", motivo: "Informe seu número de WhatsApp para receber o teste." }, { status: 400 });
  }

  const t = await queryOne<{ unnichat_id: string; variaveis: number; nome: string }>(
    `select unnichat_id, variaveis, nome from cs.templates where id = $1 and evento = $2 and canal = 'whatsapp'`,
    [b.templateId, evento],
  );
  if (!t || !t.unnichat_id) {
    return NextResponse.json({ ok: false, reason: "template_invalido", motivo: "Template de WhatsApp não encontrado (ou sem ID da Unnichat)." }, { status: 400 });
  }

  const canal = await getCanal(evento);
  await createContact({ name: sessao.nome || tel, phone: tel, cfg: canal });

  // Variáveis: a 1ª recebe o próprio nome do operador; as demais, um exemplo.
  const bodyParameters: BodyParam[] = [];
  for (let i = 1; i <= (t.variaveis || 0); i++) {
    bodyParameters.push({ type: "text", text: i === 1 ? (primeiroNome(sessao.nome) || "Teste") : `exemplo ${i}` });
  }

  const r = await sendTemplate({
    phone: tel,
    templateId: t.unnichat_id,
    bodyParameters: bodyParameters.length ? bodyParameters : undefined,
    cfg: canal,
  });
  if (!r.ok) {
    return NextResponse.json({ ok: false, reason: "falha_envio", motivo: r.erro || "Falha ao enviar o teste." }, { status: 400 });
  }
  return NextResponse.json({ ok: true, telefone: tel });
}
