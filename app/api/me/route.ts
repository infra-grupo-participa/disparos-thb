import { NextResponse } from "next/server";
import { getSessao } from "@/lib/auth";

export const runtime = "nodejs";

// GET /api/me — usuário logado (para o menu/cabeçalho e gating de UI).
export async function GET() {
  const u = await getSessao();
  if (!u) return NextResponse.json({ ok: false }, { status: 401 });
  return NextResponse.json({ ok: true, usuario: { id: u.id, nome: u.nome, email: u.email, papel: u.papel } });
}
