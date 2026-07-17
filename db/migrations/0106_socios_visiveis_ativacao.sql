-- =====================================================================
-- 0106_socios_visiveis_ativacao
--
-- O SÓCIO passa a ser visível na esteira de Ativação (aba "SÓCIOS T39"). Ele já
-- existia como sub-registro do card do titular (cs.hm_socios: nome + 3 checks de
-- acesso, sem financeiro). Faltava aparecer no board para o Thomas liberar o
-- acesso. Aqui ele NÃO vira comprador nem card financeiro — continua pendurado no
-- titular, e a UI o mostra como um card azul em "Pendente de Liberação".
--
-- Duas partes:
--   1) Importa os 4 sócios da planilha que ainda não estavam cadastrados.
--   2) Cria cs.vw_hm_socios — uma linha por sócio, com o titular, o status de
--      ativação e a CASCATA: se o titular cancelar/for reembolsado, o sócio perde
--      o acesso (o acesso do sócio existe enquanto o do titular existir).
-- Idempotente.
-- =====================================================================

-- 1) Importa os 4 sócios que faltam (2 já estavam: Alexandre e Maria Regina) ----
insert into cs.hm_socios (contato_hm_id, nome, email, telefone)
select ch.id, par.socio_nome, par.socio_email, par.socio_tel
  from (values
    ('altairxavier16@gmail.com',          'Anildo Fogaça Junior',            'anildo@contabilidadexavier.com.br', '5549999368864'),
    ('tarciopessoa@me.com',               'Emanuela Lyra de Albuquerque',    'emanuela.adm@gmail.com',            '5583993552059'),
    ('veridiane@perfilassessoria.com.br', 'Regina Shizue Narimatsu Rangel',  'regina@perfilassessoria.com.br',    '5567999760088'),
    ('dilcele@assisguerra.com.br',        'Edjamerson Leopoldo Dias Guerra', 'edjamerson@resist.com.br',          '5531987891275')
  ) as par(titular_email, socio_nome, socio_email, socio_tel)
  join public.compradores cp on lower(btrim(cp.email)) = par.titular_email
  join cs.contatos_hm ch on ch.comprador_id = cp.id
 where not exists (
   select 1 from cs.hm_socios s
    where s.contato_hm_id = ch.id
      and lower(btrim(coalesce(s.email,''))) = lower(par.socio_email)
 );

-- 2) A view do sócio: dados + titular + status + cascata --------------------
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
       end                  as status
  from cs.hm_socios s
  join cs.contatos_hm ch on ch.id = s.contato_hm_id
  join public.compradores cp on cp.id = ch.comprador_id
  left join cs.estagios e on e.id = ch.estagio_id;

grant select on cs.vw_hm_socios to disparos_app;

comment on view cs.vw_hm_socios is
  'Um sócio por linha (cs.hm_socios) com o titular, o status de ativação (nao_iniciado/em_ativacao/ativado) e a cascata sem_acesso quando o titular cancela.';
