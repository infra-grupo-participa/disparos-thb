-- =====================================================================
-- 0092_hm_cadastro_manual
--
-- CADASTRAR ALGUÉM NA ESTEIRA À MÃO — O QUE O SEED NÃO PEGA.
--
-- O card do HM nasce por gatilho (cs.fn_seed_contato_hm), e o gatilho é
-- AFTER INSERT em public.compras. Isso deixa um buraco real: o boleto do sinal
-- entra PENDENTE no insert e só vira APPROVED num UPDATE, dias depois. O seed
-- não re-dispara no update — e a pessoa fica com o pagamento no razão, mas sem
-- card na esteira. Foi o que aconteceu com a izildinha (sinal pago por boleto,
-- gerado 13/07 e aprovado 15/07): ninguém para trabalhar o lead.
--
-- Fora isso, há quem precise entrar sem compra nenhuma na Hotmart (indicação,
-- acordo por fora, migração de planilha). Hoje não há porta para isso.
--
-- Esta função é essa porta. Acha o comprador pelo e-mail (a mesma chave do
-- webhook) ou cria um novo marcado is_manual; garante um card na esteira, no
-- estágio pedido (padrão: "Contato Inicial" do comercial — a entrada do funil,
-- igual ao seed); e deixa rastro na timeline. Idempotente: chamar de novo devolve
-- o card que já existe, nunca duplica (o índice único de comprador_id garante).
-- =====================================================================

create or replace function cs.fn_hm_cadastrar_manual(
  p_nome         text,
  p_email        text,
  p_telefone     text     default null,
  p_documento    text     default null,
  p_turma        text     default 'T39',
  p_categoria    text     default null,          -- 'sinal' | 'compra_cheia' | null
  p_responsavel  text     default null,
  p_estagio_chave text    default 'hm_comprou',  -- a entrada do funil comercial
  p_autor        text     default 'cs'
)
returns jsonb
language plpgsql
security definer
set search_path to 'cs', 'public', 'pg_temp'
as $fn$
declare
  v_email    text := nullif(lower(btrim(p_email)), '');
  v_nome     text := btrim(coalesce(p_nome, ''));
  v_tel      text := cs.normalizar_telefone(p_telefone);
  v_doc      text := nullif(btrim(coalesce(p_documento, '')), '');
  v_turma    text := coalesce(nullif(btrim(coalesce(p_turma, '')), ''), 'T39');
  v_estagio  smallint;
  v_comprador uuid;
  v_card     uuid;
  v_cp       public.compradores%rowtype;
  v_criou_comprador boolean := false;
  v_criou_card boolean := false;
begin
  -- Nome e e-mail são as duas colunas NOT NULL de compradores, e o e-mail é a
  -- chave que casa com o que o webhook já gravou. Sem eles não há cadastro.
  if v_nome = '' then
    return jsonb_build_object('ok', false, 'reason', 'nome_obrigatorio');
  end if;
  if v_email is null then
    return jsonb_build_object('ok', false, 'reason', 'email_obrigatorio');
  end if;

  select id into v_estagio
    from cs.estagios
   where evento = 'HM' and chave = coalesce(nullif(btrim(coalesce(p_estagio_chave, '')), ''), 'hm_comprou')
   limit 1;
  if v_estagio is null then
    return jsonb_build_object('ok', false, 'reason', 'estagio_invalido');
  end if;

  -- 1) Comprador: acha pelo e-mail (mesma chave do upsert do webhook) ou cria.
  --    Achando, só PREENCHE buracos — nunca sobrescreve o que já veio da Hotmart.
  select * into v_cp from public.compradores where lower(btrim(email)) = v_email limit 1;
  if not found then
    insert into public.compradores (nome, email, telefone, documento, is_manual)
    values (v_nome, v_email, v_tel, v_doc, true)
    returning * into v_cp;
    v_criou_comprador := true;
  else
    update public.compradores
       set telefone      = coalesce(telefone, v_tel),
           documento     = coalesce(documento, v_doc),
           atualizado_em = now()
     where id = v_cp.id
    returning * into v_cp;
  end if;
  v_comprador := v_cp.id;

  -- 2) Card: idempotente por comprador. O `on conflict do nothing` cobre a corrida
  --    (dois cadastros simultâneos, ou o seed disparando no meio) — se já existe,
  --    o insert não faz nada e a gente lê o que está lá.
  insert into cs.contatos_hm (comprador_id, estagio_id, turma, categoria_entrada, responsavel)
  values (v_comprador, v_estagio, v_turma, nullif(btrim(coalesce(p_categoria, '')), ''), nullif(btrim(coalesce(p_responsavel, '')), ''))
  on conflict (comprador_id) do nothing
  returning id into v_card;

  if v_card is not null then
    v_criou_card := true;

    insert into cs.interacoes (contato_hm_id, tipo, descricao, autor)
    values (v_card, 'sistema',
            'Cadastrado manualmente na esteira HM'
              || case when v_criou_comprador then ' (novo contato)' else ' (contato já existia na base)' end,
            p_autor);

    -- Tags de origem (HT/turma/enriquecimento). Não-fatal: classificar é um bônus,
    -- não pode derrubar o cadastro — igual ao seed.
    begin
      perform cs.fn_tag_hm_origem(v_comprador);
    exception when others then
      insert into cs.interacoes (contato_hm_id, tipo, descricao, autor)
      values (v_card, 'sistema', 'Falha ao classificar origem HM ('||sqlerrm||') — rodar cs.fn_sync_hm_atm()', 'sistema');
    end;
  else
    select id into v_card from cs.contatos_hm where comprador_id = v_comprador;
  end if;

  return jsonb_build_object(
    'ok', true,
    'comprador_id', v_comprador,
    'card_id', v_card,
    'criou_comprador', v_criou_comprador,
    'criou_card', v_criou_card,
    'ja_existia', not v_criou_card,
    'nome', v_cp.nome, 'email', v_cp.email, 'telefone', v_cp.telefone
  );
end$fn$;

grant execute on function cs.fn_hm_cadastrar_manual(text, text, text, text, text, text, text, text, text) to disparos_app;
