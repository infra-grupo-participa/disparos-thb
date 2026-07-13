-- =====================================================================
-- 0056_hm_campos_da_operacao
-- Traz para o sistema TUDO o que a planilha "HM - T39 CONTROLE DE ATIVAÇÃO"
-- guarda e o card ainda não tinha onde guardar. É a migração da operação, não
-- só do funil: o comercial precisa largar a planilha sem perder informação.
--
-- Mapeamento completo em docs/hm-mapa-planilha.md. O que NÃO vira campo (já vem
-- pronto da Hotmart ou da base): identidade, endereço, turma, canal, oferta de
-- entrada, validade do acesso, sócios, valores da compra.
--
-- Blocos criados:
--   1) ACORDO DO SALDO — o gargalo. Como vai pagar, quando, por qual link,
--      se o link já foi enviado. Hoje isso vive em texto solto na planilha
--      ("12x no boleto", "pagamento agendado 17/07") e some quando a aba fecha.
--   2) TRAVAS — "NÃO ENTRAR EM CONTATO NO MOMENTO" e "REVISAR" são instruções
--      operacionais que o operador PRECISA ver antes de ligar. Viram flags no
--      card, não observação perdida.
--   3) CHECKLIST DE ATIVAÇÃO — Searchie, comunidade THB, grupo de informes e
--      pesquisa. Juntos, eles SÃO a definição de "ativado", e por isso travam a
--      saída de "Acesso Liberado" (decidido com o time).
--   4) CRÉDITO PRÓ-RATA — o que o aluno da base já pagou e ainda não usou. É o
--      que explica por que o saldo dele não é 14.700 (ver 0049).
--   5) CANCELAMENTO — motivo e data, porque "Pediu reembolso?" é SIM/NÃO na
--      planilha e ninguém sabe por quê.
--
-- Aditiva e idempotente.
-- =====================================================================

-- 0) A view abaixo expõe ch.ordem (a ordenação manual dos cards, criada em
-- 0058). Num banco recriado do zero esta migração roda ANTES da 0058, então a
-- coluna é garantida aqui — idempotente, e a 0058 segue sendo a dona da regra
-- (backfill e índice).
alter table cs.contatos_hm add column if not exists ordem integer not null default 0;

-- 1) Acordo do saldo ---------------------------------------------------------
alter table cs.contatos_hm add column if not exists pagamento_meio        text;   -- boleto | cartao | cartao_recorrente | pix | avista
alter table cs.contatos_hm add column if not exists pagamento_previsto_em date;   -- "pagamento agendado 17/07"
alter table cs.contatos_hm add column if not exists acordo                text;   -- o combinado, em texto ("12x no boleto, a partir do dia 15")
alter table cs.contatos_hm add column if not exists oferta_saldo_codigo   text references cs.hm_ofertas_saldo(codigo);
alter table cs.contatos_hm add column if not exists link_saldo_enviado_em timestamptz;

-- 2) Travas operacionais -----------------------------------------------------
alter table cs.contatos_hm add column if not exists nao_contatar        boolean not null default false;
alter table cs.contatos_hm add column if not exists nao_contatar_motivo text;
alter table cs.contatos_hm add column if not exists revisar             boolean not null default false;
alter table cs.contatos_hm add column if not exists revisar_motivo      text;

-- 3) Checklist de ativação ---------------------------------------------------
alter table cs.contatos_hm add column if not exists ativ_searchie   boolean not null default false;
alter table cs.contatos_hm add column if not exists ativ_comunidade boolean not null default false;
alter table cs.contatos_hm add column if not exists ativ_grupo      boolean not null default false;
alter table cs.contatos_hm add column if not exists ativ_pesquisa   boolean not null default false;
-- O grupo muda a cada turma ("THB #25" na aba antiga, "#27" na nova): guardar
-- QUAL grupo, não só se entrou.
alter table cs.contatos_hm add column if not exists grupo_informes  text;
alter table cs.contatos_hm add column if not exists pendencia       text;   -- "O que está pendente para conclusão"

-- 4) Crédito pró-rata (aluno da base) ----------------------------------------
-- Guarda só os INSUMOS; consumido, crédito e saldo são conta (a planilha
-- recalcula na mão e por isso envelhece). Ver cs.fn_hm_prorata abaixo.
alter table cs.contatos_hm add column if not exists credito_oferta      text;     -- "Renovação 2026"
alter table cs.contatos_hm add column if not exists credito_compra_em   date;     -- 19/11/2025
alter table cs.contatos_hm add column if not exists credito_valor_pago  numeric;  -- 3.997
alter table cs.contatos_hm add column if not exists credito_dias_totais integer default 365;

-- 5) Cancelamento ------------------------------------------------------------
alter table cs.contatos_hm add column if not exists cancelamento_em     timestamptz;
alter table cs.contatos_hm add column if not exists cancelamento_motivo text;

-- 6) Etapa "Aguardando Retorno" (decidida com o time) ------------------------
-- É o estado mais comum da planilha — dezenas de alunos que não respondem. Sem
-- coluna própria, o gargalo fica invisível dentro de "Contato Inicial".
insert into cs.estagios (chave, nome, ordem, cor, is_inicial, is_final, ativo, evento, aba) values
  ('hm_aguardando_retorno', 'Aguardando Retorno', 15, '#f59e0b', false, false, true, 'HM', 'comercial')
on conflict (chave) do update set
  nome = excluded.nome, ordem = excluded.ordem, cor = excluded.cor,
  ativo = true, evento = excluded.evento, aba = excluded.aba;

-- 7) Pró-rata: o crédito do tempo não usado ----------------------------------
-- crédito = valor pago × (dias que sobraram ÷ dias totais)
-- saldo   = 14.700 − crédito     (confere na planilha: 14.700 − 1.927,32 = 12.772,68)
create or replace function cs.fn_hm_prorata(p_comprador_id uuid)
returns table (
  dias_usados     integer,
  dias_restantes  integer,
  valor_dia       numeric,
  consumido       numeric,
  credito         numeric,
  saldo_a_pagar   numeric
)
language sql
stable
security definer
set search_path = cs, public, pg_temp
as $fn$
  select
    d.usados,
    greatest(ch.credito_dias_totais - d.usados, 0) as dias_restantes,
    round(ch.credito_valor_pago / nullif(ch.credito_dias_totais, 0), 2) as valor_dia,
    round(ch.credito_valor_pago * least(d.usados, ch.credito_dias_totais)::numeric
          / nullif(ch.credito_dias_totais, 0), 2) as consumido,
    round(ch.credito_valor_pago * greatest(ch.credito_dias_totais - d.usados, 0)::numeric
          / nullif(ch.credito_dias_totais, 0), 2) as credito,
    round(14700 - (ch.credito_valor_pago * greatest(ch.credito_dias_totais - d.usados, 0)::numeric
          / nullif(ch.credito_dias_totais, 0)), 2) as saldo_a_pagar
  from cs.contatos_hm ch
  cross join lateral (
    select greatest((current_date - ch.credito_compra_em), 0) as usados
  ) d
  where ch.comprador_id = p_comprador_id
    and ch.credito_valor_pago is not null
    and ch.credito_compra_em is not null;
$fn$;

grant execute on function cs.fn_hm_prorata(uuid) to disparos_app;

-- 8) A view do kanban expõe os campos que o card precisa mostrar --------------
-- `create or replace` (NUNCA drop): public.vw_aluno_360 — a base de alunos que o
-- GPS consome — depende desta view. Um DROP ... CASCADE derrubaria a base junto.
-- O replace exige que as colunas antigas fiquem intactas e na mesma posição, por
-- isso todo campo novo entra NO FIM da lista.
create or replace view cs.contatos_hm_kanban with (security_invoker = false) as
 select ch.id as contato_hm_id,
    ch.comprador_id,
    cmp.nome,
    cmp.email,
    cmp.telefone,
    ch.turma,
    ch.plano,
    ch.categoria_entrada,
    ch.estagio_id,
    est.chave as estagio_chave,
    est.nome as estagio_nome,
    est.aba as estagio_aba,
    ch.responsavel,
    ch.reuniao_em,
    ch.reuniao_resultado,
    ch.entrevista_em,
    ch.entrevista_resultado,
    ch.pagamento_forma,
    ch.pagamento_parcelas,
    ch.pagamento_em,
    ch.apto_ativacao,
    ch.tags,
    ch.observacoes,
    ch.criado_em,
    ch.atualizado_em,
    -- daqui para baixo, os campos novos (ordem + operação)
    ch.ordem,
    ch.turma_origem,
    ch.pagamento_meio,
    ch.pagamento_previsto_em,
    ch.acordo,
    ch.oferta_saldo_codigo,
    ch.link_saldo_enviado_em,
    ch.nao_contatar,
    ch.nao_contatar_motivo,
    ch.revisar,
    ch.revisar_motivo,
    ch.ativ_searchie,
    ch.ativ_comunidade,
    ch.ativ_grupo,
    ch.ativ_pesquisa,
    ch.grupo_informes,
    ch.pendencia,
    ch.cancelamento_em,
    ch.cancelamento_motivo
   from cs.contatos_hm ch
     join public.compradores cmp on cmp.id = ch.comprador_id
     left join cs.estagios est on est.id = ch.estagio_id;

grant select on cs.contatos_hm_kanban to disparos_app;
