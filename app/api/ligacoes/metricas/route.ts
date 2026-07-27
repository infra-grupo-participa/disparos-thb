import { NextResponse } from "next/server";
import { guard } from "@/lib/guard";
import { escopoVisibilidade, paramsEscopo } from "@/lib/papeis";
import { query, queryOne } from "@/lib/db";
import { sqlEscopo } from "@/lib/services/contato";
import { eventoDe } from "@/lib/services/evento";

export const runtime = "nodejs";

// GET /api/ligacoes/metricas?evento=HT&desde=&ate= — produtividade dos
// ATENDIMENTOS (ligação, WhatsApp, presencial) com compradores do evento.
//
// Antes, isto refazia o cruzamento telefone→comprador a cada consulta, porque o
// discador do Atende Simples gravava a chamada sem saber com quem falava. Agora
// o vínculo é direto: o operador escolhe o contato ao registrar, e o histórico do
// discador foi casado de uma vez (migration 0081). O join é simples.
//
// Também sumiu o filtro `provider = 'atendesimples'`, que era o motivo de o
// registro manual do operador NÃO aparecer em painel nenhum.
type Linha = {
  resultado: string | null; canal: string; direction: string | null; duracao_seg: number | null;
  atendente: string | null; dia: string; hora: number; comprador_id: string;
};

export async function GET(req: Request) {
  // Portal do evento RESOLVIDO (cookie/query) contra a whitelist da conta (0145).
  const g = await guard({ portal: eventoDe(req) });
  if (!g.ok) return g.res;

  const evento = eventoDe(req);
  const url = new URL(req.url);
  const desde = url.searchParams.get("desde");
  const ate = url.searchParams.get("ate");
  // Recorte por equipe (decisão do Marcio, 27/07): o atendimento herda o escopo
  // do CONTATO atendido — master vê o portal, gestor a equipe, operador os dele.
  const { verTudo, equipeId, usuarioId } = paramsEscopo(escopoVisibilidade(g.sessao));
  const params = [desde, ate, evento, verTudo, usuarioId, equipeId];

  const linhas = await query<Linha>(
    `select l.resultado, l.canal, l.direction, l.duracao_seg,
            coalesce(nullif(l.operador, ''), nullif(l.attendant_email, '')) as atendente,
            to_char(coalesce(l.iniciada_em, l.criado_em) at time zone 'America/Sao_Paulo', 'YYYY-MM-DD') as dia,
            extract(hour from coalesce(l.iniciada_em, l.criado_em) at time zone 'America/Sao_Paulo')::int as hora,
            l.comprador_id::text as comprador_id
       from cs.ligacoes l
       join cs.contatos_evento v on v.comprador_id = l.comprador_id and v.evento = $3
      where l.comprador_id is not null
        and ($1::timestamptz is null or l.criado_em >= $1)
        and ($2::timestamptz is null or l.criado_em <= $2)
        and ${sqlEscopo({ rid: "v.responsavel_id", eq: "v.equipe_id", nome: "v.responsavel" }, { verTudo: 4, usuario: 5, equipe: 6 })}`,
    params,
  );

  // Registros sem contato vinculado (sobretudo chamadas antigas do discador para
  // números que não são de compradores). Não entram nas métricas; a tela só diz
  // quantos são, para o número não parecer "sumido". NÃO recortável por equipe:
  // sem comprador_id não há dono nem equipe para amarrar — fica o total geral
  // (é contagem de lixo do discador, não dado de lead).
  const solto = (await queryOne<{ n: number }>(
    `select count(*)::int as n from cs.ligacoes
      where comprador_id is null
        and ($1::timestamptz is null or criado_em >= $1)
        and ($2::timestamptz is null or criado_em <= $2)`,
    [desde, ate],
  )) ?? { n: 0 };

  // --- Agregações em JS (≤ ~milhar de linhas) -----------------------------
  // 'atendeu' significa a mesma coisa em todo canal: houve conversa de verdade.
  const atendeu = (r: Linha) => r.resultado === "atendeu";
  const durAtend = linhas.filter((r) => atendeu(r) && r.duracao_seg);
  const totais = {
    total: linhas.length,
    // `direction` só existe no histórico do discador; o registro do operador é
    // sempre uma ação dele, logo conta como "feita".
    feitas: linhas.filter((r) => r.direction !== "inbound").length,
    recebidas: linhas.filter((r) => r.direction === "inbound").length,
    atendidas: linhas.filter(atendeu).length,
    abandonadas: linhas.filter((r) => r.resultado === "abandonou").length,
    recusadas: linhas.filter((r) => r.resultado === "recusada").length,
    nao_atendidas: linhas.filter((r) => r.resultado === "nao_atendeu").length,
    falhou: linhas.filter((r) => r.resultado === "falhou").length,
    dur_total_seg: linhas.reduce((a, r) => a + (r.duracao_seg || 0), 0),
    dur_media_seg: durAtend.length ? Math.round(durAtend.reduce((a, r) => a + (r.duracao_seg || 0), 0) / durAtend.length) : null,
    compradores_distintos: new Set(linhas.map((r) => r.comprador_id)).size,
    compradores_atendidos: new Set(linhas.filter(atendeu).map((r) => r.comprador_id)).size,
  };

  // Quanto de cada canal — o que revela se o time só liga ou também usa WhatsApp.
  const canalMap = new Map<string, { total: number; atendidas: number }>();
  const diaMap = new Map<string, { total: number; atendidas: number; atend: Map<string, number> }>();
  const horaMap = new Map<number, { total: number; atendidas: number }>();
  const atMap = new Map<string, { total: number; atendidas: number; feitas: number; dur_total_seg: number }>();
  for (const r of linhas) {
    const c = canalMap.get(r.canal) ?? { total: 0, atendidas: 0 };
    c.total++; if (atendeu(r)) c.atendidas++;
    canalMap.set(r.canal, c);

    const d = diaMap.get(r.dia) ?? { total: 0, atendidas: 0, atend: new Map() };
    d.total++; if (atendeu(r)) d.atendidas++;
    const op = r.atendente || "—";
    d.atend.set(op, (d.atend.get(op) || 0) + 1);
    diaMap.set(r.dia, d);

    const h = horaMap.get(r.hora) ?? { total: 0, atendidas: 0 };
    h.total++; if (atendeu(r)) h.atendidas++;
    horaMap.set(r.hora, h);

    const a = atMap.get(op) ?? { total: 0, atendidas: 0, feitas: 0, dur_total_seg: 0 };
    a.total++; if (atendeu(r)) a.atendidas++; if (r.direction !== "inbound") a.feitas++;
    a.dur_total_seg += r.duracao_seg || 0;
    atMap.set(op, a);
  }

  const serie = [...diaMap.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([dia, d]) => ({
    dia, total: d.total, atendidas: d.atendidas,
    atendentes: [...d.atend.entries()].map(([operador, qtd]) => ({ operador, qtd })).sort((a, b) => b.qtd - a.qtd),
  }));
  const porHora = [...horaMap.entries()].sort((a, b) => a[0] - b[0]).map(([hora, h]) => ({ hora, ...h }));
  const porAtendente = [...atMap.entries()].map(([atendente, a]) => ({ atendente, ...a })).sort((a, b) => b.total - a.total).slice(0, 50);
  const porCanal = [...canalMap.entries()].map(([canal, c]) => ({ canal, ...c })).sort((a, b) => b.total - a.total);

  return NextResponse.json({
    ok: true, totais, serie, porHora, porAtendente, porCanal,
    sem_vinculo: solto.n,
  });
}
