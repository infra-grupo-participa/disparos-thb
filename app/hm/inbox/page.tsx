// Inbox do portal HM. A tela é portal-agnóstica (usa usePortal → evento 'HM') e
// deriva o prefixo das rotas de inbox pelo evento: para HM usa /api/hm/inbox*
// (overlay isolado cs.contatos_hm). Reaproveita 100% da UI do Seminário — os
// refinamentos (auto-refresh, bip, janela 24h, rótulo de origem) vêm junto.
export { default } from "@/app/[portal]/inbox/page";
