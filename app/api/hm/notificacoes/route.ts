import { NextResponse } from "next/server";
import { guard } from "@/lib/guard";
import { produtoDaRequisicao } from "@/lib/produto-hm";
import { escopoVisibilidade, abasDaEsteira, type Ator } from "@/lib/papeis";
import { notificacoesHm } from "@/lib/services/hm-notificacoes";

export const runtime = "nodejs";

// GET /api/hm/notificacoes?produto=&limit= — feed do que o SISTEMA fez
// sozinho na esteira (F2): webhook da Hotmart, Make, movimentação automática.
// RECORTE de visibilidade (lib/services/visibilidade.ts): só os cards que a
// sessão enxerga — sem isso o operador veria movimento de card que a ficha
// dele recusa abrir.
//
// "Lido"/"não lido" é responsabilidade do CLIENTE (localStorage) — esta rota
// não grava nada, só lê; não existe endpoint de marcação e não deve existir
// um (a marcação por polling foi o que o plano pediu para EVITAR).
export async function GET(req: Request) {
  // 0187: portal validado é o do produto PEDIDO, não "HM" literal.
  const produto = produtoDaRequisicao(req);
  const g = await guard({ portal: produto });
  if (!g.ok) return g.res;
  const sessao = g.sessao;

  const sp = new URL(req.url).searchParams;
  const limitCru = sp.get("limit");
  // Só um número positivo passa; qualquer outra coisa (ausente, texto, negativo)
  // cai no default do service — nunca repassa direto para o SQL. O teto duro
  // (LIMITE_MAXIMO) é aplicado dentro do service, não aqui: uma única fonte de
  // verdade para "nunca mais que N linhas".
  const limit = limitCru && /^\d+$/.test(limitCru) ? Number(limitCru) : undefined;

  // Esteira compartilhada (0210/0212): o sino é a MESMA leitura do board por
  // outra porta — se o card aparece no kanban para quem tem a função, a
  // movimentação automática dele tem de aparecer aqui. Sem isso o feed fica
  // mais restrito que a listagem e some justamente o card que a função tornou
  // visível.
  const notificacoes = await notificacoesHm(escopoVisibilidade(sessao), {
    produto,
    limit,
    abas: abasDaEsteira(sessao as Ator, "HM", produto),
  });
  return NextResponse.json({ ok: true, notificacoes });
}
