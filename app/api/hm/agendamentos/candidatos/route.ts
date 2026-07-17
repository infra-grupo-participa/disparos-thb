import { NextResponse } from "next/server";
import { isAuthed } from "@/lib/auth";
import { query } from "@/lib/db";

export const runtime = "nodejs";

// GET /api/hm/agendamentos/candidatos?q=&tipo= — quem encaixar num horário livre.
// A agenda pergunta "quem vai nesse slot?"; aqui está a resposta: os contatos HM
// que casam com a busca, com QUEM PRECISA daquele tipo de compromisso no topo.
//
//   reunião    (comercial) → falta agendar a reunião: Contato Inicial / Aguardando Retorno.
//   entrevista (ativação)  → falta a entrevista de onboarding: Pendente/Acesso/Contato da Ativação.
//
// Sem `q` devolve só a fila de quem precisa (a lista pronta para encaixar); com
// `q` busca por nome em qualquer etapa (dá para agendar/remarcar quem já tem card).
const PRECISA: Record<string, string[]> = {
  reuniao: ["hm_comprou", "hm_aguardando_retorno"],
  entrevista: ["hm_pendente_liberacao", "hm_acesso_liberado", "hm_ativacao_contato", "hm_pagamento_realizado"],
};

export async function GET(req: Request) {
  if (!isAuthed()) return NextResponse.json({ ok: false }, { status: 401 });
  const sp = new URL(req.url).searchParams;
  const q = (sp.get("q") ?? "").trim();
  const tipo = sp.get("tipo") === "entrevista" ? "entrevista" : "reuniao";
  const precisa = PRECISA[tipo];

  // `precisa` no topo (a fila do dia), depois o resto por nome. Sem busca, só a fila.
  const rows = await query(
    `select comprador_id, nome, telefone, estagio_chave, estagio_nome, responsavel,
            (estagio_chave = any($2)) as precisa,
            ${tipo === "reuniao" ? "reuniao_em" : "entrevista_em"} as ja_em
       from cs.contatos_hm_kanban
      where ($1 = '' and estagio_chave = any($2))
         or ($1 <> '' and (nome ilike '%' || $1 || '%' or telefone ilike '%' || $1 || '%'))
      order by (estagio_chave = any($2)) desc, nome
      limit 25`,
    [q, precisa],
  );

  return NextResponse.json({ ok: true, candidatos: rows });
}
