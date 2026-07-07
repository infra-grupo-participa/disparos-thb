-- =====================================================================
-- 0031_cs_hm_apto_ativacao
-- Adiciona a coluna "Apto para Ativação" como ponto de partida da aba Ativação
-- (ordem 45, antes de "Entrevista Agendada"). Quem paga o saldo cai NELA, e não
-- mais direto em "Entrevista Agendada" — o operador agenda a entrevista a partir
-- daí. Reescreve o trigger e migra os aptos atuais.
-- =====================================================================

insert into cs.estagios (chave, nome, ordem, cor, is_inicial, is_final, ativo, evento, aba) values
  ('hm_apto_ativacao', 'Apto para Ativação', 45, '#14b8a6', false, false, true, 'HM', 'ativacao')
on conflict (chave) do update set
  nome = excluded.nome, ordem = excluded.ordem, cor = excluded.cor,
  is_inicial = excluded.is_inicial, is_final = excluded.is_final, ativo = true,
  evento = excluded.evento, aba = excluded.aba;

-- Trigger: a DIFERENÇA (saldo pago) passa a cair em "Apto para Ativação".
create or replace function cs.fn_seed_contato_hm()
returns trigger language plpgsql security definer set search_path = cs, public
as $fn$
declare
  v_cat   text;
  v_notes text;
  v_ini   smallint;
  v_apto  smallint;
  v_id    uuid;
  v_cutoff timestamptz := '2026-06-25 00:00:00+00';
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
  select id into v_apto from cs.estagios where evento='HM' and chave='hm_apto_ativacao' limit 1;

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

  if v_cat = 'diferenca' then
    select id into v_id from cs.contatos_hm where comprador_id = new.comprador_id;
    if v_id is not null then
      update cs.contatos_hm
         set pagamento_em = coalesce(pagamento_em, coalesce(new.data_aprovacao, now())),
             estagio_id = v_apto,
             apto_ativacao = true,
             atualizado_em = now()
       where id = v_id and coalesce(estagio_id, -1) <> v_apto;
      if found then
        insert into cs.interacoes (contato_hm_id, tipo, descricao, autor)
        values (v_id, 'sistema', 'Pagamento do saldo confirmado (Hotmart) — apto para ativação', 'sistema');
      end if;
    end if;
    return new;
  end if;

  return new;
end$fn$;

-- Migra os aptos atuais que estão em "Entrevista Agendada" sem entrevista de fato
-- marcada para o novo ponto de partida "Apto para Ativação".
update cs.contatos_hm ch
   set estagio_id = (select id from cs.estagios where evento='HM' and chave='hm_apto_ativacao' limit 1),
       atualizado_em = now()
 where ch.apto_ativacao = true
   and ch.entrevista_em is null
   and ch.estagio_id = (select id from cs.estagios where evento='HM' and chave='hm_entrevista_agendada' limit 1);
