-- =====================================================================
-- 0159_aurum_tag_e_plano
--
-- Dois acertos no card do Aurum, vistos com as duas primeiras vendas reais
-- do pitch (05/08/2026):
--
-- 1) TAG DO PRODUTO. Pedido do Marcio: "a tag do cara tem que estar como
--    AURUM, que ele comprou o AURUM vindo do THB de SP". Os cards nasciam com
--    'Aluno THB', 'ETHB SP' e 'Origem T30' — a origem estava lá, mas nada dizia
--    O QUE a pessoa comprou. Quem olha o card fora do board não sabia.
--    A tag é 'AURUM' em caixa alta de propósito: já existe 'Aluno Aurum' (que
--    significa outra coisa — a pessoa JÁ era do espaço Aurum) e 'Aurum A7'/'A8'
--    (turma). 'AURUM' é o produto comprado, e não colide com nenhuma das duas.
--
-- 2) PLANO LEGÍVEL. cs.fn_seed_contato_hm copia hm_product_catalog.notes para
--    cs.contatos_hm.plano, que a tela mostra como rótulo curto ("HM 15k",
--    "Sinal R$300"). A nota que a 0158 gravou era um parágrafo inteiro e
--    vazou para a tela. Encurtada aqui; a explicação longa fica no comentário
--    da 0158, que é onde se procura contexto.
--
-- Idempotente. Depende da 0157 e da 0158.
-- =====================================================================

-- ------------------------------------------------------- 1) plano legível
update public.hm_product_catalog
   set notes = 'Taxa de inscricao Aurum - ETHB SP'
 where offer_code = 'qm4lu7py';

-- os dois cards que já nasceram com o parágrafo
update cs.contatos_hm
   set plano = 'Taxa de inscricao Aurum - ETHB SP', atualizado_em = now()
 where produto = 'AURUM'
   and plano like 'Taxa de inscricao do Aurum (~R$40k)%';

-- --------------------------------------------- 2) a tag do produto no carimbo
-- Mesma função da 0158, agora também etiquetando o produto. O UPDATE da tag é
-- separado do UPDATE do produto de propósito: um card que já esteja no board
-- certo mas sem a tag (os dois primeiros do pitch) também é corrigido, e
-- array_agg(distinct) garante idempotência se rodar duas vezes.
create or replace function cs.fn_hm_produto_por_oferta()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'cs', 'public', 'pg_temp'
as $function$
declare
  v_produto   text;
  v_comprador uuid;
  v_id        uuid;
  v_outras    int;
begin
  if new.status not in ('APPROVED','COMPLETE','COMPLETED') then
    return new;
  end if;

  select r.produto into v_produto
    from cs.hm_origem_por_oferta r
   where r.oferta_codigo = new.oferta_codigo
     and r.produto is not null;
  if v_produto is null then
    return new;
  end if;

  v_comprador := coalesce(
    (select canonico_id from cs.hm_comprador_alias where comprador_id = new.comprador_id),
    new.comprador_id);

  select id into v_id from cs.contatos_hm where comprador_id = v_comprador;
  if v_id is null then
    return new;
  end if;

  select count(*) into v_outras
    from public.compras c
    join public.hm_product_catalog cat on cat.offer_code = c.oferta_codigo
    left join cs.hm_origem_por_oferta r on r.oferta_codigo = c.oferta_codigo
   where c.comprador_id = new.comprador_id
     and c.status in ('APPROVED','COMPLETE','COMPLETED')
     and coalesce(r.produto, 'HM') <> v_produto;

  if v_outras > 0 then
    insert into cs.interacoes (contato_hm_id, tipo, descricao, autor)
    values (v_id, 'sistema',
            'Compra de ' || v_produto || ' recebida, mas o card ficou no board atual: a pessoa ja tem compra de outro produto. Mover exige a chave UNIQUE(comprador_id, produto).',
            'sistema');
    return new;
  end if;

  update cs.contatos_hm
     set produto = v_produto, atualizado_em = now()
   where id = v_id and produto is distinct from v_produto;

  if found then
    insert into cs.interacoes (contato_hm_id, tipo, descricao, autor)
    values (v_id, 'sistema', 'Card carimbado no board ' || v_produto || ' (oferta ' || new.oferta_codigo || ')', 'sistema');
  end if;

  -- A tag do PRODUTO COMPRADO, separada do board. Só para produtos que não são
  -- o HM: no board do HM a tag 'HM' seria ruído em cima de 200 cards.
  if v_produto <> 'HM' then
    update cs.contatos_hm
       set tags = (select coalesce(array_agg(distinct t), '{}')
                     from unnest(coalesce(tags,'{}') || array[v_produto]) t),
           atualizado_em = now()
     where id = v_id and not (coalesce(tags,'{}') @> array[v_produto]);
  end if;

  return new;
end$function$;

-- ------------------------------------- backfill dos cards que já existem hoje
update cs.contatos_hm
   set tags = (select coalesce(array_agg(distinct t), '{}')
                 from unnest(coalesce(tags,'{}') || array[produto]) t),
       atualizado_em = now()
 where produto <> 'HM'
   and not (coalesce(tags,'{}') @> array[produto]);
