-- =====================================================================
-- 0005_cs_disparo_fase_criar_contatos
-- Suporte à criação prévia de contatos na Unnichat antes do disparo.
-- Compradores HT caem no nosso sistema automaticamente, mas podem não existir
-- como contato na Unnichat — e o template só é enviado para contato conhecido.
-- Por isso o disparo passa a ter 2 fases: criar contatos -> enviar.
-- Aplicada em produção via admin (Supabase). Mantida aqui para versionamento.
-- =====================================================================
alter table cs.disparos
  add column if not exists fase text not null default 'enviando',        -- criando_contatos | enviando | concluido
  add column if not exists total_contatos_criados int not null default 0;

alter table cs.disparo_contatos
  add column if not exists contato_criado boolean not null default false,
  add column if not exists erro_contato text;
