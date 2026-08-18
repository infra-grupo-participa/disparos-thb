-- 0308: venda nova de AURUM já nasce com o contrato certo
--
-- A 0307 materializou cs.contatos_hm.contrato_aurum e fez o backfill de quem já
-- estava na base. Quem comprar AMANHÃ por uma oferta de contrato próprio (ex.:
-- Clínica de Goiânia) nasceria com a coluna NULL e cairia na régua de SP —
-- exatamente o erro que a 0307 consertou, só que para o futuro.
--
-- Onde entra: cs.fn_tag_hm_origem, chamada pelos TRÊS caminhos de entrada
-- (fn_seed_contato_hm, fn_hm_cadastrar_manual, fn_sync_hm_atm). É o mesmo ponto
-- onde a 0295 corrigiu turma_origem, e pela mesma razão: aqui o sistema JÁ sabe
-- quem a pessoa é e o que ela comprou.
--
-- NÃO é trigger em public.compras de propósito — aquela tabela é caminho quente
-- de ingestão do webhook da Hotmart.
--
-- ⚠️ O critério de identificação do contrato nesta migration está ERRADO
-- (`entrada_do_programa = true`). Corrigido pela 0309 logo em seguida; o corpo
-- válido da função é o da 0309. Este arquivo fica no histórico porque é ele que
-- cria a função e faz o enxerto em cs.fn_tag_hm_origem.

-- ── A regra, isolada em função própria ──────────────────────────────────────
-- Fora de fn_tag_hm_origem porque aquela função tem vários ramos com `return`
-- próprio; enxertar em cada um seria frágil. Aqui a regra é uma só, idempotente,
-- e pode ser rechamada por reconciliação sem efeito colateral.
create or replace function cs.fn_hm_carimbar_contrato_aurum(p_comprador_id uuid)
returns numeric
language plpgsql
security definer
set search_path to 'cs', 'public', 'pg_temp'
as $fn$
declare
  v_valor numeric;
begin
  -- ⚠️ CRITÉRIO ERRADO — substituído pela 0309 (papel = 'saldo').
  select cat.valor_tabela into v_valor
    from public.compras c
    join public.hm_product_catalog cat on cat.offer_code = c.oferta_codigo::text
   where c.comprador_id = p_comprador_id
     and cat.valor_tabela is not null
     and cat.entrada_do_programa = true
     and cs.fn_hm_pagamento_do_produto(cat.offer_code, 'AURUM')
   order by coalesce(c.data_aprovacao, c.data_compra) desc
   limit 1;

  if v_valor is null then
    return null;  -- sem contrato próprio: segue a régua de cs.aurum_parametros
  end if;

  update cs.contatos_hm
     set contrato_aurum = v_valor,
         atualizado_em  = now()
   where comprador_id = p_comprador_id
     and coalesce(produto, 'HM') = 'AURUM'
     and contrato_aurum is distinct from v_valor;

  return v_valor;
end $fn$;

grant execute on function cs.fn_hm_carimbar_contrato_aurum(uuid) to disparos_app;

-- ── Enxerto mecânico em cs.fn_tag_hm_origem ────────────────────────────────
-- Mesmo padrão das 0285/0292/0295: lê a definição viva, exige âncora única,
-- aborta se o corpo mudou. Nunca reescreve a função inteira às cegas.
do $mig$
declare
  v_def   text;
  v_novo  text;
  v_ancora constant text := 'if not found then return null; end if;';
  v_enxerto constant text :=
    'if not found then return null; end if;' || E'\n\n' ||
    '  -- 0308: venda nova por oferta de contrato proprio (Clinica GO) nasce com' || E'\n' ||
    '  -- o contrato carimbado, em vez de cair na regua do pacote de SP.' || E'\n' ||
    '  perform cs.fn_hm_carimbar_contrato_aurum(p_comprador_id);';
begin
  select pg_get_functiondef(p.oid) into v_def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'cs' and p.proname = 'fn_tag_hm_origem';

  if v_def is null then
    raise exception '0308: cs.fn_tag_hm_origem nao encontrada. Abortando.';
  end if;

  if position('fn_hm_carimbar_contrato_aurum' in v_def) > 0 then
    raise notice '0308: enxerto ja presente, nada a fazer.';
    return;
  end if;

  if position(v_ancora in v_def) = 0 then
    raise exception '0308: ancora "%" nao encontrada em fn_tag_hm_origem. O corpo mudou. Abortando.', v_ancora;
  end if;
  if (length(v_def) - length(replace(v_def, v_ancora, ''))) / length(v_ancora) <> 1 then
    raise exception '0308: ancora aparece mais de uma vez em fn_tag_hm_origem. Abortando.';
  end if;

  v_novo := replace(v_def, v_ancora, v_enxerto);

  if v_novo = v_def then
    raise exception '0308: replace nao alterou nada. Abortando.';
  end if;

  execute v_novo;
end $mig$;

-- ── Trava do enxerto ────────────────────────────────────────────────────────
do $$
declare v_tem_chamada boolean;
begin
  select position('fn_hm_carimbar_contrato_aurum' in prosrc) > 0 into v_tem_chamada
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'cs' and p.proname = 'fn_tag_hm_origem';

  if not v_tem_chamada then
    raise exception '0308: fn_tag_hm_origem nao ficou com a chamada. Abortando.';
  end if;
end $$;
