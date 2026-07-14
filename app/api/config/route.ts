import { NextResponse } from "next/server";
import { z } from "zod";
import { isAuthed, getSessao } from "@/lib/auth";
import { listConfig, setConfig } from "@/lib/services/config";
import { parseBody } from "@/lib/validators";

export const runtime = "nodejs";

// GET — lê todas as configurações. PATCH — grava uma chave (valor JSON livre).
export async function GET() {
  if (!isAuthed()) return NextResponse.json({ ok: false }, { status: 401 });
  return NextResponse.json({ ok: true, config: await listConfig() });
}

const ConfigSetSchema = z.object({ chave: z.string().min(1), valor: z.unknown() });

// Escrever aqui é ato de administração: daqui saem o limite anti-ban do disparo
// (`disparo_limite_diario`/`_hora`) e o remetente dos e-mails. Deixar isso para
// qualquer papel logado permitia a um operador afrouxar o próprio limite.
export async function PATCH(req: Request) {
  const sessao = await getSessao();
  if (!sessao) return NextResponse.json({ ok: false }, { status: 401 });
  if (sessao.papel !== "admin") return NextResponse.json({ ok: false, reason: "forbidden" }, { status: 403 });

  const p = await parseBody(req, ConfigSetSchema);
  if (!p.ok) return p.res;
  await setConfig(p.data.chave, p.data.valor);
  return NextResponse.json({ ok: true });
}
