import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

// Guarda de UI/coarse: redireciona páginas sem cookie para /login e bloqueia
// APIs sem cookie com 401. A validação CRIPTOGRÁFICA da sessão acontece nas
// rotas (runtime Node, via isAuthed) — o middleware só checa presença, porque
// roda em Edge e não temos o segredo de HMAC de forma síncrona aqui.
// Rotas públicas: webhooks de provedores (autenticam por assinatura/segredo no
// próprio handler, não por cookie) + login. O webhook do Atende Simples valida
// X-Hub-Signature (HMAC) na rota, então é liberado aqui — mas SÓ ele, não as
// demais rotas de /api/ligacoes (histórico/métricas seguem exigindo sessão).
const ALLOW_PREFIX = ["/api/auth", "/api/webhook", "/api/cron", "/api/eventos", "/api/ligacoes/atendesimples", "/login"];

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  if (ALLOW_PREFIX.some((p) => pathname.startsWith(p))) {
    return NextResponse.next();
  }

  const hasSession = req.cookies.has("cs_session");
  if (!hasSession) {
    if (pathname.startsWith("/api/")) {
      return NextResponse.json({ ok: false, reason: "unauthorized" }, { status: 401 });
    }
    const url = req.nextUrl.clone();
    url.pathname = "/login";
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
