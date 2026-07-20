-- =====================================================================
-- 0109_trilha_do_sinal_acesso_gps   (Fase 3 da integração do ecossistema)
--
-- QUEM PAGA O SINAL DE R$300 PASSA A TRILHAR NO GPS.
--
-- O GPS (programa.timeholdingbrasil.com.br) é keyed em `thb_alunos.id` — todas as
-- tabelas dele (gps.etapa1_clientes, gps.membros, gps.solicitacoes_acesso) apontam
-- para um aluno, e o vínculo é feito POR DOCUMENTO. Sem linha na base, não há
-- trilha. Por isso o sinal precisa gerar uma linha.
--
-- MAS a 0054 proibiu "sinal vira aluno" por um motivo real: quando isso foi feito
-- errado, SOBRESCREVEU turma e financeiro de gente de verdade (viraram "pagou 300,
-- deve 14.700"). Esta migration não repete o erro — ela cria uma linha de outra
-- natureza:
--
--     turma_id = NULL            <- É ISTO que diz "não é da T39"
--     fonte    = 'sip_sinal_trilha'
--     situacao_financeira = 'so_sinal'  ('Só sinal pago')
--     valor_total / saldo = NULL (não afirma dívida que ninguém combinou)
--     status_acesso = 'vigente'  (o acesso em si, que o GPS enxerga)
--     plano    = 'aluno'         (o tier é obrigatório e restrito por CHECK a
--                                 aluno/aurum/diamante/platina/super_diamante —
--                                 'plano' é TIER de produto, não tipo de acesso.
--                                 Inventar um valor novo quebraria os outros
--                                 sistemas que leem esse campo.)
--
-- E com três travas: (1) só quem tem sinal aprovado e NÃO tem diferenca/compra_cheia
-- — quem quitou continua pela regra da 0054; (2) só cria linha NOVA, nunca toca em
-- cadastro existente (nem por comprador, nem por e-mail); (3) não mexe no card
-- (turma, tags e aluno_id do kanban seguem intocados — 'aluno' continua querendo
-- dizer aluno da T39).
--
-- Reversível: `delete from public.thb_alunos where fonte = 'sip_sinal_trilha'`.
-- Idempotente.
-- =====================================================================

create or replace function cs.fn_hm_provisionar_trilha_sinal(p_comprador_id uuid)
returns uuid
language plpgsql
security definer
set search_path = cs, public, pg_temp
as $fn$
declare
  v_cp        public.compradores%rowtype;
  v_tem_sinal boolean;
  v_quitou    boolean;
  v_existe    uuid;
  v_pago      numeric;
  v_data      timestamptz;
  v_id        uuid;
begin
  select * into v_cp from public.compradores where id = p_comprador_id;
  if not found then return null; end if;

  -- TRAVA 1: precisa de sinal aprovado, e NÃO pode ter quitação —
  -- quem tem diferenca/compra_cheia vira aluno de verdade pela 0054, não por aqui.
  select
    exists (select 1 from public.compras c join public.hm_product_catalog cat on cat.offer_code = c.oferta_codigo
             where c.comprador_id = p_comprador_id and c.status in ('APPROVED','COMPLETE','COMPLETED')
               and cat.categoria = 'sinal'),
    exists (select 1 from public.compras c join public.hm_product_catalog cat on cat.offer_code = c.oferta_codigo
             where c.comprador_id = p_comprador_id and c.status in ('APPROVED','COMPLETE','COMPLETED')
               and cat.categoria in ('diferenca','compra_cheia'))
  into v_tem_sinal, v_quitou;

  if not v_tem_sinal or v_quitou then return null; end if;

  -- TRAVA 2: nunca toca em cadastro que já existe (o erro da 0054 foi exatamente
  -- sobrescrever gente que já estava na base). Se já há linha, sai em silêncio.
  select id into v_existe from public.thb_alunos where comprador_id = p_comprador_id limit 1;
  if v_existe is null and coalesce(btrim(v_cp.email),'') <> '' then
    select id into v_existe from public.thb_alunos where lower(btrim(email)) = lower(btrim(v_cp.email)) limit 1;
  end if;
  if v_existe is not null then return null; end if;

  -- O que ele de fato pagou (o sinal) e quando — sem inventar total nem dívida.
  select coalesce(sum(c.preco), 0), min(coalesce(c.data_aprovacao, c.data_compra))
    into v_pago, v_data
    from public.compras c join public.hm_product_catalog cat on cat.offer_code = c.oferta_codigo
   where c.comprador_id = p_comprador_id and c.status in ('APPROVED','COMPLETE','COMPLETED')
     and cat.categoria = 'sinal';
  v_data := coalesce(v_data, now());

  insert into public.thb_alunos (
    nome, email, telefone, documento, tipo_documento,
    plano, turma_id, comprador_id,
    data_compra, data_expiracao, status_acesso, origem_acesso, regra_acesso, tempo_acesso,
    valor_total, valor_pago, saldo_devedor, situacao_financeira, status_pagamento,
    ultimo_pagamento, fonte
  ) values (
    v_cp.nome, v_cp.email, v_cp.telefone, v_cp.documento, v_cp.tipo_documento,
    'aluno', null, p_comprador_id,          -- turma_id NULL = não é da T39
    v_data, (v_data + interval '365 days')::date, 'vigente', 'Hotmart (THB)',
    'Sinal HM + 365 dias (trilha)', '1 ano',
    null, v_pago, null, 'so_sinal', 'Só sinal pago',
    v_data::date, 'sip_sinal_trilha'
  ) returning id into v_id;

  return v_id;
end$fn$;

grant execute on function cs.fn_hm_provisionar_trilha_sinal(uuid) to disparos_app;

comment on function cs.fn_hm_provisionar_trilha_sinal(uuid) is
  'Fase 3: quem pagou só o sinal ganha linha de TRILHA na base (plano trilha_sinal, sem turma, sem dívida) para acessar o GPS. Nunca toca em cadastro existente; quem quita vira aluno pela 0054.';

-- Backfill: os pagantes-só-do-sinal que ainda não têm nenhuma linha na base ------
do $backfill$
declare r record; v_novo uuid; v_n int := 0;
begin
  for r in
    select cp.id
      from public.compradores cp
     where exists (select 1 from public.compras c join public.hm_product_catalog cat on cat.offer_code=c.oferta_codigo
                    where c.comprador_id=cp.id and c.status in ('APPROVED','COMPLETE','COMPLETED') and cat.categoria='sinal')
       and not exists (select 1 from public.thb_alunos a where a.comprador_id = cp.id)
  loop
    v_novo := cs.fn_hm_provisionar_trilha_sinal(r.id);
    if v_novo is not null then v_n := v_n + 1; end if;
  end loop;
  raise notice 'trilha do sinal provisionada para % pessoa(s)', v_n;
end$backfill$;
