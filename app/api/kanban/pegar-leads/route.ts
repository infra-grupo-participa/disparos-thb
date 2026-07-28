import { NextResponse } from "next/server";
import { guard } from "@/lib/guard";
import { query } from "@/lib/db";
import { setResponsavelPorId } from "@/lib/services/contato";
import { sqlCardLivre } from "@/lib/services/visibilidade";
import { eventoDe } from "@/lib/services/evento";

export const runtime = "nodejs";

// POST /api/kanban/pegar-leads { quantos } — o SDR PUXA para si os próximos leads
// sem dono do evento. Prioriza os mais quentes (estágio mais avançado: MQL antes
// de Lead) e, dentro disso, os mais recentes. Só leads com telefone, fora de
// opt-out e de etapa final. NUNCA rouba lead que já tem responsável — cada SDR
// enche a própria fila sem pisar no outro. Vale para qualquer nível: assumir
// para SI, do pool, é o gesto permitido até ao operador comum.
export async function POST(req: Request) {
  const evento = eventoDe(req);
  // Portal do evento resolvido contra a whitelist da conta (0145).
  const g = await guard({ portal: evento });
  if (!g.ok) return g.res;
  const sessao = g.sessao;
  const body = await req.json().catch(() => ({}));
  const quantos = Math.min(50, Math.max(1, Number(body?.quantos) || 20));

  // POOL de verdade (0146): sem responsavel_id, sem equipe derivada E sem texto
  // órfão. O filtro antigo (`responsavel` texto vazio) deixaria o SDR puxar um
  // lead cujo id de dono existe mas o texto se perdeu — e o texto órfão (nome
  // que o backfill não casou) também não é "livre": era o card de alguém.
  const alvos = await query<{ comprador_id: string }>(
    `select ce.comprador_id
       from cs.contatos_evento ce
       join cs.contatos ct on ct.comprador_id = ce.comprador_id and ct.evento = $1
       left join cs.estagios e on e.id = ct.estagio_id
      where ce.evento = $1
        and ${sqlCardLivre({ rid: "ct.responsavel_id", eq: "ce.equipe_id", nome: "ct.responsavel" })}
        and not ct.opt_out
        and ce.telefone is not null and ce.telefone <> ''
        and coalesce(e.is_final, false) = false
      order by coalesce(e.ordem, 999) desc, ct.primeiro_contato_em desc nulls last
      limit $2`,
    [evento, quantos],
  );
  const ids = alvos.map((a) => a.comprador_id);
  // Auto-atribuição por ID (o texto deriva da trigger da 0146) — assumir para si.
  if (ids.length) await setResponsavelPorId(ids, evento, sessao.id, sessao.nome || "cs");
  return NextResponse.json({ ok: true, pegos: ids.length });
}
