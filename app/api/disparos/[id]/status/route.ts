import { NextResponse } from "next/server";
import { isAuthed } from "@/lib/auth";
import { query, queryOne } from "@/lib/db";
import { getContactMessages, getMessageStatus } from "@/lib/unnichat";
import { getCanal } from "@/lib/services/canais";

export const runtime = "nodejs";
export const maxDuration = 120;

// Teto por chamada. Cada contato custa até 2 requisições à Unnichat (localizar a
// mensagem + ler o status), e a rota tem 120s. Sem teto, um disparo de mil
// contatos estourava o tempo e não gravava nada. A tela pode chamar de novo: o
// que já tem status final não volta para a fila.
const LOTE = 80;

// POST /api/disparos/[id]/status — sincroniza o status de entrega (sent/delivered/
// read/failed) dos contatos do disparo consultando a Unnichat. On-demand (a tela
// chama). Usa o message id quando já temos; senão localiza via /contact/{id}/messages.
export async function POST(_req: Request, { params }: { params: { id: string } }) {
  if (!isAuthed()) return NextResponse.json({ ok: false }, { status: 401 });

  const disp = await queryOne<{ unnichat_id: string | null; evento: string }>(
    `select t.unnichat_id, coalesce(d.evento, 'HT') as evento
       from cs.disparos d
       left join cs.templates t on t.id = d.template_id
      where d.id = $1`,
    [params.id],
  );
  if (!disp) return NextResponse.json({ ok: false, reason: "disparo não encontrado" }, { status: 404 });
  const templateUnnichatId = disp.unnichat_id ?? null;

  // A mensagem vive na conta do canal DAQUELE evento (o HT e o Seminário podem
  // ter números distintos). Consultar sem a credencial do canal olhava sempre a
  // conta da env global — e não achava a mensagem.
  const canal = await getCanal(disp.evento);

  // Só quem ainda pode mudar de estado: 'read' e 'failed' são finais. Prioriza
  // o nunca consultado e depois o mais velho — o mesmo critério do cron.
  const contatos = await query<{ id: string; unnichat_contact_id: string | null; unnichat_message_id: string | null }>(
    `select id, unnichat_contact_id, unnichat_message_id
       from cs.disparo_contatos
      where disparo_id = $1 and enviado = true
        and (status_meta is null or status_meta in ('sent','delivered'))
      order by status_em asc nulls first
      limit $2`,
    [params.id, LOTE],
  );

  let atualizados = 0;
  for (const c of contatos) {
    let messageId = c.unnichat_message_id;

    // Sem message id ainda → localiza a última mensagem template do contato.
    if (!messageId && c.unnichat_contact_id) {
      const { messages } = await getContactMessages(c.unnichat_contact_id, canal);
      const tpl = messages
        .filter((m) => m.type === "template" && (!templateUnnichatId || m.templateId === templateUnnichatId))
        .sort((a, b) => (b.date ?? "").localeCompare(a.date ?? ""))[0];
      messageId = tpl?.id ?? null;
      if (messageId) {
        await query(`update cs.disparo_contatos set unnichat_message_id = $2 where id = $1`, [c.id, messageId]);
      }
    }

    if (!messageId) continue;

    const st = await getMessageStatus(messageId, canal);
    if (st.ok && st.status) {
      await query(
        `update cs.disparo_contatos set status_meta = $2, status_em = now(), erro_meta_code = $3 where id = $1`,
        [c.id, st.status, st.errorCode ?? null],
      );
      atualizados++;
    }
  }

  // `restantes` diz à tela se vale chamar de novo (disparo grande consome em levas).
  const r = await queryOne<{ n: number }>(
    `select count(*)::int as n from cs.disparo_contatos
      where disparo_id = $1 and enviado = true
        and (status_meta is null or status_meta in ('sent','delivered'))`,
    [params.id],
  );

  return NextResponse.json({ ok: true, atualizados, total: contatos.length, restantes: r?.n ?? 0 });
}
