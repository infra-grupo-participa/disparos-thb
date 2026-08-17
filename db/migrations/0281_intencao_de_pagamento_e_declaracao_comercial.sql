-- =====================================================================
-- 0281_intencao_de_pagamento_e_declaracao_comercial
--
-- D2 (decisão do Marcio): a reunião comercial termina com um desfecho —
-- "vai pagar", "tá indeciso" ou "não vai pagar". A trava da Reunião
-- Finalizada (0284, próxima migration) exige esse desfecho para deixar o
-- card sair da etapa: `vai_pagar` OU `indeciso` liberam; só `nao_vai_pagar`
-- barra. O campo `acordo` (texto livre, já existente desde a 0056) também
-- libera sozinho — é outra forma de desfecho comercial, mais antiga.
--
-- `intencao_pagamento` é DECLARAÇÃO COMERCIAL — irmã de `acordo`, não dado
-- de pagamento. Dados de transação (valor, forma, parcelas) só entram pela
-- Hotmart (decisão do Marcio, 30/07) — a rota já recusa
-- `marcar_pagamento`/`pagamento_forma`/`valor_total`/`valor_pago` com
-- `pagamento_so_hotmart` (app/api/hm/contato/[id]/route.ts). Este campo NÃO
-- é uma porta lateral para esse dado: ele registra o que o comercial ACHA
-- que vai acontecer, não o que aconteceu. Ninguém "marca como pago" por
-- aqui — quem faz isso continua sendo só o webhook da Hotmart.
--
-- `intencao_pagamento_em`: quando a declaração foi registrada (carimbo do
-- servidor, como `contato_inicial_em`/`pagamento_previsto_em`).
-- `intencao_pagamento_obs`: o porquê em texto livre — "disse que só paga
-- mês que vem", "quer conversar com o sócio antes" — mesmo padrão de
-- `credito_obs`/`cancelamento_motivo`, que já existem na ficha.
--
-- Aditiva e idempotente.
-- =====================================================================

alter table cs.contatos_hm
  add column if not exists intencao_pagamento text,
  add column if not exists intencao_pagamento_em timestamptz,
  add column if not exists intencao_pagamento_obs text;

do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'cs.contatos_hm'::regclass
       and conname = 'contatos_hm_intencao_pagamento_check'
  ) then
    alter table cs.contatos_hm
      add constraint contatos_hm_intencao_pagamento_check
      check (intencao_pagamento is null or intencao_pagamento in ('vai_pagar', 'indeciso', 'nao_vai_pagar'));
  end if;
end $$;

comment on column cs.contatos_hm.intencao_pagamento is
  '0281: declaracao comercial do desfecho da reuniao (vai_pagar/indeciso/nao_vai_pagar) — irma de `acordo`, NAO e dado de pagamento. Usada por cs.fn_hm_pode_finalizar_reuniao (0284): vai_pagar/indeciso liberam a saida da Reuniao Finalizada, nao_vai_pagar barra. Nunca aceitar como rota lateral para transacao — essa continua restrita a pagamento_so_hotmart.';
comment on column cs.contatos_hm.intencao_pagamento_em is
  '0281: quando a declaracao de intencao_pagamento foi registrada.';
comment on column cs.contatos_hm.intencao_pagamento_obs is
  '0281: o porque da intencao, texto livre do comercial (mesmo padrao de credito_obs/cancelamento_motivo).';

-- fn_hm_undo_colunas (0140): "desfazer edição" da ficha cobre os campos
-- editáveis pelo PATCH — intencao_pagamento é um deles (B6). Reescrita
-- mecânica: acrescenta os 3 campos novos ao array existente, sem tocar no
-- resto (o corpo vigente é o da 0140, confirmado por grep no repo — nenhuma
-- migration posterior reescreveu esta função).
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
    'ativ_searchie','ativ_comunidade','ativ_grupo','ativ_pesquisa','grupo_informes','pendencia',
    'cancelamento_motivo','link_facebook',
    'rev_searchie','rev_comunidade','rev_grupo','rev_pesquisa',
    'credito_oferta','credito_valor_pago','credito_dias_totais','credito_compra_em',
    'valor_total','valor_pago','pagamento_em','cancelamento_em','tags',
    'intencao_pagamento','intencao_pagamento_em','intencao_pagamento_obs'
  ]::text[];
$function$;

comment on function cs.fn_hm_undo_colunas() is
  '0281: acrescenta intencao_pagamento/intencao_pagamento_em/intencao_pagamento_obs ao snapshot do "desfazer edição" (0140 é a base vigente — nenhuma migration entre 0140 e esta reescreveu a função).';

-- ⚠️ Verificar contra o banco vivo antes de aplicar: se `fn_hm_undo_colunas`
-- tiver sido alterada direto em produção desde a 0140 (a regra de ouro deste
-- repo avisa que isso acontece), este `create or replace` PERDE a mudança
-- não commitada. Rodar `select pg_get_functiondef('cs.fn_hm_undo_colunas'::regclass)`
-- e comparar com o array acima antes de aplicar esta migration.
