import { NextResponse } from "next/server";
import { isAuthed } from "@/lib/auth";
import { query } from "@/lib/db";

export const runtime = "nodejs";

// Lê a view curada cs.contatos_ht (única janela do app para o public).
// Filtros: estagio (chave), edicao (ilike), q (nome/email/telefone), com_telefone.
export async function GET(req: Request) {
  if (!isAuthed()) {
    return NextResponse.json({ ok: false, reason: "unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const estagio = searchParams.get("estagio") || null;
  const edicao = searchParams.get("edicao") || null;
  const q = searchParams.get("q") || null;
  const comTelefone = searchParams.get("com_telefone") === "1";

  const contatos = await query(
    `select comprador_id, nome, email, telefone, edicao, edicao_ht, edition_number,
            ultima_compra_ht, estagio_chave, estagio_nome,
            proxima_acao_em, ultima_resposta_em, ultimo_contato_em
       from cs.contatos_ht
      where ($1::text is null or estagio_chave = $1)
        and ($2::text is null or edicao_ht = $2 or edicao ilike '%' || $2 || '%')
        and ($3::text is null or nome ilike '%' || $3 || '%'
             or email ilike '%' || $3 || '%' or telefone ilike '%' || $3 || '%')
        and ($4::boolean is false or (telefone is not null and telefone <> ''))
      order by ultima_compra_ht desc nulls last
      limit 1000`,
    [estagio, edicao, q, comTelefone],
  );

  return NextResponse.json({ ok: true, total: contatos.length, contatos });
}
