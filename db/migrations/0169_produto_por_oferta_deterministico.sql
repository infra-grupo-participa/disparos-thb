-- 0169_produto_por_oferta_deterministico.sql
-- Irmã da 0168: o outro consumidor de `cs.hm_origem_por_oferta` que a 0167
-- deixou para trás. Aqui não houve erro visível, o que é pior — `select ... into`
-- com duas linhas NÃO levanta exceção em plpgsql: pega uma qualquer, sem ordem
-- definida, e segue.
--
-- Hoje as duas janelas da `rlgjsrul` têm o mesmo produto ('HM'), então o
-- resultado bate por coincidência. Mas este trigger roda no caminho de TODA
-- venda aprovada — inclusive as da live desta noite — e é ele quem decide em que
-- board o card nasce. Decisão de board por sorteio é o tipo de bug que só
-- aparece semanas depois, num card que ninguém entende por que está no lugar
-- errado.
--
-- Duas mudanças:
--   1) `order by r.vale_de desc nulls last limit 1` — mesma regra de desempate
--      da 0167/0168: a janela mais recente manda.
--   2) `count(distinct c.id)` — o LEFT JOIN com a tabela de origens agora pode
--      multiplicar a mesma compra por janela. O booleano final não mudaria, mas
--      um contador que conta a mesma linha duas vezes é armadilha para o
--      próximo que ler.
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
     and r.produto is not null
   order by r.vale_de desc nulls last
   limit 1;
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

  -- A ETIQUETA VEM PRIMEIRO e é incondicional: comprou, leva a tag, esteja o
  -- card no board que estiver.
  if v_produto <> 'HM' then
    update cs.contatos_hm
       set tags = (select coalesce(array_agg(distinct t), '{}')
                     from unnest(coalesce(tags,'{}') || array[v_produto]) t),
           atualizado_em = now()
     where id = v_id and not (coalesce(tags,'{}') @> array[v_produto]);
  end if;

  -- O BOARD respeita a trava: só carimba se a pessoa não tiver compra
  -- catalogada de outro produto.
  select count(distinct c.id) into v_outras
    from public.compras c
    join public.hm_product_catalog cat on cat.offer_code = c.oferta_codigo
    left join cs.hm_origem_por_oferta r on r.oferta_codigo = c.oferta_codigo
   where c.comprador_id = new.comprador_id
     and c.status in ('APPROVED','COMPLETE','COMPLETED')
     and coalesce(r.produto, 'HM') <> v_produto;

  if v_outras > 0 then
    insert into cs.interacoes (contato_hm_id, tipo, descricao, autor)
    values (v_id, 'sistema',
            'Comprou ' || v_produto || ' (tag aplicada), mas o card ficou no board atual: a pessoa ja tem compra de outro produto e mover a tiraria da esteira em andamento. Aparecer nos dois exige a chave UNIQUE(comprador_id, produto).',
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

  return new;
end$function$;
