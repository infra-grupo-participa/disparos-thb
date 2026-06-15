import { NextResponse } from "next/server";
import { getSessao } from "@/lib/auth";
import { query, queryOne } from "@/lib/db";
import { normalizePhone } from "@/lib/phone";
import { RESULTADO_LABEL } from "@/lib/atendesimples";

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
    const candidatos = [l.from_number, l.dnis]
      .map((n) => (n ? normalizePhone(String(n)) : null))
      .filter((n): n is string => !!n);

    let m: { comprador_id: string; evento: string } | null = null;
    let tel: string | null = null;
    for (const norm of candidatos) {
      m = await queryOne<{ comprador_id: string; evento: string }>(
        `select comprador_id, evento from cs.contatos_evento
          where telefone is not null and right(regexp_replace(telefone, '\\D', '', 'g'), 8) = $1
          limit 1`,
        [norm.slice(-8)],
      );
      if (m) { tel = norm; break; }
    }
    if (!m) continue;

    await query(
      `update cs.ligacoes set comprador_id = $2, evento = $3, telefone = coalesce($4, telefone) where id = $1`,
      [l.id, m.comprador_id, m.evento, tel],
    );

    const rotulo = l.resultado ? RESULTADO_LABEL[l.resultado] ?? l.resultado : "Ligação";
    const partes = [rotulo];
    if (l.duracao_seg) partes.push(`${Math.max(1, Math.round(l.duracao_seg / 60))}min`);
    if (l.operador) partes.push(l.operador);
    await query(
      `insert into cs.interacoes (contato_id, tipo, descricao, autor)
       select id, 'ligacao', $2, $3 from cs.contatos where comprador_id = $1`,
      [m.comprador_id, `📞 ${partes.join(" · ")}`, l.operador ?? "atende-simples"],
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
      [m.comprador_id, l.criado_em, atendeu],
    );
    casadas++;
  }

  return NextResponse.json({ ok: true, verificadas: semAluno.length, casadas });
}
