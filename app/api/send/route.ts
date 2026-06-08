import { NextResponse } from "next/server";
import { isAuthed } from "@/lib/auth";
import { query, queryOne } from "@/lib/db";
import { sendTemplate, type BodyParam } from "@/lib/unnichat";
import { normalizePhone, primeiroNome } from "@/lib/phone";

export const runtime = "nodejs";
export const maxDuration = 300;

const DELAY_MS = 350; // pausa entre envios (rate limit gentil)
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

type Template = { id: string; nome: string; unnichat_id: string; variaveis: number };
type Linha = { id: string; comprador_id: string; nome: string; telefone: string };

export async function POST(req: Request) {
  if (!isAuthed()) return NextResponse.json({ ok: false }, { status: 401 });

  const b = (await req.json().catch(() => ({}))) as {
    templateId?: string;
    compradorIds?: string[];
    edicao?: string;
  };
  const templateId = b.templateId;
  const compradorIds = b.compradorIds;
  const edicao = b.edicao ? String(b.edicao) : null;

  if (!templateId || !Array.isArray(compradorIds) || compradorIds.length === 0) {
    return NextResponse.json({ ok: false, reason: "templateId e compradorIds obrigatórios" }, { status: 400 });
  }

  const template = await queryOne<Template>(
    `select id, nome, unnichat_id, variaveis from cs.templates where id = $1 and ativo`,
    [templateId],
  );
  if (!template) {
    return NextResponse.json({ ok: false, reason: "template inválido ou inativo" }, { status: 400 });
  }

  const contatos = await query<{ comprador_id: string; nome: string; telefone: string; edicao: string | null }>(
    `select comprador_id, nome, telefone, edicao from cs.contatos_ht
      where comprador_id = any($1::uuid[]) and telefone is not null and telefone <> ''`,
    [compradorIds],
  );
  if (contatos.length === 0) {
    return NextResponse.json({ ok: false, reason: "nenhum contato com telefone" }, { status: 400 });
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
    console.error("[send] erro ao processar disparo:", e),
  );

  return NextResponse.json({ ok: true, disparoId, total: linhas.length });
}

async function processar(disparoId: string, template: Template, linhas: Linha[]) {
  let enviados = 0;
  for (const l of linhas) {
    const params: BodyParam[] | undefined =
      Number(template.variaveis) >= 1 ? [{ type: "text", text: primeiroNome(l.nome) }] : undefined;

    const r = await sendTemplate({ phone: l.telefone, templateId: template.unnichat_id, bodyParameters: params });

    if (r.ok) {
      enviados++;
      await query(`update cs.disparo_contatos set enviado = true, enviado_em = now(), erro = null where id = $1`, [l.id]);
      // avança estágio (inicial -> contatado) + marca contato
      await query(
        `update cs.contatos
            set ultimo_contato_em = now(),
                primeiro_contato_em = coalesce(primeiro_contato_em, now()),
                estagio_id = case
                  when estagio_id = (select id from cs.estagios where is_inicial order by ordem limit 1)
                  then (select id from cs.estagios where chave = 'contatado')
                  else estagio_id end,
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
    await sleep(DELAY_MS);
  }

  await query(`update cs.disparos set status = 'concluido', concluido_em = now(), total_enviados = $2 where id = $1`, [
    disparoId,
    enviados,
  ]);
}
