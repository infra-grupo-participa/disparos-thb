-- 0178_views_financeiras_so_leitura.sql
-- As views financeiras deixam de ter grant de ESCRITA para o app.
--
-- Mesma origem da 0177: `cs.vw_hm_financeiro` e `cs.vw_hm_entradas_sem_pacote`
-- vinham com INSERT/UPDATE/DELETE para `disparos_app`, herdados do
-- `alter default privileges in schema cs` da 0001 — nunca foi decisão de ninguém.
--
-- Na prática escrever nelas já falharia (view com join e lateral não é
-- auto-atualizável), mas privilégio que existe por inércia é privilégio que um dia
-- alguém usa: basta a view virar mais simples, ou alguém escrever uma rule.
-- Leitura é o único direito que essas views precisam ter.
--
-- Registro do que a auditoria confirmou e NÃO precisou de correção:
--   · `public.hm_product_catalog` — a tabela que agora precifica dívida de aluno —
--     tem RLS ligado e escrita restrita pela policy `hm_product_catalog_admin_write`
--     a `gp_is_admin()`. A função é `security definer`, lê `public.perfis` por
--     `auth.uid()` e exige cargo `dev`/`admin` com status `ativo`: não é
--     falsificável pelo cliente, porque `auth.uid()` sai do JWT já verificado.
--     Os grants amplos para `anon` na tabela são inertes — não há policy para
--     `anon`, e sob RLS sem policy não se lê nem se escreve.
--   · Nenhuma rota da aplicação escreve em `public.hm_product_catalog`.
--   · O parâmetro `produto`, que passou a viajar por query string até o SQL
--     (`app/api/hm/kanban/route.ts`, `lib/services/hm.ts`), é fechado numa lista de
--     três valores e vai parametrizado — sem superfície de injeção.
revoke insert, update, delete on cs.vw_hm_financeiro from disparos_app;
revoke insert, update, delete on cs.vw_hm_entradas_sem_pacote from disparos_app;
grant select on cs.vw_hm_financeiro to disparos_app;
grant select on cs.vw_hm_entradas_sem_pacote to disparos_app;
