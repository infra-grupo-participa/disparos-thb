-- =====================================================================
-- 0114_renovacoes_nao_dao_trilha
--
-- RENOVAÇÃO NÃO DÁ DIREITO AO PROGRAMA DE IMPLEMENTAÇÃO.
--
-- O time trouxe a lista de ofertas de RENOVAÇÃO legada (gente que renovou o
-- Holding Masters por fora, sem passar pela oferta do sinal de R$300): 235hpjy9,
-- 9f3dm6af, cgerr0pt, 0ulco7sq, hgph3cfh, s2kvgyli e 6qxsk9kq. Essas pessoas NÃO
-- estão no programa de implementação e não têm direito à trilha do GPS.
--
-- O FURO: `6qxsk9kq` (R$2.497, "Acesso até Dez/2026" — downsell de acesso) está
-- catalogado como categoria 'sinal'. A Fase 3 (0110) concede trilha do GPS a todo
-- 'sinal' aprovado — então dois renovadores ganharam acesso indevido:
-- Cristiano Barreto Espindola Siebra e Leonardo Gomes de Carvalho Maia Leite.
--
-- POR QUE NÃO TROCAR A CATEGORIA: a nota do catálogo diz que o 6qxsk9kq é 'sinal'
-- de propósito, para o comprador TER card e ficar quitado nos R$2.497. Trocar a
-- categoria tiraria o card da esteira E faria o pagamento sumir do razão
-- (fn_hm_lancar_compra só lança sinal/diferenca/compra_cheia). O time confirmou:
-- mantém o card, tira só o GPS.
--
-- SOLUÇÃO: um flag declarativo no catálogo — `concede_trilha`. A categoria segue
-- dizendo o que o dinheiro É; o flag diz se aquilo dá direito ao programa. Assim a
-- regra fica no catálogo (dado), não escondida num if de função.
--
-- Reversível. Idempotente.
-- =====================================================================

-- 1) O flag: por padrão a oferta concede (não muda nada do que já existe) --------
alter table public.hm_product_catalog
  add column if not exists concede_trilha boolean not null default true;

comment on column public.hm_product_catalog.concede_trilha is
  'A oferta dá direito ao programa de implementação (trilha no GPS)? Renovação e downsell de acesso = false: a pessoa comprou acesso, não o programa.';

-- 2) Renovação e downsell de acesso NÃO concedem -------------------------------
update public.hm_product_catalog
   set concede_trilha = false
 where offer_code in ('235hpjy9','9f3dm6af','cgerr0pt','0ulco7sq','hgph3cfh','s2kvgyli','6qxsk9kq')
    or categoria = 'renovacao';

-- 3) Os 5 códigos de renovação que faltavam no catálogo (preventivo) -----------
-- Hoje não têm compra no banco (só na planilha legada). Cadastrar evita que uma
-- ingestão futura caia sem categoria — ou pior, seja lida como sinal.
insert into public.hm_product_catalog (product_id, offer_code, product_name, categoria, concede_trilha, notes)
select '5064314', v.code, 'Holding Masters — Renovação', 'renovacao', false,
       'Renovação legada (fora do programa de implementação). Cadastrada na 0114 de forma preventiva: sem compra no banco até 20/07/2026.'
  from (values ('9f3dm6af'),('cgerr0pt'),('0ulco7sq'),('hgph3cfh'),('s2kvgyli')) as v(code)
 where not exists (select 1 from public.hm_product_catalog c where c.offer_code = v.code);

-- 4) A Fase 3 passa a respeitar o flag ------------------------------------------
create or replace function cs.fn_hm_trilha_do_sinal()
returns trigger
language plpgsql
security definer
set search_path = cs, public, pg_temp
as $fn$
declare
  v_ok boolean;
begin
  if new.status not in ('APPROVED','COMPLETE','COMPLETED') then return new; end if;
  if new.comprador_id is null then return new; end if;

  -- Só o sinal do PROGRAMA concede trilha. Renovação e downsell de acesso têm
  -- concede_trilha = false: a pessoa comprou acesso, não o programa.
  select (cat.categoria = 'sinal' and cat.concede_trilha)
    into v_ok
    from public.hm_product_catalog cat
   where cat.offer_code = new.oferta_codigo
   limit 1;

  if not coalesce(v_ok, false) then return new; end if;

  begin
    perform cs.fn_hm_provisionar_trilha_sinal(new.comprador_id);
  exception when others then
    raise warning 'trilha do sinal falhou para comprador %: %', new.comprador_id, sqlerrm;
  end;

  return new;
end$fn$;

-- 5) Mesma trava na função de provisionamento (cinto e suspensório) ------------
-- Se alguém chamar a função direto (backfill, correção manual), a regra vale igual.
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

  -- O sinal precisa ser de oferta que CONCEDE o programa (0114).
  select
    exists (select 1 from public.compras c join public.hm_product_catalog cat on cat.offer_code = c.oferta_codigo
             where c.comprador_id = p_comprador_id and c.status in ('APPROVED','COMPLETE','COMPLETED')
               and cat.categoria = 'sinal' and cat.concede_trilha),
    exists (select 1 from public.compras c join public.hm_product_catalog cat on cat.offer_code = c.oferta_codigo
             where c.comprador_id = p_comprador_id and c.status in ('APPROVED','COMPLETE','COMPLETED')
               and cat.categoria in ('diferenca','compra_cheia'))
  into v_tem_sinal, v_quitou;

  if not v_tem_sinal or v_quitou then return null; end if;

  select id into v_existe from public.thb_alunos where comprador_id = p_comprador_id limit 1;
  if v_existe is null and coalesce(btrim(v_cp.email),'') <> '' then
    select id into v_existe from public.thb_alunos where lower(btrim(email)) = lower(btrim(v_cp.email)) limit 1;
  end if;
  if v_existe is not null then return null; end if;

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
    'aluno', null, p_comprador_id,
    v_data, (v_data + interval '365 days')::date, 'vigente', 'Hotmart (THB)',
    'Sinal HM + 365 dias (trilha)', '1 ano',
    null, v_pago, null, 'so_sinal', 'Só sinal pago',
    v_data::date, 'sip_sinal_trilha'
  ) returning id into v_id;

  return v_id;
end$fn$;

-- 6) Revoga a trilha concedida por engano --------------------------------------
-- Só linhas que ESTE funil criou (fonte sip_sinal_trilha) e cujo único "sinal" é
-- uma oferta que não concede. Cadastro antigo/aluno de verdade nunca é tocado.
delete from public.thb_alunos a
 where a.fonte = 'sip_sinal_trilha'
   and not exists (
     select 1 from public.compras c
       join public.hm_product_catalog cat on cat.offer_code = c.oferta_codigo
      where c.comprador_id = a.comprador_id
        and c.status in ('APPROVED','COMPLETE','COMPLETED')
        and cat.categoria = 'sinal'
        and cat.concede_trilha
   );
