-- 0211 — o card do HM ganha DOIS responsáveis possíveis: comercial e ativação.
--
-- ── O PROBLEMA ───────────────────────────────────────────────────────────────
-- `cs.contatos_hm.responsavel_id` é uma coluna só. Um card que passou pela aba
-- comercial e depois foi para ativação (ou vice-versa) perde o dono da etapa
-- anterior — só sobra quem é dono AGORA. Não dá para responder "quem cuidou
-- deste card no comercial" depois que ele virou ativação.
--
-- ── A SOLUÇÃO: duas colunas de HISTÓRICO, `responsavel_id` intocado ────────────
-- `responsavel_comercial_id` e `responsavel_ativacao_id` guardam o dono que o
-- card teve EM CADA aba, ficando preenchidos mesmo depois que o card muda de
-- aba. `responsavel_id` continua sendo o dono VIGENTE (quem opera o card hoje)
-- — nenhuma escrita nele nesta migration, é o que torna o backfill reversível
-- e não muda nenhum comportamento de tela/atribuição existente.
--
-- ── BACKFILL: regra LITERAL pela aba ATUAL do card (decisão do Marcio) ─────────
-- Sem refinamento histórico — não dá para saber quem foi dono em cada aba no
-- passado, então o backfill usa o dono ATUAL, direcionado pela aba ATUAL:
--   · card na aba ativacao  → dono vira responsavel_ativacao_id
--   · card na aba comercial → dono vira responsavel_comercial_id
-- Vale também para os 7 que já passaram pela ativação e os 26 cancelados —
-- regra literal, sem exceção por histórico de trânsito entre abas.
--
-- Idempotente: guarda `is null` nos dois UPDATEs, pode reaplicar sem duplicar
-- nem sobrescrever um valor já gravado por trânsito manual futuro.

alter table cs.contatos_hm
  add column if not exists responsavel_comercial_id uuid references cs.usuarios(id);
alter table cs.contatos_hm
  add column if not exists responsavel_ativacao_id uuid references cs.usuarios(id);

comment on column cs.contatos_hm.responsavel_comercial_id is
  '0211: dono do card na aba COMERCIAL (histórico — não some quando o card vai para ativação). responsavel_id continua sendo o dono vigente.';
comment on column cs.contatos_hm.responsavel_ativacao_id is
  '0211: dono do card na aba ATIVAÇÃO (histórico — não some se o card volta para comercial). responsavel_id continua sendo o dono vigente.';

-- Backfill literal pela aba ATUAL do card.
update cs.contatos_hm ch
   set responsavel_ativacao_id = ch.responsavel_id
  from cs.estagios e
 where e.id = ch.estagio_id
   and e.aba = 'ativacao'
   and ch.responsavel_id is not null
   and ch.responsavel_ativacao_id is null;

update cs.contatos_hm ch
   set responsavel_comercial_id = ch.responsavel_id
  from cs.estagios e
 where e.id = ch.estagio_id
   and e.aba = 'comercial'
   and ch.responsavel_id is not null
   and ch.responsavel_comercial_id is null;

-- ── View: preserva TUDO que já existe, novidade só no FINAL ───────────────────
-- `create or replace view` não permite reordenar/remover colunas existentes —
-- corpo abaixo copiado de `pg_get_viewdef('cs.contatos_hm_kanban')` no banco
-- (a view foi reescrita várias vezes desde a 0146; migration antiga não é
-- fonte confiável). Só entram, ao final: as 2 colunas novas + os 2 nomes
-- derivados via LEFT JOIN — sem trigger, o nome sai por JOIN mesmo.
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
    s.valor::numeric(10,2) AS sinal_valor,
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
    COALESCE(ru.equipe_id, peq.id, rota.equipe_id) AS equipe_id,
    COALESCE(deq.nome, peq.nome, req.nome) AS equipe_nome,
    COALESCE(deq.cor, peq.cor, req.cor) AS equipe_cor,
    COALESCE(deq.tipo, peq.tipo, req.tipo) AS equipe_tipo,
    ch.cancelamento_valor,
    ch.produto,
    s.oferta_codigo AS sinal_oferta_codigo,
    ch.aguardando_pagamento_em,
    ch.aguardando_pagamento_em IS NOT NULL AS aguardando_pagamento,
    ch.responsavel_comercial_id,
    ch.responsavel_ativacao_id,
    rc.nome AS responsavel_comercial,
    ra.nome AS responsavel_ativacao
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
     LEFT JOIN LATERAL ( SELECT p.pago_em,
            p.valor,
            p.oferta_codigo
           FROM cs.hm_pagamentos p
             JOIN hm_product_catalog cat ON cat.offer_code = p.oferta_codigo
          WHERE p.comprador_id = ch.comprador_id AND cat.categoria = 'sinal'::text AND cs.fn_hm_pagamento_do_produto(p.oferta_codigo, ch.produto)
          ORDER BY p.pago_em DESC NULLS LAST, p.valor DESC, p.id DESC
         LIMIT 1) s ON true
     LEFT JOIN LATERAL ( SELECT c.status,
            COALESCE(c.data_compra, c.data_aprovacao) AS em
           FROM compras c
             JOIN hm_product_catalog cat ON cat.offer_code = c.oferta_codigo::text
          WHERE c.comprador_id = ch.comprador_id
          ORDER BY (COALESCE(c.data_compra, c.data_aprovacao)) DESC NULLS LAST
         LIMIT 1) hs ON true
     LEFT JOIN cs.usuarios rc ON rc.id = ch.responsavel_comercial_id
     LEFT JOIN cs.usuarios ra ON ra.id = ch.responsavel_ativacao_id;

comment on view cs.contatos_hm_kanban is
  '0211: acrescenta responsavel_comercial_id/responsavel_ativacao_id (historico por aba) e os nomes derivados por LEFT JOIN, ao FINAL da lista de colunas — create or replace view nao permite reordenar. Corpo copiado de pg_get_viewdef no banco, nao de migration antiga.';

grant select on cs.contatos_hm_kanban to disparos_app;

-- ── Conferência ──────────────────────────────────────────────────────────────
-- Só confere que o backfill acertou a aba ATUAL (regra literal do comentário
-- acima). NÃO existe conferência de "vazamento cruzado" (responsavel_comercial_id
-- preenchido com o card na ativação, ou vice-versa) — essas duas colunas são
-- HISTÓRICO por design (linhas 9-14): o propósito inteiro da migration é que
-- elas continuem preenchidas depois que o card TROCA de aba. Uma conferência de
-- exclusividade mútua exigiria que as colunas fossem sempre nulas fora da aba
-- correspondente, o que quebraria no primeiro card que transita entre comercial
-- e ativação — exatamente o caso que 0212/0213 passam a tratar.
do $$
declare
  v_erro_ativacao int;
  v_erro_comercial int;
begin
  select count(*) into v_erro_ativacao
    from cs.contatos_hm ch join cs.estagios e on e.id = ch.estagio_id
   where e.aba = 'ativacao' and ch.responsavel_ativacao_id is distinct from ch.responsavel_id;
  if v_erro_ativacao > 0 then
    raise exception '0211: % card(s) na aba ativacao com responsavel_ativacao_id diferente de responsavel_id', v_erro_ativacao;
  end if;

  select count(*) into v_erro_comercial
    from cs.contatos_hm ch join cs.estagios e on e.id = ch.estagio_id
   where e.aba = 'comercial' and ch.responsavel_comercial_id is distinct from ch.responsavel_id;
  if v_erro_comercial > 0 then
    raise exception '0211: % card(s) na aba comercial com responsavel_comercial_id diferente de responsavel_id', v_erro_comercial;
  end if;

  raise notice '0211: backfill conferido sem divergencia.';
end $$;
