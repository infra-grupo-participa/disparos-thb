import { NextResponse } from "next/server";
import { getSessao, type Usuario } from "@/lib/auth";
import { nivelDe, podeAcessarPortal, type Nivel } from "@/lib/papeis";

// Porta única das rotas de API (server-only). Resolve sessão, portal e nível de
// uma vez — era exatamente o que faltava: o gate de portal (0145) vivia só nos
// layouts de página, e QUALQUER conta logada lia /api/hm/kanban direto. Toda
// rota de DADOS passa por aqui; as públicas por desenho (webhook/cron/auth/
// formulários) estão documentadas no middleware e não chamam guard.
//
// Uso:   const g = await guard({ portal: "HM", nivel: "gestor" });
//        if (!g.ok) return g.res;
//        // g.sessao é o Usuario resolvido no banco (ativo, com portais)
//
// Respostas de recusa (o front trata pelos reasons):
//   401 { ok:false, reason:'unauthorized' }  — sem sessão válida
//   403 { ok:false, reason:'sem_portal' }    — portal fora da whitelist da conta
//   403 { ok:false, reason:'sem_permissao' } — nível abaixo do mínimo exigido

// Ordem dos níveis para "nível MÍNIMO": master passa onde se exige gestor.
const PESO: Record<Nivel, number> = { operador: 0, gestor: 1, master: 2 };

export type GuardResultado =
  | { ok: true; sessao: Usuario }
  | { ok: false; res: NextResponse };

export async function guard(opts?: {
  /** 'HM' | 'HT' | 'SEM' | 'CNHF' — o portal RESOLVIDO pela rota (eventoDe(req)
   *  nos portais genéricos; literal 'HM' nas rotas do HM). Validar o resolvido é
   *  o certo: o eventoDe sai de cookie/query, que é justamente o que o atacante
   *  controla — o que importa é a whitelist da conta cobrir o que a query VAI ler. */
  portal?: string | null;
  /** Nível mínimo exigido. Ausente = qualquer nível (basta sessão + portal). */
  nivel?: "master" | "gestor";
}): Promise<GuardResultado> {
  const sessao = await getSessao();
  if (!sessao) {
    return { ok: false, res: NextResponse.json({ ok: false, reason: "unauthorized" }, { status: 401 }) };
  }
  if (opts?.portal && !podeAcessarPortal(sessao.portais, opts.portal)) {
    return { ok: false, res: NextResponse.json({ ok: false, reason: "sem_portal" }, { status: 403 }) };
  }
  if (opts?.nivel && PESO[nivelDe(sessao)] < PESO[opts.nivel]) {
    return { ok: false, res: NextResponse.json({ ok: false, reason: "sem_permissao" }, { status: 403 }) };
  }
  return { ok: true, sessao };
}
