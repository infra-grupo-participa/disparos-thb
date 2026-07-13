-- =====================================================================
-- 0047_hm_kanban_dono_do_acesso
-- O kanban de ativação passa a ser o DONO do "acesso HM liberado".
--
-- Contexto: existiam duas telas decidindo a mesma coisa — a coluna
-- "Acesso Liberado" do kanban (grava thb_alunos.status_acesso) e a fila
-- "Acesso HM" do painel v2 (grava public.hm_liberacoes, via fn_hm_liberar).
-- A fila do v2 nunca foi usada (hm_liberacoes está vazia), então o custo de
-- eleger um dono agora é zero.
--
-- Decisão: o kanban decide; o painel v2 reflete. Ao mover o card para
-- "Acesso Liberado", cs.fn_hm_liberar_acesso carimba hm_liberacoes.acesso_em
-- da compra de entrada — que é exatamente o que fn_hm_fila lê para mostrar a
-- linha como "concluído". Nenhuma mudança é necessária no repositório do v2.
--
-- IMPORTANTE — por que esta função NÃO escreve thb_alunos.status_acesso:
-- depois da 0045, `status_acesso` é DERIVADO da data_expiracao e recalculado
-- todo dia. Ele responde "a matrícula está dentro da validade?", não "o acesso
-- já foi criado na plataforma?". Se esta função o marcasse como 'vigente', a
-- rotina diária sobrescreveria de volta — e, pior, o campo passaria a afirmar
-- duas coisas diferentes. O registro de "acesso criado" é hm_liberacoes.acesso_em,
-- e só ele.
--
-- `acesso_por` fica nulo de propósito: ele referencia public.perfis (auth do
-- v2), e quem opera o kanban é um usuário de cs.usuarios. A autoria real fica
-- na timeline do card (cs.interacoes). Idempotente.
-- =====================================================================

create or replace function cs.fn_hm_liberar_acesso(p_comprador_id uuid)
returns boolean
language plpgsql
security definer
set search_path = cs, public, pg_temp
as $fn$
declare
  v_aluno_id  uuid;
  v_compra_id uuid;
  v_turma     smallint;
begin
  select coalesce(ch.aluno_id, (select a.id from public.thb_alunos a where a.comprador_id = p_comprador_id limit 1))
    into v_aluno_id
    from cs.contatos_hm ch where ch.comprador_id = p_comprador_id;
  if v_aluno_id is null then return false; end if;

  update cs.contatos_hm set aluno_id = v_aluno_id where comprador_id = p_comprador_id and aluno_id is null;

  -- Espelha na fila do painel v2: a compra de ENTRADA (sinal ou compra cheia)
  -- é a linha que fn_hm_fila mostra. Sem isso, o v2 continuaria exibindo a
  -- pessoa como pendente de liberação para sempre.
  select id into v_turma from public.thb_turmas where codigo = 'T39' limit 1;

  select c.id into v_compra_id
    from public.compras c
    join public.hm_product_catalog cat on cat.offer_code = c.oferta_codigo
   where c.comprador_id = p_comprador_id
     and c.status in ('APPROVED','COMPLETE','COMPLETED')
     and cat.categoria in ('sinal','compra_cheia')
   order by coalesce(c.data_aprovacao, c.data_compra) desc
   limit 1;

  if v_compra_id is not null then
    insert into public.hm_liberacoes (compra_id, turma_id, acesso_em, atualizado_em)
    values (v_compra_id, v_turma, now(), now())
    on conflict (compra_id) do update
      set acesso_em     = coalesce(public.hm_liberacoes.acesso_em, excluded.acesso_em),
          turma_id      = coalesce(public.hm_liberacoes.turma_id, excluded.turma_id),
          atualizado_em = now();
  end if;

  return true;
end$fn$;

grant execute on function cs.fn_hm_liberar_acesso(uuid) to disparos_app;
