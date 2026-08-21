-- =====================================================================
-- 0307_a_reuniao_finalizada_termina_com_uma_data
--
-- ── O problema medido (não suposto) ─────────────────────────────────────
-- A trava atual de entrada em "Reunião Finalizada" (cs.fn_hm_pode_finalizar_
-- reuniao, 0284) aceita 3 desfechos alternativos, e um deles é `acordo`
-- TEXTO LIVRE não-vazio. `acordo` virou diário de bordo ("quer boleto
-- parcelado", "vou conversar com ela hoje"). Medido em produção: 54 cards
-- passaram por esse atalho com `pagamento_previsto_em` NULL. Resultado: R$
-- 625k parados em "Reunião Finalizada" sem data, e no board financeiro 147
-- cards sem data (R$ 3,2 mi) contra 1 único com prazo futuro. `intencao_
-- pagamento` está morta (17 de 305 = 5,6%) porque o atalho a dispensa.
--
-- ── Decisão do Marcio ────────────────────────────────────────────────────
-- Trava = PRAZO SEMPRE, data de pagamento só quando houver promessa. Duas
-- trilhas, sem meio-termo de texto livre:
--   [A] PROMETEU     — intencao_pagamento='vai_pagar' + pagamento_previsto_em
--                       + pagamento_meio + observação.
--   [B] NÃO PROMETEU — reuniao_motivo_tipo (lista fechada) + reuniao_
--                       retomar_em + observação.
--   ESCAPE mantido: quem JÁ TEM pagamento registrado passa (fato consumado)
--                       — a 3ª saída da 0284, que não muda.
-- Sem backfill, sem trava retroativa — só entrada, igual 0284/0306. Data no
-- passado: aceita até 7 dias atrás, recusa além (cobre reunião de sexta
-- lançada na segunda; barra nascer vencido de 30 dias) — a checagem de data
-- vive na 0308 (função), não aqui (esta migration só é schema).
--
-- ── Por que NÃO existe `pagamento_forma` nesta migration ────────────────
-- Medido no banco: `pagamento_meio` já existe (0056), já é editável (NÃO
-- está sob a trava `pagamento_so_hotmart` — só pagamento_forma/marcar_
-- pagamento/valor_total/valor_pago estão), já é lido pelo financeiro, e tem
-- 58 cards preenchidos com o vocabulário certo (cartao/boleto/pix/avista/
-- cartao_recorrente). É a mesma pergunta com outro nome — reusado, não
-- duplicado.
--
-- ── As DUAS colunas novas ───────────────────────────────────────────────
--   reuniao_motivo_tipo — irmã de cancelamento_motivo_tipo (0306): lista
--     fechada, para relatório (texto puro não soma).
--   reuniao_retomar_em  — a data de VOLTAR A FALAR com quem não prometeu
--     pagar. NUNCA é cobrança (ver o comment on column, abaixo).
-- Reusadas (não criadas aqui): intencao_pagamento, pagamento_previsto_em,
-- pagamento_meio, intencao_pagamento_obs — já existem desde 0281/0056.
--
-- Aditiva e idempotente (add column if not exists).
-- =====================================================================

alter table cs.contatos_hm
  add column if not exists reuniao_motivo_tipo text,
  add column if not exists reuniao_retomar_em date;

alter table cs.contatos_hm
  drop constraint if exists contatos_hm_reuniao_motivo_tipo_check;

alter table cs.contatos_hm
  add constraint contatos_hm_reuniao_motivo_tipo_check
  check (reuniao_motivo_tipo is null or reuniao_motivo_tipo in (
    'quer_parcelar', 'vai_ver_contrato', 'sem_condicao_agora', 'indeciso', 'outro'
  ));

comment on column cs.contatos_hm.reuniao_motivo_tipo is
  '0307: por que a pessoa NÃO prometeu pagar na reunião — CATEGORIZADO (lista fechada, irmã de cancelamento_motivo_tipo/0306, para relatório — texto puro não soma). Trilha [B] da trava de entrada em "Reunião Finalizada" (cs.fn_hm_pode_finalizar_reuniao, 0308): exigido junto com reuniao_retomar_em e uma observação quando NÃO há intencao_pagamento=vai_pagar nem pagamento já registrado. Convive com intencao_pagamento_obs (texto livre, a observação do que foi combinado).';

comment on column cs.contatos_hm.reuniao_retomar_em is
  '0307: a data de VOLTAR A FALAR com quem não prometeu pagar na reunião (trilha [B] da trava, 0308). NÃO é data de cobrança — o financeiro não lê esta coluna. Cobrança é `pagamento_previsto_em`.';

-- fn_hm_undo_colunas (0140, reescrita em 0281): "desfazer edição" da ficha
-- cobre os campos editáveis pelo PATCH. Verificado ANTES de reescrever (a
-- 0281:81-85 avisa que a função pode ter sido alterada direto em produção):
-- `select pg_get_functiondef('cs.fn_hm_undo_colunas()'::regprocedure)`
-- devolveu um array com `ativ_gps` (0297/0298, que a 0281 versionada não
-- tinha) MAS SEM `cancelamento_motivo_tipo`/`cancelamento_prazo` (0306) — a
-- 0306 nunca reescreveu esta função, então o "desfazer edição" está mudo
-- para esses dois campos desde 18/08. Corrigido aqui, junto com os dois
-- novos: entram os 4 campos que faltavam (2 de cancelamento + 2 desta
-- migration), preservando `ativ_gps` e todo o resto do array vigente.
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
    'intencao_pagamento','intencao_pagamento_em','intencao_pagamento_obs',
    'cancelamento_motivo_tipo','cancelamento_prazo',
    'reuniao_motivo_tipo','reuniao_retomar_em'
  ]::text[];
$function$;

comment on function cs.fn_hm_undo_colunas() is
  '0307: acrescenta reuniao_motivo_tipo/reuniao_retomar_em ao snapshot do "desfazer edição". De brinde, corrige um esquecimento da 0306: cancelamento_motivo_tipo/cancelamento_prazo tinham ficado fora do array em produção (a 0306 nunca reescreveu esta função) — entram junto. Base vigente confirmada por pg_get_functiondef antes de reescrever (inclui ativ_gps/0297, que a versão da 0281 no repo não tinha).';
