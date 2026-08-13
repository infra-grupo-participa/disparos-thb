-- 0221 — o vazamento entre HM×AURUM não acabou em 0197/0218/0220
--
-- Triagem pedida pelo Marcio (item 2c, 13/08): varredura de toda `cs.fn_hm_*`
-- que toca `cs.contatos_hm`/`cs.hm_pagamentos` por `comprador_id` procurando a
-- MESMA classe de bug que 0196/0197/0218/0220 já fecharam em outras 12 funções
-- — "card por pessoa × produto" (0163) e `select ... where comprador_id = X`
-- sem `produto` (e sem `order by`+`limit`) escolhe UM card no escuro, entre os
-- dois de quem tem HM E AURUM (15 pessoas hoje).
--
-- Achados REAIS nesta migration (fixados abaixo):
--
--   [1] fn_hm_pode_finalizar   O ramo "comercial registrou como parcelado" lia
--                               `coalesce((select ch.pagamento_forma = ... from
--                               cs.contatos_hm where comprador_id = X))` — uma
--                               SUBQUERY ESCALAR, não `exists`. Para quem tem 2
--                               cards, isso é `ERROR 21000: more than one row
--                               returned by a subquery used as an expression`
--                               — MESMA família do incidente que já derrubou o
--                               board em 10/08 (0168) e que 0197 fechou em
--                               fn_hm_tem_lastro/fn_hm_valores_derivados. Esta
--                               ficou pra trás porque nasceu depois (0100) e
--                               ninguém tocou nela na varredura de 0197.
--                               `moverEstagioHm` chama esta função no caminho
--                               "vaiFinalizar" — pagar o saldo ou entrar na
--                               Ativação. CRASH, não só dado errado.
--
--   [2] fn_hm_estornar_pagamento  Escolhia o card da nota de timeline por
--                               `select id into v_card from cs.contatos_hm
--                               where comprador_id = v_p.comprador_id` — sem
--                               produto, sem limit. O DELETE do pagamento (o
--                               dinheiro) está correto, sempre foi por
--                               `id = p_pagamento_id`; o que vazava era só o
--                               relato ("Pagamento estornado: R$ X") caindo na
--                               timeline do board ERRADO — confunde quem
--                               audita o board certo mais tarde.
--
--   [3] fn_hm_extrato          O CTE `total` lia `cs.contatos_hm where
--                               comprador_id = X` sem produto nem limit: para
--                               quem tem 2 cards, essa CTE devolve 2 LINHAS, o
--                               `cross join total` DUPLICA cada lançamento do
--                               extrato (uma vez por total), e o `saldo_depois`
--                               de cada linha é calculado contra um
--                               `valor_total` escolhido ao acaso entre os dois
--                               boards. Zero chamadores hoje na aplicação (é a
--                               porta oficial do razão, comentário da 0076) —
--                               fixado antes de ganhar o primeiro.
--
--   [4] fn_hm_descancelar      A pior das quatro: `update cs.contatos_hm set
--                               cancelamento_efetivado_em = null, ... where
--                               comprador_id = X` — SEM `and id = card`. Desfazer
--                               o cancelamento de UM board REABRIA o cancelamento
--                               do OUTRO board junto, silenciosamente (a lógica
--                               espelho de fn_hm_cancelar, que a 0197 já corrigiu
--                               para escrever só no card certo — esta ficou
--                               destrancada). `v_aluno_id` também era escolhido
--                               sem produto/limit — o sync de `situacao_financeira`
--                               em thb_alunos podia acertar o aluno do board errado.
--
-- Todas ganham `p_produto` com DEFAULT (convenção já estabelecida por
-- fn_hm_tem_lastro/fn_hm_valores_derivados/fn_hm_cancelar, 0197): callers
-- antigos continuam válidos. `fn_hm_estornar_pagamento` não precisou de
-- parâmetro novo — o produto sai da PRÓPRIA oferta do pagamento
-- (`cs.fn_hm_pagamento_do_produto`), que é mais correto do que pedir para o
-- chamador informar.
--
-- ⚠️ A ARMADILHA DA 0215: `create or replace` NÃO troca a lista de argumentos —
-- acrescentar parâmetro cria uma SEGUNDA função e o Postgres recusa a chamada
-- antiga com `is not unique`. DROP da assinatura antiga antes de recriar, em
-- TODAS que ganham parâmetro; a rede de segurança no final conta assinaturas
-- por nome e aborta se sobrar par.
--
-- FORA desta migration (varredura completa, ~14 candidatos por
-- "contatos_hm + comprador_id sem 'produto' no corpo da função"; classificação
-- no retorno da tarefa):
--   · fn_hm_cancelar_por_email    FALSO POSITIVO — já conta os cards (v_cards)
--     e abre alerta 'cancelamento_ambiguo' em vez de escolher no escuro quando
--     há mais de um (mesmo desenho de fn_hm_cancelar_por_transacao, 0218).
--   · fn_hm_lancar_pagamento      FALSO POSITIVO para esta classe — não
--     resolve/escreve em um CARD (a linha de cs.hm_pagamentos é por
--     comprador+oferta, o produto sai da oferta nas views). O `exists(select 1
--     from contatos_hm where comprador_id=X)` é só um gate de "está no funil",
--     não uma escolha de card.
--   · fn_hm_cadastrar_manual, fn_hm_etapa_pos_pagamento, fn_hm_liberar_acesso,
--     fn_hm_admin_editar, fn_hm_pagamento_mudou (trigger), fn_hm_provisionar_socios,
--     fn_hm_sugestao_financeira, fn_hm_lancar_compra — BUG REAL, não corrigido
--     NESTA migration (ver justificativa completa no retorno da tarefa: risco/
--     acoplamento com código em edição por outro agente, ou impossibilidade de
--     medir em produção nesta rodada — este agente não teve acesso às
--     ferramentas MCP do Supabase nem a uma DATABASE_URL local). Listado para
--     o dono priorizar.

begin;

-- ---------------------------------------------------------------------------
-- [1] fn_hm_pode_finalizar — crash de subquery escalar em quem tem 2 cards.
-- ---------------------------------------------------------------------------
drop function if exists cs.fn_hm_pode_finalizar(uuid);

create or replace function cs.fn_hm_pode_finalizar(p_comprador_id uuid, p_produto text default 'HM')
returns boolean
language sql
stable
security definer
set search_path to 'cs', 'public', 'pg_temp'
as $fn$
  select
    -- pagamento real do saldo na Hotmart (à vista/diferença/compra cheia)
    exists (
      select 1
        from public.compras c
        join public.hm_product_catalog cat on cat.offer_code = c.oferta_codigo
       where c.comprador_id = p_comprador_id
         and c.status in ('APPROVED','COMPLETE','COMPLETED')
         and cat.categoria in ('diferenca','compra_cheia')
         and cs.fn_hm_pagamento_do_produto(c.oferta_codigo, p_produto)
    )
    -- parcelou na Hotmart: a compra é parcelada (installments)
    or exists (
      select 1 from public.compras c
       where c.comprador_id = p_comprador_id
         and c.status in ('APPROVED','COMPLETE','COMPLETED')
         and c.metodo_pagamento = 'HOTMART_INSTALLMENTS'
         and cs.fn_hm_pagamento_do_produto(c.oferta_codigo, p_produto)
    )
    -- já está pagando as parcelas (mensalidade lançada no razão)
    or exists (
      select 1 from cs.hm_pagamentos p
       where p.comprador_id = p_comprador_id and p.categoria = 'mensalidade'
         and cs.fn_hm_pagamento_do_produto(p.oferta_codigo, p_produto)
    )
    -- o comercial registrou o pagamento como parcelado — ERA subquery escalar
    -- SEM produto/limit (o crash desta migration). Agora `exists`, escopado ao
    -- card do produto pedido, e sem risco de "more than one row".
    or exists (
      select 1 from cs.contatos_hm ch
       where ch.comprador_id = p_comprador_id
         and coalesce(ch.produto,'HM') = p_produto
         and (ch.pagamento_forma = 'parcelado'
              or (ch.valor_total > 0 and coalesce(ch.valor_pago, 0) >= ch.valor_total))
    );
$fn$;

comment on function cs.fn_hm_pode_finalizar(uuid, text) is
  '0221: ganha p_produto (default HM, mesma convenção de fn_hm_tem_lastro/fn_hm_valores_derivados). O último ramo era subquery ESCALAR sem produto/limit — ERROR 21000 (more than one row) para quem tem card no HM e no AURUM. Virou EXISTS escopado ao produto.';

grant execute on function cs.fn_hm_pode_finalizar(uuid, text) to disparos_app;

-- ---------------------------------------------------------------------------
-- [2] fn_hm_estornar_pagamento — nota de timeline no board certo.
-- Mesma assinatura (não precisa de p_produto: o produto sai da OFERTA do
-- pagamento que está sendo estornado, via fn_hm_pagamento_do_produto).
-- ---------------------------------------------------------------------------
create or replace function cs.fn_hm_estornar_pagamento(
  p_pagamento_id uuid,
  p_motivo       text,
  p_autor        text default 'sistema'
)
returns boolean
language plpgsql
security definer
set search_path = cs, public, pg_temp
as $fn$
declare
  v_p    cs.hm_pagamentos%rowtype;
  v_card uuid;
begin
  select * into v_p from cs.hm_pagamentos where id = p_pagamento_id;
  if not found then return false; end if;

  -- 0221: o card CERTO é o do produto da OFERTA paga — não "qualquer card do
  -- comprador". Sem isso, para as 15 pessoas com card no HM e no AURUM, a nota
  -- "Pagamento estornado" caía na timeline de um board que nem recebeu aquele
  -- dinheiro. `coalesce(ch.produto,'HM')` porque fn_hm_pagamento_do_produto já
  -- resolve internamente contra 'HM' quando o produto do card é nulo.
  select ch.id into v_card
    from cs.contatos_hm ch
   where ch.comprador_id = v_p.comprador_id
     and cs.fn_hm_pagamento_do_produto(v_p.oferta_codigo, ch.produto)
   order by ch.criado_em asc
   limit 1;
  -- Oferta que não casa produto de NENHUM card (dado legado) — cai no mais
  -- antigo, mesma rede de segurança do resto do módulo (0169): a nota tem que
  -- existir em ALGUM lugar, e "nenhuma nota" é pior do que "no board mais antigo".
  if v_card is null then
    select id into v_card from cs.contatos_hm where comprador_id = v_p.comprador_id order by criado_em asc limit 1;
  end if;

  delete from cs.hm_pagamentos where id = p_pagamento_id;   -- o gatilho recalcula o saldo

  if v_card is not null then
    insert into cs.interacoes (contato_hm_id, tipo, descricao, autor)
    values (v_card, 'sistema',
            'Pagamento estornado: R$ ' || trim(to_char(v_p.valor, '999G999G999D99'))
            || ' (' || v_p.categoria || ', ' || v_p.origem || ')'
            || case when v_p.transacao is not null then ' — transação ' || v_p.transacao else '' end
            || ' · motivo: ' || coalesce(p_motivo, 'não informado'),
            coalesce(p_autor, 'sistema'));
  end if;

  return true;
end$fn$;

comment on function cs.fn_hm_estornar_pagamento(uuid, text, text) is
  '0221: o card da nota de timeline sai do PRODUTO da oferta paga (fn_hm_pagamento_do_produto), nao mais de um select as-cegas por comprador_id. O DELETE (o dinheiro) sempre foi por id do pagamento e nao mudou.';

grant execute on function cs.fn_hm_estornar_pagamento(uuid, text, text) to disparos_app;

-- ---------------------------------------------------------------------------
-- [3] fn_hm_extrato — total duplicado/errado para quem tem 2 cards.
-- ---------------------------------------------------------------------------
drop function if exists cs.fn_hm_extrato(uuid);

create or replace function cs.fn_hm_extrato(p_comprador_id uuid, p_produto text default 'HM')
returns table (
  id uuid, categoria text, valor numeric, pago_em timestamptz, origem text,
  transacao text, oferta_codigo text, metodo_pagamento text, parcela smallint,
  obs text, autor text, acumulado numeric, saldo_depois numeric
)
language sql
stable
security definer
set search_path = cs, public, pg_temp
as $fn$
  with total as (
    -- 0221: sem produto+limit, quem tem 2 cards devolvia 2 LINHAS aqui — o
    -- `cross join` abaixo duplicava CADA lançamento do extrato (uma vez por
    -- total) e o saldo_depois usava um valor_total escolhido ao acaso.
    select coalesce(valor_total, 0) as valor_total
      from cs.contatos_hm
     where comprador_id = p_comprador_id
       and coalesce(produto,'HM') = p_produto
     order by criado_em asc
     limit 1
  ),
  ext as (
    select p.id, p.categoria, p.valor, p.pago_em, p.origem, p.transacao, p.oferta_codigo,
           p.metodo_pagamento, p.parcela, p.obs, p.autor,
           sum(p.valor) over (order by p.pago_em, p.criado_em
                              rows between unbounded preceding and current row) as acumulado
      from cs.hm_pagamentos p
     where p.comprador_id = p_comprador_id
       -- 0221: só os lançamentos DESTE board (a oferta resolve o produto).
       and cs.fn_hm_pagamento_do_produto(p.oferta_codigo, p_produto)
  )
  select ext.id, ext.categoria, ext.valor, ext.pago_em, ext.origem, ext.transacao,
         ext.oferta_codigo, ext.metodo_pagamento, ext.parcela, ext.obs, ext.autor,
         ext.acumulado,
         case when total.valor_total > 0
              then greatest(total.valor_total - ext.acumulado, 0)
              else null end as saldo_depois     -- sem total fechado, não se afirma saldo
    from ext cross join total
   order by ext.pago_em desc, ext.acumulado desc;
$fn$;

comment on function cs.fn_hm_extrato(uuid, text) is
  '0221: ganha p_produto (default HM). Sem produto/limit no CTE total, o extrato de quem tem card no HM e no AURUM duplicava cada lançamento (cross join com 2 linhas de total) e calculava o saldo contra o board errado. Zero chamadores na aplicação hoje (porta oficial do razão, 0076) — fixado antes do primeiro.';

grant execute on function cs.fn_hm_extrato(uuid, text) to disparos_app;

-- ---------------------------------------------------------------------------
-- [4] fn_hm_descancelar — desfazer cancelamento de UM board reabria o OUTRO.
-- Espelha fn_hm_cancelar (0197), mesma convenção de p_produto (default NULL =
-- sem filtro, cai no card mais antigo com preferência por HM — mesmo
-- desempate de fn_hm_card_da_oferta/moverEstagioHm).
-- ---------------------------------------------------------------------------
drop function if exists cs.fn_hm_descancelar(uuid);

create or replace function cs.fn_hm_descancelar(p_comprador_id uuid, p_produto text default null)
returns text
language plpgsql
security definer
set search_path to 'cs', 'public', 'pg_temp'
as $function$
declare
  v_aluno_id uuid;
  v_card_id  uuid;
begin
  select ch.id, ch.aluno_id into v_card_id, v_aluno_id
    from cs.contatos_hm ch
   where ch.comprador_id = p_comprador_id
     and (p_produto is null or coalesce(ch.produto,'HM') = p_produto)
   order by (coalesce(ch.produto,'HM') = 'HM') desc, ch.criado_em asc
   limit 1;
  if v_card_id is null then return 'sem_card'; end if;

  -- 0221: escrito SÓ no card resolvido (`id = v_card_id`) — a versão anterior
  -- fazia `where comprador_id = p_comprador_id`, sem `and id = ...`, e
  -- desfazer o cancelamento de UM board reabria o cancelamento do OUTRO junto.
  update cs.contatos_hm
     set cancelamento_efetivado_em = null,
         cancelamento_origem       = null,
         atualizado_em             = now()
   where id = v_card_id;

  if v_aluno_id is null then return 'sem_aluno'; end if;

  update public.thb_alunos a
     set cancelado_em     = null,
         cancelado_origem = null,
         situacao_financeira = case
           when coalesce(a.valor_total, 0) > 0 and coalesce(a.saldo_devedor, 0) = 0 then 'quitado'
           when coalesce(a.valor_pago, 0) > 0 then 'em_andamento'
           else 'so_sinal' end,
         status_pagamento = case
           when coalesce(a.valor_total, 0) > 0 and coalesce(a.saldo_devedor, 0) = 0 then 'Quitado'
           when coalesce(a.valor_pago, 0) > 0 then 'Em andamento'
           else 'Só sinal pago' end,
         atualizado_em = now()
   where a.id = v_aluno_id
      or (a.socio_de_aluno_id = v_aluno_id and a.fonte = 'sip_ativacao_hm');

  return 'descancelado';
end$function$;

comment on function cs.fn_hm_descancelar(uuid, text) is
  '0221: ganha p_produto (default NULL, mesma convenção de fn_hm_cancelar/0197) e o UPDATE de cs.contatos_hm passa a mirar `id = v_card_id` (o card resolvido), nao mais TODO comprador_id — antes, desfazer o cancelamento de um board reabria o cancelamento do outro board da mesma pessoa.';

grant execute on function cs.fn_hm_descancelar(uuid, text) to disparos_app;

-- ---------------------------------------------------------------------------
-- Rede de segurança da 0215: uma assinatura por nome, sempre.
-- ---------------------------------------------------------------------------
do $$
declare r record;
begin
  for r in
    select p.proname, count(*) as n
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'cs'
       and p.proname in ('fn_hm_pode_finalizar','fn_hm_estornar_pagamento','fn_hm_extrato','fn_hm_descancelar')
     group by p.proname having count(*) <> 1
  loop
    raise exception '0221: cs.% ficou com % assinaturas — sobrecarga ambigua (0215).', r.proname, r.n;
  end loop;
  raise notice '0221: fn_hm_pode_finalizar, fn_hm_estornar_pagamento, fn_hm_extrato e fn_hm_descancelar corrigidas, uma assinatura cada.';
end $$;

commit;
