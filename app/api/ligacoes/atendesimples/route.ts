import { NextResponse } from "next/server";
import { query, queryOne } from "@/lib/db";
import { normalizePhone } from "@/lib/phone";
import { logger } from "@/lib/log";
import {
  verificarAssinatura, assinarCorpo, parsePayload, mapearResultado, RESULTADO_LABEL,
} from "@/lib/atendesimples";

export const runtime = "nodejs";
const log = logger("ligacoes:atendesimples");

// GET — diagnóstico PÚBLICO do setup (não expõe segredos nem dados). Confirma
// que o deploy subiu, que o secret está configurado e se a migration 0024
// (colunas do Atende Simples) já foi aplicada no banco — sem precisar logar.
export async function GET() {
  // Conta as chamadas já gravadas + checa o schema. Tudo em uma ida ao banco,
  // tolerante a falha (se a tabela/coluna não existir, retorna o motivo).
  let migracao0024: boolean | null = null;
  let migracao0025: boolean | null = null;
  let gravadas: number | null = null;
  let casadas: number | null = null;
  let ultima: string | null = null;
  let erro: string | undefined;
  const extra: Record<string, number> = {};
  try {
    const col = await queryOne<{ m24: boolean; m25: boolean }>(
      `select bool_or(column_name = 'direction') as m24,
              bool_or(column_name = 'iniciada_em') as m25
         from information_schema.columns
        where table_schema = 'cs' and table_name = 'ligacoes'
          and column_name in ('direction', 'iniciada_em')`,
    );
    migracao0024 = Boolean(col?.m24);
    migracao0025 = Boolean(col?.m25);
    if (migracao0024) {
      const r = await queryOne<{ total: number; distintas: number; com_aluno: number; hoje: number; ultima: string | null }>(
        `select count(*)::int as total,
                count(distinct provider_call_id)::int as distintas,
                count(*) filter (where comprador_id is not null)::int as com_aluno,
                count(*) filter (where criado_em > now() - interval '24 hours')::int as hoje,
                max(criado_em) as ultima
           from cs.ligacoes where provider = 'atendesimples'`,
      );
      gravadas = r?.total ?? 0;
      casadas = r?.com_aluno ?? 0;
      ultima = r?.ultima ?? null;
      // distintas == total → sem duplicação (1 linha por chamada).
      Object.assign(extra, { chamadas_distintas: r?.distintas ?? 0, chamadas_24h: r?.hoje ?? 0 });
    }
  } catch (e) {
    erro = e instanceof Error ? e.message : "erro ao consultar o banco";
  }

  return NextResponse.json({
    ok: true,
    endpoint: "atendesimples-webhook",
    secret_configurado: Boolean(process.env.ATENDESIMPLES_WEBHOOK_SECRET),
    migration_0024_ok: migracao0024,
    migration_0025_ok: migracao0025,
    chamadas_gravadas: gravadas,
    chamadas_com_aluno: casadas,
    ...extra,
    ultima_chamada_em: ultima,
    ...(erro ? { erro } : {}),
  });
}

// Webhook do Atende Simples (provedor de ligações). Recebe os eventos de
// chamada (call.newcall → call.finished) e mantém UMA linha por chamada em
// cs.ligacoes (idempotente por provider_call_id). Casa o número com um aluno
// quando possível e espelha na timeline. Valida X-Hub-Signature (HMAC-SHA1).
//
// Config necessária: ATENDESIMPLES_WEBHOOK_SECRET (mesma chave do webhook no
// painel do Atende Simples) e a URL desta rota cadastrada lá.
export async function POST(req: Request) {
  const corpoCru = await req.text();
  const assinatura = req.headers.get("x-hub-signature");
  const secret = process.env.ATENDESIMPLES_WEBHOOK_SECRET;
  const assinaturaOk = verificarAssinatura(corpoCru, assinatura, secret);
  const headerEvento = req.headers.get("x-atendesimples-event") || "";

  // Parse tolerante (JSON ou urlencoded — a Atende Simples permite os dois).
  const body = parsePayload(corpoCru);
  // O HEADER é a fonte canônica do código do evento. O Body é customizável no
  // painel (vem como event_code = "call.{{event_code}}"), então no ping chega
  // "call.ping" no corpo — por isso priorizamos o header e detectamos ping de
  // forma tolerante (cobre "ping" e "call.ping").
  const evento = headerEvento || body.event_code || "";
  const ehPing = evento === "ping" || body.event_code === "ping" || /(^|\.)ping$/i.test(evento);
  const call = body.call;
  const callId = call?.call_id != null ? String(call.call_id) : "";

  // Diagnóstico (não expõe o secret — "calculada" é o HMAC, irreversível).
  const diag = {
    evento, callId: callId || null, assinatura_ok: assinaturaOk,
    recebida: assinatura ?? null, calculada: secret ? assinarCorpo(corpoCru, secret) : null,
    tamanho: corpoCru.length, content_type: req.headers.get("content-type"), secret_configurado: Boolean(secret),
  };

  // Ping ou requisição sem chamada com dados → 200 SEMPRE (ativação/health-check;
  // não grava nada). Loga se a assinatura bateu — o ping real vira o teste da
  // fórmula HMAC sem travar a ativação.
  if (ehPing || !callId) {
    log.info("webhook ping/no-op", diag);
    return NextResponse.json({ ok: true, pong: ehPing || undefined, assinatura_ok: assinaturaOk });
  }

  // Evento com dados de chamada → EXIGE assinatura válida (segurança da gravação).
  if (!assinaturaOk) {
    log.warn("webhook com assinatura inválida", diag);
    return NextResponse.json({ ok: false }, { status: 401 });
  }

  // Casa o aluno por telefone tentando AMBOS os números da chamada. Em chamada
  // de saída, a Atende Simples coloca o número do CLIENTE no from_number; o dnis
  // é o número fixo da plataforma. Tenta os dois e usa o primeiro que casar.
  const candidatos = [call?.from_number, call?.dnis]
    .map((n) => (n ? normalizePhone(String(n)) : null))
    .filter((n): n is string => !!n);
  let compradorId: string | null = null;
  let eventoAluno: string | null = null;
  let telCasado: string | null = null;
  for (const norm of candidatos) {
    const m = await queryOne<{ comprador_id: string; evento: string }>(
      `select comprador_id, evento from cs.contatos_evento
        where telefone is not null and right(regexp_replace(telefone, '\\D', '', 'g'), 8) = $1
        limit 1`,
      [norm.slice(-8)],
    );
    if (m) { compradorId = m.comprador_id; eventoAluno = m.evento; telCasado = norm; break; }
  }
  // Telefone do registro = o que casou; senão o from_number (lado do cliente).
  const telNorm = telCasado || normalizePhone(call?.from_number ?? null) || normalizePhone(call?.dnis ?? null);

  const { resultado, status } = mapearResultado(call?.status);
  const dur = Number(call?.inbound_duration ?? 0) || null;
  const billed = Number(call?.billed_duration ?? 0) || null;
  // Horário REAL da chamada (started_at ISO do AC) — base das métricas de hora/dia.
  const iniciadaEm = call?.started_at ? String(call.started_at) : null;

  // Upsert idempotente por (provider, provider_call_id). Eventos posteriores
  // (answered → finished → audio_available) atualizam a mesma linha sem apagar
  // o que já havia (coalesce mantém o valor anterior quando o novo vem vazio).
  await query(
    `insert into cs.ligacoes (
       comprador_id, evento, operador, attendant_email, telefone, from_number, dnis,
       direction, status_pabx, resultado, duracao_seg, billed_duration, url_gravacao,
       provider, provider_call_id, status, iniciada_em, criado_em, atualizado_em
     ) values (
       $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, 'atendesimples', $14, $15, $16, now(), now()
     )
     on conflict (provider, provider_call_id) where provider_call_id is not null
     do update set
       comprador_id    = coalesce(ligacoes.comprador_id, excluded.comprador_id),
       evento          = coalesce(ligacoes.evento, excluded.evento),
       operador        = coalesce(excluded.operador, ligacoes.operador),
       attendant_email = coalesce(excluded.attendant_email, ligacoes.attendant_email),
       telefone        = coalesce(excluded.telefone, ligacoes.telefone),
       from_number     = coalesce(excluded.from_number, ligacoes.from_number),
       dnis            = coalesce(excluded.dnis, ligacoes.dnis),
       direction       = coalesce(excluded.direction, ligacoes.direction),
       status_pabx     = coalesce(excluded.status_pabx, ligacoes.status_pabx),
       resultado       = coalesce(excluded.resultado, ligacoes.resultado),
       duracao_seg     = coalesce(excluded.duracao_seg, ligacoes.duracao_seg),
       billed_duration = coalesce(excluded.billed_duration, ligacoes.billed_duration),
       url_gravacao    = coalesce(excluded.url_gravacao, ligacoes.url_gravacao),
       iniciada_em     = coalesce(excluded.iniciada_em, ligacoes.iniciada_em),
       status          = excluded.status,
       atualizado_em   = now()`,
    [
      compradorId, eventoAluno, call?.attendant_name ?? null, call?.attendant_email ?? null,
      telNorm, call?.from_number ?? null, call?.dnis ?? null,
      call?.direction ?? null, call?.status ?? null, resultado, dur, billed, call?.audio_url ?? null,
      callId, status, iniciadaEm,
    ],
  );

  // Quando a chamada finaliza e casou com um aluno, espelha na timeline e marca
  // o último contato (igual ao registro manual de ligação).
  if (evento === "call.finished" && compradorId) {
    const rotulo = resultado ? RESULTADO_LABEL[resultado] ?? resultado : "Ligação";
    const partes = [rotulo];
    if (dur) partes.push(`${Math.max(1, Math.round(dur / 60))}min`);
    if (call?.attendant_name) partes.push(call.attendant_name);
    await query(
      `insert into cs.interacoes (contato_id, tipo, canal, descricao, autor)
       select id, 'ligacao', 'ligacao', $2, $3 from cs.contatos where comprador_id = $1`,
      [compradorId, `📞 ${partes.join(" · ")}`, call?.attendant_name ?? "atende-simples"],
    );
    // Marca os timestamps de contato (base do SLA de ligação): primeiro/último
    // contato sempre; quando ATENDIDA, conta como contato efetivo (resposta).
    const atendeu = resultado === "atendeu";
    await query(
      `update cs.contatos set
         ultimo_contato_em   = now(),
         primeiro_contato_em = coalesce(primeiro_contato_em, now()),
         ultima_resposta_em  = case when $2 then now() else ultima_resposta_em end,
         atualizado_em       = now()
       where comprador_id = $1`,
      [compradorId, atendeu],
    );
  }

  log.info("chamada do Atende Simples processada", { evento, callId, resultado, compradorId: compradorId ?? undefined });
  return NextResponse.json({ ok: true });
}
