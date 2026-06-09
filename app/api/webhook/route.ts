import { NextResponse } from "next/server";
import { query, queryOne } from "@/lib/db";
import { normalizePhone } from "@/lib/phone";

export const runtime = "nodejs";

// Webhook chamado pela automação do Unnichat ("Cliente interagir → qualquer mensagem").
// NÃO usa sessão do app — valida origem via WEBHOOK_SECRET (header, query ou body).
// Sempre responde 200 (exceto segredo inválido) para o Unnichat não ficar retentando.
// TODA chamada é registrada em cs.webhook_log para observabilidade do SLA.

function originOk(req: Request, body: Record<string, unknown>): boolean {
  const secret = process.env.WEBHOOK_SECRET;
  if (!secret) return true; // sem segredo configurado → não bloqueia (dev)
  const url = new URL(req.url);
  const recebido =
    req.headers.get("x-webhook-secret") ||
    url.searchParams.get("secret") ||
    (typeof body.secret === "string" ? body.secret : null);
  return recebido === secret;
}

// Registra a chamada recebida (best-effort; nunca quebra o webhook).
async function logWebhook(args: {
  origem: string | null;
  telefoneRaw: string | null;
  telefoneNorm: string | null;
  resultado: string;
  payload: unknown;
}) {
  try {
    await query(
      `insert into cs.webhook_log (origem, telefone_raw, telefone_norm, resultado, payload)
       values ($1, $2, $3, $4, $5)`,
      [args.origem, args.telefoneRaw, args.telefoneNorm, args.resultado, JSON.stringify(args.payload ?? null)],
    );
  } catch (e) {
    console.error("[webhook] falha ao gravar log:", e instanceof Error ? e.message : e);
  }
}

export async function GET() {
  return new Response("OK", { status: 200 });
}

export async function POST(req: Request) {
  const origem = req.headers.get("x-forwarded-for") || req.headers.get("user-agent") || null;
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;

  if (!originOk(req, body)) {
    await logWebhook({ origem, telefoneRaw: null, telefoneNorm: null, resultado: "invalid_secret", payload: body });
    return NextResponse.json({ ok: false, reason: "invalid_secret" }, { status: 401 });
  }

  const telefoneRaw =
    (body.telefone as string) ?? (body.phone as string) ?? (body.contact_phone as string) ?? null;
  const mensagem = String((body.mensagem as string) ?? (body.message as string) ?? "").slice(0, 140);
  const tel = normalizePhone(telefoneRaw);

  if (!tel) {
    await logWebhook({ origem, telefoneRaw, telefoneNorm: null, resultado: "sem_telefone", payload: body });
    return NextResponse.json({ ok: true, reason: "sem_telefone" }, { status: 200 });
  }

  const desc = mensagem ? `Respondeu: ${mensagem}` : "Respondeu (sem texto)";

  // 1) Tenta casar com um disparo pendente (enviado e ainda sem resposta) — o mais recente.
  const pendente = await queryOne<{ id: string; disparo_id: string; comprador_id: string | null }>(
    `select id, disparo_id, comprador_id
       from cs.disparo_contatos
      where telefone = $1 and enviado = true and respondeu = false
      order by enviado_em desc
      limit 1`,
    [tel],
  );

  if (pendente) {
    // Idempotência: o UPDATE só "vence" se a linha ainda estava respondeu=false.
    const upd = await queryOne<{ sla_minutos: number }>(
      `update cs.disparo_contatos
          set respondeu = true,
              respondeu_em = now(),
              sla_minutos = round(extract(epoch from (now() - enviado_em)) / 60)::int
        where id = $1 and respondeu = false
        returning sla_minutos`,
      [pendente.id],
    );

    if (!upd) {
      await logWebhook({ origem, telefoneRaw, telefoneNorm: tel, resultado: "duplicado", payload: body });
      return NextResponse.json({ ok: true, matched: true, duplicado: true, sla_minutos: null });
    }

    await query(`update cs.disparos set total_respondidos = total_respondidos + 1 where id = $1`, [pendente.disparo_id]);

    if (pendente.comprador_id) {
      await avancarContato(pendente.comprador_id, desc, pendente.disparo_id);
    }
    await logWebhook({ origem, telefoneRaw, telefoneNorm: tel, resultado: "matched", payload: body });
    return NextResponse.json({ ok: true, matched: true, sla_minutos: upd.sla_minutos ?? null });
  }

  // 2) Sem disparo pendente — registra a resposta no contato HT (se existir), sem SLA.
  const contato = await queryOne<{ comprador_id: string }>(
    `select comprador_id from cs.contatos_ht where telefone = $1 limit 1`,
    [tel],
  );
  if (contato) {
    await avancarContato(contato.comprador_id, desc, null);
    await logWebhook({ origem, telefoneRaw, telefoneNorm: tel, resultado: "registrado_sem_disparo", payload: body });
    return NextResponse.json({ ok: true, matched: false, registrado: true });
  }

  await logWebhook({ origem, telefoneRaw, telefoneNorm: tel, resultado: "telefone_nao_encontrado", payload: body });
  return NextResponse.json({ ok: true, matched: false, registrado: false });
}

// Marca resposta no contato: timeline + ultima_resposta_em + avança estágio (novo/contatado → respondeu).
async function avancarContato(compradorId: string, descricao: string, disparoId: string | null) {
  await query(
    `update cs.contatos
        set ultima_resposta_em = now(),
            estagio_id = case
              when estagio_id in (select id from cs.estagios where chave in ('novo','contatado'))
              then (select id from cs.estagios where chave = 'respondeu')
              else estagio_id end,
            atualizado_em = now()
      where comprador_id = $1`,
    [compradorId],
  );
  await query(
    `insert into cs.interacoes (contato_id, tipo, descricao, disparo_id, autor)
     select id, 'resposta', $2, $3, 'lead' from cs.contatos where comprador_id = $1`,
    [compradorId, descricao, disparoId],
  );
}
