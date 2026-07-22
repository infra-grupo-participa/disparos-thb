-- =====================================================================
-- 0126_hm_imersao_janela_e_origem_do_socio
--
-- (1) fn_hm_canal_imersao pegava QUALQUER compra da oferta nz3ob9r2 após 01/06,
--     capturando 3 que compraram em 15-17/06 (edições HT 24/26 na planilha), não
--     a Imersão POA (08/06). Restringe à janela da imersão (01-10/06). Pós re-sync:
--     Imersão fica com os 5 corretos; Gustavo/Hudson → HT26; Guilherme → Programa.
-- (2) Sócio ganha ORIGEM própria (cs.hm_socios.origem) — a planilha de sócios traz
--     o canal de cada um (LDP→Live / HT ATM / HT24 / HT26 / Imersão POA). Preenche
--     os 8 atuais por e-mail e expõe em cs.vw_hm_socios (coluna ao FINAL). O front
--     (API /api/hm/kanban + ficha do sócio) mostra a origem como badge.
-- =====================================================================

create or replace function cs.fn_hm_canal_imersao(p_comprador_id uuid)
 returns text language sql stable security definer
 set search_path to 'cs', 'public', 'pg_temp'
as $function$
  select 'Imersão POA'
    from public.compras c
   where c.comprador_id = p_comprador_id
     and c.oferta_codigo = 'nz3ob9r2'
     and c.status in ('APPROVED','COMPLETE','COMPLETED')
     and coalesce(c.data_compra, c.data_aprovacao) >= '2026-06-01 00:00:00-03'
     and coalesce(c.data_compra, c.data_aprovacao) <  '2026-06-11 00:00:00-03'
   limit 1;
$function$;

alter table cs.hm_socios add column if not exists origem text;

update cs.hm_socios s set origem = v.origem, atualizado_em = now()
from (values
  ('anildo@contabilidadexavier.com.br', 'Live Direto ao Ponto'),
  ('edjamerson@resist.com.br',          'HT ATM'),
  ('alexandrenunes0@hotmail.com',       'HT24'),
  ('gifsc@terra.com.br',                'HT26'),
  ('joycebudtingeradv@gmail.com',       'Imersão POA'),
  ('gabriela@pluraloffice.com.br',      'Imersão POA'),
  ('emanuela.adm@gmail.com',            'Live Direto ao Ponto'),
  ('regina@perfilassessoria.com.br',    'HT ATM')
) as v(email, origem)
where lower(trim(s.email)) = v.email;

create or replace view cs.vw_hm_socios as
 select s.id as socio_id, s.contato_hm_id, s.nome, s.email, s.telefone, s.link_facebook,
        s.ativ_searchie, s.ativ_comunidade, s.ativ_grupo, s.aluno_id, s.criado_em,
        ch.comprador_id as titular_comprador_id, cp.nome as titular_nome,
        ch.turma as titular_turma, ch.turma_origem as titular_origem, e.chave as titular_estagio_chave,
        ch.cancelamento_efetivado_em is not null or e.chave = 'hm_reembolsado' as titular_cancelado,
        s.ativ_searchie::int + s.ativ_comunidade::int + s.ativ_grupo::int as checks_feitos,
        case when ch.cancelamento_efetivado_em is not null or e.chave = 'hm_reembolsado' then 'sem_acesso'
             when s.ativ_searchie and s.ativ_comunidade and s.ativ_grupo then 'ativado'
             when s.ativ_searchie or s.ativ_comunidade or s.ativ_grupo then 'em_ativacao'
             else 'nao_iniciado' end as status,
        ch.aluno_id as titular_aluno_id,
        s.origem
   from cs.hm_socios s
   join cs.contatos_hm ch on ch.id = s.contato_hm_id
   join public.compradores cp on cp.id = ch.comprador_id
   left join cs.estagios e on e.id = ch.estagio_id;
