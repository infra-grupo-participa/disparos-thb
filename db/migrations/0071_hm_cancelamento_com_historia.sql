-- =====================================================================
-- 0071_hm_cancelamento_com_historia
-- Cancelar deixa de apagar. O aluno que sai continua existindo.
--
-- A 0070 resolvia o cancelamento com DELETE: quem nasceu neste funil
-- (fonte = 'sip_ativacao_hm') e cancelava sumia de thb_alunos. Só que o
-- cancelamento não é um fim — é um estado. A pessoa volta, e quando volta
-- queremos saber quem ela foi: a turma, a validade que teve, os acessos que
-- usou, os sócios que trouxe, por que saiu. Um cadastro apagado não conta
-- história nenhuma. E o DELETE ainda era disparado pela SOLICITAÇÃO (arrastar
-- o card), não pelo fato — reembolso negado pela Hotmart destruía o cadastro
-- de um aluno que continuava aluno.
--
-- Passa a valer:
--
--   SOLICITOU  → o card vai para "Solicitou Cancelamento" e nada acontece na
--                base. É intenção, e intenção volta atrás.
--   CANCELOU   → o fato chega da Hotmart (PURCHASE_REFUNDED / CHARGEBACK /
--                PROTEST / SUBSCRIPTION_CANCELLATION, tratados no webhook) ou
--                é confirmado à mão. AÍ o aluno é marcado como cancelado —
--                nunca apagado —, some das telas operacionais do GPS e nasce a
--                pendência de REMOVER OS ACESSOS.
--   REVOGOU    → o Thomas dá baixa nos quatro acessos, um a um (Searchie,
--                Comunidade, Grupo, Pesquisa). O sistema carimba quem e quando,
--                no card e na ficha do aluno.
--   VOLTOU     → pagou de novo: o provisionamento reencontra a MESMA linha,
--                limpa o cancelamento, carimba retornou_em e renova a validade.
--                Turma, sócios e histórico continuam lá.
--
-- A validade (data_expiracao) NÃO é reescrita no cancelamento: ela é o que foi
-- contratado, e mentir sobre ela seria reescrever o passado. Quem esconde o
-- cancelado das telas do GPS é cancelado_em — e quem de fato tira o acesso é o
-- Thomas, no checklist de revogação.
--
-- Aditiva e idempotente.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1) Onde o cancelamento mora
-- ---------------------------------------------------------------------

-- Card: a solicitação (cancelamento_em, que já existia) ganha um irmão — o fato.
alter table cs.contatos_hm
  add column if not exists cancelamento_efetivado_em timestamptz,
  add column if not exists cancelamento_origem       text,   -- 'hotmart' | 'manual'
  add column if not exists rev_searchie              boolean not null default false,
  add column if not exists rev_comunidade            boolean not null default false,
  add column if not exists rev_grupo                 boolean not null default false,
  add column if not exists rev_pesquisa              boolean not null default false,
  add column if not exists acessos_revogados_em      timestamptz,
  add column if not exists acessos_revogados_por     text;

comment on column cs.contatos_hm.cancelamento_em is
  'Quando o aluno PEDIU o cancelamento. Intenção — não mexe na base.';
comment on column cs.contatos_hm.cancelamento_efetivado_em is
  'Quando o cancelamento virou FATO (reembolso na Hotmart ou confirmação manual). É este que marca o aluno.';

-- Ficha do aluno: o cancelamento e a revogação dos acessos viram parte da história.
alter table public.thb_alunos
  add column if not exists cancelado_em           timestamptz,
  add column if not exists cancelado_motivo       text,
  add column if not exists cancelado_origem       text,
  add column if not exists acessos_revogados_em   timestamptz,
  add column if not exists acessos_revogados_por  text,
  add column if not exists retornou_em            timestamptz;

comment on column public.thb_alunos.cancelado_em is
  'Cancelamento efetivado. Não apaga o aluno: esconde-o das telas operacionais (vw_aluno_360) e preserva o histórico para quando ele voltar.';
comment on column public.thb_alunos.retornou_em is
  'Voltou depois de ter cancelado — o cadastro é o mesmo, a turma é a mesma.';

create index if not exists idx_thb_alunos_cancelado_em on public.thb_alunos (cancelado_em);

-- ---------------------------------------------------------------------
-- 2) Cancelar = marcar, nunca apagar
-- ---------------------------------------------------------------------
-- A assinatura antiga (só o comprador) sai: com os defaults da nova, uma chamada
-- de um argumento ficaria ambígua — e ela é justamente a que apagava o aluno.
drop function if exists cs.fn_hm_cancelar(uuid);

create or replace function cs.fn_hm_cancelar(
  p_comprador_id uuid,
  p_motivo       text default null,
  p_origem       text default 'manual'
)
returns text
language plpgsql
security definer
set search_path to 'cs', 'public', 'pg_temp'
as $function$
declare
  v_aluno_id uuid;
  v_motivo   text;
begin
  select ch.aluno_id into v_aluno_id from cs.contatos_hm ch where ch.comprador_id = p_comprador_id;

  -- O card guarda o fato mesmo quando não há aluno (cancelou antes de pagar o
  -- saldo): é dele que sai a fila de cancelamentos.
  update cs.contatos_hm
     set cancelamento_em           = coalesce(cancelamento_em, now()),
         cancelamento_efetivado_em = coalesce(cancelamento_efetivado_em, now()),
         cancelamento_origem       = coalesce(cancelamento_origem, p_origem),
         cancelamento_motivo       = coalesce(nullif(p_motivo, ''), cancelamento_motivo),
         atualizado_em             = now()
   where comprador_id = p_comprador_id;

  if v_aluno_id is null then return 'sem_aluno'; end if;

  v_motivo := coalesce(nullif(p_motivo, ''), 'Cancelamento do Holding Masters');

  -- O aluno e os sócios que só existem porque ele os trouxe. Ninguém é apagado:
  -- ficam marcados, somem do GPS e continuam inteiros para o dia em que voltar.
  update public.thb_alunos a
     set cancelado_em         = coalesce(a.cancelado_em, now()),
         cancelado_motivo     = coalesce(a.cancelado_motivo, v_motivo),
         cancelado_origem     = coalesce(a.cancelado_origem, p_origem),
         situacao_financeira  = 'cancelado',
         status_pagamento     = 'Cancelado',
         retornou_em          = null,
         atualizado_em        = now()
   where a.id = v_aluno_id
      or (a.socio_de_aluno_id = v_aluno_id and a.fonte = 'sip_ativacao_hm');

  return 'cancelado';
end$function$;

grant execute on function cs.fn_hm_cancelar(uuid, text, text) to disparos_app;

-- ---------------------------------------------------------------------
-- 3) O fato chega da Hotmart: reembolso/chargeback pela transação
-- ---------------------------------------------------------------------
-- Chamada pela Edge Function do webhook. Atualiza a compra, efetiva o
-- cancelamento e joga o card para "Solicitou Cancelamento" (a coluna onde a
-- operação vê quem saiu), registrando tudo na timeline.
create or replace function cs.fn_hm_cancelar_por_transacao(
  p_transaction text,
  p_evento      text,
  p_status      text
)
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
begin
  update public.compras
     set status        = p_status,
         hotmart_event = p_evento,
         atualizado_em = now()
   where hotmart_transaction = p_transaction
  returning comprador_id into v_comprador_id;

  if v_comprador_id is null then
    return jsonb_build_object('achou_compra', false);
  end if;

  select ch.id, ch.estagio_id into v_card_id, v_estagio_ant
    from cs.contatos_hm ch where ch.comprador_id = v_comprador_id;

  if v_card_id is null then
    -- Compra de outro canal (HT, Clínica…): o status já foi corrigido, e é isso
    -- que o canal precisa. Não há esteira de HM para mexer.
    return jsonb_build_object('achou_compra', true, 'tem_card_hm', false, 'comprador_id', v_comprador_id);
  end if;

  v_motivo   := 'Cancelado na Hotmart (' || p_evento || ')';
  v_resultado := cs.fn_hm_cancelar(v_comprador_id, v_motivo, 'hotmart');

  select id into v_estagio_id from cs.estagios where chave = 'hm_cancelamento' and evento = 'HM';
  if v_estagio_id is not null and v_estagio_ant is distinct from v_estagio_id then
    update cs.contatos_hm set estagio_id = v_estagio_id, atualizado_em = now() where id = v_card_id;
    insert into cs.interacoes (contato_hm_id, tipo, descricao, autor, estagio_anterior_id, estagio_novo_id)
    values (v_card_id, 'mudanca_estagio', 'Movido para "Solicitou Cancelamento" pelo cancelamento na Hotmart',
            'hotmart', v_estagio_ant, v_estagio_id);
  end if;

  insert into cs.interacoes (contato_hm_id, tipo, descricao, autor)
  values (
    v_card_id, 'sistema',
    case v_resultado
      when 'cancelado' then v_motivo || ' — aluno marcado como cancelado na base THB. Remover os acessos.'
      else v_motivo || ' — o contato ainda não era aluno; nada a remover na base.'
    end,
    'hotmart'
  );

  return jsonb_build_object(
    'achou_compra', true, 'tem_card_hm', true,
    'comprador_id', v_comprador_id, 'resultado', v_resultado
  );
end$function$;

grant execute on function cs.fn_hm_cancelar_por_transacao(text, text, text) to disparos_app;

-- A Edge Function fala com o PostgREST, que só enxerga os schemas expostos — e
-- cs não é um deles. Esta é a porta em public; a regra continua morando em cs.
create or replace function public.fn_hm_cancelar_por_transacao(
  p_transaction text,
  p_evento      text,
  p_status      text
)
returns jsonb
language sql
security definer
set search_path to 'public', 'cs', 'pg_temp'
as $$
  select cs.fn_hm_cancelar_por_transacao(p_transaction, p_evento, p_status);
$$;

revoke all on function public.fn_hm_cancelar_por_transacao(text, text, text) from public, anon, authenticated;
grant execute on function public.fn_hm_cancelar_por_transacao(text, text, text) to service_role;

-- Desfazer um cancelamento lançado por engano (ou negado pela Hotmart depois de
-- efetivado). O aluno volta a valer — inclusive quem já estava com a validade
-- vencida, por isso a marca é limpa aqui e não deixada para o gatilho de retorno
-- (que só reage a quem volta com acesso válido). O motivo do cancelamento fica:
-- foi o que aconteceu, e apagá-lo seria mentir sobre o passado.
create or replace function cs.fn_hm_descancelar(p_comprador_id uuid)
returns text
language plpgsql
security definer
set search_path to 'cs', 'public', 'pg_temp'
as $function$
declare
  v_aluno_id uuid;
begin
  select ch.aluno_id into v_aluno_id from cs.contatos_hm ch where ch.comprador_id = p_comprador_id;

  update cs.contatos_hm
     set cancelamento_efetivado_em = null,
         cancelamento_origem       = null,
         atualizado_em             = now()
   where comprador_id = p_comprador_id;

  if v_aluno_id is null then return 'sem_aluno'; end if;

  update public.thb_alunos a
     set cancelado_em     = null,
         cancelado_origem = null,
         situacao_financeira = case
           when coalesce(a.valor_total, 0) > 0 and coalesce(a.saldo_devedor, 0) = 0 then 'quitado'
           when coalesce(a.valor_pago, 0) > 0 then 'em_andamento'
           else 'so_sinal' end,
         status_pagamento = case
           when coalesce(a.valor_total, 0) > 0 and coalesce(a.saldo_devedor, 0) = 0 then 'Quitado'
           when coalesce(a.valor_pago, 0) > 0 then 'Em andamento'
           else 'Só sinal pago' end,
         atualizado_em = now()
   where a.id = v_aluno_id
      or (a.socio_de_aluno_id = v_aluno_id and a.fonte = 'sip_ativacao_hm');

  return 'descancelado';
end$function$;

grant execute on function cs.fn_hm_descancelar(uuid) to disparos_app;

-- ---------------------------------------------------------------------
-- 4) A baixa dos acessos: o card carimba, a ficha do aluno espelha
-- ---------------------------------------------------------------------
-- Os quatro acessos revogados = revogação completa. A data nasce sozinha (não
-- se digita "quando"), e some se alguém desmarcar um item — a fila do Thomas
-- volta a acusar o que ficou aberto.
create or replace function cs.trg_hm_revogacao()
returns trigger
language plpgsql
as $$
begin
  if new.rev_searchie and new.rev_comunidade and new.rev_grupo and new.rev_pesquisa then
    new.acessos_revogados_em := coalesce(new.acessos_revogados_em, now());
  else
    new.acessos_revogados_em  := null;
    new.acessos_revogados_por := null;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_hm_revogacao on cs.contatos_hm;
create trigger trg_hm_revogacao
  before insert or update of rev_searchie, rev_comunidade, rev_grupo, rev_pesquisa
  on cs.contatos_hm
  for each row execute function cs.trg_hm_revogacao();

-- Espelho na ficha do aluno: quem remove o acesso é o Thomas no card, mas quem
-- responde "esse aluno ainda tem acesso?" é a base.
create or replace function cs.trg_hm_revogacao_espelho()
returns trigger
language plpgsql
security definer
set search_path to 'cs', 'public', 'pg_temp'
as $$
begin
  if new.aluno_id is not null
     and new.acessos_revogados_em is distinct from old.acessos_revogados_em then
    update public.thb_alunos
       set acessos_revogados_em  = new.acessos_revogados_em,
           acessos_revogados_por = new.acessos_revogados_por,
           atualizado_em         = now()
     where id = new.aluno_id;
  end if;
  return null;
end;
$$;

drop trigger if exists trg_hm_revogacao_espelho on cs.contatos_hm;
create trigger trg_hm_revogacao_espelho
  after update on cs.contatos_hm
  for each row execute function cs.trg_hm_revogacao_espelho();

-- ---------------------------------------------------------------------
-- 5) Voltar: o mesmo cadastro, com o cancelamento datado
-- ---------------------------------------------------------------------
-- O provisionamento (fn_hm_provisionar_aluno) reencontra o aluno cancelado por
-- comprador_id/e-mail e cai no ramo "aluno da base": renova a validade, mantém a
-- turma, e regrava a situação financeira ('quitado'/'em_andamento'/'só sinal').
-- É exatamente esse retorno à vida financeira — e não a data de validade, que
-- pode nem mudar — o sinal de que a pessoa voltou.
create or replace function public.trg_aluno_retornou()
returns trigger
language plpgsql
as $$
begin
  if old.cancelado_em is not null
     and new.situacao_financeira is distinct from 'cancelado'
     and coalesce(new.data_expiracao, current_date) >= current_date then
    new.retornou_em      := now();
    new.cancelado_em     := null;   -- volta a aparecer para o GPS
    new.cancelado_origem := null;
    -- cancelado_motivo permanece: é a história de por que ele saiu da outra vez.
  end if;
  return new;
end;
$$;

drop trigger if exists trg_aluno_retornou on public.thb_alunos;
create trigger trg_aluno_retornou
  before update on public.thb_alunos
  for each row execute function public.trg_aluno_retornou();

-- ---------------------------------------------------------------------
-- 6) As telas: o GPS não vê o cancelado; a operação vê todos eles
-- ---------------------------------------------------------------------

-- O card, com o cancelamento e a revogação.
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
    -- A fila do Thomas: cancelou de verdade e ainda tem acesso vivo em algum lugar.
    (ch.cancelamento_efetivado_em is not null and ch.acessos_revogados_em is null) AS acessos_a_remover
   FROM cs.contatos_hm ch
     JOIN compradores cmp ON cmp.id = ch.comprador_id
     LEFT JOIN cs.estagios est ON est.id = ch.estagio_id
     LEFT JOIN LATERAL ( SELECT COALESCE(c.data_compra, c.data_aprovacao) AS pago_em,
            c.preco AS valor
           FROM compras c
             JOIN hm_product_catalog cat ON cat.offer_code = c.oferta_codigo::text
          WHERE c.comprador_id = ch.comprador_id AND cat.categoria = 'sinal'::text
            AND (c.status::text = ANY (ARRAY['APPROVED'::character varying, 'COMPLETE'::character varying, 'COMPLETED'::character varying]::text[]))
          ORDER BY (COALESCE(c.data_compra, c.data_aprovacao))
         LIMIT 1) s ON true;

-- O aluno cancelado sai da visão operacional do GPS — sem sair do banco.
create or replace view public.vw_aluno_360 as
 WITH compras_resumo AS (
         SELECT cp.comprador_id,
            bool_or(cp.produto_nome::text ~~* '%Holding Total%'::text AND (cp.status::text = ANY (ARRAY['APPROVED'::text, 'COMPLETE'::text]))) AS tem_ht_compra,
            bool_or(cp.produto_nome::text ~~* '%Holding Masters%'::text AND (cp.status::text = ANY (ARRAY['APPROVED'::text, 'COMPLETE'::text]))) AS tem_hm_compra,
            max(cp.data_compra) FILTER (WHERE cp.produto_nome::text ~~* '%Holding Total%'::text AND (cp.status::text = ANY (ARRAY['APPROVED'::text, 'COMPLETE'::text]))) AS data_compra_ht,
            max(cp.data_compra) FILTER (WHERE cp.produto_nome::text ~~* '%Holding Masters%'::text AND (cp.status::text = ANY (ARRAY['APPROVED'::text, 'COMPLETE'::text]))) AS data_compra_hm
           FROM compras cp
          GROUP BY cp.comprador_id
        ), depoimento_resumo AS (
         SELECT gp_depoimentos.aluno_id,
            count(*)::integer AS total_depoimentos
           FROM gp_depoimentos
          GROUP BY gp_depoimentos.aluno_id
        ), cs_resumo AS (
         SELECT u.comprador_id,
            (array_agg(u.estagio_nome ORDER BY u.ord DESC NULLS LAST))[1] AS cs_estagio,
            (array_agg(u.responsavel ORDER BY u.ord DESC NULLS LAST))[1] AS cs_responsavel,
            max(u.ultimo_contato_em) AS cs_ultimo_contato_em,
            (array_agg(u.proxima_acao_em ORDER BY u.ord DESC NULLS LAST))[1] AS cs_proxima_acao_em,
            (array_agg(u.legado_no_grupo ORDER BY u.ord DESC NULLS LAST))[1] AS cs_no_grupo,
            (array_agg(u.observacoes ORDER BY u.ord DESC NULLS LAST))[1] AS cs_observacoes
           FROM ( SELECT contatos_evento.comprador_id,
                    contatos_evento.estagio_nome,
                    contatos_evento.responsavel,
                    contatos_evento.ultimo_contato_em,
                    contatos_evento.proxima_acao_em,
                    contatos_evento.legado_no_grupo,
                    contatos_evento.observacoes,
                    COALESCE(contatos_evento.ultimo_contato_em, contatos_evento.primeiro_contato_em, contatos_evento.proxima_acao_em) AS ord
                   FROM cs.contatos_evento
                  WHERE contatos_evento.comprador_id IS NOT NULL
                UNION ALL
                 SELECT contatos_ht.comprador_id,
                    contatos_ht.estagio_nome,
                    contatos_ht.responsavel,
                    contatos_ht.ultimo_contato_em,
                    contatos_ht.proxima_acao_em,
                    contatos_ht.legado_no_grupo,
                    contatos_ht.observacoes,
                    COALESCE(contatos_ht.ultimo_contato_em, contatos_ht.primeiro_contato_em, contatos_ht.proxima_acao_em) AS ord
                   FROM cs.contatos_ht
                  WHERE contatos_ht.comprador_id IS NOT NULL) u
          GROUP BY u.comprador_id
        ), sip_emails AS (
         SELECT DISTINCT lower(btrim(users.email)) AS e
           FROM sip.users
          WHERE users.email IS NOT NULL AND btrim(users.email) <> ''::text
        )
 SELECT a.id,
    a.nome,
    a.email,
    a.documento,
    a.telefone,
    a.telefone_e164,
    a.profissao,
    a.link_facebook,
    a.cep,
    a.endereco_logradouro,
    a.endereco_numero,
    a.endereco_complemento,
    a.bairro,
    a.cidade,
    a.estado,
    a.pais,
    a.turma_id,
    t.codigo AS turma_codigo,
    t.tipo AS turma_tipo,
    a.turma_aurum_id,
    a.plano,
    a.nivel_resultado,
    a.placa_aurum,
    a.eh_socio,
    a.socio_de_aluno_id,
    a.socio_de_nome,
    a.status_acesso,
    a.comprador_id,
    comp.hotmart_ucode,
    a.turma_id IS NOT NULL OR COALESCE(cr.tem_ht_compra, false) AS tem_ht,
    cr.data_compra_ht,
    a.turma_id IS NOT NULL OR a.turma_aurum_id IS NOT NULL OR COALESCE(cr.tem_hm_compra, false) AS tem_hm,
    cr.data_compra_hm,
    pa.aluno_id IS NOT NULL AS tem_placa,
    pa.step_index AS placa_step,
    pa.encerrado AS placa_encerrada,
    pa.protocolo AS placa_protocolo,
    COALESCE(dr.total_depoimentos, 0) > 0 AS tem_depoimento,
    COALESCE(dr.total_depoimentos, 0) AS total_depoimentos,
    a.fonte,
    a.data_compra AS data_compra_importada,
    a.importado_em,
    a.atualizado_em,
    cs.cs_estagio,
    cs.cs_responsavel,
    cs.cs_ultimo_contato_em,
    cs.cs_proxima_acao_em,
    cs.cs_no_grupo,
    cs.cs_observacoes,
    se.e IS NOT NULL AS sip_registrado,
    a.instagram_url,
    a.youtube_url,
    a.site_profissional,
    a.telefone_profissional,
    a.placa_solicitacao_id,
    ps.id IS NOT NULL AS tem_solicitacao_placa,
    ps.status AS placa_sol_status,
    ps.step_index AS placa_sol_step,
    COALESCE(ps.codigo_rastreio, a.placa_codigo_rastreio) AS placa_rastreio,
    ps.entrevista_data AS placa_entrevista_data,
    ps.regularizacao_pendente AS placa_regularizacao_pendente,
    a.produto,
    a.instrucao,
    a.oferta,
    a.tipo_oferta,
    a.regra_acesso,
    a.data_expiracao,
    a.tempo_acesso,
    a.status_acesso_central,
    a.status_pagamento,
    a.valor_total,
    a.valor_pago,
    a.saldo_devedor,
    a.ultimo_pagamento,
    a.num_cobrancas,
    a.origem_acesso,
    a.num_socios,
    a.tratamento_manual,
    a.obs_central,
    a.situacao_acesso,
    a.espaco_instrucao,
    a.situacao_financeira,
    hm.estagio_nome AS hm_estagio,
    hm.estagio_aba AS hm_estagio_aba,
    hm.responsavel AS hm_responsavel,
    hm.apto_ativacao AS hm_saldo_pago,
    hm.pagamento_em AS hm_pagamento_em,
    hm.entrevista_em AS hm_entrevista_em,
    hm.turma AS hm_turma,
    hm.tags AS hm_tags,
    hm.contato_hm_id IS NOT NULL AS tem_esteira_hm
   FROM thb_alunos a
     LEFT JOIN thb_turmas t ON t.id = a.turma_id
     LEFT JOIN compradores comp ON comp.id = a.comprador_id
     LEFT JOIN compras_resumo cr ON cr.comprador_id = a.comprador_id
     LEFT JOIN thb_placas_auditoria pa ON pa.aluno_id = a.id
     LEFT JOIN depoimento_resumo dr ON dr.aluno_id = a.id
     LEFT JOIN cs_resumo cs ON cs.comprador_id = a.comprador_id
     LEFT JOIN sip_emails se ON se.e = lower(btrim(a.email))
     LEFT JOIN thb_placas_solicitacoes ps ON ps.id = a.placa_solicitacao_id
     LEFT JOIN cs.contatos_hm_kanban hm ON hm.comprador_id = a.comprador_id
  WHERE a.cancelado_em IS NULL;   -- <- cancelado não é aluno ativo (mas continua no banco)

-- Onde os cancelamentos são consultados: a história de quem saiu, com o que
-- falta remover e o que já foi removido. Inclui os cancelamentos antigos, que
-- vieram da planilha sem data (situação financeira 'cancelado').
create or replace view public.vw_alunos_cancelados as
 SELECT a.id AS aluno_id,
    a.nome,
    a.email,
    a.telefone,
    a.comprador_id,
    t.codigo AS turma,
    a.fonte,
    a.data_compra,
    a.data_expiracao,
    a.valor_total,
    a.valor_pago,
    a.cancelado_em,
    a.cancelado_motivo,
    a.cancelado_origem,
    a.acessos_revogados_em,
    a.acessos_revogados_por,
    a.retornou_em,
    a.eh_socio,
    a.socio_de_aluno_id,
    hm.contato_hm_id,
    hm.estagio_nome AS hm_estagio,
    hm.cancelamento_em AS hm_solicitou_em,
    hm.cancelamento_efetivado_em AS hm_cancelado_em,
    hm.rev_searchie,
    hm.rev_comunidade,
    hm.rev_grupo,
    hm.rev_pesquisa,
    (a.cancelado_em IS NOT NULL AND a.acessos_revogados_em IS NULL) AS acessos_a_remover
   FROM thb_alunos a
     LEFT JOIN thb_turmas t ON t.id = a.turma_id
     LEFT JOIN cs.contatos_hm_kanban hm ON hm.comprador_id = a.comprador_id
  WHERE a.cancelado_em IS NOT NULL
     OR lower(coalesce(a.situacao_financeira, '')) = 'cancelado';

grant select on public.vw_alunos_cancelados to disparos_app;

-- Contagens do GPS: aluno cancelado não conta como aluno.
create or replace view public.vw_dashboard_resumo as
 SELECT ( SELECT count(*) AS count
           FROM thb_alunos
          WHERE thb_alunos.cancelado_em IS NULL) AS total_alunos,
    ( SELECT count(*) AS count
           FROM thb_alunos
          WHERE thb_alunos.comprador_id IS NOT NULL AND thb_alunos.cancelado_em IS NULL) AS alunos_vinculados,
    ( SELECT count(*) AS count
           FROM thb_alunos
          WHERE thb_alunos.comprador_id IS NULL AND thb_alunos.cancelado_em IS NULL) AS alunos_sem_vinculo,
    ( SELECT count(*) AS count
           FROM thb_alunos
          WHERE thb_alunos.nivel_resultado IS NULL AND thb_alunos.cancelado_em IS NULL) AS alunos_sem_nivel,
    ( SELECT count(*) AS count
           FROM compradores) AS total_compradores,
    ( SELECT count(*) AS count
           FROM thb_placas_solicitacoes
          WHERE thb_placas_solicitacoes.status = 'enviado'::text) AS placas_enviadas,
    ( SELECT count(*) AS count
           FROM thb_placas_solicitacoes
          WHERE thb_placas_solicitacoes.status = 'em_auditoria'::text) AS placas_em_auditoria,
    ( SELECT count(*) AS count
           FROM thb_placas_solicitacoes
          WHERE thb_placas_solicitacoes.status = 'concluido'::text) AS placas_concluidas,
    ( SELECT count(*) AS count
           FROM thb_system_events
          WHERE thb_system_events.tipo = 'error'::text AND thb_system_events.criado_em > (now() - '24:00:00'::interval)) AS erros_24h,
    ( SELECT count(*) AS count
           FROM thb_system_events
          WHERE thb_system_events.criado_em > (now() - '24:00:00'::interval)) AS eventos_24h,
    ( SELECT count(*) AS count
           FROM thb_alunos_audit_log
          WHERE thb_alunos_audit_log.criado_em > (now() - '24:00:00'::interval)) AS audits_24h,
    ( SELECT count(*) AS count
           FROM vw_inconsistencias_alunos) AS total_inconsistencias,
    now() AS gerado_em;

-- ---------------------------------------------------------------------
-- 7) Uma palavra só para "cancelado"
-- ---------------------------------------------------------------------
-- A base já tinha 5 alunos vindos da planilha com 'cancelada' / 'Cancelada pelo
-- cliente', enquanto a função gravava 'cancelado' / 'Cancelado (HM)'. Duas
-- palavras para o mesmo fato = filtro que perde metade dos casos. O texto
-- original vira o MOTIVO (é o que ele sempre foi).
--
-- Estes NÃO ganham cancelado_em: são cancelamentos antigos, sem data conhecida,
-- e carimbá-los com uma data inventada os faria sumir do GPS hoje, de surpresa.
-- Aparecem em vw_alunos_cancelados pelo situacao_financeira.
update public.thb_alunos
   set cancelado_motivo    = coalesce(cancelado_motivo, nullif(status_pagamento, '')),
       situacao_financeira = 'cancelado',
       status_pagamento    = 'Cancelado',
       atualizado_em       = now()
 where lower(coalesce(situacao_financeira, '')) in ('cancelada', 'cancelado')
   and (situacao_financeira <> 'cancelado' or status_pagamento <> 'Cancelado');
