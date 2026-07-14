-- =====================================================================
-- 0073_hm_aviso_de_remocao_nasce_no_banco
-- Um cancelamento, um aviso — venha ele de onde vier.
--
-- O cancelamento tem DUAS portas: a Hotmart (reembolso, chargeback, assinatura
-- cancelada) e o comercial (acordo fechado por fora, Pix devolvido — confirmado
-- na ficha ou ao arrastar o card). Nas duas o Thomas precisa ser chamado para
-- remover os acessos, e em nenhuma ele pode ser chamado duas vezes.
--
-- Se cada porta mandasse a própria mensagem, o mesmo aluno que pede reembolso ao
-- comercial e depois tem o pedido processado na Hotmart geraria dois avisos —
-- e dois avisos para uma tarefa só é o começo de ninguém ler nenhum.
--
-- Então o aviso deixa de ser coisa de QUEM CANCELA e passa a ser coisa do FATO:
-- um gatilho no banco dispara no instante em que cancelamento_efetivado_em deixa
-- de ser nulo. Um só emissor, uma só mensagem, com a origem escrita nela.
-- `aviso_remocao_em` carimba o envio e impede o segundo.
--
-- Só é avisado o cancelamento de quem ERA ALUNO: quem saiu antes de ter acesso
-- não tem acesso a remover, e chamar o Thomas à toa é o caminho mais curto para
-- o aviso virar ruído ignorado.
--
-- Aditiva e idempotente.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1) O carimbo que impede o segundo aviso
-- ---------------------------------------------------------------------
alter table cs.contatos_hm
  add column if not exists aviso_remocao_em timestamptz;

comment on column cs.contatos_hm.aviso_remocao_em is
  'Quando o Slack foi avisado para remover os acessos deste cancelado. Existe para o aviso não sair duas vezes (Hotmart + comercial).';

-- ---------------------------------------------------------------------
-- 2) Onde mora a URL do canal
-- ---------------------------------------------------------------------
-- Incoming Webhook do canal dos acessos. Fica em cs.config porque agora é o
-- BANCO quem envia — o secret da Edge Function não alcança daqui.
insert into cs.config (chave, valor, atualizado_em)
values ('slack_webhook_acessos', to_jsonb(''::text), now())
on conflict (chave) do nothing;

-- ---------------------------------------------------------------------
-- 3) O aviso
-- ---------------------------------------------------------------------
-- Monta a ordem de serviço e a entrega via pg_net (assíncrono: o POST sai depois
-- do commit e não segura a transação do card). Nome/e-mail/telefone/turma saem
-- do SISTEMA — é no payload da Hotmart que o nome chega sujo (0068), e mandar o
-- Thomas procurar um telefone no Searchie seria pedir para a tarefa não ser feita.
create or replace function cs.fn_hm_avisar_remocao(p_contato_hm_id uuid)
returns void
language plpgsql
security definer
set search_path to 'cs', 'public', 'extensions', 'pg_temp'
as $function$
declare
  v_url     text;
  v_usuario text;
  v_ch      cs.contatos_hm%rowtype;
  v_cp      public.compradores%rowtype;
  v_texto   text;
  v_origem  text;
begin
  select coalesce(valor #>> '{}', '') into v_url  from cs.config where chave = 'slack_webhook_acessos';
  select coalesce(valor #>> '{}', '') into v_usuario from cs.config where chave = 'slack_user_acessos';

  if coalesce(v_url, '') = '' then
    -- Sem canal configurado o aviso não sai — mas o cancelamento não pode falhar
    -- por causa disso. A fila "Cancelou e ainda tem acesso" continua acusando.
    raise notice 'slack_webhook_acessos não configurado — aviso de remoção não enviado';
    return;
  end if;

  select * into v_ch from cs.contatos_hm where id = p_contato_hm_id;
  if not found or v_ch.aviso_remocao_em is not null then return; end if;

  select * into v_cp from public.compradores where id = v_ch.comprador_id;

  v_origem := case v_ch.cancelamento_origem
                when 'hotmart' then 'Reembolso/cancelamento processado na Hotmart'
                else 'Cancelamento registrado pelo comercial (fora da Hotmart)'
              end;

  v_texto := format(
    ':x: *Cancelamento — remover acessos*%s*Nome:* %s%s*E-mail:* %s%s*Telefone:* %s%s*Turma:* %s%s*Origem:* %s%s*Motivo:* %s%s%s:warning: *Remova os acessos deste aluno* — área de membros do Searchie/Óbvio, comunidade THB e grupo de informes.%sDepois marque cada item no checklist *"Remover acessos"* da ficha do contato, no portal HM: enquanto não estiver marcado, ele continua na fila de pendências.',
    E'\n',
    coalesce(v_cp.nome, '-'),                E'\n',
    coalesce(v_cp.email, '-'),               E'\n',
    coalesce(v_cp.telefone, '-'),            E'\n',
    coalesce(v_ch.turma, '-'),               E'\n',
    v_origem,                                E'\n',
    coalesce(v_ch.cancelamento_motivo, '-'), E'\n',
    case when coalesce(v_usuario, '') <> '' then E'\n<@' || v_usuario || '> ' else E'\n' end,
    E'\n'
  );

  perform net.http_post(
    url     := v_url,
    headers := '{"Content-Type": "application/json"}'::jsonb,
    body    := jsonb_build_object(
                 'text', 'Cancelamento — remover acessos: ' || coalesce(v_cp.nome, '-'),
                 'blocks', jsonb_build_array(
                   jsonb_build_object('type', 'section',
                     'text', jsonb_build_object('type', 'mrkdwn', 'text', v_texto)),
                   jsonb_build_object('type', 'divider')
                 )
               )
  );

  update cs.contatos_hm set aviso_remocao_em = now() where id = p_contato_hm_id;

  insert into cs.interacoes (contato_hm_id, tipo, descricao, autor)
  values (p_contato_hm_id, 'sistema', 'Slack avisado: remover os acessos deste aluno', 'sistema');
end$function$;

-- ---------------------------------------------------------------------
-- 4) O gatilho: o fato é que avisa, não quem o registrou
-- ---------------------------------------------------------------------
create or replace function cs.trg_hm_cancelamento_avisa()
returns trigger
language plpgsql
security definer
set search_path to 'cs', 'public', 'pg_temp'
as $$
begin
  -- Só na TRANSIÇÃO para cancelado (null → data), e só para quem era aluno:
  -- sem aluno não há acesso a remover.
  if old.cancelamento_efetivado_em is null
     and new.cancelamento_efetivado_em is not null
     and new.aluno_id is not null
     and new.aviso_remocao_em is null then
    perform cs.fn_hm_avisar_remocao(new.id);
  end if;
  return null;
end;
$$;

drop trigger if exists trg_hm_cancelamento_avisa on cs.contatos_hm;
create trigger trg_hm_cancelamento_avisa
  after update of cancelamento_efetivado_em on cs.contatos_hm
  for each row execute function cs.trg_hm_cancelamento_avisa();

-- ---------------------------------------------------------------------
-- 5) A view expõe o carimbo (a tela mostra "Thomas já foi avisado")
-- ---------------------------------------------------------------------
-- (contatos_hm_kanban é recriada em 0071; aqui só acrescentamos a coluna nova
--  ao final — create or replace permite adicionar, nunca reordenar.)
