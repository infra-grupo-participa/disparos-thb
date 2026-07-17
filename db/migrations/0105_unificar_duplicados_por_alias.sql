-- =====================================================================
-- 0105_unificar_duplicados_por_alias
--
-- Unifica os cadastros duplicados que o detector (0103/0104) acendeu e que são
-- COMPROVADAMENTE a mesma pessoa. Mesmo mecanismo do Renato (0082): um alias
-- aponta o cadastro-gêmeo para o CANÔNICO (o que tem o card no HM), e o razão
-- passa a lançar o pagamento no card. Reversível (basta remover o alias e
-- estornar o lançamento). NÃO apaga nem funde linhas — só redireciona o dinheiro.
--
-- O caso âncora: CARIA da Veiga Jardim pagou o SALDO INTEIRO (R$ 14.700) no
-- cadastro caritaveiga@hotmail, que não tem card — o pagamento ficou órfão e ela
-- aparecia como "não pago". Este é o "pagou e sumiu" que o time reportou.
--
-- FICA DE FORA de propósito: Marli (marli@) x Mayara (mayara@oliveiranascimentoadv)
-- — nomes diferentes, mesmo escritório: são pessoas DISTINTAS dividindo o telefone.
-- Fundir seria roubar o pagamento de uma para a outra.
--
-- Idempotente (on conflict do nothing + relançamento com on conflict por transação).
-- =====================================================================

-- 1) Os aliases: (e-mail do gêmeo)  ->  (e-mail do canônico, que tem o card) ----
insert into cs.hm_comprador_alias (comprador_id, canonico_id, motivo)
select dup.id, can.id,
       'Mesma pessoa, dois cadastros: card em ' || can.email || ', pagamento em '
         || dup.email || ' (unificado na 0105 — detector de duplicados).'
  from (values
    ('caritaveiga@hotmail.com',      'caritaveiga3@gmail.com'),
    ('samsouza.am@gmail.com',        'sergiosouza.advogado@gmail.com'),
    ('iaracbcastro.asv@gmail.com',   'iaracbcastro.adv@gmail.com'),
    ('jessica@oliveirabronze.com.br','bronze.jessica@hotmail.com'),
    ('wik2708@gmail.com',            'wilson.koressawasan@gmail.com'),
    ('a.alemontanari@gmail.com',     'aprado@apradopericias.com.br')
  ) as par(email_dup, email_can)
  join public.compradores dup on lower(btrim(dup.email)) = par.email_dup
  join public.compradores can on lower(btrim(can.email)) = par.email_can
  -- trava de segurança: só alia se o canônico realmente tem card no HM
  where exists (select 1 from cs.contatos_hm ch where ch.comprador_id = can.id)
on conflict (comprador_id) do nothing;

-- 2) Relança no razão as compras aprovadas que estavam no gêmeo — agora caem no
--    card do canônico. fn_hm_lancar_compra só lança offer do catálogo HM e é
--    idempotente por transação (não duplica o que já tinha lastro).
do $relanca$
declare r record;
begin
  for r in
    select c.id
      from public.compras c
      join cs.hm_comprador_alias a on a.comprador_id = c.comprador_id
     where c.status in ('APPROVED','COMPLETE','COMPLETED')
  loop
    perform cs.fn_hm_lancar_compra(r.id);
  end loop;
end$relanca$;
