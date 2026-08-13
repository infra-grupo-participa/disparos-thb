-- 0216 — "Lead novo" vira "Aluno novo"
--
-- Decisão do Marcio (12/08/2026): "Não coloca como lead novo, coloca como aluno
-- novo. Não faz sentido ser lead." E é factualmente verdade — a tag só nasce
-- DEPOIS da compra do sinal. Quem está no board do HM já pagou; chamar de lead
-- é o vocabulário do funil anterior vazando para dentro da esteira de ativação.
--
-- A tag é um literal espalhado por quatro lugares. Renomear em três e esquecer o
-- quarto reclassificaria gente em silêncio — por isso a migration troca por
-- REESCRITA MECÂNICA do fonte (replace do literal em pg_get_functiondef), nunca
-- reescrevendo as funções à mão: assim é impossível alterar a lógica sem querer.
--
--   cs.fn_tag_hm_origem   emite a tag
--   cs.fn_sync_hm_atm     limpa a tag antes de reclassificar
--   cs.vw_hm_financeiro   CLASSIFICA por ela (publico = lead_novo | aluno_base)
--   cs.contatos_hm.tags   146 cards carregam o texto
--
-- A view fica TOLERANTE ÀS DUAS GRAFIAS de propósito. Ela decide o `publico`, e
-- `publico` decide pacote e crédito: um card que escapasse do backfill viraria
-- `nao_classificado` e mudaria de dinheiro. Degradar não pode significar mentir.

begin;

do $$
declare v_def text; v_novo text;
begin
  -- 1) Emissores — troca do literal, sem tocar em lógica.
  for v_def in
    select pg_get_functiondef(p.oid)
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'cs' and p.proname in ('fn_tag_hm_origem','fn_sync_hm_atm')
  loop
    v_novo := replace(v_def, '''Lead novo''', '''Aluno novo''');
    if v_novo = v_def then
      raise exception 'o literal nao casou numa das funcoes — abortado antes de mexer nos dados';
    end if;
    execute v_novo;
  end loop;

  -- 2) Classificador do dinheiro — aceita as duas grafias.
  select pg_get_viewdef('cs.vw_hm_financeiro'::regclass) into v_def;
  v_novo := replace(v_def,
    'WHEN (''Lead novo''::text = ANY (ch.tags)) THEN ''lead_novo''::text',
    'WHEN ((''Aluno novo''::text = ANY (ch.tags)) OR (''Lead novo''::text = ANY (ch.tags))) THEN ''lead_novo''::text');
  if v_novo = v_def then
    raise exception 'o classificador nao casou na vw_hm_financeiro — abortado';
  end if;
  execute 'create or replace view cs.vw_hm_financeiro as ' || v_novo;
end $$;

-- 3) Catálogo de tags (a régua do board e o seletor da ficha leem daqui).
update cs.tags set nome = 'Aluno novo' where nome = 'Lead novo';

-- 4) Os cards.
update cs.contatos_hm
   set tags = array_replace(tags, 'Lead novo', 'Aluno novo'),
       atualizado_em = now()
 where 'Lead novo' = any(tags);

-- 5) Trava: o dinheiro não pode ter mudado de lugar.
do $$
declare v_lead int; v_nc int; v_resto int;
begin
  select count(*) into v_lead from cs.vw_hm_financeiro where publico = 'lead_novo';
  select count(*) into v_nc   from cs.vw_hm_financeiro where publico = 'nao_classificado';
  select count(*) into v_resto from cs.contatos_hm where 'Lead novo' = any(tags);

  if v_resto > 0 then
    raise exception 'sobraram % cards com a grafia antiga', v_resto;
  end if;
  -- Medido em produção antes da migration: 146 lead_novo, 5 nao_classificado.
  if v_lead <> 146 or v_nc <> 5 then
    raise exception 'a classificacao mudou (lead_novo=%, nao_classificado=%) — esperado 146 e 5', v_lead, v_nc;
  end if;
end $$;

commit;
