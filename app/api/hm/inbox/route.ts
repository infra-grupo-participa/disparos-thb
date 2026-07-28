import { NextResponse } from "next/server";
import { guard } from "@/lib/guard";
import { filaInboxHm } from "@/lib/services/inbox-fila";

export const runtime = "nodejs";

// GET /api/hm/inbox — fila de conversas do HM. Rota HM PRÓPRIA (não a genérica):
// o HM vive no overlay isolado cs.contatos_hm, com timeline em contato_hm_id e
// sem entrar em cs.contatos_evento. Mostra todos os cards com telefone (o
// comercial inicia a conversa); pendentes no topo, quem espera há mais tempo
// primeiro (fila de SLA).
//
// RECORTE POR OPERADOR (segurança no backend): GP/admin veem tudo; operador
// comum vê só o pool (sem dono) + os cards atribuídos a ele. Mesmo predicado do
// board. A montagem da fila (colunas, ordenação, recorte) vive em
// lib/services/inbox-fila.ts, compartilhada com POST /api/inbox/sync?fila=1.
export async function GET(req: Request) {
  const g = await guard({ portal: "HM" });
  if (!g.ok) return g.res;
  const sp = new URL(req.url).searchParams;

  const { conversas, pendentes } = await filaInboxHm(g.sessao, {
    status: sp.get("status"),      // pendente | resolvido
    disparoId: sp.get("disparo"),  // ver só os contatos de um disparo
  });
  return NextResponse.json({ ok: true, conversas, pendentes });
}
