-- =====================================================================
-- 0079_hm_comprador_duplicado
--
-- UMA PESSOA, DOIS CADASTROS NA HOTMART — E O DINHEIRO CAINDO NO ERRADO.
--
-- Renato Nicolodi comprou o sinal com `orenatonicolodi@gmail.com` (é o cadastro
-- que virou card) e o saldo com `nicolodir3@gmail.com` (que não tem card). A
-- mensalidade dele, de R$ 1.364,54, cai num cadastro que o funil não enxerga: o
-- razão não lança, o saldo não abate, e isso se repetiria nas 9 parcelas restantes.
--
-- POR QUE UM MAPA E NÃO UM UPDATE em public.compras: reapontar a compra para o
-- outro comprador funcionaria até o próximo webhook. `persistPurchase` faz upsert
-- por `hotmart_transaction` e reescreve o `comprador_id` a partir do e-mail do
-- payload — a correção seria desfeita sozinha, em silêncio. O mapa fica do lado de
-- cá, onde a Hotmart não alcança, e o razão o consulta a cada lançamento.
--
-- Aditiva e idempotente.
-- =====================================================================

create table if not exists cs.hm_comprador_alias (
  comprador_id uuid primary key references public.compradores(id) on delete cascade,
  canonico_id  uuid not null      references public.compradores(id) on delete cascade,
  motivo       text,
  criado_em    timestamptz not null default now(),
  constraint hm_alias_nao_aponta_pra_si check (comprador_id <> canonico_id)
);

create index if not exists hm_comprador_alias_canonico_ix on cs.hm_comprador_alias (canonico_id);
grant select on cs.hm_comprador_alias to disparos_app;

-- Quem é o dono real deste pagamento
create or replace function cs.fn_hm_dono_do_pagamento(p_comprador_id uuid)
returns uuid
language sql
stable
security definer
set search_path = cs, public, pg_temp
as $fn$
  select coalesce(
    (select a.canonico_id from cs.hm_comprador_alias a where a.comprador_id = p_comprador_id),
    p_comprador_id
  );
$fn$;

grant execute on function cs.fn_hm_dono_do_pagamento(uuid) to disparos_app;

-- O razão passa a lançar no dono, não em quem a Hotmart diz que comprou
create or replace function cs.fn_hm_lancar_compra(p_compra_id uuid)
returns uuid
language plpgsql
security definer
set search_path = cs, public, pg_temp
as $fn$
declare
  v_c        public.compras%rowtype;
  v_dono     uuid;
  v_cat      text;
  v_recor    boolean;
  v_natureza text;
  v_id       uuid;
begin
  select * into v_c from public.compras where id = p_compra_id;
  if not found or v_c.status not in ('APPROVED','COMPLETE','COMPLETED') then return null; end if;

  -- Cadastro duplicado: o pagamento pertence ao card do cadastro canônico.
  v_dono := cs.fn_hm_dono_do_pagamento(v_c.comprador_id);

  if not exists (select 1 from cs.contatos_hm where comprador_id = v_dono) then return null; end if;

  select cat.categoria into v_cat from public.hm_product_catalog cat
   where cat.offer_code = v_c.oferta_codigo limit 1;
  select os.recorrente into v_recor from cs.hm_ofertas_saldo os
   where os.codigo = v_c.oferta_codigo limit 1;

  if v_cat is null or v_cat not in ('sinal','diferenca','compra_cheia') then return null; end if;

  v_natureza := cs.fn_hm_natureza_pagamento(v_cat, v_c.metodo_pagamento, v_recor);
  if v_natureza is null or coalesce(v_c.preco, 0) = 0 then return null; end if;

  insert into cs.hm_pagamentos (comprador_id, categoria, valor, pago_em, origem, transacao, compra_id,
                                oferta_codigo, metodo_pagamento, parcela, obs, autor)
  values (v_dono, v_natureza, v_c.preco, coalesce(v_c.data_aprovacao, v_c.data_compra, now()),
          'hotmart', v_c.hotmart_transaction, v_c.id, v_c.oferta_codigo, v_c.metodo_pagamento,
          v_c.numero_recorrencia,
          case when v_dono <> v_c.comprador_id
               then 'Pago no cadastro duplicado da Hotmart (' || v_c.comprador_id || ')' end,
          'hotmart')
  on conflict (transacao) where transacao is not null do nothing
  returning id into v_id;

  return v_id;
end$fn$;

grant execute on function cs.fn_hm_lancar_compra(uuid) to disparos_app;

-- Órfão de verdade é quem não tem card NEM alias para um card.
create or replace view cs.vw_hm_pagamentos_orfaos as
select c.id as compra_id, c.comprador_id, cp.nome, cp.email,
       cat.categoria, c.oferta_codigo, c.preco, c.metodo_pagamento,
       coalesce(c.data_aprovacao, c.data_compra) as pago_em, c.hotmart_transaction
  from public.compras c
  join public.compradores cp on cp.id = c.comprador_id
  join public.hm_product_catalog cat on cat.offer_code = c.oferta_codigo
 where c.status in ('APPROVED','COMPLETE','COMPLETED')
   and cat.categoria in ('sinal','diferenca','compra_cheia')
   and not exists (
     select 1 from cs.contatos_hm ch
      where ch.comprador_id = cs.fn_hm_dono_do_pagamento(c.comprador_id)
   );

grant select on cs.vw_hm_pagamentos_orfaos to disparos_app;

-- O caso do Renato ---------------------------------------------------------
insert into cs.hm_comprador_alias (comprador_id, canonico_id, motivo)
select dup.id, card.id,
       'Mesma pessoa, dois cadastros na Hotmart: sinal em ' || card.email
         || ', saldo em ' || dup.email || ' (sem CPF no duplicado). O saldo é do card.'
  from public.compradores dup
  join public.compradores card on lower(card.email) = 'orenatonicolodi@gmail.com'
 where lower(dup.email) = 'nicolodir3@gmail.com'
on conflict (comprador_id) do nothing;

-- O pagamento real entra no razão, com transação e lastro...
do $renato$
declare r record;
begin
  for r in
    select c.id
      from public.compras c
      join cs.hm_comprador_alias a on a.comprador_id = c.comprador_id
     where c.status in ('APPROVED','COMPLETE','COMPLETED')
  loop
    perform cs.fn_hm_lancar_compra(r.id);
  end loop;
end$renato$;

-- ...e o ajuste manual que segurava o valor sai de cena: agora há lastro de verdade.
-- (Se o ajuste ficasse, o pagamento contaria duas vezes.)
do $limpa$
declare r record;
begin
  for r in
    select p.id
      from cs.hm_pagamentos p
      join public.compradores cp on cp.id = p.comprador_id
     where p.autor = 'migration-0075'
       and p.categoria = 'ajuste'
       and lower(cp.email) = 'orenatonicolodi@gmail.com'
  loop
    perform cs.fn_hm_estornar_pagamento(
      r.id,
      'Substituído pelo pagamento real (cadastro duplicado unificado na migration 0079)',
      'migration-0079');
  end loop;
end$limpa$;

-- A trava de conferência sai junto: o valor dele não é mais um palpite.
update cs.contatos_hm ch
   set revisar = false,
       revisar_motivo = null,
       atualizado_em = now()
  from public.compradores cp
 where cp.id = ch.comprador_id
   and lower(cp.email) = 'orenatonicolodi@gmail.com'
   and ch.revisar_motivo like 'Financeiro: parte do valor pago não tem registro na Hotmart%';
