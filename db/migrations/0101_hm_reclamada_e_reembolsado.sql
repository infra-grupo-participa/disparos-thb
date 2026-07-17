-- =====================================================================
-- 0101_hm_reclamada_e_reembolsado
--
-- SEPARAR O PEDIDO DO FATO no cancelamento — cada coluna do kanban reflete o
-- status do sistema principal (grupoparticipa.app.br).
--
--   Reclamada   = o cliente PEDIU o cancelamento (a equipe informando). Aluno
--                 continua ativo — pode voltar atrás. (renomeia hm_cancelamento)
--   Reembolsado = o reembolso foi CONFIRMADO e executado na Hotmart (ou a
--                 confirmação manual do time). O aluno é marcado como cancelado.
--                 (novo estágio hm_reembolsado)
--
-- Antes tudo caía em "Solicitou Cancelamento". O webhook da Hotmart (o fato)
-- passa a mover para "Reembolsado"; o pedido manual continua em "Reclamada".
-- Idempotente.
-- =====================================================================

-- 1) Renomeia o estágio do PEDIDO ------------------------------------------
update cs.estagios set nome = 'Reclamada'
 where evento = 'HM' and chave = 'hm_cancelamento';

-- 2) Cria o estágio do FATO (reembolso confirmado) -------------------------
insert into cs.estagios (chave, nome, aba, ordem, cor, evento, ativo)
select 'hm_reembolsado', 'Reembolsado', 'comercial', 55, '#9f1239', 'HM', true
 where not exists (select 1 from cs.estagios where evento = 'HM' and chave = 'hm_reembolsado');

-- 3) O webhook da Hotmart passa a mover para "Reembolsado" ------------------
-- (o fato: PURCHASE_REFUNDED/CHARGEBACK/PROTEST/CANCELED confirmado na Hotmart)
create or replace function cs.fn_hm_cancelar_por_transacao(p_transaction text, p_evento text, p_status text, p_ocorrido_em timestamptz default null)
returns jsonb
language plpgsql
security definer
set search_path to 'cs', 'public', 'pg_temp'
as $fn$
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
     set status = p_status, hotmart_event = p_evento, atualizado_em = now()
   where hotmart_transaction = p_transaction
  returning comprador_id into v_comprador_id;

  if v_comprador_id is null then
    return jsonb_build_object('achou_compra', false);
  end if;

  select * into v_cp from public.compradores where id = v_comprador_id;
  select ch.id, ch.estagio_id, ch.turma into v_card_id, v_estagio_ant, v_turma
    from cs.contatos_hm ch where ch.comprador_id = v_comprador_id;

  if v_card_id is null then
    return jsonb_build_object('achou_compra', true, 'tem_card_hm', false, 'comprador_id', v_comprador_id);
  end if;

  v_motivo    := 'Cancelado na Hotmart (' || p_evento || ')';
  v_resultado := cs.fn_hm_cancelar(v_comprador_id, v_motivo, 'hotmart');

  update cs.contatos_hm
     set hotmart_cancelado_em = v_quando, hotmart_cancelamento_evento = p_evento,
         hotmart_cancelamento_transacao = p_transaction, atualizado_em = now()
   where id = v_card_id;

  -- O FATO confirmado na Hotmart move para "Reembolsado" (antes: Solicitou Cancelamento).
  select id into v_estagio_id from cs.estagios where chave = 'hm_reembolsado' and evento = 'HM';
  if v_estagio_id is not null and v_estagio_ant is distinct from v_estagio_id then
    update cs.contatos_hm set estagio_id = v_estagio_id, atualizado_em = now() where id = v_card_id;
    insert into cs.interacoes (contato_hm_id, tipo, descricao, autor, estagio_anterior_id, estagio_novo_id)
    values (v_card_id, 'mudanca_estagio', 'Movido para "Reembolsado" — cancelamento confirmado na Hotmart',
            'hotmart', v_estagio_ant, v_estagio_id);
  end if;

  insert into cs.interacoes (contato_hm_id, tipo, descricao, autor)
  values (v_card_id, 'sistema',
    case v_resultado
      when 'cancelado' then v_motivo || ' — aluno marcado como cancelado na base THB. Remover os acessos.'
      else v_motivo || ' — o contato ainda não era aluno; nada a remover na base.'
    end, 'hotmart');

  return jsonb_build_object('achou_compra', true, 'tem_card_hm', true,
    'comprador_id', v_comprador_id, 'resultado', v_resultado,
    'nome', v_cp.nome, 'email', v_cp.email, 'telefone', v_cp.telefone, 'turma', v_turma,
    'hotmart_cancelado_em', v_quando);
end$fn$;

create or replace function cs.fn_hm_cancelar_por_email(p_email text, p_evento text, p_ocorrido_em timestamptz default null)
returns jsonb
language plpgsql
security definer
set search_path to 'cs', 'public', 'pg_temp'
as $fn$
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
  select * into v_cp from public.compradores
   where lower(btrim(email)) = lower(btrim(p_email)) limit 1;
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

  update cs.contatos_hm
     set hotmart_cancelado_em = v_quando, hotmart_cancelamento_evento = p_evento,
         hotmart_cancelamento_transacao = null, atualizado_em = now()
   where id = v_card_id;

  select id into v_estagio_id from cs.estagios where chave = 'hm_reembolsado' and evento = 'HM';
  if v_estagio_id is not null and v_estagio_ant is distinct from v_estagio_id then
    update cs.contatos_hm set estagio_id = v_estagio_id, atualizado_em = now() where id = v_card_id;
    insert into cs.interacoes (contato_hm_id, tipo, descricao, autor, estagio_anterior_id, estagio_novo_id)
    values (v_card_id, 'mudanca_estagio', 'Movido para "Reembolsado" — assinatura cancelada na Hotmart',
            'hotmart', v_estagio_ant, v_estagio_id);
  end if;

  insert into cs.interacoes (contato_hm_id, tipo, descricao, autor)
  values (v_card_id, 'sistema',
    case v_resultado
      when 'cancelado' then v_motivo || ' — aluno marcado como cancelado na base THB. Remover os acessos.'
      else v_motivo || ' — o contato ainda não era aluno; nada a remover na base.'
    end, 'hotmart');

  return jsonb_build_object('achou_comprador', true, 'tem_card_hm', true,
    'comprador_id', v_comprador_id, 'resultado', v_resultado,
    'nome', v_cp.nome, 'email', v_cp.email, 'telefone', v_cp.telefone, 'turma', v_turma,
    'hotmart_cancelado_em', v_quando);
end$fn$;
