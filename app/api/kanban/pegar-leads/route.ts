import { NextResponse } from "next/server";
import { getSessao } from "@/lib/auth";
import { query } from "@/lib/db";
import { setResponsavel } from "@/lib/services/contato";
import { eventoDe } from "@/lib/services/evento";

export const runtime = "nodejs";

// POST /api/kanban/pegar-leads { quantos } — o SDR PUXA para si os próximos leads
// sem dono do evento. Prioriza os mais quentes (estágio mais avançado: MQL antes
// de Lead) e, dentro disso, os mais recentes. Só leads com telefone, fora de
// opt-out e de etapa final. NUNCA rouba lead que já tem responsável — cada SDR
// enche a própria fila sem pisar no outro.
export async function POST(req: Request) {
  const sessao = await getSessao();
  if (!sessao) return NextResponse.json({ ok: false }, { status: 401 });
  const evento = eventoDe(req);
  const body = await req.json().catch(() => ({}));
  const quantos = Math.min(50, Math.max(1, Number(body?.quantos) || 20));

  const alvos = await query<{ comprador_id: string }>(
    `select ce.comprador_id
       from cs.contatos_evento ce
       join cs.contatos ct on ct.comprador_id = ce.comprador_id and ct.evento = $1
       left join cs.estagios e on e.id = ct.estagio_id
      where ce.evento = $1
        and (ct.responsavel is null or ct.responsavel = '')
        and not ct.opt_out
        and ce.telefone is not null and ce.telefone <> ''
        and coalesce(e.is_final, false) = false
      order by coalesce(e.ordem, 999) desc, ct.primeiro_contato_em desc nulls last
      limit $2`,
    [evento, quantos],
  );
  const ids = alvos.map((a) => a.comprador_id);
  if (ids.length) await setResponsavel(ids, sessao.nome || "cs", sessao.nome || "cs");
  return NextResponse.json({ ok: true, pegos: ids.length });
}
