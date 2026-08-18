-- =====================================================================
-- 0297_o_gps_e_o_que_falta_na_ativacao
--
-- Pedido literal do Marcio (17/08): "Pessoas que são de renovação ou que já
-- são alunos antigos, a gente já tem que deixar acertado que ela já tem
-- acesso ao Search, à comunidade do THB e grupo de informes. A única coisa
-- que fica pendente é o acesso dela no programa de implementação do GPS.
-- É o único checkbox que a gente tem que deixar ali, para pessoas antigas e
-- novas."
--
-- `ativ_gps`: acesso ao GPS (Programa de Implementação Assistida) — o 5º
-- item do checklist de ativação (lib/services/hm.ts, CHECKLIST — B4). Para
-- todo mundo (aluno novo ou antigo) ele é gesto humano; nunca é auto-marcado
-- por trigger algum (D2, decisão do Marcio) — é justamente o item que
-- continua pendente para o aluno antigo/renovação depois que os outros 3
-- chegam prontos (0298).
--
-- Aditiva e idempotente.
-- =====================================================================

alter table cs.contatos_hm
  add column if not exists ativ_gps boolean not null default false;

comment on column cs.contatos_hm.ativ_gps is
  '0297: acesso ao GPS (Programa de Implementação Assistida) — 5o item do checklist de ativacao (lib/services/hm.ts CHECKLIST). E o UNICO item que fica pendente para aluno antigo/renovacao depois que 0298 auto-marca ativ_searchie/comunidade/grupo na entrada da Ativacao (D2, decisao do Marcio) — nunca auto-marcado, sempre gesto humano.';

-- ⚠️ REGRA DE OURO DESTE REPO: o banco está à FRENTE do código local (ver
-- gap de numeração 0267→0280 nas migrations commitadas — o repo não reflete
-- tudo que já rodou em produção). Antes de aplicar o bloco abaixo, rodar
--   select pg_get_functiondef('cs.fn_hm_undo_colunas'::regclass);
-- e comparar contra o array reescrito aqui. A versão usada como base é a da
-- 0281 (29 colunas, confirmada por grep como a última a tocar a função) — se
-- o banco vivo tiver uma lista diferente, ESTE `create or replace` PERDE
-- silenciosamente qualquer coluna que só exista lá. Reescrever o array a
-- partir do retorno real antes de aplicar.
create or replace function cs.fn_hm_undo_colunas()
 returns text[]
 language sql
 immutable
as $function$
  select array[
    'responsavel','responsavel_id','turma','turma_origem','plano','observacoes',
    'reuniao_resultado','entrevista_resultado','reuniao_gravacao_url','entrevista_gravacao_url',
    'pagamento_meio','pagamento_previsto_em','acordo','oferta_saldo_codigo','link_saldo_enviado_em',
    'nao_contatar','nao_contatar_motivo','revisar','revisar_motivo',
    'ativ_searchie','ativ_comunidade','ativ_grupo','ativ_pesquisa','ativ_gps','grupo_informes','pendencia',
    'cancelamento_motivo','link_facebook',
    'rev_searchie','rev_comunidade','rev_grupo','rev_pesquisa',
    'credito_oferta','credito_valor_pago','credito_dias_totais','credito_compra_em',
    'valor_total','valor_pago','pagamento_em','cancelamento_em','tags',
    'intencao_pagamento','intencao_pagamento_em','intencao_pagamento_obs'
  ]::text[];
$function$;

comment on function cs.fn_hm_undo_colunas() is
  '0297: acrescenta ativ_gps ao snapshot do "desfazer edicao" (base = 0281, 43 colunas -> 44). Confirmar contra pg_get_functiondef antes de aplicar (regra de ouro do repo) -- ver aviso acima.';

-- cs.contatos_hm_kanban (view do board/ficha/relatório) também precisa expor
-- ativ_gps — sem isso, k.ativ_gps (hm-ficha.ts, hm-relatorio.ts, kanban/route.ts)
-- falha com "column does not exist". A view foi criada/alterada por migrations
-- que não estão neste repo (gap 0267-0279) — NÃO reescrita aqui à mão: lida em
-- runtime por pg_get_viewdef e alterada por PATCH MECÂNICO (mesmo padrão
-- 0292/0295), acrescentando a coluna logo depois de `ativ_pesquisa` na
-- projeção — mesma posição relativa que o SELECT de hm-ficha.ts/hm-relatorio.ts
-- já usa para os outros ativ_*. Aborta com `raise exception` se a âncora não
-- casar — nunca grava view incompleta.
do $$
declare
  v_def  text;
  v_novo text;
begin
  select pg_get_viewdef('cs.contatos_hm_kanban'::regclass, true) into v_def;

  if v_def is null then
    raise exception '0297: cs.contatos_hm_kanban nao encontrada — abortado antes de mexer em nada.';
  end if;

  if v_def ~ 'ativ_gps' then
    raise exception '0297: cs.contatos_hm_kanban ja expoe ativ_gps — patch ja aplicado, abortado para nao duplicar.';
  end if;

  -- Âncora: a coluna `ativ_pesquisa` na projeção, com o alias de tabela que o
  -- corpo vivo usar (grupo 1, capturado e reaproveitado) e a vírgula que a
  -- separa da próxima coluna, preservada. Tolerante ao alias exato,
  -- intolerante ao resto — não adivinha nada além disso.
  if v_def !~ '([A-Za-z_][A-Za-z0-9_]*\.)?ativ_pesquisa\s*,' then
    raise exception '0297: a ancora "ativ_pesquisa," nao casou no fonte de cs.contatos_hm_kanban — abortado antes de gravar view incompleta. Rodar select pg_get_viewdef(''cs.contatos_hm_kanban''::regclass, true) e ajustar a ancora deste patch (posicao/alias real da coluna) antes de reaplicar.';
  end if;

  -- Só a 1ª ocorrência (ativ_pesquisa não deve se repetir na projeção).
  v_novo := regexp_replace(
    v_def,
    '(([A-Za-z_][A-Za-z0-9_]*\.)?ativ_pesquisa\s*,)',
    '\1 \2ativ_gps,'
  );

  if v_novo = v_def then
    raise exception '0297: o regexp_replace nao alterou o texto da view — ancora nao casou de forma inequivoca. Abortado antes de gravar view incompleta.';
  end if;

  execute format('create or replace view cs.contatos_hm_kanban as %s', v_novo);
end $$;

comment on view cs.contatos_hm_kanban is
  '0297: acrescenta ativ_gps a projecao (logo apos ativ_pesquisa) — patch mecanico sobre o corpo vivo (pg_get_viewdef), nao reescrita. O resto das colunas/joins da view fica intacto.';

do $$
declare
  v_coluna_existe int;
  v_view_expoe int;
begin
  select count(*) into v_coluna_existe
    from information_schema.columns
   where table_schema = 'cs' and table_name = 'contatos_hm' and column_name = 'ativ_gps';
  if v_coluna_existe <> 1 then
    raise exception '0297: coluna ativ_gps não foi criada em cs.contatos_hm.';
  end if;

  select count(*) into v_view_expoe
    from information_schema.columns
   where table_schema = 'cs' and table_name = 'contatos_hm_kanban' and column_name = 'ativ_gps';
  if v_view_expoe <> 1 then
    raise exception '0297: cs.contatos_hm_kanban nao esta expondo ativ_gps depois do patch — abortado.';
  end if;

  raise notice '0297: ativ_gps criada em cs.contatos_hm (default false) e exposta por cs.contatos_hm_kanban.';
end $$;
