-- =====================================================================
-- 0138_template_unnichat_tag
-- Tag do Unnichat que um template de WhatsApp aplica ao contato NO MOMENTO do
-- disparo. Assim "disparar" também vira "segmentar lá dentro" — quem recebeu o
-- template fica marcado no Unnichat, alimentando automações/segmentos deles.
-- Opcional: template sem tag dispara normalmente, sem carimbar nada.
-- =====================================================================
alter table cs.templates add column if not exists unnichat_tag_id   text;
alter table cs.templates add column if not exists unnichat_tag_nome text;
