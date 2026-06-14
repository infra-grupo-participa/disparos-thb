import { NextResponse } from "next/server";
import { isAuthed } from "@/lib/auth";
import { query } from "@/lib/db";
import { eventoDe } from "@/lib/services/evento";

export const runtime = "nodejs";

// Lê a view curada cs.contatos_ht + tags do CS + lead score (termômetro).
// Filtros: estagio, edicao, q, com_telefone, com_tag, sem_tag, faixa (frio|morno|quente).
export async function GET(req: Request) {
  if (!isAuthed()) {
    return NextResponse.json({ ok: false, reason: "unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const estagio = searchParams.get("estagio") || null;
  const edicao = searchParams.get("edicao") || null;
  const q = searchParams.get("q") || null;
  const comTelefone = searchParams.get("com_telefone") === "1";
  const comTag = searchParams.get("com_tag") || null;
  const semTag = searchParams.get("sem_tag") || null;
  const faixa = searchParams.get("faixa") || null;

  const contatos = await query(
    `select v.comprador_id, v.nome, v.email, v.telefone, v.edicao, v.edicao_ht, v.edition_number,
            v.ultima_compra_ht, v.estagio_chave, v.estagio_nome,
            v.proxima_acao_em, v.ultima_resposta_em, v.ultimo_contato_em,
            coalesce(ct.tags, '{}'::text[]) as tags,
            coalesce(ls.score, 0)::int as score
       from cs.contatos_evento v
       left join cs.contatos ct on ct.comprador_id = v.comprador_id and ct.evento = v.evento
       left join cs.lead_scores ls on ls.comprador_id = v.comprador_id
      where v.evento = $8
        and ($1::text is null or v.estagio_chave = $1)
        and ($2::text is null or v.edicao_ht = $2 or v.edicao ilike '%' || $2 || '%')
        and ($3::text is null or v.nome ilike '%' || $3 || '%'
             or v.email ilike '%' || $3 || '%' or v.telefone ilike '%' || $3 || '%')
        and ($4::boolean is false or (v.telefone is not null and v.telefone <> ''))
        and ($5::text is null or $5 = any(ct.tags))
        and ($6::text is null or not ($6 = any(coalesce(ct.tags, '{}'::text[]))))
        and ($7::text is null
             or ($7 = 'quente' and coalesce(ls.score, 0) >= 60)
             or ($7 = 'morno'  and coalesce(ls.score, 0) between 30 and 59)
             or ($7 = 'frio'   and coalesce(ls.score, 0) < 30))
      order by v.ultima_compra_ht desc nulls last, v.ultima_resposta_em desc nulls last
      limit 1000`,
    [estagio, edicao, q, comTelefone, comTag, semTag, faixa, eventoDe(req)],
  );

  return NextResponse.json({ ok: true, total: contatos.length, contatos });
}
