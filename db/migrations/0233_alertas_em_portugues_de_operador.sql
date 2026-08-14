-- 0233 — Os alertas passam a falar português de operador
--
-- Pedido do Marcio (13/08): "esses avisos da saúde do dinheiro precisam que
-- VOCÊ entenda. Eles precisam bater o olho e já entender, não bater o olho e
-- ficar tentando entender. É muito ruim isso para a operação."
--
-- Abri a tela e olhei (`tests/e2e/__shots__/admin-alertas-desktop.png`). O
-- problema não é só de layout — metade dele está no TEXTO que sai daqui:
--
--   sem_canal (74 abertos)
--     "Card x@y.com sem canal de aquisição (rodar cs.fn_sync_hm_atm ou
--      conferir oferta de entrada)."
--     → manda o operador RODAR UMA FUNÇÃO SQL. Ele não tem como.
--
--   oferta_orfa
--     "...mas NAO esta em public.hm_product_catalog — o trigger ignora e o card
--      nao anda. Catalogar com a categoria certa (sinal, diferenca ou
--      compra_cheia)."
--     → nome de tabela, a palavra "trigger" e os nomes internos das categorias.
--
--   card_faltando
--     "Comprador x@y.com pagou (compra_cheia) e não tem card na esteira."
--     → "compra_cheia" é o valor da coluna, não português.
--
--   compra_fora_do_razao (27) e webhook_sem_log — ESCRITOS POR MIM HOJE, e os
--     piores: sem acento nenhum ("nao entra no razao de propositto" — com typo)
--     e citando `cs.hotmart_eventos` e `supabase/functions/hotmart-events-webhook`.
--     Escrevi como quem lê log, não como quem opera.
--
-- A REGRA que fica: `detalhe` é o que o OPERADOR lê — só português, e sempre
-- respondendo "o que aconteceu" e "o que fazer". O identificador técnico já tem
-- lugar próprio: a coluna `chave`, que a tela mostra como chip separado.
--
-- Reescrita por REPLACE MECÂNICO do fonte das funções (o padrão da 0216): trocar
-- frase por frase é impossível alterar a lógica sem querer. As duas funções que
-- eu mesmo escrevi hoje foram refeitas por inteiro.
--
-- Os alertas JÁ ABERTOS também são reescritos — senão a melhora só valeria para o
-- próximo alerta e a tela de hoje continuaria ilegível.
--
-- Trava no fim: nenhum alerta aberto pode conter nome de tabela, de função, de
-- caminho de arquivo ou a palavra "trigger".

begin;

-- [1] As frases, reescritas na origem.
do $$
declare v_def text; v_novo text; i int;
  subs text[][] := array[
    array[
     ' sem canal de aquisição (rodar cs.fn_sync_hm_atm ou conferir oferta de entrada).',
     ' entrou sem canal de aquisição: o sistema não sabe de qual live ou campanha essa venda veio, e por isso ela não conta no placar de nenhum canal. Conferir por qual oferta a pessoa comprou.'],
    array[
     ''' pagou (''||string_agg(distinct cat.categoria,''/'')||'') e não tem card na esteira.''',
     ''' pagou e não apareceu na Jornada. O dinheiro entrou, mas não existe card para ninguém trabalhar — ninguém cobra e ninguém ativa essa pessoa.'''],
    array[
     'mas NAO esta em public.hm_product_catalog — o trigger ignora e o card nao anda. Catalogar com a categoria certa (sinal, diferenca ou compra_cheia).',
     'mas essa oferta não está cadastrada no sistema. Enquanto isso, o card não nasce e o pagamento não entra no saldo. Cadastrar a oferta resolve e o pagamento entra sozinho.'],
    array[' com 2+ cadastros na Hotmart (', ' aparece com mais de um cadastro na Hotmart ('],
    array[') — conferir alias.', '). Isso divide o histórico da mesma pessoa em dois; conferir qual é o cadastro bom.'],
    -- prefixos que sobraram do vocabulário interno
    array['''Card ''||cp.email||'' entrou sem canal', '''''||cp.email||'' entrou sem canal'],
    array['''Comprador ''||cp.email||'' pagou e não apareceu', '''''||cp.email||'' pagou e não apareceu'],
    array['está em "Reembolsado" mas a compra segue aprovada no banco — reembolso/chargeback pode não ter dado baixa (razão conta como recebido). Conferir na Hotmart.',
          'está marcado como Reembolsado aqui, mas na Hotmart a compra continua aprovada. Enquanto isso o sistema conta esse dinheiro como recebido. Conferir na Hotmart se o reembolso saiu mesmo.']
  ];
begin
  for v_def in
    select pg_get_functiondef(p.oid) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'cs' and p.proname in ('fn_hm_health_check','fn_hm_alerta_oferta_orfa')
  loop
    v_novo := v_def;
    for i in 1..array_length(subs,1) loop
      v_novo := replace(v_novo, subs[i][1], subs[i][2]);
    end loop;
    execute v_novo;
  end loop;
end $$;

-- [2] Os dois que eu escrevi hoje, refeitos.
create or replace function cs.fn_hm_alerta_compra_fora_do_razao()
returns int language plpgsql security definer set search_path to 'cs','public','pg_temp'
as $fn$
declare r record; v_n int := 0;
begin
  for r in
    select c.id, c.hotmart_transaction, c.oferta_codigo, c.preco, k.categoria,
           coalesce(cp.nome, cp.email, c.comprador_id::text) as quem,
           coalesce(c.data_aprovacao, c.data_compra, c.criado_em) as quando
      from public.compras c
      join public.hm_product_catalog k on k.offer_code = c.oferta_codigo
      join public.compradores cp on cp.id = c.comprador_id
     where c.status in ('APPROVED','COMPLETE','COMPLETED')
       and k.categoria not in ('sinal','diferenca','compra_cheia')
       and coalesce(c.preco, 0) > 0
       and coalesce(c.data_aprovacao, c.data_compra, c.criado_em) >= '2026-06-25'
       and not exists (select 1 from cs.hm_pagamentos p where p.compra_id = c.id)
       and not exists (
         select 1 from cs.hm_alertas a
          where a.tipo = 'compra_fora_do_razao' and a.chave = c.hotmart_transaction and a.resolvido_em is null)
  loop
    insert into cs.hm_alertas (tipo, chave, severidade, detalhe)
    values ('compra_fora_do_razao', r.hotmart_transaction, 'aviso',
      format('%s pagou R$ %s de %s em %s. Esse tipo de compra não abate o pacote do aluno, então de propósito ele não aparece no saldo nem na Jornada — senão a pessoa apareceria como quitada sem ter pago o pacote. Está aqui só para o dinheiro ficar visível: confira se a receita já foi reconhecida e dê baixa.',
             r.quem, to_char(r.preco, 'FM999G999D00'), r.categoria, to_char(r.quando, 'DD/MM/YYYY')));
    v_n := v_n + 1;
  end loop;
  return v_n;
end$fn$;

create or replace function cs.fn_hm_alerta_webhook_mudo()
returns int language plpgsql security definer set search_path to 'cs','public','pg_temp'
as $fn$
declare v_ultimo timestamptz; v_dias int;
begin
  select max(recebido_em) into v_ultimo from cs.hotmart_eventos;
  v_dias := extract(day from (now() - coalesce(v_ultimo, '2000-01-01'::timestamptz)))::int;
  if v_dias < 3 then
    update cs.hm_alertas set resolvido_em = now() where tipo = 'webhook_sem_log' and resolvido_em is null;
    return 0;
  end if;
  if exists (select 1 from cs.hm_alertas where tipo='webhook_sem_log' and resolvido_em is null) then return 0; end if;
  insert into cs.hm_alertas (tipo, chave, severidade, detalhe)
  values ('webhook_sem_log', 'hotmart_eventos', 'critico',
    format('O sistema parou de guardar o registro de tudo que a Hotmart avisa, há %s dias (último em %s). As vendas continuam entrando normalmente e NÃO há pagamento perdido por causa disso. O que se perdeu foi a capacidade de investigar: se alguém disser que pagou e não apareceu, não temos como conferir o que a Hotmart mandou. Precisa do time técnico.',
           v_dias, to_char(coalesce(v_ultimo, now()), 'DD/MM/YYYY HH24:MI')));
  return 1;
end$fn$;

-- [3] O que já está aberto na tela ganha o texto novo.
update cs.hm_alertas set detalhe = regexp_replace(replace(detalhe,
  ' sem canal de aquisição (rodar cs.fn_sync_hm_atm ou conferir oferta de entrada).',
  ' entrou sem canal de aquisição: o sistema não sabe de qual live ou campanha essa venda veio, e por isso ela não conta no placar de nenhum canal. Conferir por qual oferta a pessoa comprou.'), '^Card ', '')
 where tipo='sem_canal' and resolvido_em is null;

update cs.hm_alertas set detalhe = regexp_replace(
  regexp_replace(detalhe, ' pagou \(.*\) e não tem card na esteira\.$',
   ' pagou e não apareceu na Jornada. O dinheiro entrou, mas não existe card para ninguém trabalhar — ninguém cobra e ninguém ativa essa pessoa.'), '^Comprador ', '')
 where tipo='card_faltando' and resolvido_em is null;

update cs.hm_alertas set detalhe = replace(detalhe,
  'mas NAO esta em public.hm_product_catalog — o trigger ignora e o card nao anda. Catalogar com a categoria certa (sinal, diferenca ou compra_cheia).',
  'mas essa oferta não está cadastrada no sistema. Enquanto isso, o card não nasce e o pagamento não entra no saldo. Cadastrar a oferta resolve e o pagamento entra sozinho.')
 where tipo='oferta_orfa' and resolvido_em is null;

update cs.hm_alertas set detalhe = regexp_replace(replace(detalhe,
  'está em "Reembolsado" mas a compra segue aprovada no banco — reembolso/chargeback pode não ter dado baixa (razão conta como recebido). Conferir na Hotmart.',
  'está marcado como Reembolsado aqui, mas na Hotmart a compra continua aprovada. Enquanto isso o sistema conta esse dinheiro como recebido. Conferir na Hotmart se o reembolso saiu mesmo.'), '^Card ', '')
 where tipo='reembolso_sem_baixa' and resolvido_em is null;

-- Os dois meus eram texto sem acento: regenera do zero.
delete from cs.hm_alertas where tipo in ('compra_fora_do_razao','webhook_sem_log') and resolvido_em is null;
select cs.fn_hm_alerta_compra_fora_do_razao();
select cs.fn_hm_alerta_webhook_mudo();

-- Trava: nada de vocabulário de máquina no que o operador lê.
do $$
declare v_tecnico int;
begin
  select count(*) into v_tecnico from cs.hm_alertas
   where resolvido_em is null
     and (detalhe like '%cs.fn_%' or detalhe like '%public.hm_%' or detalhe like '%cs.hotmart_%'
          or detalhe like '%supabase/functions%' or detalhe like '%trigger%');
  if v_tecnico > 0 then
    raise exception '0233: ainda restam % alertas com nome de tabela/funcao no texto do operador', v_tecnico;
  end if;
end $$;

commit;
