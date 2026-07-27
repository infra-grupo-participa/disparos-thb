import { NextResponse } from "next/server";
import { z } from "zod";
import { guard } from "@/lib/guard";
import { listConfig, setConfig } from "@/lib/services/config";
import { parseBody } from "@/lib/validators";

export const runtime = "nodejs";

// Configuração global (limite anti-ban, remetente de e-mail…) é gestão de
// sistema: SÓ MASTER, na leitura e na escrita. A leitura também: os valores
// alimentam a tela de canais (área do master) e expõem os parâmetros da operação.
export async function GET() {
  const g = await guard({ nivel: "master" });
  if (!g.ok) return g.res;
  return NextResponse.json({ ok: true, config: await listConfig() });
}

const ConfigSetSchema = z.object({ chave: z.string().min(1), valor: z.unknown() });

// Escrever aqui é ato de administração: daqui saem o limite anti-ban do disparo
// (`disparo_limite_diario`/`_hora`) e o remetente dos e-mails. Deixar isso para
// qualquer papel logado permitia a um operador afrouxar o próprio limite — e
// "papel admin" sozinho deixava passar admin de equipe comum (agora é master).
export async function PATCH(req: Request) {
  const g = await guard({ nivel: "master" });
  if (!g.ok) return g.res;

  const p = await parseBody(req, ConfigSetSchema);
  if (!p.ok) return p.res;
  await setConfig(p.data.chave, p.data.valor);
  return NextResponse.json({ ok: true });
}
