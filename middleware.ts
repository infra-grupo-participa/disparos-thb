import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

// Guarda de UI/coarse: redireciona páginas sem cookie para /login e bloqueia
// APIs sem cookie com 401. A validação CRIPTOGRÁFICA da sessão acontece nas
// rotas (runtime Node, via isAuthed) — o middleware só checa presença, porque
// roda em Edge e não temos o segredo de HMAC de forma síncrona aqui.
const ALLOW_PREFIX = ["/api/auth", "/api/webhook", "/login"];

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
