-- 0301_solicitou_cancelamento_e_o_pedido_que_so_veio_pra_gente
--
-- ── O pedido (Marcio, 18/08) ────────────────────────────────────────────────
-- "Crie uma coluna 'Solicitou Cancelamento', manual, para o comercial mover
--  quem pediu o cancelamento PESSOALMENTE — por mensagem ou na ligação — mas
--  ainda NÃO abriu o pedido na Hotmart."
--
-- ── Por que essa coluna faltava ─────────────────────────────────────────────
-- "Reclamada" (hm_cancelamento) significa, por decisão anterior do Marcio:
-- *a pessoa PEDIU o reembolso na Hotmart*. É fato da Hotmart — por isso a 0290
-- classificou a coluna como origem_movimento='hotmart' e a 0291 travou o
-- movimento manual.
--
-- Só que o pedido feito ao comercial (WhatsApp, ligação) não tem rastro na
-- Hotmart e não tinha onde morar. A auditoria de 18/08 mediu o efeito disso:
-- das 17 fichas em "Reclamada", **13 não tinham NENHUMA compra REFUNDED /
-- PROTESTED / CHARGEBACK / CANCELED**. O board afirmava um pedido na Hotmart
-- que não existia — e a 0293, corretamente, se recusou a movê-las por não ter
-- evidência (gerou alerta `reclamada_sem_evidencia` em vez de inventar fato).
--
-- Esta coluna é o lugar que faltava para esses casos. A esteira passa a ler:
--   Solicitou Cancelamento (45) → pediu PRA GENTE, sem rastro na Hotmart
--   Reclamada               (50) → pediu NA HOTMART, dinheiro ainda conosco
--   Reembolsado             (55) → reembolso executado, dinheiro devolveu
--
-- ── origem_movimento = 'operador', e isso é o ponto ─────────────────────────
-- Diferente das duas irmãs, esta coluna é MANUAL por natureza: o fato que ela
-- registra é uma conversa, e conversa não gera webhook. Só o comercial sabe.

insert into cs.estagios (evento, chave, nome, cor, ordem, aba, ativo, origem_movimento)
values ('HM', 'hm_solicitou_cancelamento', 'Solicitou Cancelamento', '#F59E0B', 45, 'comercial', true, 'operador')
on conflict do nothing;

do $$
declare v_n int;
begin
  select count(*) into v_n from cs.estagios
   where evento='HM' and chave='hm_solicitou_cancelamento' and ativo;
  if v_n <> 1 then
    raise exception '0301: a coluna hm_solicitou_cancelamento nao foi criada (achei %). Abortado.', v_n;
  end if;
end $$;

comment on column cs.estagios.origem_movimento is
  '0290 (D1/D2) + 0301: quem tem autoridade para mover uma ficha PARA ou PARA FORA desta coluna. hotmart = fato da Hotmart (boleto, pedido de reembolso, reembolso executado) — bloqueia gesto manual. derivada = espelho de outra etapa. operador = movimento humano; inclui hm_solicitou_cancelamento, que registra um pedido feito por mensagem/ligacao ao comercial e por definicao NAO tem rastro na Hotmart — so o operador sabe.';

-- ── As 13 fichas que estavam na coluna errada ───────────────────────────────
-- Critério de FATO, não por nome: está em "Reclamada" E não existe nenhuma
-- compra com status de reclamação/reembolso na Hotmart. Exatamente o conjunto
-- que a 0293 recusou-se a mover por falta de evidência.
do $$
declare
  v_alvo record;
  v_solicitou smallint;
  v_reclamada smallint;
  v_n int := 0;
begin
  select id into v_solicitou from cs.estagios where evento='HM' and chave='hm_solicitou_cancelamento';
  select id into v_reclamada from cs.estagios where evento='HM' and chave='hm_cancelamento';

  for v_alvo in
    select ch.id, ch.comprador_id, (ch.cancelamento_em is not null) as tem_registro_de_pedido
      from cs.contatos_hm ch
     where ch.estagio_id = v_reclamada
       and not exists (
         select 1 from public.compras c
          where c.comprador_id = ch.comprador_id
            and c.status in ('REFUNDED','CHARGEBACK','PROTESTED','CANCELED','CANCELLED')
       )
  loop
    update cs.contatos_hm
       set estagio_id = v_solicitou, atualizado_em = now()
     where id = v_alvo.id;

    insert into cs.interacoes (contato_hm_id, tipo, descricao, autor, estagio_anterior_id, estagio_novo_id)
    values (v_alvo.id, 'mudanca_estagio',
            case when v_alvo.tem_registro_de_pedido
                 then '0301: movido de "Reclamada" para "Solicitou Cancelamento" — ha registro de pedido feito ao comercial (cancelamento_em), mas NENHUMA compra reclamada/reembolsada na Hotmart. "Reclamada" passa a significar so pedido aberto na Hotmart.'
                 else '0301: movido de "Reclamada" para "Solicitou Cancelamento" — nenhuma compra reclamada/reembolsada na Hotmart. ⚠️ Tambem nao ha registro de quando o pedido foi feito ao comercial: conferir com quem atendeu.'
            end,
            'sistema', v_reclamada, v_solicitou);
    v_n := v_n + 1;
  end loop;

  raise notice '0301: % ficha(s) movida(s) de "Reclamada" para "Solicitou Cancelamento".', v_n;

  -- Resolve o alerta que existia justamente por essas fichas estarem no lugar
  -- errado — agora elas TÊM lugar.
  update cs.hm_alertas set resolvido_em = now()
   where tipo = 'reclamada_sem_evidencia' and resolvido_em is null;
end $$;

-- ── Conferência ─────────────────────────────────────────────────────────────
do $$
declare v_sem_evidencia int;
begin
  select count(*) into v_sem_evidencia
    from cs.contatos_hm ch
    join cs.estagios e on e.id = ch.estagio_id
   where e.chave = 'hm_cancelamento'
     and not exists (
       select 1 from public.compras c
        where c.comprador_id = ch.comprador_id
          and c.status in ('REFUNDED','CHARGEBACK','PROTESTED','CANCELED','CANCELLED')
     );

  if v_sem_evidencia <> 0 then
    raise exception '0301: ainda restam % ficha(s) em "Reclamada" sem evidencia na Hotmart — abortado.', v_sem_evidencia;
  end if;

  raise notice '0301: conferido — "Reclamada" agora so tem quem tem pedido real na Hotmart.';
end $$;
