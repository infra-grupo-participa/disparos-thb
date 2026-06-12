import { query } from "@/lib/db";
import { getContactMessages, getMessageStatus } from "@/lib/unnichat";
import { logger } from "@/lib/log";

const log = logger("disparo-status");

type Linha = {
  id: string;
  unnichat_contact_id: string | null;
  unnichat_message_id: string | null;
  template_unnichat_id: string | null;
};

// Sincroniza o status de entrega (Meta) dos envios recentes — alimenta o painel
// de saúde do disparo sem depender do clique manual. Idempotente e limitado:
// prioriza quem ainda não tem status, depois quem está em estado não-final
// (sent/delivered ainda podem virar read/failed). Chamado pelo cron.
export async function sincronizarStatusRecentes(maxContatos = 80): Promise<{ atualizados: number; verificados: number }> {
  const linhas = await query<Linha>(
    `select dc.id, dc.unnichat_contact_id, dc.unnichat_message_id, t.unnichat_id as template_unnichat_id
       from cs.disparo_contatos dc
       join cs.disparos d on d.id = dc.disparo_id
       left join cs.templates t on t.id = d.template_id
      where dc.enviado = true
        and d.iniciado_em > now() - interval '48 hours'
        and (dc.status_meta is null or dc.status_meta in ('sent', 'delivered'))
        and (dc.status_em is null or dc.status_em < now() - interval '10 minutes')
      order by dc.status_em asc nulls first
      limit $1`,
    [maxContatos],
  );

  let atualizados = 0;
  for (const l of linhas) {
    let messageId = l.unnichat_message_id;
    if (!messageId && l.unnichat_contact_id) {
      const { messages } = await getContactMessages(l.unnichat_contact_id);
      const tpl = messages
        .filter((m) => m.type === "template" && (!l.template_unnichat_id || m.templateId === l.template_unnichat_id))
        .sort((a, b) => (b.date ?? "").localeCompare(a.date ?? ""))[0];
      messageId = tpl?.id ?? null;
      if (messageId) await query(`update cs.disparo_contatos set unnichat_message_id = $2 where id = $1`, [l.id, messageId]);
    }
    if (!messageId) continue;

    const st = await getMessageStatus(messageId);
    if (st.ok && st.status) {
      await query(
        `update cs.disparo_contatos set status_meta = $2, status_em = now(), erro_meta_code = $3 where id = $1`,
        [l.id, st.status, st.errorCode ?? null],
      );
      atualizados++;
    }
  }

  if (linhas.length) log.info("status sincronizado", { verificados: linhas.length, atualizados });
  return { atualizados, verificados: linhas.length };
}
