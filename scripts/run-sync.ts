// Sincronização do histórico de conversas da Unnichat via CLI (sem HTTP/auth).
// Uso: npx tsx scripts/run-sync.ts [limitePorLote]
// Carrega .env.local, roda lotes até esgotar os pendentes, encerra o pool.
import { loadEnvConfig } from "@next/env";
loadEnvConfig(process.cwd());

async function main() {
  const { sincronizarLote } = await import("../lib/sync-conversas");
  const { getPool } = await import("../lib/db");
  const limite = Number(process.argv[2]) || 60;

  let totalNovas = 0;
  for (let i = 0; i < 20; i++) {
    const r = await sincronizarLote(limite);
    totalNovas += r.mensagens_novas;
    console.log(
      `lote ${i + 1}: processados=${r.processados} com_conversa=${r.com_conversa} ` +
      `novas=${r.mensagens_novas} erros=${r.erros} restantes=${r.restantes}`,
    );
    if (r.restantes === 0) break;
  }
  console.log(`\n✔ concluído — ${totalNovas} mensagens novas no total`);
  await getPool().end();
}

main().catch((e) => { console.error(e); process.exit(1); });
