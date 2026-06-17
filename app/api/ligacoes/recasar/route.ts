import { NextResponse } from "next/server";
import { getSessao } from "@/lib/auth";
import { query, queryOne } from "@/lib/db";
import { logger } from "@/lib/log";
import { RESULTADO_LABEL } from "@/lib/atendesimples";
import { casarTelefone } from "@/lib/services/ligacoes";

export const runtime = "nodejs";
export const maxDuration = 300;
const log = logger("ligacoes:recasar");

// POST /api/ligacoes/recasar?limite=150 — re-tenta o casamento por telefone das
// ligações do Atende Simples que ficaram SEM aluno, com o casamento robusto
// (maior sufixo + sem ambiguidade). Admin. Processa em LOTE (default 150) para
// não estourar o timeout do proxy — retorna `restantes`; é só chamar de novo
// até zerar. Idempotente (só pega comprador_id null) e tolerante por registro.
export async function POST(req: Request) {
  const sessao = await getSessao();
  if (!sessao) return NextResponse.json({ ok: false }, { status: 401 });
  if (sessao.papel !== "admin") return NextResponse.json({ ok: false, reason: "forbidden" }, { status: 403 });

  const limite = Math.min(Math.max(Number(new URL(req.url).searchParams.get("limite")) || 150, 1), 500);

  try {
    const semAluno = await query<{
      id: string; from_number: string | null; dnis: string | null;
      resultado: string | null; operador: string | null; duracao_seg: number | null; criado_em: string;
    }>(
      `select id, from_number, dnis, resultado, operador, duracao_seg, criado_em
         from cs.ligacoes
        where provider = 'atendesimples' and comprador_id is null
        order by criado_em desc
        limit $1`,
      [limite],
    );

    let casadas = 0;
    const erros: string[] = [];
    for (const l of semAluno) {
      try {
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
      } catch (e) {
        erros.push(`${l.id}: ${e instanceof Error ? e.message : "erro"}`);
      }
    }

    // Quantas ainda restam sem aluno (para o operador saber se chama de novo).
    const restantes = (await queryOne<{ n: number }>(
      `select count(*)::int as n from cs.ligacoes where provider = 'atendesimples' and comprador_id is null`,
    ))?.n ?? 0;

    if (erros.length) log.warn("re-casamento com erros parciais", { erros: erros.slice(0, 10) });
    return NextResponse.json({
      ok: true, verificadas: semAluno.length, casadas, restantes, com_erro: erros.length,
      ...(erros.length ? { exemplos_erro: erros.slice(0, 5) } : {}),
    });
  } catch (e) {
    log.error("falha no re-casamento", e);
    return NextResponse.json({ ok: false, reason: e instanceof Error ? e.message : "erro ao re-casar" });
  }
}
