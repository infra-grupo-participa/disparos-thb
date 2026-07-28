-- =====================================================================
-- 0150_hm_socio_estagio_arrastavel
--
-- Sócio arrastável entre as colunas da Ativação (pedido do Victor via Marcio,
-- 28/07). Hoje o card do sócio NÃO arrasta: a coluna dele é derivada de
-- colunaDoSocio(status) = os 3 acessos (searchie/comunidade/grupo) → só duas
-- posições possíveis (Pendente / Acesso Liberado), sem gesto livre.
--
-- Decisão: o sócio passa a ter ESTÁGIO PRÓPRIO, podendo ir a QUALQUER coluna da
-- aba ativação, como o titular. Estratégia sem quebrar o que existe:
--   • `estagio_id` NULL  → comportamento ANTIGO (coluna derivada dos 3 checks).
--   • `estagio_id` setado → o operador arrastou; a coluna passa a ser esta.
-- Assim os sócios atuais seguem exatamente como estão até alguém arrastar um.
--
-- FK para cs.estagios; on delete set null (se um estágio sumir, o sócio volta ao
-- modo derivado). Idempotente.
-- Ver [[HM - Feature de equipes e niveis de acesso]].
-- =====================================================================

alter table cs.hm_socios
  add column if not exists estagio_id smallint references cs.estagios(id) on delete set null;

comment on column cs.hm_socios.estagio_id is
  'Estágio (coluna) próprio do sócio na Ativação quando o operador o arrastou. NULL = coluna derivada dos 3 acessos (comportamento anterior).';

-- View dos sócios do board: expõe o estágio próprio (id + chave) ao FINAL.
-- Corpo idêntico ao vigente (pg_get_viewdef), só acrescenta estagio_id/chave.
create or replace view cs.vw_hm_socios as
 SELECT s.id AS socio_id,
    s.contato_hm_id,
    s.nome,
    s.email,
    s.telefone,
    s.link_facebook,
    s.ativ_searchie,
    s.ativ_comunidade,
    s.ativ_grupo,
    s.aluno_id,
    s.criado_em,
    ch.comprador_id AS titular_comprador_id,
    cp.nome AS titular_nome,
    ch.turma AS titular_turma,
    ch.turma_origem AS titular_origem,
    e.chave AS titular_estagio_chave,
    ch.cancelamento_efetivado_em IS NOT NULL OR e.chave = 'hm_reembolsado'::text AS titular_cancelado,
    s.ativ_searchie::integer + s.ativ_comunidade::integer + s.ativ_grupo::integer AS checks_feitos,
        CASE
            WHEN ch.cancelamento_efetivado_em IS NOT NULL OR e.chave = 'hm_reembolsado'::text THEN 'sem_acesso'::text
            WHEN s.ativ_searchie AND s.ativ_comunidade AND s.ativ_grupo THEN 'ativado'::text
            WHEN s.ativ_searchie OR s.ativ_comunidade OR s.ativ_grupo THEN 'em_ativacao'::text
            ELSE 'nao_iniciado'::text
        END AS status,
    ch.aluno_id AS titular_aluno_id,
    s.origem,
    s.estagio_id,
    se.chave AS estagio_chave
   FROM cs.hm_socios s
     JOIN cs.contatos_hm ch ON ch.id = s.contato_hm_id
     JOIN compradores cp ON cp.id = ch.comprador_id
     LEFT JOIN cs.estagios e ON e.id = ch.estagio_id
     LEFT JOIN cs.estagios se ON se.id = s.estagio_id;
