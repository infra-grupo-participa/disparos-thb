// ---------------------------------------------------------------------------
// PUBLICAR UMA VEZ, SEM PERDER O AVISO.
//
// Ordem: reivindica a chave (INSERT … ON CONFLICT DO NOTHING) → publica no Slack →
// se o Slack NÃO confirmou (HTTP ≠ 2xx, timeout, exceção), LIBERA a chave (delete
// da linha) para que um próximo envio do mesmo evento possa publicar. Sem a
// liberação, uma falha do Slack consumia a chave e o aviso se perdia para sempre.
//
// Sem I/O próprio: a reivindicação/liberação entram como dependência (o RPC real
// vive em index.ts), para o teste rodar sem banco. index.ts não é importável em
// teste porque chama serve().
// ---------------------------------------------------------------------------
import type { Aviso } from "./decidir_aviso.ts";

export type PortaDeAviso = {
  // true = este chamador publica. Erro do RPC já vira true lá dentro (falha aberta).
  reivindicar(aviso: Aviso, canal: string): Promise<boolean>;
  // Não fatal: falha só vai para o log.
  liberar(aviso: Aviso): Promise<void>;
};

// POST no webhook do Slack. true SÓ com resposta 2xx; timeout, exceção e qualquer
// outro status devolvem false (e vão para o log).
export async function postarNoSlack(url: string, corpo: unknown, rotulo: string): Promise<boolean> {
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(corpo),
      // Slack fora do ar não pode travar o processamento do evento — 10s e segue.
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) {
      console.error(`[SLACK] falha ao notificar ${rotulo}:`, response.status, await response.text());
      return false;
    }
    await response.body?.cancel();
    return true;
  } catch (e) {
    console.error(`[SLACK] exceção ao notificar ${rotulo}:`, e instanceof Error ? e.message : e);
    return false;
  }
}

// Devolve true se publicou. Os logs mostram só tipo e chave (a chave da RECUSA já
// vem com o e-mail em hash — ver decidirAviso).
export async function avisarUmaVez(
  aviso: Aviso,
  canal: string,
  publicar: () => Promise<boolean>,
  porta: PortaDeAviso,
): Promise<boolean> {
  if (aviso.tipo === "NADA" || !aviso.chave) return false;
  if (!await porta.reivindicar(aviso, canal)) return false;

  const publicou = await publicar();
  if (!publicou) {
    console.error(`[AVISO] Slack não confirmou — liberando a chave para o próximo envio (${aviso.tipo} ${aviso.chave})`);
    try {
      await porta.liberar(aviso);
    } catch (e) {
      console.error(`[AVISO] liberação falhou (${aviso.tipo} ${aviso.chave}):`, e instanceof Error ? e.message : e);
    }
  }
  return publicou;
}
