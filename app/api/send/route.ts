import { NextResponse } from "next/server";
import { getSessao, podeDisparar } from "@/lib/auth";
import { query, queryOne } from "@/lib/db";
import { normalizePhone } from "@/lib/phone";
import { logger } from "@/lib/log";
import { parseBody, SendSchema } from "@/lib/validators";
import { processarDisparo } from "@/lib/services/disparo";
import { eventoDe } from "@/lib/services/evento";

export const runtime = "nodejs";
export const maxDuration = 300;
const log = logger("send");

// Cria a campanha (disparo + linhas) e delega o processamento ao serviço, que
// é idempotente e resiliente (retomável pelo cron). Bloqueia quem deu opt-out.
export async function POST(req: Request) {
  // Trava de papel: só admin e disparador podem efetuar disparos. Operador
  // comum opera o Kanban/contatos normalmente, mas não envia. Esta é a fonte
  // da verdade — a UI apenas espelha (esconde os botões).
  const sessao = await getSessao();
  if (!sessao) return NextResponse.json({ ok: false }, { status: 401 });
  if (!podeDisparar(sessao.papel)) {
    return NextResponse.json({ ok: false, reason: "sem_permissao_disparo" }, { status: 403 });
  }

  const p = await parseBody(req, SendSchema);
  if (!p.ok) return p.res;
  const { templateId, compradorIds } = p.data;
  const edicao = p.data.edicao ? String(p.data.edicao) : null;
  const evento = eventoDe(req);

  const template = await queryOne<{ id: string }>(
    `select id from cs.templates where id = $1 and ativo`,
    [templateId],
  );
  if (!template) {
    return NextResponse.json({ ok: false, reason: "template inválido ou inativo" }, { status: 400 });
  }

  // HM vive num overlay isolado (cs.contatos_hm sobre `compradores`), fora de
  // cs.contatos_evento e sem opt-out. Resolve os destinatários pela view do HM;
  // os demais eventos (HT/SEM) seguem por cs.contatos_evento com filtro opt-out.
  const ehHM = evento === "HM";
  const contatos = ehHM
    ? await query<{ comprador_id: string; telefone: string; edicao: string | null }>(
        `select comprador_id, telefone, null::text as edicao from cs.contatos_hm_kanban
          where comprador_id = any($1::uuid[]) and telefone is not null and telefone <> ''`,
        [compradorIds],
      )
    : await query<{ comprador_id: string; telefone: string; edicao: string | null }>(
        `select comprador_id, telefone, edicao from cs.contatos_evento
          where evento = $2 and comprador_id = any($1::uuid[]) and telefone is not null and telefone <> ''
            and comprador_id not in (select comprador_id from cs.contatos where opt_out)`,
        [compradorIds, evento],
      );
  const optOut = ehHM
    ? { n: 0 }
    : await queryOne<{ n: number }>(
        `select count(*)::int as n from cs.contatos where comprador_id = any($1::uuid[]) and opt_out`,
        [compradorIds],
      );
  if (contatos.length === 0) {
    return NextResponse.json({
      ok: false,
      reason: (optOut?.n ?? 0) > 0 ? "todos os contatos selecionados pediram para não receber (opt-out)" : "nenhum contato com telefone",
    }, { status: 400 });
  }

  // Edição da campanha: a explícita, ou derivada quando todos são da mesma.
  let edicaoFinal = edicao;
  if (!edicaoFinal) {
    const distintas = [...new Set(contatos.map((c) => c.edicao).filter(Boolean))];
    if (distintas.length === 1) edicaoFinal = distintas[0] as string;
  }

  const disparo = await queryOne<{ id: string }>(
    `insert into cs.disparos (template_id, edicao_ht, status, operador, evento)
     values ($1, $2, 'em_andamento', $4, $3) returning id`,
    [templateId, edicaoFinal, evento, sessao.nome || "cs"],
  );
  const disparoId = disparo!.id;

  for (const c of contatos) {
    await query(
      `insert into cs.disparo_contatos (disparo_id, comprador_id, telefone, enviado)
       values ($1, $2, $3, false)`,
      [disparoId, c.comprador_id, normalizePhone(c.telefone)!],
    );
  }

  // Processamento em background (servidor persistente). Se cair no meio, o cron
  // retoma — processarDisparo só age sobre o que ainda não foi enviado.
  void processarDisparo(disparoId).catch((e) => log.error("erro ao processar disparo", e, { disparoId }));

  return NextResponse.json({ ok: true, disparoId, total: contatos.length, pulados_opt_out: optOut?.n ?? 0 });
}
