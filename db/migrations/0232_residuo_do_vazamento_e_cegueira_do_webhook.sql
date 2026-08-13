-- 0232 — O resíduo do vazamento entre boards, e a cegueira do webhook
--
-- Auditoria do webhook pedida pelo Marcio (13/08): "vê se o webhook teve alguma
-- falha na questão financeira: se alguém pagou e não entrou no sistema, ou se
-- alguém teve algum furo. Preciso que você garanta isso 100%."
--
-- O QUE A RECONCILIAÇÃO ACHOU (produção, 13/08)
--
-- Das 456 compras aprovadas dos produtos do HM/AURUM:
--   393 (R$ 954.765,18)  no razão, corretas
--    43 (R$ 101.916,11)  renovacao/reserva — fora do razão POR DESENHO (0230)
--    19 (R$ 164.260,76)  sem card. **17 são anteriores a 25/06**, quando
--                        fn_seed_contato_hm ainda não criava card, e TODAS as 19
--                        pessoas têm aluno em public.thb_alunos (ou seja: têm
--                        acesso, o que se perdeu foi o card da esteira).
--                        Pós-corte sobra UMA: Luana N Teixeira de Souza,
--                        R$ 1.495,84 em 24/07 — o alerta card_faltando de 25/07.
--     1 (R$ 1.376,35)    oferta fora do catálogo (Rangel, 11/08).
--
-- Integridade do razão: 0 pagamento duplicado, 0 pagamento sem compra, 0 compra
-- sem comprador. Reembolso: dos 10 pagamentos ligados a compra não aprovada, 9
-- têm o card cancelado e em "Reembolsado" — o sistema tratou certo, e o
-- lançamento fica no razão como história (o dinheiro entrou e voltou).
--
-- ============================================================================
-- [1] O QUE ESTAVA ERRADO: 15 cards com valor_pago somando os DOIS boards
-- ============================================================================
-- Todos os 15 são de gente com card no HM **e** no AURUM, e a diferença é
-- sempre a MESMA: ~R$ 1.000, o valor da entrada do AURUM (oferta qm4lu7py).
-- Resíduo de antes da 0196/0197, quando fn_hm_recalcular_financeiro somava os
-- dois boards e gravava nos dois. As funções foram corrigidas; os VALORES
-- gravados nos cards nunca foram recalculados.
--
-- Consequência real: **quatro pessoas apareciam devendo R$ 1.000 a MENOS** do
-- que devem — a entrada do AURUM abatia a dívida do HM. Ana Paula Kfuri, Magda
-- Maria José de Morais, Paulete da Costa Monteiro Carvalho e Vania Claudie
-- Thomaz. É receita que o time não estava perseguindo.
--
-- Medido no ensaio revertido: 16 cards mudam de valor_pago, NENHUM saldo cai,
-- **quitados do HM 59 → 59**. Anderson Silva Resende tinha o caminho inverso —
-- o dinheiro do HM inflando o card do AURUM (15.999,99 → 999,97).
--
-- ============================================================================
-- [2] A CEGUEIRA: cs.hotmart_eventos parado desde 17/07
-- ============================================================================
-- O log bruto do webhook não grava há 27 dias. As compras continuam entrando
-- (public.compras tem registro de hoje), então **não há dinheiro perdido por
-- causa disso** — mas é o que impede a garantia de 100% que o Marcio pediu:
-- sem o log não dá para provar que nenhum evento se perdeu, nem investigar um
-- pagamento que alguém jure ter feito.
--
-- Monitor que ninguém monitora não é monitor. O alerta abaixo torna o silêncio
-- visível e se fecha sozinho quando o log voltar.

begin;

-- [1] Recalcular os cards com resíduo.
do $$
declare v_n int;
begin
  create temp table _alvo_0232 as
   select distinct ch.comprador_id from cs.contatos_hm ch
    where coalesce(ch.produto,'HM')='HM'
      and abs(coalesce(ch.valor_pago,0) - coalesce((select sum(p.valor) from cs.hm_pagamentos p
            where p.comprador_id=ch.comprador_id and cs.fn_hm_pagamento_do_produto(p.oferta_codigo, ch.produto)),0)) > 1;
  select count(*) into v_n from _alvo_0232;
  raise notice '0232: recalculando % pessoas', v_n;
  perform cs.fn_hm_recalcular_financeiro(comprador_id) from _alvo_0232;
  drop table _alvo_0232;
end $$;

-- [2] O silêncio do webhook vira alerta.
create or replace function cs.fn_hm_alerta_webhook_mudo()
returns int
language plpgsql security definer set search_path to 'cs','public','pg_temp'
as $fn$
declare v_ultimo timestamptz; v_dias int;
begin
  select max(recebido_em) into v_ultimo from cs.hotmart_eventos;
  v_dias := extract(day from (now() - coalesce(v_ultimo, '2000-01-01'::timestamptz)))::int;

  -- Voltou a receber: o alerta se resolve sozinho (mesma regra da 0208 — alerta
  -- cuja causa o sistema consegue verificar não exige baixa manual).
  if v_dias < 3 then
    update cs.hm_alertas set resolvido_em = now()
     where tipo = 'webhook_sem_log' and resolvido_em is null;
    return 0;
  end if;

  -- Um alerta aberto por vez: repetir a cada rodada treina o time a ignorar.
  if exists (select 1 from cs.hm_alertas where tipo='webhook_sem_log' and resolvido_em is null) then
    return 0;
  end if;

  insert into cs.hm_alertas (tipo, chave, severidade, detalhe)
  values ('webhook_sem_log', 'hotmart_eventos', 'critico',
    format('O log bruto do webhook da Hotmart (cs.hotmart_eventos) nao recebe nada ha %s dias -- ultimo evento em %s. As compras seguem entrando (public.compras esta atualizada), entao NAO ha dinheiro perdido por isto. O problema e a CEGUEIRA: sem o log bruto nao da para provar que nenhum evento se perdeu, nem investigar um pagamento que nao apareceu. Conferir a edge function supabase/functions/hotmart-events-webhook.',
           v_dias, to_char(coalesce(v_ultimo, now()), 'DD/MM/YYYY HH24:MI')));
  return 1;
end$fn$;

comment on function cs.fn_hm_alerta_webhook_mudo() is
  '0232: o log bruto do webhook morreu em 17/07 e ninguem notou por 27 dias. Monitor que nao e monitorado nao e monitor. Fecha sozinho quando o log voltar a receber.';

grant execute on function cs.fn_hm_alerta_webhook_mudo() to disparos_app;

select cs.fn_hm_alerta_webhook_mudo();

-- Travas.
do $$
declare v_div int; v_q int;
begin
  select count(*) into v_div from cs.contatos_hm ch
   where coalesce(ch.produto,'HM')='HM'
     and abs(coalesce(ch.valor_pago,0) - coalesce((select sum(p.valor) from cs.hm_pagamentos p
           where p.comprador_id=ch.comprador_id and cs.fn_hm_pagamento_do_produto(p.oferta_codigo, ch.produto)),0)) > 1;
  if v_div > 0 then
    raise exception '0232: sobraram % cards com valor_pago divergente do razao', v_div;
  end if;
  select count(*) into v_q from cs.vw_hm_financeiro f join cs.contatos_hm ch on ch.id=f.contato_hm_id
   where coalesce(ch.produto,'HM')='HM' and f.quitado;
  if v_q <> 59 then
    raise exception '0232: quitados do HM mudou de 59 para % -- alguem foi reclassificado', v_q;
  end if;
end $$;

commit;
