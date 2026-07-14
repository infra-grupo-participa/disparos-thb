-- =====================================================================
-- 0072_hm_aviso_de_cancelamento_com_dados_do_aluno
-- O aviso de cancelamento no Slack não é um recibo — é uma ordem de serviço.
--
-- Quem lê aquela mensagem é o Thomas, e o que ele precisa fazer é ACHAR a
-- pessoa na área de membros do Searchie/Óbvio, na comunidade THB e no grupo de
-- informes, para tirá-la de lá. Para isso ele precisa dos dados do aluno —
-- nome, e-mail, telefone, turma —, não do número da transação.
--
-- E esses dados têm de vir do SISTEMA (public.compradores + o card), nunca do
-- payload da Hotmart: é justamente no payload que o nome chega sujo (o caso que
-- gerou a 0068 — comprador cadastrado com o próprio telefone no lugar do nome).
-- Mandar o Thomas procurar "+55 (86) 99834-3773" no Searchie seria pedir para a
-- tarefa não ser feita.
--
-- As duas portas do cancelamento (por transação e, na assinatura, por e-mail)
-- passam a devolver nome/e-mail/telefone/turma junto do resultado. O corpo é o
-- mesmo da 0071 — muda só o que sai.
-- Idempotente.
-- =====================================================================

create or replace function cs.fn_hm_cancelar_por_transacao(
  p_transaction text,
  p_evento      text,
  p_status      text
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
    'nome', v_cp.nome, 'email', v_cp.email, 'telefone', v_cp.telefone, 'turma', v_turma
  );
end$function$;

create or replace function cs.fn_hm_cancelar_por_email(p_email text, p_evento text)
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
    'nome', v_cp.nome, 'email', v_cp.email, 'telefone', v_cp.telefone, 'turma', v_turma
  );
end$function$;
