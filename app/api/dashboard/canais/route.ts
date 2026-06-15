import { NextResponse } from "next/server";
import { isAuthed } from "@/lib/auth";
import { queryOne } from "@/lib/db";
import { eventoDe } from "@/lib/services/evento";

export const runtime = "nodejs";

// GET /api/dashboard/canais?evento=&desde=&ate= — resumo COMPARATIVO dos 3
// canais de ação do evento (volume + resultado), para ver as proporções num
// relance. Cada canal lê sua própria fonte; só dados reais (zera se não houver).
//   WhatsApp (Unnichat):    cs.disparo_contatos  → enviados / respondidos
//   E-mail (ActiveCampaign): cs.campanhas_email   → enviados / aberturas únicas
//   Ligações (Atende Simples): cs.ligacoes        → feitas / atendidas
export async function GET(req: Request) {
  if (!isAuthed()) return NextResponse.json({ ok: false }, { status: 401 });

  const evento = eventoDe(req);
  const url = new URL(req.url);
  const desde = url.searchParams.get("desde");
  const ate = url.searchParams.get("ate");
  const p = [evento, desde, ate];

  const whatsapp = (await queryOne<{ enviados: number; respondidos: number }>(
    `select
       count(*) filter (where dc.enviado)::int as enviados,
       count(*) filter (where dc.respondeu)::int as respondidos
     from cs.disparo_contatos dc
     join cs.disparos d on d.id = dc.disparo_id and d.evento = $1
     where ($2::timestamptz is null or d.iniciado_em >= $2)
       and ($3::timestamptz is null or d.iniciado_em <= $3)`,
    p,
  )) ?? { enviados: 0, respondidos: 0 };

  const email = (await queryOne<{ enviados: number; aberturas: number }>(
    `select
       coalesce(sum(enviados), 0)::int as enviados,
       coalesce(sum(aberturas_unicas), 0)::int as aberturas
     from cs.campanhas_email
     where evento = $1
       and ($2::timestamptz is null or enviada_em >= $2)
       and ($3::timestamptz is null or enviada_em <= $3)`,
    p,
  )) ?? { enviados: 0, aberturas: 0 };

  const ligacoes = (await queryOne<{ total: number; feitas: number; atendidas: number }>(
    `select
       count(*)::int as total,
       count(*) filter (where direction = 'outbound')::int as feitas,
       count(*) filter (where resultado = 'atendeu')::int as atendidas
     from cs.ligacoes
     where provider = 'atendesimples' and evento = $1
       and ($2::timestamptz is null or criado_em >= $2)
       and ($3::timestamptz is null or criado_em <= $3)`,
    p,
  )) ?? { total: 0, feitas: 0, atendidas: 0 };

  return NextResponse.json({ ok: true, whatsapp, email, ligacoes });
}
