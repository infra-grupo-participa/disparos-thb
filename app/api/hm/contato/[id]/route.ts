import { NextResponse } from "next/server";
import { isAuthed, getSessao } from "@/lib/auth";
import { query, queryOne } from "@/lib/db";
import { parseBody, HmContatoPatchSchema } from "@/lib/validators";
import { moverEstagioHm, registrarPagamentoHm, addNotaHm, reverterEstagioHm, setResponsavelHm, HM_STAGE_ENTREVISTA } from "@/lib/services/hm";

export const runtime = "nodejs";

// GET: detalhe do card HM + timeline + formulários (Respondi).
export async function GET(_req: Request, { params }: { params: { id: string } }) {
  if (!isAuthed()) return NextResponse.json({ ok: false }, { status: 401 });
  const compradorId = params.id;

  const contato = await queryOne(
    `select comprador_id, nome, email, telefone, turma, plano, categoria_entrada,
            estagio_chave, estagio_nome, estagio_aba, responsavel,
            reuniao_em, reuniao_resultado, entrevista_em, entrevista_resultado,
            pagamento_forma, pagamento_parcelas, pagamento_em, apto_ativacao,
            tags, observacoes, criado_em
       from cs.contatos_hm_kanban where comprador_id = $1`,
    [compradorId],
  );
  if (!contato) return NextResponse.json({ ok: false, reason: "não encontrado" }, { status: 404 });

  const timeline = await query(
    `select i.tipo, i.descricao, i.autor, i.criado_em
       from cs.interacoes i
       join cs.contatos_hm ch on ch.id = i.contato_hm_id
      where ch.comprador_id = $1
      order by i.criado_em desc
      limit 200`,
    [compradorId],
  );

  // Formulários do comprador (Respondi / HT). Mesma tabela cs.formularios.
  const formularios = await query(
    `select tipo, respostas, pontuacao, respondido_em
       from cs.formularios where comprador_id = $1
      order by respondido_em desc nulls last`,
    [compradorId],
  );

  return NextResponse.json({ ok: true, contato, timeline, formularios });
}

// PATCH: atualiza estágio / campos da ficha HM / pagamento do saldo / nota.
export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const sessao = await getSessao();
  if (!sessao) return NextResponse.json({ ok: false }, { status: 401 });
  const operador = sessao.nome || "cs";
  const compradorId = params.id;
  const parsed = await parseBody(req, HmContatoPatchSchema);
  if (!parsed.ok) return parsed.res;
  const b = parsed.data;

  const atual = await queryOne<{ id: string; estagio_chave: string | null; reuniao_em: string | null }>(
    `select ch.id, est.chave as estagio_chave, ch.reuniao_em
       from cs.contatos_hm ch left join cs.estagios est on est.id = ch.estagio_id
      where ch.comprador_id = $1`,
    [compradorId],
  );
  if (!atual) return NextResponse.json({ ok: false, reason: "não encontrado" }, { status: 404 });

  // Desfazer o último movimento (miss click) — ação isolada, ignora os demais campos.
  if (b.reverter) {
    const ok = await reverterEstagioHm(compradorId, operador);
    return NextResponse.json({ ok, reason: ok ? undefined : "sem_movimento_para_reverter" });
  }

  // Campos simples da ficha (atualiza só os enviados; string vazia limpa).
  const sets: string[] = [];
  const vals: unknown[] = [atual.id];
  const add = (col: string, v: unknown) => {
    sets.push(`${col} = $${vals.length + 1}`);
    vals.push(v === "" ? null : v);
  };
  if (b.observacoes !== undefined) add("observacoes", b.observacoes);
  if (b.plano !== undefined) add("plano", b.plano);
  if (b.reuniao_resultado !== undefined) add("reuniao_resultado", b.reuniao_resultado);
  if (b.entrevista_resultado !== undefined) add("entrevista_resultado", b.entrevista_resultado);
  if (b.reuniao_em !== undefined) sets.push(`reuniao_em = ${b.reuniao_em ? `$${vals.push(b.reuniao_em)}::timestamptz` : "null"}`);
  if (b.entrevista_em !== undefined) sets.push(`entrevista_em = ${b.entrevista_em ? `$${vals.push(b.entrevista_em)}::timestamptz` : "null"}`);
  if (b.tags !== undefined) { sets.push(`tags = $${vals.length + 1}`); vals.push(b.tags); }
  if (sets.length) {
    await query(`update cs.contatos_hm set ${sets.join(", ")}, atualizado_em = now() where id = $1`, vals);
  }

  // Responsável — via serviço (registra a mudança na timeline; permite reatribuir).
  if (b.responsavel !== undefined) await setResponsavelHm(compradorId, b.responsavel || null, operador);

  // Agendou reunião estando em "Comprou HM" → avança para "Reunião Agendada".
  if (b.reuniao_em) {
    await addNotaHm(compradorId, `Reunião agendada para ${fmtBr(b.reuniao_em)}`, operador);
    if (atual.estagio_chave === "hm_comprou") await moverEstagioHm(compradorId, "hm_reuniao_agendada", operador);
  }
  if (b.entrevista_em) {
    await addNotaHm(compradorId, `Entrevista agendada para ${fmtBr(b.entrevista_em)}`, operador);
    if (atual.estagio_chave && ["hm_apto_ativacao", "hm_pagamento_realizado", "hm_comprou", "hm_reuniao_agendada", "hm_reuniao_finalizada"].includes(atual.estagio_chave)) {
      await moverEstagioHm(compradorId, HM_STAGE_ENTREVISTA, operador);
    }
  }

  // Pagamento do saldo (14.700) — dispara a transição para Ativação.
  if (b.marcar_pagamento || b.pagamento_forma) {
    await registrarPagamentoHm(compradorId, b.pagamento_forma ?? "avista", b.pagamento_parcelas ?? null, operador);
  }

  // Mudança de estágio manual (via seletor) — depois dos automáticos.
  if (b.estagio_chave) await moverEstagioHm(compradorId, b.estagio_chave, operador);

  // Nota manual na timeline.
  if (b.nota && b.nota.trim()) await addNotaHm(compradorId, b.nota.trim(), operador);

  return NextResponse.json({ ok: true });
}

function fmtBr(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
}
