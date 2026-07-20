-- =====================================================================
-- 0111_vw_gps_acessos
--
-- A CONSULTA DOS ACESSOS DO GPS, para o admin.
--
-- Depois da Fase 3 (0109/0110) o funil passou a CRIAR acesso: quem paga o sinal
-- ganha linha de trilha. Só que criar a linha na base HABILITA o acesso — não
-- garante que a pessoa ENTROU no GPS. Na verificação, os 74 da trilha estavam
-- com 0 membros e 0 clientes no GPS: o vínculo por documento acontece quando a
-- pessoa entra lá, não proativamente.
--
-- Esta view mostra as duas coisas lado a lado, que é o que o admin precisa saber:
--   • habilitado  → existe linha em thb_alunos (o GPS consegue casar)
--   • entrou      → já é membro/cliente no GPS de fato
--   • sem_documento → o GPS casa por DOCUMENTO; sem CPF ele nunca vai achar
--
-- Só leitura.
-- =====================================================================

create or replace view cs.vw_gps_acessos as
select
  a.id                       as aluno_id,
  a.nome,
  a.email,
  a.telefone,
  a.documento,
  -- O tipo do acesso: trilha (pagou o sinal) x aluno (quitou/parcelou, tem turma)
  case when a.fonte = 'sip_sinal_trilha' then 'trilha' else 'aluno' end as tipo,
  a.fonte,
  t.codigo                   as turma,
  a.plano,
  a.status_acesso,
  a.regra_acesso,
  a.data_compra,
  a.data_expiracao,
  (a.data_expiracao is not null and a.data_expiracao < current_date) as acesso_vencido,
  a.situacao_financeira,
  a.cancelado_em,
  a.importado_em             as criado_em,
  -- O outro lado: a pessoa ENTROU no GPS?
  exists (select 1 from gps.membros m         where m.aluno_id = a.id) as gps_membro,
  exists (select 1 from gps.etapa1_clientes c where c.aluno_id = a.id) as gps_cliente,
  (a.documento is null)      as sem_documento,
  a.comprador_id
from public.thb_alunos a
left join public.thb_turmas t on t.id = a.turma_id;

grant select on cs.vw_gps_acessos to disparos_app;
-- A view lê o schema do GPS; o app precisa enxergar essas duas tabelas (só leitura).
grant usage on schema gps to disparos_app;
grant select on gps.membros, gps.etapa1_clientes to disparos_app;

comment on view cs.vw_gps_acessos is
  'Acessos do GPS para consulta do admin: quem foi HABILITADO (linha em thb_alunos) x quem ENTROU (membro/cliente no GPS), com o tipo (trilha do sinal x aluno) e o alerta de documento ausente.';
