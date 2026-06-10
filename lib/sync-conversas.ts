import { query } from "@/lib/db";
import { searchContactByPhone, getContactMessages } from "@/lib/unnichat";
import { classificarMensagem } from "@/lib/classificar";

// Lógica de sincronização do histórico de conversas da Unnichat para
// cs.lead_mensagens. Usada pela rota /api/sync-conversas e por scripts/run-sync.ts.
// Não há listagem em massa na Unnichat: para cada contato HT com telefone,
// search → messages → classifica as do lead → upsert idempotente.

const CONCORRENCIA = 6;

type Alvo = { telefone: string; comprador_id: string | null };

export type ResultadoSync = {
  processados: number;
  com_conversa: number;
  mensagens_novas: number;
  erros: number;
  restantes: number;
};

async function emLotes<T>(itens: T[], n: number, fn: (item: T) => Promise<void>) {
  for (let i = 0; i < itens.length; i += n) {
    await Promise.all(itens.slice(i, i + n).map(fn));
  }
}

async function marcarSync(telefone: string, contactId: string | null, totalMsgs: number, erro: string | null) {
  await query(
    `insert into cs.sync_conversas (telefone_norm, unnichat_contact_id, ultima_sincronizacao, total_mensagens, ultimo_erro)
     values ($1, $2, now(), $3, $4)
     on conflict (telefone_norm) do update
       set unnichat_contact_id = coalesce(excluded.unnichat_contact_id, cs.sync_conversas.unnichat_contact_id),
           ultima_sincronizacao = now(),
           total_mensagens = excluded.total_mensagens,
           ultimo_erro = excluded.ultimo_erro`,
    [telefone, contactId, totalMsgs, erro],
  );
}

export async function sincronizarLote(limite: number): Promise<ResultadoSync> {
  const lim = Math.min(Math.max(limite, 1), 120);

  // Telefones da view vêm brutos (alguns sem o 55 dos CSVs importados);
  // normalizamos para casar com o formato da Unnichat e da nossa base.
  const alvos = await query<Alvo>(
    `with alvos as (
       select distinct on (cs.normalizar_telefone(h.telefone))
              cs.normalizar_telefone(h.telefone) as telefone,
              h.comprador_id
         from cs.contatos_ht h
        where cs.normalizar_telefone(h.telefone) is not null
        order by cs.normalizar_telefone(h.telefone), h.ultima_compra_ht desc nulls last
     )
     select a.telefone, a.comprador_id
       from alvos a
       left join cs.sync_conversas s on s.telefone_norm = a.telefone
      order by s.ultima_sincronizacao asc nulls first
      limit $1`,
    [lim],
  );

  let comConversa = 0, mensagensNovas = 0, erros = 0;

  await emLotes(alvos, CONCORRENCIA, async (alvo) => {
    try {
      const busca = await searchContactByPhone(alvo.telefone);
      const contactId = busca.contactId;
      if (!contactId) { await marcarSync(alvo.telefone, null, 0, null); return; }

      const { ok, messages } = await getContactMessages(contactId);
      if (!ok) { await marcarSync(alvo.telefone, contactId, 0, "falha ao listar mensagens"); erros++; return; }

      const validas = messages.filter((m) => (m.text || "").trim().length > 0);
      if (validas.length === 0) { await marcarSync(alvo.telefone, contactId, 0, null); return; }

      const ids: string[] = [], cmp: (string | null)[] = [], tel: string[] = [];
      const dir: string[] = [], txt: string[] = [], ass: (string | null)[] = [];
      const cat: (string | null)[] = [], sen: (string | null)[] = [], dt: (string | null)[] = [];

      for (const m of validas) {
        const ehLead = String(m.senderBy || "").toLowerCase() === "contact";
        const c = ehLead ? classificarMensagem(m.text) : null;
        ids.push(`${contactId}:${m.id}`);
        cmp.push(alvo.comprador_id);
        tel.push(alvo.telefone);
        dir.push(ehLead ? "lead" : "cs");
        txt.push(m.text.slice(0, 1000));
        ass.push(c?.assunto ?? null);
        cat.push(c?.categoria ?? null);
        sen.push(c?.sentimento ?? null);
        dt.push(m.date ?? null);
      }

      const res = await query<{ id: string }>(
        `insert into cs.lead_mensagens
           (unnichat_message_id, comprador_id, telefone_norm, direcao, texto, assunto, categoria, sentimento, enviada_em)
         select * from unnest(
           $1::text[], $2::uuid[], $3::text[], $4::text[], $5::text[], $6::text[], $7::text[], $8::text[], $9::timestamptz[]
         )
         on conflict (unnichat_message_id) do nothing
         returning id`,
        [ids, cmp, tel, dir, txt, ass, cat, sen, dt],
      );

      mensagensNovas += res.length;
      comConversa++;
      await marcarSync(alvo.telefone, contactId, validas.length, null);
    } catch (e) {
      erros++;
      await marcarSync(alvo.telefone, null, 0, e instanceof Error ? e.message.slice(0, 200) : "erro");
    }
  });

  const pendentes = await query<{ n: number }>(
    `with alvos as (
       select distinct cs.normalizar_telefone(h.telefone) as telefone
         from cs.contatos_ht h
        where cs.normalizar_telefone(h.telefone) is not null
     )
     select count(*)::int as n
       from alvos a
       left join cs.sync_conversas s on s.telefone_norm = a.telefone
      where s.ultima_sincronizacao is null`,
  );

  return {
    processados: alvos.length,
    com_conversa: comConversa,
    mensagens_novas: mensagensNovas,
    erros,
    restantes: pendentes[0]?.n ?? 0,
  };
}
