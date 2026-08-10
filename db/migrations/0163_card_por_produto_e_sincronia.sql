-- 0163_card_por_produto_e_sincronia.sql
-- 1 card por pessoa POR PRODUTO (decisão do Marcio, 10/08): "posso ter eles espalhados
-- mesmo que você acabe duplicando card. Eu preciso que, mesmo que dê duplica, ele faça
-- uma sincronia entre si, a gente poder ter mapeado sempre o que cada card passou
-- durante cada processo da ativação."
--
-- ---------------------------------------------------------------------------
-- O DIAGNÓSTICO
--
-- 34 pessoas compraram a taxa do Aurum (`qm4lu7py`, R$1.000, 05–07/08) e só **19**
-- têm card no board do Aurum. As outras **15** já tinham card do HM criado em
-- 07–08/07 (funil do sinal de R$300) — e `cs.contatos_hm.comprador_id` é UNIQUE, então
-- o `on conflict (comprador_id) do update` do trigger **reaproveitou o card do HM** em
-- vez de criar o do Aurum. A venda do Aurum entrou, mas no board errado.
--
-- Efeito colateral que isso já causou: **R$15.000 da taxa do Aurum estão lançados no
-- razão de cards do HM** (15 lançamentos de `qm4lu7py`). Ex.: Ana Paula com
-- valor_pago 2.664,54 = 1.664,54 (HM) + 1.000 (taxa Aurum). O financeiro do HM está
-- inflado para essas 15 pessoas — a separação conserta isso na origem.
--
-- ---------------------------------------------------------------------------
-- ⚠️ O QUE ISSO QUEBRA (e como cada ponto é tratado)
--
-- 13 funções buscam o card SÓ por comprador_id — com 2 cards elas viram ambíguas
-- (`select … into` pega um ao acaso). As 3 críticas mexem em dinheiro/matrícula:
-- fn_hm_lancar_compra, fn_hm_provisionar_aluno, fn_hm_recalcular_financeiro.
--
-- Estratégia para não reescrever as 13 de uma vez (risco alto, 6 pessoas com matrícula
-- ativa): **desempate determinístico por produto da OFERTA**. `fn_hm_dono_do_pagamento`
-- e as buscas passam a preferir o card cujo `produto` casa com o produto da oferta que
-- originou a chamada; sem oferta no contexto, cai no card mais ANTIGO (comportamento
-- histórico — o card do HM, que é quem tinha o dinheiro até aqui).
-- ---------------------------------------------------------------------------

-- 1) A constraint: 1 card por pessoa POR PRODUTO -------------------------------
alter table cs.contatos_hm drop constraint if exists contatos_hm_comprador_id_key;
alter table cs.contatos_hm
  add constraint contatos_hm_comprador_produto_key unique (comprador_id, produto);

comment on constraint contatos_hm_comprador_produto_key on cs.contatos_hm is
  'A mesma pessoa pode ter card em HM e AURUM ao mesmo tempo (0163). Antes era UNIQUE(comprador_id), o que fazia a venda do Aurum reaproveitar o card do HM.';

-- 2) SINCRONIA entre os cards da mesma pessoa ----------------------------------
-- O Marcio pediu que os cards "façam sincronia entre si": a timeline de um card
-- registra quando o OUTRO card da mesma pessoa muda de etapa. Assim o operador do
-- Aurum vê que ela avançou no HM (e vice-versa) sem sair do board dele.
--
-- Só ESPELHA (nota na timeline) — NÃO move o card nem copia estágio: as esteiras são
-- diferentes e forçar o mesmo estágio nos dois quebraria as duas.
create or replace function cs.fn_hm_sincroniza_cards_irmaos()
returns trigger language plpgsql
set search_path to 'cs','public','pg_temp'
as $function$
declare
  r record;
  v_nome_estagio text;
begin
  if new.estagio_id is distinct from old.estagio_id then
    select nome into v_nome_estagio from cs.estagios where id = new.estagio_id;

    for r in
      select ch.id, ch.produto from cs.contatos_hm ch
       where ch.comprador_id = new.comprador_id
         and ch.id <> new.id
    loop
      insert into cs.interacoes (contato_hm_id, tipo, descricao, autor)
      values (r.id, 'sistema',
              '[' || coalesce(new.produto,'HM') || '] a mesma pessoa avançou para "' ||
              coalesce(v_nome_estagio,'(etapa)') || '" no outro board',
              'sistema');
    end loop;
  end if;
  return new;
end$function$;

drop trigger if exists trg_hm_sincroniza_cards_irmaos on cs.contatos_hm;
create trigger trg_hm_sincroniza_cards_irmaos
  after update of estagio_id on cs.contatos_hm
  for each row execute function cs.fn_hm_sincroniza_cards_irmaos();

-- 3) Desempate por produto no dono do pagamento --------------------------------
-- `fn_hm_dono_do_pagamento(comprador)` resolvia alias e devolvia UM comprador. Agora
-- o razão precisa saber em qual CARD lançar. Nova função irmã, usada por
-- fn_hm_lancar_compra: dado o comprador e a OFERTA, devolve o card certo.
create or replace function cs.fn_hm_card_da_oferta(p_comprador uuid, p_oferta text)
returns uuid language sql stable
set search_path to 'cs','public','pg_temp'
as $function$
  select ch.id
    from cs.contatos_hm ch
    left join cs.hm_origem_por_oferta o on o.oferta_codigo = p_oferta
   where ch.comprador_id = p_comprador
   order by
     -- 1º: card cujo produto casa com o produto declarado da oferta
     (ch.produto is not distinct from o.produto) desc nulls last,
     -- 2º: o mais antigo (comportamento histórico)
     ch.criado_em asc
   limit 1;
$function$;

comment on function cs.fn_hm_card_da_oferta(uuid, text) is
  'Card em que um pagamento deve ser lançado quando a pessoa tem card em mais de um board (0163). Prefere o card do produto da oferta; empata pelo mais antigo.';
