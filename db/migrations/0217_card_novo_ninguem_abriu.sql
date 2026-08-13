-- 0217 — "ninguém abriu este card ainda"
--
-- Pedido do Marcio (12/08/2026): "a pessoa comprou agora, coloca uma
-- notificaçãozinha pulsando, porque indica que ninguém visualizou o card dela
-- ainda. Uma tagzinha no topo superior direito do card."
--
-- O board já pulsa por outro motivo (alvo do deep-link `?card=`, 0164), e ali o
-- pulso é temporário. Este é permanente até alguém abrir — por isso é estado no
-- banco, não estado de tela.
--
-- PRIMEIRA ABERTURA, não "última visita". A pergunta que o selo responde é
-- "alguém já olhou essa venda?", não "quem passou por aqui por último" — então
-- `visto_em` só é gravado uma vez (coalesce na escrita) e guarda QUEM abriu, que
-- é o que o gestor cobra depois.
--
-- ZERO RETROATIVIDADE. Sem backfill, os 298 cards existentes nasceriam todos
-- "novos" e o board viraria uma parede de selos pulsando — o inverso do pedido,
-- que é destacar o que acabou de cair. Marca-se tudo que já existe como visto,
-- exceto o que está numa etapa de ENTRADA e chegou nas últimas 48h: esses três
-- são justamente os que ninguém pode garantir que foram olhados.

begin;

alter table cs.contatos_hm
  add column if not exists visto_em  timestamptz,
  add column if not exists visto_por text;

comment on column cs.contatos_hm.visto_em is
  '0217: quando o card foi ABERTO pela primeira vez. Null = ninguém olhou ainda (selo pulsando no board).';
comment on column cs.contatos_hm.visto_por is
  '0217: quem abriu primeiro. Gravado junto com visto_em, uma vez só.';

-- Backfill: tudo que já existe conta como visto, menos as entradas recentes.
update cs.contatos_hm ch
   set visto_em  = coalesce(ch.entrada_em, ch.criado_em),
       visto_por = 'backfill 0217 (card anterior ao selo)'
  from cs.estagios e
 where e.id = ch.estagio_id
   and ch.visto_em is null
   and not (
     e.chave in ('hm_comprou','hm_boleto_gerado','hm_aguardando_pagamento')
     and ch.criado_em >= now() - interval '48 hours'
   );

-- Cards sem estágio não casam no join acima; também não devem nascer "novos".
update cs.contatos_hm
   set visto_em = coalesce(entrada_em, criado_em),
       visto_por = 'backfill 0217 (card sem etapa)'
 where visto_em is null and estagio_id is null;

do $$
declare v_novos int;
begin
  select count(*) into v_novos from cs.contatos_hm where visto_em is null;
  raise notice 'cards que seguem sem abertura registrada: %', v_novos;
  if v_novos > 20 then
    raise exception 'backfill deixou % cards como "novo" — o board viraria parede de selo', v_novos;
  end if;
end $$;

commit;
