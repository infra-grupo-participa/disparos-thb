-- 0304_o_aurum_da_clinica_nao_e_o_pacote_de_sp
-- APLICADA EM PRODUCAO 18/08/2026.
--
-- ── O que o Marcio viu ──────────────────────────────────────────────────────
-- Sebastiao aparecia devendo R$ 55.528 do AURUM. O contrato dele, na tela da
-- Hotmart, e `ulimhvmd` = "Saldo de reserva - Clinica GO - R$ 13.000
-- (Parcelado Hotmart)". Ele deve ~R$ 9,5 mil. Cobranca de R$ 46 mil a mais.
--
-- ── A causa ─────────────────────────────────────────────────────────────────
-- cs.fn_aurum_saldo partia SEMPRE de cs.aurum_parametros.pacote_cheio
-- (R$ 60.000 — o pacote do ETHB SP), para TODO card AURUM, sem olhar qual
-- oferta a pessoa comprou. Quem entrou por saldo de reserva de 13k era cobrado
-- como se tivesse fechado o programa inteiro de SP.
--
-- Base: corpo vivo lido inteiro antes de reescrever (funcao curta, language
-- sql). Reescrever a partir do banco e seguro; a partir de arquivo antigo, nao.
--
-- ── A regra nova ────────────────────────────────────────────────────────────
-- Se a pessoa comprou oferta de saldo do AURUM COM valor_tabela (0303), esse e
-- o pacote dela: saldo = valor - credito - pago, sem descontar a entrada de SP
-- (que ela nao pagou). Sem oferta de saldo identificada, mantem a regra antiga.
-- Desempate com mais de uma oferta: a de MAIOR valor (quem comprou 13k e depois
-- fechou 43k tem contrato de 43k).
--
-- ── Medido apos aplicar ─────────────────────────────────────────────────────
-- Sebastiao  55.528 -> 9.528   (contrato 13.000)
-- Rangel     56.247 -> 10.247  (contrato 13.000)
-- Vanda      59.000 -> 59.000  (ETHB SP, controle: nao pode mudar)

create or replace function cs.fn_aurum_saldo(p_comprador uuid)
 returns numeric
 language sql
 stable
 set search_path to 'cs', 'public', 'pg_temp'
as $function$
  with a as (
    select ap.credito, ap.excecao from cs.aurum_pagamento_aluno ap
     where ap.comprador_id = p_comprador
     order by ap.atualizado_em desc, ap.documento limit 1
  ), pago as (
    select coalesce(sum(p.valor), 0::numeric) as valor from cs.hm_pagamentos p
     where p.comprador_id = p_comprador
       and p.categoria is distinct from 'sinal'
       and cs.fn_hm_pagamento_do_produto(p.oferta_codigo, 'AURUM')
  ), contrato as (
    -- 0304: o contrato REAL da pessoa, quando a oferta de saldo que ela
    -- comprou tem valor proprio no catalogo. Maior valor vence o desempate.
    select max(cat.valor_tabela) as valor
      from public.compras c
      join public.hm_product_catalog cat on cat.offer_code = c.oferta_codigo
     where c.comprador_id = p_comprador
       and c.status in ('APPROVED','COMPLETE','COMPLETED')
       and cat.categoria = 'diferenca'
       and cat.valor_tabela is not null
       and cs.fn_hm_pagamento_do_produto(cat.offer_code, 'AURUM')
  )
  select case
           when (select excecao from a) then null::numeric
           when (select valor from contrato) is not null then
             greatest(round(
               ( (select valor from contrato)
               - coalesce((select credito from a), 0::numeric)
               - (select valor from pago) ), 2), 0::numeric)
           else
             greatest(round(
               ( (select valor from cs.aurum_parametros where chave = 'pacote_cheio')
               - (select valor from cs.aurum_parametros where chave = 'entrada')
               - coalesce((select credito from a), 0::numeric)
               - (select valor from pago) ), 2), 0::numeric)
         end;
$function$;

comment on function cs.fn_aurum_saldo(uuid) is
  '0304: o saldo do AURUM sai do CONTRATO da pessoa. Se ela comprou uma oferta de saldo com valor_tabela no catalogo (ex. ulimhvmd = Clinica GO R$ 13.000), o pacote e esse valor e o saldo e valor - pago, sem descontar a entrada do ETHB SP (que ela nao pagou). Sem oferta de saldo identificada, mantem a regra antiga (aurum_parametros.pacote_cheio - entrada - credito - pago). Antes disso TODO card AURUM partia dos R$ 60.000 de SP.';

do $$
declare v_seb numeric; v_vanda numeric;
begin
  select cs.fn_aurum_saldo(c.comprador_id) into v_seb
    from cs.contatos_hm c join public.compradores cp on cp.id=c.comprador_id
   where c.produto='AURUM' and cp.nome ilike '%Sebastiao Jose da Silva%' limit 1;

  select cs.fn_aurum_saldo(c.comprador_id) into v_vanda
    from cs.contatos_hm c join public.compradores cp on cp.id=c.comprador_id
   where c.produto='AURUM' and cp.nome ilike '%Vanda Amorim%' limit 1;

  if v_seb >= 55000 then
    raise exception '0304: o saldo do Sebastiao nao caiu (%) — contrato proprio nao aplicado.', v_seb;
  end if;
  if v_vanda is distinct from 59000.00 then
    raise exception '0304: o saldo de quem e do ETHB SP mudou (Vanda=%). Abortado.', v_vanda;
  end if;
  raise notice '0304: Sebastiao=% | Vanda (controle ETHB SP)=%.', v_seb, v_vanda;
end $$;
