import { NextResponse } from "next/server";
import { makeToken, SESSION_COOKIE } from "@/lib/auth";
import { parseBody, AuthSchema } from "@/lib/validators";

export const runtime = "nodejs";

export async function POST(req: Request) {
  if (!process.env.APP_PASSWORD) {
    return NextResponse.json({ ok: false, reason: "server_misconfigured" }, { status: 500 });
  }
  const p = await parseBody(req, AuthSchema);
  if (!p.ok || p.data.password !== process.env.APP_PASSWORD) {
    return NextResponse.json({ ok: false, reason: "invalid_password" }, { status: 401 });
  }

  const res = NextResponse.json({ ok: true });
  res.cookies.set(SESSION_COOKIE, makeToken(), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 30,
  });
  return res;
}

export async function DELETE() {
  const res = NextResponse.json({ ok: true });
  res.cookies.set(SESSION_COOKIE, "", { httpOnly: true, path: "/", maxAge: 0 });
  return res;
}
