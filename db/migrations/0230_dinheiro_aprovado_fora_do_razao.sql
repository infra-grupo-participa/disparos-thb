-- 0230 — Dinheiro aprovado na Hotmart que nunca entrou no razão
--
-- Auditoria do financeiro pedida pelo Marcio em 12/08 ("vê se você acha furo no
-- financeiro e mapeia isso pra mim"). Medido em produção ANTES desta migration:
-- **R$ 283.498,20** aprovados nos produtos do HM/AURUM estão fora de
-- `cs.hm_pagamentos`. Separando o que é história do que é furo:
--
--   R$  15.944,98  RECUPERÁVEL — categoria que entra no razão (sinal/diferenca/
--                  compra_cheia), pessoa COM card, preço > 0, e ainda assim fora.
--                  O gatilho não rodou na época (compra que entrou por import, ou
--                  antes de o card existir). Relançar resolve — é o que esta
--                  migration faz.
--   R$  59.952,04  POR DESENHO — 27 compras de `renovacao` e `reserva` desde o
--                  corte de 25/06. `fn_hm_lancar_compra` só aceita sinal,
--                  diferenca e compra_cheia. Não entram no razão porque NÃO são
--                  pagamento do pacote de 15k — lançar reclassificaria gente como
--                  quitada. Mas ficar invisível também não serve: alerta, abaixo.
--   o resto        anterior ao corte de 25/06 (`fn_seed_contato_hm` não criava
--                  card antes disso). História pré-sistema, não se mexe.
--
-- ENSAIO EM TRANSAÇÃO REVERTIDA, antes de aplicar: 4 compras lançadas, 3 pessoas
-- mudam de valor, NENHUM saldo cai e NINGUÉM vira quitado por engano —
--   Rodrigo Alexandre Assis Silva [HM]   pago 299,99 → 12.300,01   saldo igual
--   Thiago Barbosa Ferreira       [HM]   pago    0   →  2.944,96   saldo NULL → 12.055,04
--   Marcos Adriano Marques        [AURUM] pago   0   →  1.000,00   saldo igual
--
-- O caso do Thiago justifica sozinho: o saldo dele era INCALCULÁVEL e passa a ter
-- número. O board não sabia quanto cobrar de um aluno que já tinha pago R$ 2.944,96.
--
-- Depois de aplicar: recuperável restante = R$ 0; quitados do HM = 58 (inalterado);
-- soma a perseguir do HM 2.530.336,32 → 2.542.391,36, exatamente os 12.055,04 do
-- Thiago que antes não existiam para o sistema.

begin;

-- ---------------------------------------------------------------------------
-- 1) Relançar o recuperável. Idempotente: `fn_hm_lancar_compra` tem
--    `on conflict (transacao, parcela) do nothing`, e o filtro exige estar fora
--    do razão. Rodar duas vezes não duplica pagamento.
-- ---------------------------------------------------------------------------
do $$
declare r record; v_n int := 0; v_total numeric := 0;
begin
  for r in
    select c.id, c.preco
      from public.compras c
      join public.hm_product_catalog k on k.offer_code = c.oferta_codigo
     where c.status in ('APPROVED','COMPLETE','COMPLETED')
       and k.categoria in ('sinal','diferenca','compra_cheia')
       and not exists (select 1 from cs.hm_pagamentos p where p.compra_id = c.id)
       and exists (select 1 from cs.contatos_hm ch where ch.comprador_id = cs.fn_hm_dono_do_pagamento(c.comprador_id))
       and coalesce(c.preco, 0) > 0
  loop
    if cs.fn_hm_lancar_compra(r.id) is not null then
      v_n := v_n + 1; v_total := v_total + r.preco;
    end if;
  end loop;
  raise notice '0230: % compras relancadas, R$ % recuperados para o razao', v_n, v_total;
end $$;

-- ---------------------------------------------------------------------------
-- 2) O dinheiro que NÃO entra no razão para de ser invisível.
--
--    `renovacao` e `reserva` são receita real do HM que o razão ignora de
--    propósito (não abatem o pacote). Hoje ninguém vê: não viram card, não viram
--    pagamento, não viram alerta. Foi assim que R$ 59.952,04 passaram batido
--    desde 25/06 — e a operação descobriu por auditoria, não pelo sistema.
--
--    A saída NÃO é lançar no razão: mudaria o saldo de quem não pagou o pacote.
--    É dar visibilidade — tipo de alerta próprio, severidade `aviso`. Não é erro
--    do sistema, é dinheiro que a operação precisa enxergar. Severidade crítica
--    aqui treinaria o time a ignorar o painel, que foi exatamente o problema dos
--    13 falsos positivos de "Reclamada" (0208).
-- ---------------------------------------------------------------------------
create or replace function cs.fn_hm_alerta_compra_fora_do_razao()
returns int
language plpgsql security definer set search_path to 'cs','public','pg_temp'
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
          where a.tipo = 'compra_fora_do_razao'
            and a.chave = c.hotmart_transaction
            and a.resolvido_em is null)
  loop
    insert into cs.hm_alertas (tipo, chave, severidade, detalhe)
    values ('compra_fora_do_razao', r.hotmart_transaction, 'aviso',
      format('%s comprou %s (%s, oferta %s) por R$ %s em %s. Esta categoria NAO entra no razao de propositto -- nao abate o pacote de 15k -- entao nao aparece em saldo, board nem export. Registrado aqui para a operacao enxergar o dinheiro.',
             r.quem, r.categoria, r.categoria, r.oferta_codigo, r.preco, to_char(r.quando, 'DD/MM/YYYY')));
    v_n := v_n + 1;
  end loop;
  return v_n;
end$fn$;

comment on function cs.fn_hm_alerta_compra_fora_do_razao() is
  '0230: torna visivel a receita de categorias que o razao ignora (renovacao, reserva). Nao lanca pagamento -- so alerta. R$ 59.952,04 em 27 compras estavam invisiveis desde 25/06.';

grant execute on function cs.fn_hm_alerta_compra_fora_do_razao() to disparos_app;

select cs.fn_hm_alerta_compra_fora_do_razao();

-- Trava: o recuperável tem que ter ido a zero.
do $$
declare v_fora numeric; v_alertas int;
begin
  select coalesce(sum(c.preco),0) into v_fora
    from public.compras c join public.hm_product_catalog k on k.offer_code=c.oferta_codigo
   where c.status in ('APPROVED','COMPLETE','COMPLETED')
     and k.categoria in ('sinal','diferenca','compra_cheia')
     and not exists (select 1 from cs.hm_pagamentos p where p.compra_id=c.id)
     and exists (select 1 from cs.contatos_hm ch where ch.comprador_id = cs.fn_hm_dono_do_pagamento(c.comprador_id))
     and coalesce(c.preco,0) > 0;
  if v_fora <> 0 then
    raise exception '0230: ainda sobrou R$ % recuperavel fora do razao -- o relancamento nao pegou tudo', v_fora;
  end if;
  select count(*) into v_alertas from cs.hm_alertas where tipo='compra_fora_do_razao' and resolvido_em is null;
  raise notice '0230: alertas de compra fora do razao abertos: %', v_alertas;
end $$;

commit;
