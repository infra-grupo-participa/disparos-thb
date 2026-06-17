import { NextResponse } from "next/server";
import { getSessao } from "@/lib/auth";
import { query } from "@/lib/db";
import { RESULTADO_LABEL } from "@/lib/atendesimples";
import { casarTelefone } from "@/lib/services/ligacoes";

export const runtime = "nodejs";
export const maxDuration = 300;

// POST /api/ligacoes/recasar — re-tenta o casamento por telefone das ligações do
// Atende Simples que ficaram SEM aluno (backfill após corrigir o campo do número
// do cliente). Admin. Vincula aluno/evento, espelha na timeline e marca os
// timestamps de contato (base do SLA). Idempotente: só pega comprador_id null.
export async function POST() {
  const sessao = await getSessao();
  if (!sessao) return NextResponse.json({ ok: false }, { status: 401 });
  if (sessao.papel !== "admin") return NextResponse.json({ ok: false, reason: "forbidden" }, { status: 403 });

  const semAluno = await query<{
    id: string; from_number: string | null; dnis: string | null;
    resultado: string | null; operador: string | null; duracao_seg: number | null; criado_em: string;
  }>(
    `select id, from_number, dnis, resultado, operador, duracao_seg, criado_em
       from cs.ligacoes
      where provider = 'atendesimples' and comprador_id is null
      order by criado_em desc
      limit 5000`,
  );

  let casadas = 0;
  for (const l of semAluno) {
    const m = await casarTelefone([l.from_number, l.dnis]);
    if (!m) continue;

    await query(
      `update cs.ligacoes set comprador_id = $2, evento = $3, telefone = coalesce($4, telefone) where id = $1`,
      [l.id, m.compradorId, m.evento, m.telefone],
    );

    const rotulo = l.resultado ? RESULTADO_LABEL[l.resultado] ?? l.resultado : "Ligação";
    const partes = [rotulo];
    if (l.duracao_seg) partes.push(`${Math.max(1, Math.round(l.duracao_seg / 60))}min`);
    if (l.operador) partes.push(l.operador);
    await query(
      `insert into cs.interacoes (contato_id, tipo, canal, descricao, autor)
       select id, 'ligacao', 'ligacao', $2, $3 from cs.contatos where comprador_id = $1`,
      [m.compradorId, `📞 ${partes.join(" · ")}`, l.operador ?? "atende-simples"],
    );

    // Timestamps de contato com a data REAL da chamada (não now), para o SLA.
    const atendeu = l.resultado === "atendeu";
    await query(
      `update cs.contatos set
         ultimo_contato_em   = greatest(coalesce(ultimo_contato_em, $2::timestamptz), $2::timestamptz),
         primeiro_contato_em = least(coalesce(primeiro_contato_em, $2::timestamptz), $2::timestamptz),
         ultima_resposta_em  = case when $3 then greatest(coalesce(ultima_resposta_em, $2::timestamptz), $2::timestamptz) else ultima_resposta_em end,
         atualizado_em       = now()
       where comprador_id = $1`,
      [m.compradorId, l.criado_em, atendeu],
    );
    casadas++;
  }

  return NextResponse.json({ ok: true, verificadas: semAluno.length, casadas });
}
