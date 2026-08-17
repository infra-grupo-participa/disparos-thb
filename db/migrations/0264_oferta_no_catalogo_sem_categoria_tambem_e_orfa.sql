-- =====================================================================
-- 0264 — oferta CATALOGADA mas SEM CATEGORIA também é órfã.
--
-- ── O CASO (Marcio, 17/08/2026) ─────────────────────────────────────────────────
-- Leandro Francatto Assunção pagou R$ 45.927,32 por PIX em 16/08 (transação
-- HP2057016447, oferta `vzehb16i`, produto Aurum). A compra ENTROU em
-- public.compras 17 segundos depois — o webhook funcionou. Mas o card do AURUM
-- dele seguiu dizendo **"deve R$ 45.927,32"**: exatamente o valor que ele acabara
-- de pagar.
--
-- ── A CAUSA ─────────────────────────────────────────────────────────────────────
-- `vzehb16i` ESTAVA em public.hm_product_catalog — mas com `categoria = NULL`.
-- E cs.fn_hm_lancar_compra tem esta linha:
--
--     if v_cat is null or v_cat not in ('sinal','diferenca','compra_cheia')
--       then return null; end if;
--
-- Categoria nula → a função sai **sem lançar nada e sem reclamar**. O dinheiro
-- entrou na Hotmart, entrou em public.compras, e nunca virou linha em
-- cs.hm_pagamentos. O board cobrou quem já tinha pagado.
--
-- ── POR QUE O ALERTA DA 0189 NÃO PEGOU ──────────────────────────────────────────
-- cs.fn_hm_alerta_oferta_orfa_na_compra (0189) protege contra oferta FORA do
-- catálogo:
--
--     if exists (select 1 from public.hm_product_catalog cat
--                 where cat.offer_code = new.oferta_codigo) then return new; end if;
--
-- Existir no catálogo bastava para o alerta calar. Mas existir NÃO é suficiente —
-- o que fn_hm_lancar_compra precisa é de uma categoria USÁVEL. Uma linha no
-- catálogo com categoria nula é pior que a ausência da linha: silencia o alerta E
-- não lança o pagamento. Este é o mesmo padrão de falha do
-- `product_not_mapped` do AURUM (webhook devolvia 200 e descartava): **a
-- verificação existia, mas media a coisa errada**.
--
-- ── O QUE ESTA MIGRATION FAZ ────────────────────────────────────────────────────
-- Troca o teste de PRESENÇA no catálogo por um teste de CATEGORIA UTILIZÁVEL — a
-- mesma lista que fn_hm_lancar_compra exige. O alerta passa a acender também
-- quando a oferta está catalogada com categoria nula ou fora da lista, e o
-- `detalhe` diz qual dos dois casos é (o operador precisa saber se cadastra a
-- oferta ou se corrige a categoria de uma que já existe).
--
-- Idempotente: só substitui a função da trigger; a trigger em si (0189) continua
-- apontando para o mesmo nome. Nenhuma alteração de schema.
--
-- ⚠️ NÃO faz backfill nem lança pagamento retroativo: o caso do Leandro foi
-- corrigido à mão (categoria `diferenca` + cs.fn_hm_lancar_compra na transação
-- HP2057016447 → card passou de "deve 45.927" para QUITADO). Varredura de outros
-- casos fica com o health check, que esta migration passa a alimentar.
-- =====================================================================

create or replace function cs.fn_hm_alerta_oferta_orfa_na_compra()
returns trigger
language plpgsql
security definer
set search_path to 'cs', 'public', 'pg_temp'
as $function$
declare
  v_cat        text;
  v_no_catalogo boolean;
  v_motivo     text;
begin
  if new.status not in ('APPROVED','COMPLETE','COMPLETED') then return new; end if;
  if new.oferta_codigo is null then return new; end if;

  -- Só produtos que o sistema conhece: venda de outro produto não é problema desta esteira.
  if not exists (select 1 from cs.hm_produto_hotmart m where m.produto_id = new.produto_id) then
    return new;
  end if;

  select cat.categoria, true into v_cat, v_no_catalogo
    from public.hm_product_catalog cat
   where cat.offer_code = new.oferta_codigo
   limit 1;
  v_no_catalogo := coalesce(v_no_catalogo, false);

  -- 0264: a condição de alerta deixa de ser "não está no catálogo" e passa a ser
  -- "não tem categoria que cs.fn_hm_lancar_compra aceite" — que é o que de fato
  -- impede o pagamento de ser lançado. Mesma lista da função de lançamento; se
  -- ela mudar, esta tem de mudar junto.
  if v_no_catalogo and v_cat is not null and v_cat in ('sinal','diferenca','compra_cheia') then
    return new;   -- catalogada E utilizável: nada a alertar
  end if;

  v_motivo := case
    when not v_no_catalogo then 'NAO esta em hm_product_catalog'
    when v_cat is null     then 'esta em hm_product_catalog mas com CATEGORIA VAZIA (foi o caso do Leandro em 16/08: pagou 45.927,32 e o card seguiu cobrando)'
    else                        format('esta em hm_product_catalog com categoria "%s", que nao serve para lancar pagamento', v_cat)
  end;

  begin
    insert into cs.hm_alertas (tipo, chave, severidade, detalhe)
    values ('oferta_orfa', new.oferta_codigo, 'critico',
            format('AGORA: %s pagou R$ %s na oferta %s (%s), que %s — o card nao vai andar e o pagamento nao entra no razao. Corrigir em public.hm_product_catalog (categoria: sinal, diferenca ou compra_cheia) e, se for saldo, em cs.hm_ofertas_saldo. Depois rodar cs.fn_hm_lancar_compra para a compra. Transacao %s.',
                   coalesce((select cp.nome from public.compradores cp where cp.id = new.comprador_id), '?'),
                   translate(to_char(new.preco, 'FM999G999G999D00'), ',.', '.,'),
                   new.oferta_codigo,
                   coalesce((select m.produto from cs.hm_produto_hotmart m where m.produto_id = new.produto_id), '?'),
                   v_motivo,
                   coalesce(new.hotmart_transaction, '?')));
  exception when others then null;   -- alerta nunca derruba a gravação da compra
  end;

  return new;
end$function$;

comment on function cs.fn_hm_alerta_oferta_orfa_na_compra() is
  '0189/0264: alerta critico na HORA em que uma compra aprovada cai numa oferta que nao consegue virar pagamento. 0264 ampliou o gatilho: antes so pegava oferta FORA do catalogo, e uma linha catalogada com categoria NULA silenciava o alerta sem lancar o pagamento (caso Leandro, 16/08, R$ 45.927,32). Agora a condicao e a MESMA que cs.fn_hm_lancar_compra exige — categoria em (sinal, diferenca, compra_cheia).';

-- Varredura imediata: alguma compra aprovada JA no banco esta neste estado?
-- Só reporta (raise notice) — não lança nada sozinha, porque escolher a categoria
-- de uma oferta é decisão de negócio, não de migration.
do $$
declare v_n int;
begin
  select count(*) into v_n
    from public.compras c
    left join public.hm_product_catalog cat on cat.offer_code = c.oferta_codigo
   where c.status in ('APPROVED','COMPLETE','COMPLETED')
     and c.oferta_codigo is not null
     and exists (select 1 from cs.hm_produto_hotmart m where m.produto_id = c.produto_id)
     and (cat.offer_code is null or cat.categoria is null
          or cat.categoria not in ('sinal','diferenca','compra_cheia'))
     and not exists (select 1 from cs.hm_pagamentos p where p.compra_id = c.id);

  if v_n > 0 then
    raise notice '0264: % compra(s) aprovada(s) sem pagamento lancado por causa de oferta sem categoria utilizavel. Ver o alerta oferta_orfa em cs.hm_alertas.', v_n;
  else
    raise notice '0264: nenhuma compra aprovada pendente por oferta sem categoria.';
  end if;
end $$;
