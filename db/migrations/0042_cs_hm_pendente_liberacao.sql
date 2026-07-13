-- =====================================================================
-- 0042_cs_hm_pendente_liberacao
-- Redesenha a aba Ativação do HM. Nova esteira, nesta ordem:
--
--   Pendente de Liberação → Apto para Ativação → Acesso Liberado
--   → Entrevista Agendada → Entrevista Finalizada (final)
--
-- Mudanças:
--  1) NOVA etapa "Pendente de Liberação" (ordem 45): é onde o card cai ao sair
--     do Comercial (pagamento do saldo confirmado, via trigger da Hotmart ou
--     via o botão da ficha). Antes ele caía direto em "Apto para Ativação".
--     Agora "Apto" é uma decisão do operador, não um efeito do pagamento.
--  2) "Acesso Liberado" sai do fim da esteira e passa a vir ANTES da
--     entrevista (libera o acesso, depois entrevista). Deixa de ser is_final.
--  3) "Entrevista Realizada" → "Entrevista Finalizada", agora é a etapa final.
--  4) Os cards que hoje estão em "Apto para Ativação" (chegaram lá só por terem
--     pago, sem triagem) voltam para "Pendente de Liberação".
--
-- A flag cs.contatos_hm.apto_ativacao continua significando "pagou o saldo"
-- (é o que joga o card para a aba Ativação e permite desfazer para o
-- Comercial) — não é mais sinônimo da etapa "Apto para Ativação".
-- Aditiva e idempotente.
-- =====================================================================

-- 1) Nova etapa de entrada da Ativação --------------------------------------
insert into cs.estagios (chave, nome, ordem, cor, is_inicial, is_final, ativo, evento, aba) values
  ('hm_pendente_liberacao', 'Pendente de Liberação', 45, '#94a3b8', false, false, true, 'HM', 'ativacao')
on conflict (chave) do update set
  nome = excluded.nome, ordem = excluded.ordem, cor = excluded.cor,
  is_inicial = excluded.is_inicial, is_final = excluded.is_final, ativo = true,
  evento = excluded.evento, aba = excluded.aba;

-- 2) Reordena a esteira e move o "final" para a entrevista -------------------
update cs.estagios set ordem = 50, is_final = false where evento = 'HM' and chave = 'hm_apto_ativacao';
update cs.estagios set ordem = 60, is_final = false where evento = 'HM' and chave = 'hm_acesso_liberado';
update cs.estagios set ordem = 70, is_final = false where evento = 'HM' and chave = 'hm_entrevista_agendada';
update cs.estagios set ordem = 80, is_final = true, nome = 'Entrevista Finalizada'
 where evento = 'HM' and chave = 'hm_entrevista_realizada';

-- 3) Cards já na Ativação sem triagem voltam para o novo ponto de partida ----
update cs.contatos_hm ch
   set estagio_id = (select id from cs.estagios where evento = 'HM' and chave = 'hm_pendente_liberacao' limit 1),
       atualizado_em = now()
 where ch.estagio_id = (select id from cs.estagios where evento = 'HM' and chave = 'hm_apto_ativacao' limit 1);

-- 4) Trigger de venda: o saldo pago cai em "Pendente de Liberação" -----------
-- Idêntica à versão da 0039, trocando o destino da categoria 'diferenca'.
create or replace function cs.fn_seed_contato_hm()
returns trigger
language plpgsql
security definer
set search_path to 'cs', 'public'
as $function$
declare
  v_cat   text;
  v_notes text;
  v_ini   smallint;
  v_pend  smallint;
  v_id    uuid;
  v_cutoff timestamptz := '2026-06-25 00:00:00+00';
begin
  if new.status not in ('APPROVED','COMPLETE','COMPLETED') then
    return new;
  end if;

  -- Parcela de parcelamento (HOTMART_INSTALLMENTS): reenvio por parcela → ignora.
  if new.metodo_pagamento = 'HOTMART_INSTALLMENTS' and exists (
    select 1 from public.compras c2
     where c2.comprador_id = new.comprador_id
       and c2.oferta_codigo = new.oferta_codigo
       and c2.status in ('APPROVED','COMPLETE','COMPLETED')
       and c2.id <> new.id
       and coalesce(c2.data_aprovacao, c2.data_compra) < coalesce(new.data_aprovacao, new.data_compra)
  ) then
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
  select id into v_pend from cs.estagios where evento='HM' and chave='hm_pendente_liberacao' limit 1;

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

    -- Classificação de origem (público/evento/turma). Nunca derruba a compra.
    begin
      perform cs.fn_tag_hm_origem(new.comprador_id);
    exception when others then
      if v_id is not null then
        insert into cs.interacoes (contato_hm_id, tipo, descricao, autor)
        values (v_id, 'sistema', 'Falha ao classificar origem HM ('||sqlerrm||') — rodar cs.fn_sync_hm_atm()', 'sistema');
      end if;
    end;
    return new;
  end if;

  if v_cat = 'diferenca' then
    select id into v_id from cs.contatos_hm where comprador_id = new.comprador_id;
    if v_id is not null then
      update cs.contatos_hm
         set pagamento_em = coalesce(pagamento_em, coalesce(new.data_aprovacao, now())),
             estagio_id = v_pend,
             apto_ativacao = true,
             atualizado_em = now()
       where id = v_id and coalesce(estagio_id, -1) <> v_pend;
      if found then
        insert into cs.interacoes (contato_hm_id, tipo, descricao, autor)
        values (v_id, 'sistema', 'Pagamento do saldo confirmado (Hotmart) — pendente de liberação', 'sistema');
      end if;
    end if;
    return new;
  end if;

  return new;
end$function$;
