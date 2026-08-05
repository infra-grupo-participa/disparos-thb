-- =====================================================================
-- 0160_aurum_tag_independe_do_board
--
-- A tag do produto passa a valer MESMO quando o card não muda de board.
--
-- O que apareceu com as vendas reais do pitch (05/08/2026): das 5 primeiras
-- compras do Aurum, 2 foram de gente que JÁ tinha card no HM em etapa avançada
-- (Manuel em "Reunião finalizada", Eduardo em "Aguardando retorno"). A trava da
-- 0158 fez o certo e não moveu os cards — o Marcio foi explícito em não tirar
-- ninguém das outras esteiras. Só que na 0159 a tag 'AURUM' vinha DEPOIS da
-- trava: quem não era carimbado também não era etiquetado. Resultado: dois
-- clientes pagantes do Aurum indistinguíveis no board do HM.
--
-- São duas perguntas diferentes e a 0159 tratava como uma só:
--   • em QUE BOARD o card mora  -> depende da trava (chave UNIQUE(comprador_id))
--   • o que a pessoa COMPROU    -> é fato da compra, não depende de nada
--
-- Aqui a etiqueta passa a ser incondicional. O board continua exatamente com a
-- mesma regra de antes. Enquanto a chave não virar UNIQUE(comprador_id,
-- produto), a tag é o único jeito de o time achar essas pessoas — e ela está
-- dourada na tela (app/_components/tags.tsx).
--
-- Idempotente. Depende da 0157, 0158 e 0159.
-- =====================================================================

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

  -- A ETIQUETA VEM PRIMEIRO e é incondicional: comprou, leva a tag, esteja o
  -- card no board que estiver. É o que permite achar no board do HM quem
  -- comprou Aurum enquanto a chave não muda.
  if v_produto <> 'HM' then
    update cs.contatos_hm
       set tags = (select coalesce(array_agg(distinct t), '{}')
                     from unnest(coalesce(tags,'{}') || array[v_produto]) t),
           atualizado_em = now()
     where id = v_id and not (coalesce(tags,'{}') @> array[v_produto]);
  end if;

  -- O BOARD, esse sim, respeita a trava: só carimba se a pessoa não tiver
  -- compra catalogada de outro produto. Mover seria tirá-la da esteira em que
  -- o time já está trabalhando o caso.
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

-- ---------------------------------- backfill: quem comprou e ficou sem a tag
with compradores_por_produto as (
  select distinct
         coalesce((select a.canonico_id from cs.hm_comprador_alias a where a.comprador_id = c.comprador_id),
                  c.comprador_id) as comprador_id,
         r.produto
    from public.compras c
    join cs.hm_origem_por_oferta r on r.oferta_codigo = c.oferta_codigo
   where c.status in ('APPROVED','COMPLETE','COMPLETED')
     and r.produto is not null
     and r.produto <> 'HM'
)
update cs.contatos_hm ch
   set tags = (select coalesce(array_agg(distinct t), '{}')
                 from unnest(coalesce(ch.tags,'{}') || array[cp.produto]) t),
       atualizado_em = now()
  from compradores_por_produto cp
 where ch.comprador_id = cp.comprador_id
   and not (coalesce(ch.tags,'{}') @> array[cp.produto]);
