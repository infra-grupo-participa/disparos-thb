-- 0196_dinheiro_do_card_certo.sql
-- Cada card recebe o SEU dinheiro, o SEU boleto e o SEU cancelamento.
--
-- Continuação da 0195. Lá o problema era o sistema não reconhecer uma oferta do
-- AURUM; aqui é o oposto: o que ele reconhece, ele aplica na pessoa inteira em vez de
-- no card. Desde a 0163 uma pessoa pode ter card no HM **e** no AURUM — hoje são 15
-- pessoas, de 275. Três funções centrais nunca foram adaptadas e ainda resolvem por
-- `comprador_id`, sem olhar o produto.
--
-- ---------------------------------------------------------------------------
-- 1) `cs.fn_hm_recalcular_financeiro` SOMAVA OS DOIS BOARDS  [crítico]
--
--   select * into v_card ... where comprador_id = X        -- pega um card qualquer
--   select sum(valor) ... where comprador_id = X           -- soma HM + AURUM juntos
--   update cs.contatos_hm ... where comprador_id = X       -- grava nos DOIS cards
--
-- Roda a cada linha de `cs.hm_pagamentos`, ou seja, em toda venda e toda mensalidade.
-- Quando a mensalidade do AURUM cair, ela entra no `valor_pago` do card do HM da mesma
-- pessoa — e vice-versa. É a mesma classe do problema que a 0163 apontou ("R$ 15.000
-- da taxa do Aurum lançados no razão de cards do HM") e que nunca foi corrigida.
-- Agora a função percorre os cards da pessoa e recalcula CADA UM com os pagamentos do
-- produto daquele card, gravando por `id`.
--
-- Para produto <> HM o `valor_total` NÃO é derivado: cravar pacote no card do AURUM
-- ligaria `saldo_cravado`, que vence `cs.fn_aurum_saldo` e jogaria fora o crédito da
-- planilha. O saldo do AURUM continua vindo da fonte única da 0195 — e é ela que diz
-- quando o card está quitado.
--
-- ---------------------------------------------------------------------------
-- 2) CANCELAMENTO DE ASSINATURA PODIA MATAR O BOARD ERRADO  [alto]
--
-- A 0193 corrigiu `fn_hm_compra_cancelada` (cancelamento COM transação: acha o card
-- pelo produto da oferta). O caminho de `SUBSCRIPTION_CANCELLATION` — que chega **sem
-- transação e sem oferta**, só com e-mail — continuou resolvendo `where comprador_id`
-- e cancelando um card arbitrário.
--
-- Sem oferta não há como saber o board. Então: uma pessoa com um card só segue sendo
-- cancelada automaticamente; com dois cards, o sistema NÃO escolhe — registra alerta
-- crítico `cancelamento_ambiguo` e deixa para o humano. Cancelar o board errado é pior
-- que não cancelar: apaga esteira ativa e esconde dívida real.
--
-- ---------------------------------------------------------------------------
-- 3) CARD NASCIA SEMPRE COMO 'HM', E BOLETO DE SALDO NÃO ENTRAVA NA FILA  [alto]
--
-- `fn_seed_contato_hm` tem `produto` fixo em `'HM'` nos quatro inserts. Uma venda do
-- AURUM só virava card do AURUM depois, se a oferta estivesse cadastrada na tabela de
-- canal. Agora o produto vem de `cs.fn_hm_produto_da_oferta` (canal → produto da
-- Hotmart → HM), a mesma cadeia da 0195.
--
-- E o ramo de boleto aceitava só `sinal`/`compra_cheia`: **boleto de saldo (categoria
-- `diferenca`) não aparecia em "Boleto Gerado"** — justo o boleto que o AURUM vai
-- gerar para cobrar os R$ 45–59 mil. Passa a entrar na fila como os outros.
--
-- Idempotente. Nenhum dado é reescrito por esta migration: ela troca comportamento
-- daqui para frente e recalcula o financeiro dos 15 cards de gente com dois boards.

-- ---------------------------------------------------------------------------
-- 0) De que board é esta compra — canal, senão o produto da Hotmart
-- ---------------------------------------------------------------------------
create or replace function cs.fn_hm_produto_da_oferta(p_oferta text, p_produto_id text default null)
 returns text
 language sql
 stable
 set search_path to 'cs', 'public', 'pg_temp'
as $function$
  select coalesce(
    (select o.produto from cs.hm_origem_por_oferta o
      where o.oferta_codigo = p_oferta and o.produto is not null
      order by o.vale_de desc nulls last
      limit 1),
    (select m.produto from cs.hm_produto_hotmart m where m.produto_id = p_produto_id),
    (select m.produto from public.compras c
       join cs.hm_produto_hotmart m on m.produto_id = c.produto_id
      where c.oferta_codigo = p_oferta
        and c.status in ('APPROVED','COMPLETE','COMPLETED')
      order by coalesce(c.data_aprovacao, c.data_compra) desc nulls last
      limit 1),
    'HM'
  );
$function$;

comment on function cs.fn_hm_produto_da_oferta(text, text) is
  '0196: board de uma compra. Canal declarado (cs.hm_origem_por_oferta) primeiro; depois o produto da Hotmart (cs.hm_produto_hotmart); HM como último recurso.';

-- ---------------------------------------------------------------------------
-- 1) Recálculo financeiro por CARD
-- ---------------------------------------------------------------------------
create or replace function cs.fn_hm_recalcular_financeiro(p_comprador_id uuid)
 returns void
 language plpgsql
 security definer
 set search_path to 'cs', 'public', 'pg_temp'
as $function$
declare
  v_card cs.contatos_hm%rowtype;
  v_pago numeric; v_total numeric; v_saldo numeric;
  v_ultimo timestamptz; v_val record; v_situacao text; v_status text;
begin
  -- 0196: um recálculo por card. Antes era "um card qualquer da pessoa" e o UPDATE
  -- caía em todos, misturando o dinheiro do HM com o do AURUM.
  for v_card in
    select * from cs.contatos_hm
     where comprador_id = p_comprador_id
     order by (produto = 'HM') desc, criado_em asc
  loop
    select coalesce(sum(p.valor), 0), max(p.pago_em)
      into v_pago, v_ultimo
      from cs.hm_pagamentos p
     where p.comprador_id = p_comprador_id
       and cs.fn_hm_pagamento_do_produto(p.oferta_codigo, v_card.produto);

    v_total := v_card.valor_total;

    if coalesce(v_card.produto, 'HM') = 'HM' then
      -- Total só é derivado quando há LASTRO. Para quem só pagou o sinal, fica nulo de
      -- propósito: cravar 15.000 afirmaria dívida de 14.700 ao aluno da base, que deve
      -- menos (o pró-rata desconta). Saldo desconhecido é honesto; saldo inventado, não.
      if v_total is null and cs.fn_hm_tem_lastro(p_comprador_id) then
        select * into v_val from cs.fn_hm_valores_derivados(p_comprador_id);
        v_total := v_val.valor_total;
      end if;
      v_saldo := greatest(coalesce(v_total, 0) - v_pago, 0);
      if v_saldo < 1 then v_saldo := 0; end if;   -- centavos não são dívida
    else
      -- AURUM (e qualquer board futuro): o saldo é o da fonte única da 0195, que já
      -- desconta crédito da planilha e pagamentos. NULL = "não cobrar" (exceção) e
      -- nunca deve virar quitação.
      v_saldo := cs.fn_aurum_saldo(p_comprador_id);
      if v_saldo is not null and v_saldo < 1 then v_saldo := 0; end if;
    end if;

    update cs.contatos_hm
       set valor_pago = v_pago,
           valor_total = v_total,
           quitado_em = case
                          when coalesce(v_card.produto,'HM') = 'HM'
                            then case when coalesce(v_total, 0) > 0 and v_saldo = 0
                                      then coalesce(quitado_em, v_ultimo, now()) else null end
                          else case when v_saldo = 0 and v_pago > 0
                                    then coalesce(quitado_em, v_ultimo, now()) else null end
                        end,
           atualizado_em = now()
     where id = v_card.id;

    -- Espelha na base de alunos, mas NUNCA cria matrícula (isso é do lastro).
    if v_card.aluno_id is not null then
      if coalesce(v_total, 0) > 0 and coalesce(v_saldo, 1) = 0 then v_situacao := 'quitado'; v_status := 'Quitado';
      elsif v_pago > 0 then v_situacao := 'em_andamento'; v_status := 'Em andamento';
      else v_situacao := 'so_sinal'; v_status := 'Só sinal pago'; end if;

      update public.thb_alunos
         set valor_total = v_total, valor_pago = v_pago, saldo_devedor = coalesce(v_saldo, 0),
             situacao_financeira = case when situacao_financeira = 'cancelado'
                                        then situacao_financeira else v_situacao end,
             status_pagamento    = case when situacao_financeira = 'cancelado'
                                        then status_pagamento else v_status end,
             ultimo_pagamento = coalesce(v_ultimo::date, ultimo_pagamento),
             atualizado_em = now()
       where id = v_card.aluno_id;
    end if;
  end loop;
end$function$;

comment on function cs.fn_hm_recalcular_financeiro(uuid) is
  '0196: recalcula CADA card da pessoa com os pagamentos do produto daquele card. Antes somava HM+AURUM e gravava nos dois. Para produto <> HM nao deriva valor_total (cravar pacote atropelaria cs.fn_aurum_saldo).';

-- ---------------------------------------------------------------------------
-- 2) Cancelamento por e-mail: não escolhe board no escuro
-- ---------------------------------------------------------------------------
create or replace function cs.fn_hm_cancelar_por_email(p_email text, p_evento text, p_ocorrido_em timestamptz default null)
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
  v_cards        int;
  v_quando       timestamptz := coalesce(p_ocorrido_em, now());
begin
  select * into v_cp from public.compradores
   where lower(btrim(email)) = lower(btrim(p_email)) limit 1;
  if not found then
    return jsonb_build_object('achou_comprador', false);
  end if;
  v_comprador_id := v_cp.id;

  select count(*) into v_cards from cs.contatos_hm where comprador_id = v_comprador_id;

  -- 0196: SUBSCRIPTION_CANCELLATION chega sem transação e sem oferta — não dá para
  -- saber de que board é. Com mais de um card, escolher no escuro apaga a esteira
  -- ativa de alguém (foi o caso Iara, que a 0193 corrigiu no caminho por transação).
  if v_cards > 1 then
    begin
      insert into cs.hm_alertas (tipo, chave, severidade, detalhe)
      values ('cancelamento_ambiguo', coalesce(v_cp.email, v_comprador_id::text), 'critico',
              format('%s cancelou a assinatura na Hotmart (%s), mas tem %s cards (boards diferentes) e o evento nao diz qual. NENHUM card foi cancelado — decidir na mao qual board perde o acesso.',
                     coalesce(v_cp.nome, v_cp.email), p_evento, v_cards));
    exception when others then null;
    end;
    return jsonb_build_object('achou_comprador', true, 'tem_card_hm', true,
      'comprador_id', v_comprador_id, 'resultado', 'ambiguo',
      'cards', v_cards, 'nome', v_cp.nome, 'email', v_cp.email);
  end if;

  select ch.id, ch.estagio_id, ch.turma into v_card_id, v_estagio_ant, v_turma
    from cs.contatos_hm ch where ch.comprador_id = v_comprador_id
   order by ch.criado_em asc limit 1;
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
    values (v_card_id, 'mudanca_estagio', 'Movido para "Reembolsado" - assinatura cancelada na Hotmart',
            'hotmart', v_estagio_ant, v_estagio_id);
  end if;

  insert into cs.interacoes (contato_hm_id, tipo, descricao, autor)
  values (v_card_id, 'sistema',
    case v_resultado
      when 'cancelado' then v_motivo || ' - aluno marcado como cancelado na base THB. Remover os acessos.'
      else v_motivo || ' - o contato ainda nao era aluno; nada a remover na base.'
    end, 'hotmart');

  return jsonb_build_object('achou_comprador', true, 'tem_card_hm', true,
    'comprador_id', v_comprador_id, 'resultado', v_resultado,
    'nome', v_cp.nome, 'email', v_cp.email, 'telefone', v_cp.telefone, 'turma', v_turma,
    'hotmart_cancelado_em', v_quando);
end$function$;

comment on function cs.fn_hm_cancelar_por_email(text, text, timestamptz) is
  '0196: cancelamento de assinatura (sem transacao). Com mais de um card, NAO escolhe: abre alerta cancelamento_ambiguo e deixa para o humano.';
