import { NextResponse } from "next/server";
import { isAuthed } from "@/lib/auth";
import { query } from "@/lib/db";

export const runtime = "nodejs";

// GET /api/ligacoes/diag-casamento — por que as chamadas SEM aluno não casaram?
// Para uma amostra das não-casadas, conta quantos compradores da base batem o
// telefone (últimos 8 dígitos de from_number OU dnis) e classifica:
//   sem_match  → nenhum comprador com esse número  → NÃO é comprador (esperado)
//   match_unico→ exatamente 1 comprador            → DEVERIA ter casado (bug!)
//   ambiguo    → 2+ compradores                    → recusado p/ não errar
// Autenticado; rode logado no navegador. Mostra exemplos só dos casos úteis.
export async function GET(req: Request) {
  if (!isAuthed()) return NextResponse.json({ ok: false }, { status: 401 });
  const amostra = Math.min(Math.max(Number(new URL(req.url).searchParams.get("amostra")) || 300, 1), 2000);

  try {
    const linhas = await query<{
      id: string; from_number: string | null; dnis: string | null;
      direction: string | null; matches: number;
    }>(
      `with sem_aluno as (
         select id, from_number, dnis, direction,
                right(regexp_replace(coalesce(from_number, ''), '\\D', '', 'g'), 8) as f8,
                right(regexp_replace(coalesce(dnis, ''),        '\\D', '', 'g'), 8) as d8
           from cs.ligacoes
          where provider = 'atendesimples' and comprador_id is null
          order by criado_em desc
          limit $1
       )
       select s.id, s.from_number, s.dnis, s.direction,
              (select count(distinct v.comprador_id)
                 from cs.contatos_evento v
                where v.telefone is not null
                  and right(regexp_replace(v.telefone, '\\D', '', 'g'), 8) in (s.f8, s.d8)
                  and length(coalesce(s.f8, '')) >= 8) as matches
         from sem_aluno s`,
      [amostra],
    );

    const semMatch = linhas.filter((l) => Number(l.matches) === 0);
    const unico = linhas.filter((l) => Number(l.matches) === 1);
    const ambiguo = linhas.filter((l) => Number(l.matches) > 1);
    const mask = (n: string | null) => (n ? n.replace(/\d(?=\d{4})/g, "•") : null);

    return NextResponse.json({
      ok: true,
      amostra: linhas.length,
      sem_match: semMatch.length,
      match_unico: unico.length,
      ambiguo: ambiguo.length,
      // Exemplos só dos casos que indicam BUG (deveria casar) ou ambiguidade.
      exemplos_match_unico: unico.slice(0, 8).map((l) => ({ from: mask(l.from_number), dnis: mask(l.dnis), direction: l.direction })),
      exemplos_ambiguo: ambiguo.slice(0, 5).map((l) => ({ from: mask(l.from_number), dnis: mask(l.dnis), matches: Number(l.matches) })),
      nota: "match_unico > 0 = compradores sendo perdidos (investigar formato). sem_match alto = chamadas a não-compradores (esperado).",
    });
  } catch (e) {
    return NextResponse.json({ ok: false, reason: e instanceof Error ? e.message : "erro" });
  }
}
