-- =====================================================================
-- 0117_socios_estado_na_base
--
-- O sócio "certinho na base de dados": a view passa a dizer se o SÓCIO já existe
-- em public.thb_alunos (a base mestre que o GPS lê) e se o TITULAR já é aluno.
-- Sem isso o board não conseguia mostrar o gargalo real — sócios cujo titular já
-- pagou, mas que nunca foram provisionados na base (importados por planilha antes
-- de o titular quitar, ou por SQL direto como na 0106). Eles ficam no kanban com
-- os acessos marcados, porém invisíveis para o GPS.
--
-- Só adiciona `titular_aluno_id` (o aluno_id do sócio já saía como `aluno_id`).
-- O front deriva três estados:
--   • sócio com aluno_id            → "na base" (ok)
--   • sem aluno_id, titular é aluno → "fora da base" (GARGALO — provisionar)
--   • sem aluno_id, titular não é   → "aguarda o titular pagar" (normal)
-- Aditiva e idempotente (recria a view; nenhuma coluna some).
-- =====================================================================

create or replace view cs.vw_hm_socios as
select s.id                as socio_id,
       s.contato_hm_id,
       s.nome, s.email, s.telefone, s.link_facebook,
       s.ativ_searchie, s.ativ_comunidade, s.ativ_grupo,
       s.aluno_id,
       s.criado_em,
       ch.comprador_id      as titular_comprador_id,
       cp.nome              as titular_nome,
       ch.turma             as titular_turma,
       ch.turma_origem      as titular_origem,
       e.chave              as titular_estagio_chave,
       -- CASCATA: o acesso do sócio vale enquanto o do titular valer.
       (ch.cancelamento_efetivado_em is not null or e.chave = 'hm_reembolsado') as titular_cancelado,
       (s.ativ_searchie::int + s.ativ_comunidade::int + s.ativ_grupo::int) as checks_feitos,
       case
         when (ch.cancelamento_efetivado_em is not null or e.chave = 'hm_reembolsado') then 'sem_acesso'
         when s.ativ_searchie and s.ativ_comunidade and s.ativ_grupo         then 'ativado'
         when s.ativ_searchie or  s.ativ_comunidade or  s.ativ_grupo         then 'em_ativacao'
         else 'nao_iniciado'
       end                  as status,
       -- Acrescentada ao FINAL: create-or-replace só permite append de colunas.
       ch.aluno_id          as titular_aluno_id
  from cs.hm_socios s
  join cs.contatos_hm ch on ch.id = s.contato_hm_id
  join public.compradores cp on cp.id = ch.comprador_id
  left join cs.estagios e on e.id = ch.estagio_id;

grant select on cs.vw_hm_socios to disparos_app;

comment on view cs.vw_hm_socios is
  'Um sócio por linha (cs.hm_socios) com o titular, o status de ativação e a cascata sem_acesso quando o titular cancela. aluno_id/titular_aluno_id dizem quem já está na base mestre THB.';
