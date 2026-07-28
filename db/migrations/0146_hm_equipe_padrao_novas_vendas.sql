-- =====================================================================
-- 0146_hm_equipe_padrao_novas_vendas
--
-- Equipe padrão para NOVAS vendas HM (pedido do Marcio, 28/07). O oposto
-- pontual da 0144: em vez de reativar o roteamento por canal (que pegaria os
-- cards legados que já estão no pool), a equipe padrão é CARIMBADA no card no
-- momento em que ele nasce. Assim só compras "de agora em diante" caem na
-- equipe; os cards antigos sem dono continuam no pool, intactos.
--
-- 1) cs.hm_config: config singleton do board (linha única id=1). Guarda
--    equipe_padrao_id — a equipe para onde toda venda HM nova vai por padrão.
--    Configurável pela UI (/hm/equipes). NULL = comportamento atual (pool).
-- 2) cs.contatos_hm.equipe_padrao_id: a equipe carimbada na CRIAÇÃO do card.
--    Não muda depois (o dono/atribuição manual sobrepõe na leitura). É o que
--    separa "novo" de "legado" sem depender de data de corte na leitura.
-- 3) View: prioridade da equipe = dono -> carimbo -> rota de canal.
-- 4) fn_seed_contato_hm: ao INSERIR um card novo, lê a equipe padrão vigente e
--    carimba equipe_padrao_id. Só na criação (on conflict do update NÃO mexe).
-- Ver [[HM - Feature de equipes e niveis de acesso]].
-- =====================================================================

-- 1) Config singleton do board HM --------------------------------------------
create table if not exists cs.hm_config (
  id                smallint primary key default 1 check (id = 1),
  equipe_padrao_id  uuid references cs.equipes(id) on delete set null,
  atualizado_em     timestamptz not null default now()
);
comment on table cs.hm_config is
  'Config singleton do board HM (linha id=1). equipe_padrao_id = equipe para onde toda venda HM nova é carimbada na criação; NULL = cai no pool.';

insert into cs.hm_config (id) values (1) on conflict (id) do nothing;

-- 2) Equipe carimbada na criação do card -------------------------------------
alter table cs.contatos_hm
  add column if not exists equipe_padrao_id uuid references cs.equipes(id) on delete set null;
comment on column cs.contatos_hm.equipe_padrao_id is
  'Equipe carimbada quando o card nasceu (equipe padrão vigente na criação). Só afeta cards novos; o dono manual sobrepõe na leitura.';

-- 3) View do kanban: prioridade dono -> carimbo -> rota de canal --------------
--    Corpo idêntico ao vigente (pg_get_viewdef); muda só o cálculo da equipe,
--    que passa a olhar o carimbo (LEFT JOIN peq) entre o dono e a rota.
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
    ch.hotmart_cancelado_em,
    ch.hotmart_cancelamento_evento,
    ch.hotmart_cancelamento_transacao,
    ch.hotmart_cancelado_em IS NOT NULL AS cancelado_na_hotmart,
    ch.cancelamento_efetivado_em IS NOT NULL AND ch.hotmart_cancelado_em IS NULL AS cancelado_sem_confirmacao_hotmart,
    hs.status AS hotmart_status,
    hs.em AS hotmart_status_em,
    COALESCE(( SELECT t.t
           FROM unnest(ch.tags) t(t)
          WHERE t.t ~ '^HT[0-9]+$'::text
         LIMIT 1), ( SELECT t.t
           FROM unnest(ch.tags) t(t)
          WHERE t.t = ANY (ARRAY['HT ATM'::text, 'Live Direto ao Ponto'::text, 'Imersão POA'::text, 'Ex aluno Direto ao Ponto'::text, 'HM - Programa de Implementação'::text, 'Venda direta'::text])
          ORDER BY (array_position(ARRAY['HT ATM'::text, 'Live Direto ao Ponto'::text, 'Imersão POA'::text, 'Ex aluno Direto ao Ponto'::text, 'HM - Programa de Implementação'::text, 'Venda direta'::text], t.t))
         LIMIT 1)) AS canal_aquisicao,
    ch.reuniao_gravacao_url,
    ch.entrevista_gravacao_url,
    ch.responsavel_id,
    -- equipe do card: dono (atribuição) -> carimbo de criação -> rota de canal
    COALESCE(ru.equipe_id, peq.id, rota.equipe_id) AS equipe_id,
    COALESCE(deq.nome, peq.nome, req.nome)         AS equipe_nome,
    COALESCE(deq.cor,  peq.cor,  req.cor)          AS equipe_cor,
    COALESCE(deq.tipo, peq.tipo, req.tipo)         AS equipe_tipo
   FROM cs.contatos_hm ch
     JOIN compradores cmp ON cmp.id = ch.comprador_id
     LEFT JOIN cs.estagios est ON est.id = ch.estagio_id
     LEFT JOIN cs.usuarios ru ON ru.id = ch.responsavel_id
     LEFT JOIN cs.equipes deq ON deq.id = ru.equipe_id
     LEFT JOIN cs.equipes peq ON peq.id = ch.equipe_padrao_id
     LEFT JOIN LATERAL ( SELECT ec.equipe_id
           FROM cs.equipe_canais ec
          WHERE ec.canal = ANY (ch.tags)
         LIMIT 1) rota ON true
     LEFT JOIN cs.equipes req ON req.id = rota.equipe_id
     LEFT JOIN LATERAL ( SELECT COALESCE(c.data_compra, c.data_aprovacao) AS pago_em,
            c.preco AS valor
           FROM compras c
             JOIN hm_product_catalog cat ON cat.offer_code = c.oferta_codigo::text
          WHERE c.comprador_id = ch.comprador_id AND cat.categoria = 'sinal'::text AND (c.status::text = ANY (ARRAY['APPROVED'::text, 'COMPLETE'::text, 'COMPLETED'::text]))
          ORDER BY (COALESCE(c.data_compra, c.data_aprovacao))
         LIMIT 1) s ON true
     LEFT JOIN LATERAL ( SELECT c.status,
            COALESCE(c.data_compra, c.data_aprovacao) AS em
           FROM compras c
             JOIN hm_product_catalog cat ON cat.offer_code = c.oferta_codigo::text
          WHERE c.comprador_id = ch.comprador_id
          ORDER BY (COALESCE(c.data_compra, c.data_aprovacao)) DESC NULLS LAST
         LIMIT 1) hs ON true;

-- 4) fn_seed_contato_hm: carimba a equipe padrão vigente ao criar card novo ---
--    Estratégia mínima e à prova de drift: em vez de reescrever a função inteira
--    (longa e sujeita a divergir do que roda hoje), carimbamos por trigger
--    dedicado AFTER INSERT em cs.contatos_hm. Todo card novo (venha do seed
--    automático ou do cadastro manual) recebe a equipe padrão, se houver, e só
--    se ainda não veio com equipe/dono definido.
create or replace function cs.fn_hm_carimba_equipe_padrao()
returns trigger language plpgsql
set search_path to 'cs','public','pg_temp'
as $function$
declare
  v_padrao uuid;
begin
  if new.equipe_padrao_id is not null or new.responsavel_id is not null then
    return new;  -- já nasceu com equipe/dono explícito: respeita
  end if;
  select equipe_padrao_id into v_padrao from cs.hm_config where id = 1;
  if v_padrao is not null then
    update cs.contatos_hm set equipe_padrao_id = v_padrao where id = new.id;
  end if;
  return new;
end$function$;

drop trigger if exists trg_hm_carimba_equipe_padrao on cs.contatos_hm;
create trigger trg_hm_carimba_equipe_padrao
  after insert on cs.contatos_hm
  for each row execute function cs.fn_hm_carimba_equipe_padrao();
