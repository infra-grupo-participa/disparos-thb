import { NextResponse } from "next/server";
import { isAuthed } from "@/lib/auth";
import { query, queryOne } from "@/lib/db";
import { getContactMessages, getMessageStatus } from "@/lib/unnichat";

export const runtime = "nodejs";
export const maxDuration = 120;

// POST /api/disparos/[id]/status — sincroniza o status de entrega (sent/delivered/
// read/failed) dos contatos do disparo consultando a Unnichat. On-demand (a tela
// chama). Usa o message id quando já temos; senão localiza via /contact/{id}/messages.
export async function POST(_req: Request, { params }: { params: { id: string } }) {
  if (!isAuthed()) return NextResponse.json({ ok: false }, { status: 401 });

  const disp = await queryOne<{ unnichat_id: string | null }>(
    `select t.unnichat_id from cs.disparos d
       left join cs.templates t on t.id = d.template_id
      where d.id = $1`,
    [params.id],
  );
  const templateUnnichatId = disp?.unnichat_id ?? null;

  const contatos = await query<{ id: string; unnichat_contact_id: string | null; unnichat_message_id: string | null }>(
    `select id, unnichat_contact_id, unnichat_message_id
       from cs.disparo_contatos
      where disparo_id = $1 and enviado = true`,
    [params.id],
  );

  let atualizados = 0;
  for (const c of contatos) {
    let messageId = c.unnichat_message_id;

    // Sem message id ainda → localiza a última mensagem template do contato.
    if (!messageId && c.unnichat_contact_id) {
      const { messages } = await getContactMessages(c.unnichat_contact_id);
      const tpl = messages
        .filter((m) => m.type === "template" && (!templateUnnichatId || m.templateId === templateUnnichatId))
        .sort((a, b) => (b.date ?? "").localeCompare(a.date ?? ""))[0];
      messageId = tpl?.id ?? null;
      if (messageId) {
        await query(`update cs.disparo_contatos set unnichat_message_id = $2 where id = $1`, [c.id, messageId]);
      }
    }

    if (!messageId) continue;

    const st = await getMessageStatus(messageId);
    if (st.ok && st.status) {
      await query(
        `update cs.disparo_contatos set status_meta = $2, status_em = now(), erro_meta_code = $3 where id = $1`,
        [c.id, st.status, st.errorCode ?? null],
      );
      atualizados++;
    }
  }

  return NextResponse.json({ ok: true, atualizados, total: contatos.length });
}
