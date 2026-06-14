import { cookies } from "next/headers";

// Contexto de evento (portal ativo). Resolve a partir da querystring ?evento=
// (prioridade, útil em chamadas explícitas) ou do cookie cs_evento (definido
// pelo seletor no topo). Default 'HT' — preserva o comportamento legado. As
// rotas filtram a view cs.contatos_evento e os estágios por este valor.
export const EVENTO_COOKIE = "cs_evento";

// Sanitiza para um identificador de evento (letras maiúsculas, curto). Evita
// que valor arbitrário do cliente vire algo inesperado; a query é parametrizada.
function limpar(v: string | null | undefined): string | null {
  if (!v) return null;
  const s = v.toUpperCase().replace(/[^A-Z]/g, "").slice(0, 10);
  return s || null;
}

export function eventoDe(req: Request): string {
  const qs = limpar(new URL(req.url).searchParams.get("evento"));
  if (qs) return qs;
  const c = limpar(cookies().get(EVENTO_COOKIE)?.value);
  return c || "HT";
}
