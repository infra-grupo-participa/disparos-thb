-- =====================================================================
-- 0091_cancelamento_confirmado_pela_hotmart
--
-- "O ALUNO CANCELOU MESMO?" — HOJE NÃO DÁ PARA RESPONDER.
--
-- O cancelamento tem duas verdades diferentes, e elas dividem o mesmo campo:
--
--   cancelamento_efetivado_em + cancelamento_origem
--
-- Quem escreve ali é quem chegar primeiro — e escreve com COALESCE (0071:101-102):
--
--   cancelamento_efetivado_em = coalesce(cancelamento_efetivado_em, now())
--   cancelamento_origem       = coalesce(cancelamento_origem, p_origem)
--
-- Consequência: o comercial confirma à mão ("o reembolso saiu, pode marcar"), e
-- quando o reembolso DE FATO cai na Hotmart, dias depois, o webhook não muda
-- nada — a origem continua 'manual' e a data continua a do palpite humano. O
-- fato da Hotmart fica INVISÍVEL. E se o comercial se enganou (o reembolso nunca
-- saiu), ninguém descobre: o card diz "cancelado" para sempre.
--
-- Aqui a Hotmart ganha campo próprio. Só o webhook escreve nele. Assim as duas
-- verdades convivem e podem ser comparadas:
--
--   cancelamento_em            → o aluno PEDIU
--   cancelamento_efetivado_em  → NÓS confirmamos (à mão ou pela Hotmart)
--   hotmart_cancelado_em       → a HOTMART devolveu o dinheiro. Isto é o fato.
--
-- Idempotente.
-- =====================================================================

-- ----- 1) O fato, vindo da fonte --------------------------------------
alter table cs.contatos_hm add column if not exists hotmart_cancelado_em           timestamptz;
alter table cs.contatos_hm add column if not exists hotmart_cancelamento_evento    text;
alter table cs.contatos_hm add column if not exists hotmart_cancelamento_transacao text;

comment on column cs.contatos_hm.hotmart_cancelado_em is
  'Quando a HOTMART confirmou o cancelamento (data do evento no webhook). Só o webhook escreve. Diferente de cancelamento_efetivado_em, que aceita confirmação à mão.';
comment on column cs.contatos_hm.hotmart_cancelamento_evento is
  'Qual evento confirmou: PURCHASE_REFUNDED | PURCHASE_CHARGEBACK | PURCHASE_PROTEST | PURCHASE_CANCELED | SUBSCRIPTION_CANCELLATION. Reembolso e chargeback são coisas MUITO diferentes para o financeiro.';
comment on column cs.contatos_hm.hotmart_cancelamento_transacao is
  'A transação reembolsada. Nula no cancelamento de assinatura, que não fala de compra nenhuma (casa por e-mail).';

create index if not exists ix_hm_hotmart_cancelado
  on cs.contatos_hm (hotmart_cancelado_em) where hotmart_cancelado_em is not null;

-- ----- 2) As portas do webhook passam a carimbar o fato ----------------
-- A assinatura muda (ganha p_ocorrido_em), e mudar assinatura não é `replace` —
-- criaria uma sobrecarga, e o PostgREST recusa chamar função ambígua. Por isso
-- DROP + CREATE. O parâmetro tem DEFAULT: o webhook antigo, que ainda não manda
-- a data, continua funcionando enquanto o deploy da edge function não sai.
drop function if exists public.fn_hm_cancelar_por_transacao(text, text, text);
drop function if exists public.fn_hm_cancelar_por_email(text, text);
drop function if exists cs.fn_hm_cancelar_por_transacao(text, text, text);
drop function if exists cs.fn_hm_cancelar_por_email(text, text);

create or replace function cs.fn_hm_cancelar_por_transacao(
  p_transaction text,
  p_evento      text,
  p_status      text,
  p_ocorrido_em timestamptz default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'cs', 'public', 'pg_temp'
as $function$
declare
  v_comprador_id uuid;
  v_card_id      uuid;
  v_estagio_id   smallint;
  v_estagio_ant  smallint;
  v_resultado    text;
  v_motivo       text;
  v_cp           public.compradores%rowtype;
  v_turma        text;
  v_quando       timestamptz := coalesce(p_ocorrido_em, now());
begin
  update public.compras
     set status        = p_status,
         hotmart_event = p_evento,
         atualizado_em = now()
   where hotmart_transaction = p_transaction
  returning comprador_id into v_comprador_id;

  if v_comprador_id is null then
    return jsonb_build_object('achou_compra', false);
  end if;

  select * into v_cp from public.compradores where id = v_comprador_id;

  select ch.id, ch.estagio_id, ch.turma into v_card_id, v_estagio_ant, v_turma
    from cs.contatos_hm ch where ch.comprador_id = v_comprador_id;

  if v_card_id is null then
    -- Compra de outro canal (HT, Clínica…): o status já foi corrigido, e é isso
    -- que o canal precisa. Não há esteira de HM para mexer.
    return jsonb_build_object('achou_compra', true, 'tem_card_hm', false, 'comprador_id', v_comprador_id);
  end if;

  v_motivo    := 'Cancelado na Hotmart (' || p_evento || ')';
  v_resultado := cs.fn_hm_cancelar(v_comprador_id, v_motivo, 'hotmart');

  -- O FATO. Sem coalesce, de propósito: aqui não há palpite a preservar — é a
  -- Hotmart falando. Se o card já tinha sido confirmado à mão, esta linha é a
  -- única prova de que o dinheiro voltou de verdade. Chegando outro evento
  -- depois (um chargeback em cima de um reembolso), o último é o que vale: é o
  -- estado atual da compra na Hotmart.
  update cs.contatos_hm
     set hotmart_cancelado_em           = v_quando,
         hotmart_cancelamento_evento    = p_evento,
         hotmart_cancelamento_transacao = p_transaction,
         atualizado_em                  = now()
   where id = v_card_id;

  select id into v_estagio_id from cs.estagios where chave = 'hm_cancelamento' and evento = 'HM';
  if v_estagio_id is not null and v_estagio_ant is distinct from v_estagio_id then
    update cs.contatos_hm set estagio_id = v_estagio_id, atualizado_em = now() where id = v_card_id;
    insert into cs.interacoes (contato_hm_id, tipo, descricao, autor, estagio_anterior_id, estagio_novo_id)
    values (v_card_id, 'mudanca_estagio', 'Movido para "Solicitou Cancelamento" pelo cancelamento na Hotmart',
            'hotmart', v_estagio_ant, v_estagio_id);
  end if;

  insert into cs.interacoes (contato_hm_id, tipo, descricao, autor)
  values (
    v_card_id, 'sistema',
    case v_resultado
      when 'cancelado' then v_motivo || ' — aluno marcado como cancelado na base THB. Remover os acessos.'
      else v_motivo || ' — o contato ainda não era aluno; nada a remover na base.'
    end,
    'hotmart'
  );

  return jsonb_build_object(
    'achou_compra', true, 'tem_card_hm', true,
    'comprador_id', v_comprador_id, 'resultado', v_resultado,
    'nome', v_cp.nome, 'email', v_cp.email, 'telefone', v_cp.telefone, 'turma', v_turma,
    'hotmart_cancelado_em', v_quando
  );
end$function$;

create or replace function cs.fn_hm_cancelar_por_email(
  p_email       text,
  p_evento      text,
  p_ocorrido_em timestamptz default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'cs', 'public', 'pg_temp'
as $function$
declare
  v_comprador_id uuid;
  v_card_id      uuid;
  v_estagio_id   smallint;
  v_estagio_ant  smallint;
  v_resultado    text;
  v_motivo       text;
  v_cp           public.compradores%rowtype;
  v_turma        text;
  v_quando       timestamptz := coalesce(p_ocorrido_em, now());
begin
  select * into v_cp
    from public.compradores
   where lower(btrim(email)) = lower(btrim(p_email))
   limit 1;

  if not found then
    return jsonb_build_object('achou_comprador', false);
  end if;
  v_comprador_id := v_cp.id;

  select ch.id, ch.estagio_id, ch.turma into v_card_id, v_estagio_ant, v_turma
    from cs.contatos_hm ch where ch.comprador_id = v_comprador_id;

  if v_card_id is null then
    return jsonb_build_object('achou_comprador', true, 'tem_card_hm', false, 'comprador_id', v_comprador_id);
  end if;

  v_motivo    := 'Assinatura cancelada na Hotmart (' || p_evento || ')';
  v_resultado := cs.fn_hm_cancelar(v_comprador_id, v_motivo, 'hotmart');

  -- Sem transação: a assinatura cancelada não desfaz compra nenhuma. O fato
  -- ainda é da Hotmart, e é isso que fica registrado.
  update cs.contatos_hm
     set hotmart_cancelado_em           = v_quando,
         hotmart_cancelamento_evento    = p_evento,
         hotmart_cancelamento_transacao = null,
         atualizado_em                  = now()
   where id = v_card_id;

  select id into v_estagio_id from cs.estagios where chave = 'hm_cancelamento' and evento = 'HM';
  if v_estagio_id is not null and v_estagio_ant is distinct from v_estagio_id then
    update cs.contatos_hm set estagio_id = v_estagio_id, atualizado_em = now() where id = v_card_id;
    insert into cs.interacoes (contato_hm_id, tipo, descricao, autor, estagio_anterior_id, estagio_novo_id)
    values (v_card_id, 'mudanca_estagio', 'Movido para "Solicitou Cancelamento" pelo cancelamento da assinatura na Hotmart',
            'hotmart', v_estagio_ant, v_estagio_id);
  end if;

  insert into cs.interacoes (contato_hm_id, tipo, descricao, autor)
  values (
    v_card_id, 'sistema',
    case v_resultado
      when 'cancelado' then v_motivo || ' — aluno marcado como cancelado na base THB. Remover os acessos.'
      else v_motivo || ' — o contato ainda não era aluno; nada a remover na base.'
    end,
    'hotmart'
  );

  return jsonb_build_object(
    'achou_comprador', true, 'tem_card_hm', true,
    'comprador_id', v_comprador_id, 'resultado', v_resultado,
    'nome', v_cp.nome, 'email', v_cp.email, 'telefone', v_cp.telefone, 'turma', v_turma,
    'hotmart_cancelado_em', v_quando
  );
end$function$;

-- Portas públicas (o webhook fala com o PostgREST, que só enxerga `public`).
create or replace function public.fn_hm_cancelar_por_transacao(
  p_transaction text,
  p_evento      text,
  p_status      text,
  p_ocorrido_em timestamptz default null
)
returns jsonb
language sql
security definer
set search_path to 'cs', 'public', 'pg_temp'
as $function$
  select cs.fn_hm_cancelar_por_transacao(p_transaction, p_evento, p_status, p_ocorrido_em);
$function$;

create or replace function public.fn_hm_cancelar_por_email(
  p_email       text,
  p_evento      text,
  p_ocorrido_em timestamptz default null
)
returns jsonb
language sql
security definer
set search_path to 'cs', 'public', 'pg_temp'
as $function$
  select cs.fn_hm_cancelar_por_email(p_email, p_evento, p_ocorrido_em);
$function$;

revoke all on function public.fn_hm_cancelar_por_transacao(text, text, text, timestamptz) from public, anon, authenticated;
revoke all on function public.fn_hm_cancelar_por_email(text, text, timestamptz)            from public, anon, authenticated;
grant execute on function public.fn_hm_cancelar_por_transacao(text, text, text, timestamptz) to service_role;
grant execute on function public.fn_hm_cancelar_por_email(text, text, timestamptz)            to service_role;

-- ----- 3) A view mostra o fato ----------------------------------------
-- `create or replace view` não deixa reordenar nem remover coluna: o que é novo
-- entra no FIM. (Recriar do zero quebraria vw_aluno_360 e vw_alunos_cancelados,
-- que dependem desta.)
create or replace view cs.contatos_hm_kanban as
 SELECT ch.id AS contato_hm_id,
    ch.comprador_id,
    cmp.nome,
    cmp.email,
    cmp.telefone,
    ch.turma,
    ch.plano,
    ch.categoria_entrada,
    ch.estagio_id,
    est.chave AS estagio_chave,
    est.nome AS estagio_nome,
    est.aba AS estagio_aba,
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
    ch.cancelamento_motivo,
    ch.link_facebook,
    s.pago_em AS sinal_pago_em,
    s.valor AS sinal_valor,
    ch.cancelamento_efetivado_em,
    ch.cancelamento_origem,
    ch.rev_searchie,
    ch.rev_comunidade,
    ch.rev_grupo,
    ch.rev_pesquisa,
    ch.acessos_revogados_em,
    ch.acessos_revogados_por,
    ch.aluno_id,
    ch.cancelamento_efetivado_em IS NOT NULL AND ch.acessos_revogados_em IS NULL AS acessos_a_remover,
    -- ----- novo (0091): o cancelamento pelos olhos da Hotmart -----
    ch.hotmart_cancelado_em,
    ch.hotmart_cancelamento_evento,
    ch.hotmart_cancelamento_transacao,
    ch.hotmart_cancelado_em IS NOT NULL AS cancelado_na_hotmart,
    -- Confirmamos à mão e a Hotmart NUNCA confirmou. Ou o reembolso ainda não
    -- saiu, ou o comercial se enganou. Em ambos os casos alguém precisa olhar:
    -- o aluno está sem acesso e o dinheiro pode não ter voltado.
    (ch.cancelamento_efetivado_em IS NOT NULL AND ch.hotmart_cancelado_em IS NULL) AS cancelado_sem_confirmacao_hotmart
   FROM cs.contatos_hm ch
     JOIN compradores cmp ON cmp.id = ch.comprador_id
     LEFT JOIN cs.estagios est ON est.id = ch.estagio_id
     LEFT JOIN LATERAL ( SELECT COALESCE(c.data_compra, c.data_aprovacao) AS pago_em,
            c.preco AS valor
           FROM compras c
             JOIN hm_product_catalog cat ON cat.offer_code = c.oferta_codigo::text
          WHERE c.comprador_id = ch.comprador_id AND cat.categoria = 'sinal'::text AND (c.status::text = ANY (ARRAY['APPROVED'::character varying::text, 'COMPLETE'::character varying::text, 'COMPLETED'::character varying::text]))
          ORDER BY (COALESCE(c.data_compra, c.data_aprovacao))
         LIMIT 1) s ON true;

-- ----- 4) Backfill do que já aconteceu --------------------------------
-- Os cancelamentos que JÁ vieram da Hotmart (origem='hotmart') são fato, mesmo
-- tendo sido gravados antes destas colunas existirem. A data que temos é a do
-- processamento (cancelamento_efetivado_em) e o evento está escrito no motivo
-- ("Cancelado na Hotmart (PURCHASE_REFUNDED)") — de onde o extraímos.
--
-- Cancelamentos de origem 'manual' NÃO são backfillados: é justamente deles que
-- não sabemos se a Hotmart confirmou. Ficam visíveis em
-- `cancelado_sem_confirmacao_hotmart`, que é a pergunta que o time precisa fazer.
update cs.contatos_hm
   set hotmart_cancelado_em        = cancelamento_efetivado_em,
       hotmart_cancelamento_evento = coalesce(
         substring(cancelamento_motivo from '\(([A-Z_]+)\)'),
         'PURCHASE_REFUNDED'
       )
 where cancelamento_origem = 'hotmart'
   and cancelamento_efetivado_em is not null
   and hotmart_cancelado_em is null;
