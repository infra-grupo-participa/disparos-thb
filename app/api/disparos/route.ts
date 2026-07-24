import { NextResponse } from "next/server";
import { isAuthed } from "@/lib/auth";
import { query } from "@/lib/db";
import { eventoDe } from "@/lib/services/evento";

export const runtime = "nodejs";

// GET /api/disparos — histórico de campanhas do evento ativo, com progresso.
// É o "log" que o operador abre para conferir o que enviou e, se algo travou,
// retomar de onde parou (botão na tela, sem depender do cron nem de nós).
export async function GET(req: Request) {
  if (!isAuthed()) return NextResponse.json({ ok: false }, { status: 401 });
  const evento = eventoDe(req);

  const disparos = await query(
    `select d.id, d.status, d.fase, d.operador, d.edicao_ht as edicao,
            d.iniciado_em, d.concluido_em, d.processando_em,
            t.nome as template_nome,
            count(dc.*)::int as total,
            count(*) filter (where dc.enviado)::int as enviados,
            count(*) filter (where not dc.enviado)::int as pendentes,
            count(*) filter (where dc.erro is not null)::int as erros,
            count(*) filter (where dc.respondeu)::int as respondidos,
            -- Entrega real (Meta), quando o status já foi sincronizado.
            count(*) filter (where dc.status_meta = 'delivered')::int as entregue,
            count(*) filter (where dc.status_meta = 'read')::int as lido,
            count(*) filter (where dc.status_meta = 'sent')::int as so_enviado,
            count(*) filter (where dc.status_meta = 'failed')::int as falha_entrega,
            -- "Não chegaram": nunca saíram (fila) + a Meta recusou a entrega. É o
            -- alvo do botão "Reenviar os que não chegaram".
            count(*) filter (where not dc.enviado or dc.status_meta = 'failed')::int as nao_chegaram,
            -- Travado: em andamento mas sem processo vivo (heartbeat parado > 2min).
            -- É o gatilho do botão "Retomar": há pendentes e ninguém cuidando.
            (d.status = 'em_andamento'
              and (d.processando_em is null or d.processando_em < now() - interval '120 seconds')) as travado
       from cs.disparos d
       left join cs.templates t on t.id = d.template_id
       left join cs.disparo_contatos dc on dc.disparo_id = d.id
      where d.evento = $1
      group by d.id, t.nome
      order by d.iniciado_em desc nulls last
      limit 60`,
    [evento],
  );

  return NextResponse.json({ ok: true, disparos });
}
