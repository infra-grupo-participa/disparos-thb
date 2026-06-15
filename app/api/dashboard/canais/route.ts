import { NextResponse } from "next/server";
import { isAuthed } from "@/lib/auth";
import { queryOne } from "@/lib/db";
import { eventoDe } from "@/lib/services/evento";

export const runtime = "nodejs";

// GET /api/dashboard/canais?evento=&desde=&ate=&edicao= — resumo COMPARATIVO dos
// 3 canais de ação (volume + resultado), para ver as proporções num relance.
// Só dados reais (zera se não houver). O filtro de edição vale para cada canal
// na medida em que cada um "tem" edição:
//   WhatsApp (Unnichat):     cs.disparos.edicao_ht (nativo)
//   E-mail (ActiveCampaign): pelo NOME da campanha (ex.: "[HT20]") — best-effort
//   Ligações (Atende Simples): herda a edição do ALUNO casado (cs.contatos_evento).
//     Sem edição selecionada, ligações mostram o total geral (produtividade do
//     comercial não depende de o número estar na base).
export async function GET(req: Request) {
  if (!isAuthed()) return NextResponse.json({ ok: false }, { status: 401 });

  const evento = eventoDe(req);
  const url = new URL(req.url);
  const desde = url.searchParams.get("desde");
  const ate = url.searchParams.get("ate");
  const edicao = url.searchParams.get("edicao");
  const p = [evento, desde, ate, edicao];

  const whatsapp = (await queryOne<{ enviados: number; respondidos: number }>(
    `select
       count(*) filter (where dc.enviado)::int as enviados,
       count(*) filter (where dc.respondeu)::int as respondidos
     from cs.disparo_contatos dc
     join cs.disparos d on d.id = dc.disparo_id and d.evento = $1
     where ($2::timestamptz is null or d.iniciado_em >= $2)
       and ($3::timestamptz is null or d.iniciado_em <= $3)
       and ($4::text is null or d.edicao_ht = $4)`,
    p,
  )) ?? { enviados: 0, respondidos: 0 };

  const email = (await queryOne<{ enviados: number; aberturas: number }>(
    `select
       coalesce(sum(enviados), 0)::int as enviados,
       coalesce(sum(aberturas_unicas), 0)::int as aberturas
     from cs.campanhas_email
     where evento = $1
       and ($2::timestamptz is null or enviada_em >= $2)
       and ($3::timestamptz is null or enviada_em <= $3)
       and ($4::text is null or nome ilike '%' || $4 || '%')`,
    p,
  )) ?? { enviados: 0, aberturas: 0 };

  const ligacoes = (await queryOne<{ total: number; feitas: number; atendidas: number }>(
    `select
       count(*)::int as total,
       count(*) filter (where l.direction = 'outbound')::int as feitas,
       count(*) filter (where l.resultado = 'atendeu')::int as atendidas
     from cs.ligacoes l
     left join cs.contatos_evento v on v.comprador_id = l.comprador_id and v.evento = $1
     where l.provider = 'atendesimples'
       and ($2::timestamptz is null or l.criado_em >= $2)
       and ($3::timestamptz is null or l.criado_em <= $3)
       and ($4::text is null or v.edicao_ht = $4)`,
    p,
  )) ?? { total: 0, feitas: 0, atendidas: 0 };

  return NextResponse.json({ ok: true, whatsapp, email, ligacoes });
}
