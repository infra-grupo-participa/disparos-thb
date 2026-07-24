import { queryOne } from "@/lib/db";
import { getConfig } from "@/lib/services/config";
import { checarLimiteDisparo, type Veredito } from "@/lib/services/limite";

// Guarda de disparo: a camada PREVENTIVA entre o operador e a Unnichat. Numa
// decisão só, reúne tudo que evita queimar a API ou bloquear o número:
//   1. Horário permitido — não disparar de madrugada/fim de semana (cara de spam).
//   2. Freio de segurança (circuit breaker) — se a Meta já está recusando ou
//      limitando ESTE número (falhas/códigos de qualidade nas últimas 24h), para
//      antes de piorar a reputação. O painel de saúde só aconselhava; aqui barra.
//   3. Limite de volume por evento (dia/hora) — o controle que já existia.
// Tudo configurável em cs.config (defaults sensatos); nunca quebra se a chave não
// existir. O admin ainda pode passar por cima no /api/send (com `forcar`, logado).

export type GuardaVeredito = Veredito & { bloqueios: string[] };

async function checarHorario(): Promise<string | null> {
  const ini = await getConfig<number>("disparo_janela_inicio", 9);
  const fim = await getConfig<number>("disparo_janela_fim", 18);
  const soUtil = await getConfig<boolean>("disparo_so_dia_util", true);
  // O servidor roda em UTC; a janela é no horário de Brasília.
  const partes = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Sao_Paulo",
    hour: "2-digit",
    hour12: false,
    weekday: "short",
  }).formatToParts(new Date());
  const hora = Number(partes.find((p) => p.type === "hour")?.value ?? "12");
  const dia = partes.find((p) => p.type === "weekday")?.value ?? "Mon";
  if (soUtil && (dia === "Sat" || dia === "Sun")) {
    return `Fora da janela: disparo só em dia útil. Hoje é ${dia === "Sat" ? "sábado" : "domingo"}.`;
  }
  if (hora < ini || hora >= fim) {
    return `Fora do horário permitido (${ini}h–${fim}h, horário de Brasília). Agora são ${hora}h — espere a janela abrir.`;
  }
  return null;
}

async function checarSaudeNumero(evento: string): Promise<string | null> {
  const ativo = await getConfig<boolean>("disparo_breaker", true);
  if (!ativo) return null;
  const pctLimite = await getConfig<number>("disparo_breaker_falha_pct", 15);
  const minAmostra = await getConfig<number>("disparo_breaker_min", 20);
  // Sinais reais da Meta nas últimas 24h neste número (evento). Os códigos são de
  // qualidade/bloqueio: 131049 (limite por qualidade), 368 (bloqueio por política),
  // 131031 (conta travada), 131026 (indisponível/recusa).
  const r = await queryOne<{ enviados: number; falhas: number; bloqueios: number }>(
    `select
        count(*) filter (where dc.enviado)::int as enviados,
        count(*) filter (where dc.status_meta = 'failed' or dc.erro is not null)::int as falhas,
        count(*) filter (where dc.erro_meta_code in ('131049','368','131031','131026'))::int as bloqueios
       from cs.disparo_contatos dc
       join cs.disparos d on d.id = dc.disparo_id and d.evento = $1
      where dc.enviado_em > now() - interval '24 hours'`,
    [evento],
  );
  if (!r || r.enviados < minAmostra) return null; // amostra pequena não decide
  if (r.bloqueios > 0) {
    return `Freio de segurança: a Meta sinalizou ${r.bloqueios} bloqueio/limite de qualidade nas últimas 24h neste número. Disparo pausado para não queimar o número — troque o número ou aguarde.`;
  }
  const pct = Math.round((r.falhas / Math.max(1, r.enviados)) * 100);
  if (pct >= pctLimite) {
    return `Freio de segurança: ${pct}% de falha nas últimas 24h (limite ${pctLimite}%). O número está em risco — disparo pausado.`;
  }
  return null;
}

export async function checarGuardaDisparo(evento: string, aEnviar: number): Promise<GuardaVeredito> {
  const bloqueios: string[] = [];

  const horario = await checarHorario();
  if (horario) bloqueios.push(horario);

  const saude = await checarSaudeNumero(evento);
  if (saude) bloqueios.push(saude);

  const vol = await checarLimiteDisparo(evento, aEnviar);
  if (!vol.liberado && vol.motivo) bloqueios.push(vol.motivo);

  return { ...vol, liberado: bloqueios.length === 0, motivo: bloqueios[0], bloqueios };
}
