-- 0157_hm_oferta_697_live_ht.sql
-- Cataloga a oferta `rlgjsrul` (R$ 697) — entrada do HM vendida na LIVE DO HT de
-- 09/08/2026 — e recupera as 20 vendas que ficaram órfãs por ela estar fora do
-- catálogo.
--
-- O FURO (padrão que já mordeu antes: Nelci/Vanessa na 0156, Cristiano/Leonardo na
-- 0114): `cs.fn_seed_contato_hm` consulta `public.hm_product_catalog` e, se a oferta
-- não estiver lá, cai em `if v_cat is null then return new` — a compra é gravada pelo
-- webhook, mas NENHUM card é criado e NENHUM pagamento entra no razão
-- (`cs.fn_hm_lancar_compra` tem a mesma guarda). O silêncio é total: nada falha, nada
-- alerta, a venda simplesmente não existe para a operação.
-- Resultado medido em 10/08: 20 vendas aprovadas de `rlgjsrul`, 0 cards.
--
-- DECISÃO DO MARCIO (10/08/2026): os R$ 697 são a ENTRADA DO PROGRAMA de
-- implementação — mesma natureza do sinal de R$ 300, só que com valor novo. Logo:
--   · categoria      = 'sinal'  -> card nasce em "Comprou", comercial persegue o saldo
--   · concede_trilha = true     -> dá acesso ao GPS (trilha), como o sinal de 300
--
-- NÃO mexe em thb_alunos: 'sinal' não cria aluno da T39 ([[hm-quem-vira-aluno]]). Quem
-- ganha linha de TRILHA é o gatilho da 0110, pelo mesmo caminho do sinal de 300.
-- Idempotente.

-- ---------------------------------------------------------------------------
-- 1) Catálogo — é isto que faz o trigger enxergar a oferta daqui para a frente
-- ---------------------------------------------------------------------------
insert into public.hm_product_catalog
  (product_id, offer_code, product_name, product_type, notes, categoria, concede_trilha)
values
  ('5064314', 'rlgjsrul', 'Holding Masters', 'hm',
   'Entrada HM R$697 (ofertado na live do HT de 09/08/2026)', 'sinal', true)
on conflict (offer_code) do update
  set categoria       = excluded.categoria,
      notes           = excluded.notes,
      product_id      = excluded.product_id,
      product_name    = excluded.product_name,
      product_type    = excluded.product_type,
      concede_trilha  = excluded.concede_trilha;

-- ---------------------------------------------------------------------------
-- 1b) Origem POR OFERTA — o canal "Live HT 09/08" que o Marcio quer filtrar
--
-- Sem isto o canal seria derivado por DATA/edição e sairia errado: no teste seco a
-- Gabriela veio taggeada `HT29 - 26-07` — a edição do INGRESSO DO HT que ela comprou
-- semanas antes, não a live que de fato converteu. É o erro clássico de derivar canal
-- de um proxy fraco (ver [[hm-canal-pelo-fato]], caso Laura Cardoso).
--
-- `cs.hm_origem_por_oferta` é consultada por `cs.fn_tag_hm_origem` logo após o
-- override manual e ANTES da derivação por imersão/janela/edição — a oferta é um fato
-- mais forte que a data. Mesmo mecanismo já usado para `qm4lu7py` (ETHB SP).
-- ---------------------------------------------------------------------------
insert into cs.hm_origem_por_oferta (oferta_codigo, origem, nota, produto)
values ('rlgjsrul', 'Live HT 09/08',
        'Oferta de entrada R$697 do HM apresentada na live do Holding Total de 09/08/2026. '
        'Canal vem da OFERTA, não da data: derivar por janela traria a edição do ingresso do HT.',
        'HM')
on conflict (oferta_codigo) do update
  set origem = excluded.origem,
      nota   = excluded.nota,
      produto = excluded.produto;

-- ---------------------------------------------------------------------------
-- 2) Backfill — cria o card das vendas que já entraram órfãs
--
-- Reprocessa cada compra aprovada da oferta pelo MESMO caminho do webhook, em vez de
-- inserir na mão em cs.contatos_hm — assim o backfill não pode divergir da regra do
-- trigger: ele É a regra do trigger (card + estágio + turma por data + timeline +
-- tags de origem).
--
-- ⚠️ Duas armadilhas aqui, ambas verificadas contra a definição real dos triggers:
--
--   a) `cs.fn_seed_contato_hm()` é TRIGGER FUNCTION (retorna trigger, lê `new`) — não
--      existe versão chamável por compra_id. Só roda por trigger.
--   b) `trg_seed_contato_hm_upd` tem WHEN de TRANSIÇÃO: old.status NÃO-aprovado ->
--      new.status aprovado. Estas compras JÁ nasceram APPROVED, então um update
--      qualquer (em atualizado_em, ou até em status para o mesmo valor) NÃO dispara.
--
-- Por isso o backfill força a transição: derruba o status para um valor neutro e o
-- devolve para o original, na MESMA transação. O ida-e-volta faz o WHEN casar e o
-- trigger rodar exatamente como rodaria ao vivo. O status final é idêntico ao inicial
-- (preservado por linha, não hardcoded) — se algo falhar, a transação inteira volta.
--
-- 'PENDING' é só o valor-ponte: não está na lista de aprovados (senão o WHEN não
-- casaria) nem na de cancelados (senão `trg_hm_compra_cancelada` e
-- `trg_zz_hm_trilha_cancelada` disparariam e cancelariam o que acabamos de criar).
-- ---------------------------------------------------------------------------
do $$
declare
  r record;
  n integer := 0;
begin
  for r in
    select c.id, c.status from public.compras c
     where c.oferta_codigo = 'rlgjsrul'
       and c.status in ('APPROVED','COMPLETE','COMPLETED')
       and not exists (
         select 1 from cs.contatos_hm ch
          where ch.comprador_id = coalesce(
            (select a.canonico_id from cs.hm_comprador_alias a where a.comprador_id = c.comprador_id),
            c.comprador_id)
       )
     order by c.data_compra
  loop
    update public.compras set status = 'PENDING' where id = r.id;
    update public.compras set status = r.status  where id = r.id;  -- redispara o seed
    n := n + 1;
  end loop;
  raise notice 'backfill 0157: % compra(s) reprocessada(s)', n;
end $$;

-- ---------------------------------------------------------------------------
-- 3) Razão de pagamentos — lança os R$ 697 já pagos
--
-- O card criado acima não traz o dinheiro junto: `cs.fn_hm_lancar_compra` roda por
-- compra e exige que o card JÁ exista (`if not exists (...contatos_hm...) return null`).
-- Por isso o lançamento vem depois do backfill, não junto. É idempotente pela unique
-- (transacao, parcela).
-- ---------------------------------------------------------------------------
do $$
declare r record;
begin
  for r in
    select c.id from public.compras c
     where c.oferta_codigo = 'rlgjsrul'
       and c.status in ('APPROVED','COMPLETE','COMPLETED')
  loop
    perform cs.fn_hm_lancar_compra(r.id);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- 4) Marca na timeline que estes cards nasceram de backfill, não do webhook
--
-- Sem isso a origem do card fica indistinguível de uma venda que caiu ao vivo — e a
-- diferença importa quando alguém for auditar o atraso de atendimento (a venda é de
-- 09/08, o card é de 10/08).
-- ---------------------------------------------------------------------------
insert into cs.interacoes (contato_hm_id, tipo, descricao, autor)
select distinct ch.id, 'sistema',
       'Card recuperado por backfill (0157) — a venda de 09/08 na oferta R$697 (rlgjsrul) '
       'ficou órfã porque a oferta não estava no catálogo; a compra existia desde o webhook',
       'sistema'
  from public.compras c
  join cs.contatos_hm ch on ch.comprador_id = coalesce(
        (select a.canonico_id from cs.hm_comprador_alias a where a.comprador_id = c.comprador_id),
        c.comprador_id)
 where c.oferta_codigo = 'rlgjsrul'
   and c.status in ('APPROVED','COMPLETE','COMPLETED')
   and not exists (
     select 1 from cs.interacoes i
      where i.contato_hm_id = ch.id
        and i.descricao like 'Card recuperado por backfill (0157)%'
   );
