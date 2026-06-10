// Logger estruturado leve (sem dependência). Em produção emite JSON por linha
// (fácil de indexar/encaminhar p/ Sentry/Datadog depois); em dev, legível.
// Uso: const log = logger("send"); log.info("disparo iniciado", { disparoId });
type Nivel = "debug" | "info" | "warn" | "error";
const ORDEM: Record<Nivel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

const MIN = ORDEM[(process.env.LOG_LEVEL as Nivel) || (process.env.NODE_ENV === "production" ? "info" : "debug")] ?? 10;

function emit(nivel: Nivel, escopo: string, msg: string, meta?: Record<string, unknown>) {
  if (ORDEM[nivel] < MIN) return;
  const base = { ts: new Date().toISOString(), nivel, escopo, msg, ...(meta ?? {}) };
  const saida = process.env.NODE_ENV === "production"
    ? JSON.stringify(base)
    : `[${nivel}] ${escopo}: ${msg}${meta ? " " + JSON.stringify(meta) : ""}`;
  (nivel === "error" ? console.error : nivel === "warn" ? console.warn : console.log)(saida);
}

export function logger(escopo: string) {
  return {
    debug: (m: string, meta?: Record<string, unknown>) => emit("debug", escopo, m, meta),
    info: (m: string, meta?: Record<string, unknown>) => emit("info", escopo, m, meta),
    warn: (m: string, meta?: Record<string, unknown>) => emit("warn", escopo, m, meta),
    error: (m: string, erro?: unknown, meta?: Record<string, unknown>) =>
      emit("error", escopo, m, { ...(meta ?? {}), erro: erro instanceof Error ? erro.message : erro != null ? String(erro) : undefined }),
  };
}
