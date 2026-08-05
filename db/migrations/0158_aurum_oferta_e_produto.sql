-- =====================================================================
-- 0158_aurum_oferta_e_produto
--
-- A venda do Aurum passa a virar CARD no board do Aurum (pedido do Marcio,
-- 05/08/2026, durante o pitch no Encontro do Time Holding Brasil - SP).
--
-- A oferta qm4lu7py é uma TAXA DE INSCRIÇÃO (~R$40k) — o comprador se
-- compromete e começa a pagar o Aurum depois. Não é o valor cheio. No modelo do
-- HM isso é `categoria = 'sinal'`: o card entra em "Comprou" e segue a esteira,
-- em vez de pular para "Pendente de Liberação" como faria uma compra_cheia.
--
-- POR QUE UM GATILHO NOVO EM VEZ DE MEXER NA fn_seed_contato_hm:
-- aquela função tem ~190 linhas e é quem cria TODOS os cards do HM. Alterá-la
-- ao vivo, durante o evento, para acrescentar o carimbo do produto seria
-- arriscar a esteira inteira do HM por um campo. Este gatilho roda DEPOIS dela
-- (nome com 'zzz' — gatilhos disparam em ordem alfabética, e os existentes são
-- trg_seed_contato_hm, trg_z_..., trg_zz_...) e só faz um UPDATE de uma coluna.
-- Pior caso se ele falhar: o card nasce como 'HM' e é corrigido depois. O HM
-- continua intacto.
--
-- A TRAVA QUE IMPORTA: o card só é carimbado como AURUM se a pessoa NÃO tiver
-- nenhuma outra compra catalogada fora das ofertas do Aurum. Como
-- cs.contatos_hm ainda tem UNIQUE(comprador_id) — um card por pessoa —, sem
-- essa trava um aluno que já é card do HM e comprasse o Aurum teria o card
-- MOVIDO para o board do Aurum, sumindo do HM. O Marcio foi explícito: não
-- remover das outras esteiras. Então, hoje: comprador novo nasce no Aurum;
-- quem já é card do HM continua no HM até a mudança de chave para
-- UNIQUE(comprador_id, produto), que é quando "aparecer nos dois" fica
-- possível de verdade.
--
-- Depende da 0157 (cs.hm_origem_por_oferta).
-- Idempotente.
-- =====================================================================

-- ------------------------------------------------- oferta -> produto do board
alter table cs.hm_origem_por_oferta
  add column if not exists produto text
  check (produto is null or produto in ('HM','AURUM','ETHB'));

comment on column cs.hm_origem_por_oferta.produto is
  'Board em que o card desta oferta deve nascer (cs.contatos_hm.produto). NULL = não carimba, fica no default HM.';

update cs.hm_origem_por_oferta set produto = 'AURUM' where oferta_codigo = 'qm4lu7py';

-- ------------------------------------------------------ a oferta no catálogo
-- Sem esta linha cs.fn_seed_contato_hm devolve sem fazer nada (ela procura a
-- oferta em hm_product_catalog e sai se não achar) — ou seja, card nenhum.
--
-- concede_trilha = FALSE de propósito: a trilha é do programa do HM, e liberar
-- trilha de HM para comprador de Aurum seria conceder acesso errado. Se o Aurum
-- tiver trilha própria um dia, isso vira decisão à parte.
insert into public.hm_product_catalog (offer_code, product_name, categoria, notes, concede_trilha)
values ('qm4lu7py', 'Aurum', 'sinal',
        'Taxa de inscricao do Aurum (~R$40k) - pitch no ETHB Sao Paulo, 05/08/2026. Nao e o valor cheio: o comprador comeca a pagar o Aurum depois.',
        false)
on conflict (offer_code) do nothing;

-- ------------------------------------------------------- o carimbo do produto
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

  -- Mesmo apelido canônico que a fn_seed_contato_hm usa, senão o card do
  -- comprador duplicado não é encontrado.
  v_comprador := coalesce(
    (select canonico_id from cs.hm_comprador_alias where comprador_id = new.comprador_id),
    new.comprador_id);

  select id into v_id from cs.contatos_hm where comprador_id = v_comprador;
  if v_id is null then
    return new;   -- a seed não criou card (oferta fora do catálogo, cutoff etc.)
  end if;

  -- A TRAVA: só carimba se TODAS as compras catalogadas desta pessoa forem de
  -- ofertas deste mesmo produto. Se ela tem qualquer compra de outro board
  -- (HM, tipicamente), o card fica onde está — mover seria tirá-la da esteira
  -- em que o time já trabalha.
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

  return new;
end$function$;

-- 'zzz' para disparar DEPOIS de trg_seed_contato_hm (que cria o card) e dos
-- trg_z_/trg_zz_ existentes — gatilhos do mesmo evento disparam em ordem
-- alfabética de nome.
drop trigger if exists trg_zzz_hm_produto_por_oferta on public.compras;
create trigger trg_zzz_hm_produto_por_oferta
  after insert or update of status on public.compras
  for each row execute function cs.fn_hm_produto_por_oferta();
