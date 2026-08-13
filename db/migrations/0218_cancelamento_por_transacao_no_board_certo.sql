-- =====================================================================
-- 0218_cancelamento_por_transacao_no_board_certo
--
-- O BURACO — achado na auditoria de 12/08/2026 (pedido do Marcio, item C):
-- "se ele solicitou o pedido e reembolsado, ou solicitou na Hotmart, a gente
-- tem que finalizar isso aí" — mas `cs.fn_hm_cancelar_por_transacao` (o
-- caminho que o webhook chama para PURCHASE_REFUNDED/CHARGEBACK/PROTEST/
-- CANCELED, ou seja, o FATO confirmado na Hotmart) nunca recebeu o mesmo
-- conserto que a 0196 deu à irmã dela, `fn_hm_cancelar_por_email`:
--
--   select ch.id, ch.estagio_id, ch.turma into v_card_id, v_estagio_ant, v_turma
--     from cs.contatos_hm ch where ch.comprador_id = v_comprador_id;
--
-- SEM `and ch.produto = ...` e SEM `order by ... limit 1`. Desde a 0163 (card
-- por pessoa × produto) uma pessoa pode ter card no HM E no AURUM — hoje 15
-- pessoas, de 275+35. Um `select ... into` sem STRICT em PL/pgSQL não erra com
-- mais de uma linha: pega uma delas, em ordem que o planner escolhe, sem
-- avisar ninguém. Um reembolso do AURUM podia cancelar o card do HM da mesma
-- pessoa (ou vice-versa) — apagando a esteira ativa de um board e escondendo
-- a dívida real do outro. É a MESMA classe de bug que a 0196 fechou em
-- `fn_hm_cancelar_por_email`; só que aquele caminho (SUBSCRIPTION_CANCELLATION,
-- sem transação) tinha sido corrigido e este (com transação) ficou para trás.
--
-- A DIFERENÇA que permite fazer MELHOR que o caminho por e-mail: aqui HÁ uma
-- transação, e a transação tem oferta e produto_id — dá para saber de qual
-- board é o cancelamento (cs.fn_hm_produto_da_oferta, a mesma cadeia canal →
-- produto Hotmart → HM que a 0196/0197 já usam em todo lugar), em vez de só
-- alertar e esperar decisão humana. Só quando o produto resolvido não bate
-- com NENHUM card da pessoa é que o alerta `cancelamento_ambiguo` entra —
-- sinal de que algo está errado nos dados (produto sem card correspondente),
-- não um "escolhe um e reza".
--
-- Idempotente. Não reescreve nenhum cancelamento já processado.
-- =====================================================================

begin;

create or replace function cs.fn_hm_cancelar_por_transacao(p_transaction text, p_evento text, p_status text, p_ocorrido_em timestamptz default null)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'cs', 'public', 'pg_temp'
as $function$
declare
  v_comprador_id uuid;
  v_oferta       text;
  v_produto_id   text;
  v_produto      text;
  v_card_id      uuid;
  v_estagio_id   smallint;
  v_estagio_ant  smallint;
  v_resultado    text;
  v_motivo       text;
  v_cp           public.compradores%rowtype;
  v_turma        text;
  v_cards        int;
  v_quando       timestamptz := coalesce(p_ocorrido_em, now());
begin
  update public.compras
     set status = p_status, hotmart_event = p_evento, atualizado_em = now()
   where hotmart_transaction = p_transaction
  returning comprador_id, oferta_codigo, produto_id
    into v_comprador_id, v_oferta, v_produto_id;

  if v_comprador_id is null then
    return jsonb_build_object('achou_compra', false);
  end if;

  select * into v_cp from public.compradores where id = v_comprador_id;
  select count(*) into v_cards from cs.contatos_hm where comprador_id = v_comprador_id;

  if v_cards = 0 then
    return jsonb_build_object('achou_compra', true, 'tem_card_hm', false, 'comprador_id', v_comprador_id);
  end if;

  -- De qual board é ESTA transação — mesma cadeia da 0195/0196 (canal
  -- declarado → produto da Hotmart → HM como último recurso).
  v_produto := cs.fn_hm_produto_da_oferta(v_oferta, v_produto_id);

  select ch.id, ch.estagio_id, ch.turma into v_card_id, v_estagio_ant, v_turma
    from cs.contatos_hm ch
   where ch.comprador_id = v_comprador_id and ch.produto = v_produto
   order by ch.criado_em asc
   limit 1;

  -- Card único: segue valendo mesmo se, por algum motivo, o produto resolvido
  -- não bater com o cravado no card (dado legado) — é o mesmo comportamento
  -- de antes desta migration para quem só tem um board.
  if v_card_id is null and v_cards = 1 then
    select ch.id, ch.estagio_id, ch.turma into v_card_id, v_estagio_ant, v_turma
      from cs.contatos_hm ch where ch.comprador_id = v_comprador_id;
  end if;

  -- Mais de um card e NENHUM bate com o produto desta transação: os dados
  -- discordam entre si (produto_id da Hotmart e o board cravado no card) —
  -- decisão humana, nunca "escolhe um e reza" (a lição da 0169/0196).
  if v_card_id is null then
    begin
      insert into cs.hm_alertas (tipo, chave, severidade, detalhe)
      values ('cancelamento_ambiguo', coalesce(v_cp.email, v_comprador_id::text), 'critico',
              format('%s teve a transacao %s cancelada/reembolsada na Hotmart (%s, produto %s -> board %s), mas tem %s cards e NENHUM eh do board %s. NENHUM card foi cancelado — decidir na mao qual board perde o acesso.',
                     coalesce(v_cp.nome, v_cp.email), p_transaction, p_evento, coalesce(v_produto_id,'?'), v_produto, v_cards, v_produto));
    exception when others then null;
    end;
    return jsonb_build_object('achou_compra', true, 'tem_card_hm', true,
      'comprador_id', v_comprador_id, 'resultado', 'ambiguo',
      'cards', v_cards, 'produto', v_produto, 'nome', v_cp.nome, 'email', v_cp.email);
  end if;

  v_motivo    := 'Cancelado na Hotmart (' || p_evento || ')';
  -- v_produto EXPLÍCITO — `cs.fn_hm_cancelar` (0197) sem o 4º argumento resolve
  -- por conta própria (`order by produto='HM' desc`), o que reintroduziria o
  -- MESMO bug para quem tem 2 cards: cancelaria de volta o preferido por HM em
  -- vez do card que este board resolveu acima. `fn_hm_cancelar_por_email` (0196)
  -- se safa sem passar o produto só porque só chega a esta chamada quando a
  -- pessoa tem NO MÁXIMO 1 card (2+ vira alerta antes) — aqui não é o caso.
  v_resultado := cs.fn_hm_cancelar(v_comprador_id, v_motivo, 'hotmart', v_produto);

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
    'comprador_id', v_comprador_id, 'resultado', v_resultado, 'produto', v_produto,
    'nome', v_cp.nome, 'email', v_cp.email, 'telefone', v_cp.telefone, 'turma', v_turma,
    'hotmart_cancelado_em', v_quando);
end$function$;

comment on function cs.fn_hm_cancelar_por_transacao(text, text, text, timestamptz) is
  '0218: cancelamento COM transação resolve o board pelo produto da oferta (cs.fn_hm_produto_da_oferta) e só cancela o card daquele board. Antes escolhia um card qualquer de quem tem HM+AURUM sem filtro nem limit (mesma classe do bug que a 0196 fechou em fn_hm_cancelar_por_email). Sem card do board resolvido, abre cancelamento_ambiguo — nunca escolhe no escuro.';

-- ---------------------------------------------------------------------------
-- Verificação (não é dado — só prova que o catálogo ficou consistente).
-- Não existe, hoje, uma segunda assinatura de fn_hm_cancelar_por_transacao no
-- catálogo (esta é create-or-replace da MESMA assinatura de sempre — 4
-- argumentos, nesta ordem — então não há o risco da 0215/sobrecarga ambígua
-- aqui). A trava abaixo é a mesma rede de segurança, para nunca mais confiar
-- nisso de vista.
-- ---------------------------------------------------------------------------
do $$
declare v_assinaturas int;
begin
  select count(*) into v_assinaturas
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'cs' and p.proname = 'fn_hm_cancelar_por_transacao';
  if v_assinaturas <> 1 then
    raise exception '0218: esperava 1 assinatura de cs.fn_hm_cancelar_por_transacao no catalogo, achei %. Sobrecarga ambigua (0215) — DROP a versao velha antes de seguir.', v_assinaturas;
  end if;
end $$;

commit;
