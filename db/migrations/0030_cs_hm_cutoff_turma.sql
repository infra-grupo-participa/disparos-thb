-- =====================================================================
-- 0030_cs_hm_cutoff_turma
-- Escopa o kanban HM à campanha atual (T39). O backfill do 0028 trouxe TODO o
-- histórico de sinal/compra_cheia (incl. turmas anteriores). A campanha atual
-- começou em 25/06/2026 (oferta "Sinal R$300" / z391kxd9). Aqui:
--   (a) remove os cards cuja compra de entrada é anterior ao corte;
--   (b) passa a semear apenas compras a partir do corte (trigger).
-- A timeline dos cards removidos cai por cascade (interacoes.contato_hm_id).
-- =====================================================================

-- Corte da campanha T39. Se mudar de turma, ajuste esta data (ou externalize).
-- (Mantido inline por clareza; é a única fonte da regra de corte.)

-- (a) Remove cards de turmas anteriores (sem compra de entrada a partir do corte)
delete from cs.contatos_hm ch
where not exists (
  select 1
    from public.compras c
    join public.hm_product_catalog cat on cat.offer_code = c.oferta_codigo
   where c.comprador_id = ch.comprador_id
     and c.status in ('APPROVED','COMPLETE','COMPLETED')
     and cat.categoria in ('sinal','compra_cheia')
     and coalesce(c.data_aprovacao, c.data_compra) >= '2026-06-25 00:00:00+00'
);

-- (b) Trigger de seed com o corte na ENTRADA (sinal/compra_cheia). A diferença
-- (saldo) continua agindo só sobre cards existentes, sem corte.
create or replace function cs.fn_seed_contato_hm()
returns trigger language plpgsql security definer set search_path = cs, public
as $fn$
declare
  v_cat   text;
  v_notes text;
  v_ini   smallint;
  v_entr  smallint;
  v_id    uuid;
  v_cutoff timestamptz := '2026-06-25 00:00:00+00';  -- início da campanha T39
begin
  if new.status not in ('APPROVED','COMPLETE','COMPLETED') then
    return new;
  end if;

  select cat.categoria, cat.notes into v_cat, v_notes
    from public.hm_product_catalog cat
   where cat.offer_code = new.oferta_codigo
   limit 1;

  if v_cat is null then
    return new;
  end if;

  select id into v_ini  from cs.estagios where evento='HM' and chave='hm_comprou' limit 1;
  select id into v_entr from cs.estagios where evento='HM' and chave='hm_entrevista_agendada' limit 1;

  -- ENTRADA: sinal + compra cheia, apenas a partir do corte da campanha atual.
  if v_cat in ('sinal','compra_cheia')
     and coalesce(new.data_aprovacao, new.data_compra, now()) >= v_cutoff then
    insert into cs.contatos_hm (comprador_id, estagio_id, turma, plano, categoria_entrada)
    values (new.comprador_id, v_ini, 'T39', v_notes, v_cat)
    on conflict (comprador_id) do update
      set plano = coalesce(cs.contatos_hm.plano, excluded.plano),
          categoria_entrada = coalesce(cs.contatos_hm.categoria_entrada, excluded.categoria_entrada),
          atualizado_em = now();

    select id into v_id from cs.contatos_hm where comprador_id = new.comprador_id;
    if v_id is not null and not exists (
      select 1 from cs.interacoes i
      where i.contato_hm_id = v_id and i.tipo='sistema' and i.descricao like 'Entrou na esteira%'
    ) then
      insert into cs.interacoes (contato_hm_id, tipo, descricao, autor)
      values (v_id, 'sistema', 'Entrou na esteira HM ('||v_cat||' — '||coalesce(v_notes,'oferta')||')', 'sistema');
    end if;
    return new;
  end if;

  -- DIFERENÇA (saldo 14.700): registra pagamento e move pra Ativação. Só age se
  -- o comprador já é um card HM da campanha atual.
  if v_cat = 'diferenca' then
    select id into v_id from cs.contatos_hm where comprador_id = new.comprador_id;
    if v_id is not null then
      update cs.contatos_hm
         set pagamento_em = coalesce(pagamento_em, coalesce(new.data_aprovacao, now())),
             estagio_id = v_entr,
             apto_ativacao = true,
             atualizado_em = now()
       where id = v_id and coalesce(estagio_id, -1) <> v_entr;
      if found then
        insert into cs.interacoes (contato_hm_id, tipo, descricao, autor)
        values (v_id, 'sistema', 'Pagamento do saldo confirmado (Hotmart) — apto para ativação', 'sistema');
      end if;
    end if;
    return new;
  end if;

  return new;
end$fn$;
