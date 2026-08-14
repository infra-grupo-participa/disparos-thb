-- 0239_a_central_passa_a_sair_do_banco.sql
-- A Central de Alunos deixa de ser planilha mantida à mão e passa a SAIR do banco,
-- já com o processo da ativação dentro.
--
-- Decisão do Marcio (14/08/2026): "a ativação passa a alimentar a Central — é o processo
-- de encaminhamento dos alunos, para a gente saber onde estão os processos".
--
-- ---------------------------------------------------------------------------
-- O QUE A MEDIÇÃO MOSTROU (14/08/2026) — o cano já existe; quem está velha é a planilha
--
-- 285 cards ativos na ativação · 180 estão na planilha · **105 não estão**.
-- Desses 105, **97 JÁ ESTÃO em public.thb_alunos**. O provisionamento
-- (`fn_hm_provisionar_aluno`, `sip_ativacao_hm`, `sip_sinal_trilha`) funciona.
--
-- Os 8 que não estão em lugar nenhum, um a um:
--   · Kelly A. e Bruno Hermann ......... "Boleto Gerado", nenhuma compra aprovada. CORRETO.
--   · Gilmar Afonso, Roberto Pires,
--     Edson Rodrigo, Thereza Christina .. AURUM, só a entrada de R$ 1.000 do evento.
--                                         Não compraram programa. CORRETO.
--   · Lidiane Praxedes ................. oferta 6qxsk9kq (R$ 2.497), boleto ainda gerado.
--   · **Leonardo Gomes de C. M. Leite ... QUITADO, T39, e fora da base. Este é o furo.**
--
-- Ou seja: o buraco não era de 111 pessoas. Era de **uma**. O resto é a planilha ser um
-- retrato congelado — a aba oficial parou em 14/08 e o `Resumo` dela, em 28/07, ainda
-- anunciando 1.662 pessoas quando a aba tem 1.501.
--
-- Enquanto a Central for um arquivo que alguém exporta e edita, ela volta a envelhecer na
-- semana seguinte. A correção não é um processo novo de cópia: é a Central passar a ser
-- uma CONSULTA. Quem quiser o xlsx exporta desta view, e ele nasce certo.
--
-- Aditivo: cria uma view e um alerta. Não altera tabela, não altera dado, não toca
-- `public.thb_alunos`. Idempotente.

-- ---------------------------------------------------------------------------
-- 1) A Central, gerada
--
-- Mesma espinha da planilha (identidade · produto · instrução · turma · oferta · acesso),
-- mais as colunas que a planilha nunca teve e que são a razão do pedido: em que etapa da
-- ativação a pessoa está, com quem, e quanto falta.
--
-- `vw_aluno_360` já costura `thb_alunos` com o card da ativação — por isso a view sai dela,
-- e não de um JOIN novo que precisaria repetir a regra de casamento (e divergiria dela).
-- ---------------------------------------------------------------------------
create or replace view cs.vw_central_alunos as
select
    a.nome,
    -- o documento sai normalizado: a planilha tem 24 CPFs de sócio destruídos por
    -- notação científica (3,79E+10 -> 37900000000) e 69 linhas sem documento nenhum
    nullif(regexp_replace(coalesce(a.documento,''), '[^0-9]', '', 'g'), '') as documento,
    lower(trim(a.email))                                        as email,
    coalesce(a.telefone_e164, a.telefone)                       as telefone,
    a.cidade, a.estado,
    a.produto,
    a.instrucao,
    a.turma_codigo                                              as turma,
    t.codigo                                                    as turma_aurum,
    a.nivel_resultado                                           as nivel,
    a.oferta, a.tipo_oferta, a.regra_acesso,
    a.data_compra_importada::date                               as data_da_compra,
    a.data_expiracao::date                                      as data_de_expiracao,
    a.tempo_acesso, a.status_acesso, a.status_pagamento          as status_de_cobranca,
    a.valor_total, a.valor_pago, a.saldo_devedor, a.ultimo_pagamento,
    a.origem_acesso,
    a.eh_socio, a.socio_de_nome, a.num_socios,
    -- ---- o que a planilha nunca teve: onde o processo está -------------------
    a.tem_esteira_hm                                            as esta_na_ativacao,
    a.hm_estagio                                                as ativacao_etapa,
    a.hm_estagio_aba                                            as ativacao_aba,
    a.hm_responsavel                                            as ativacao_responsavel,
    a.hm_turma                                                  as ativacao_turma_vendida,
    a.hm_saldo_pago                                             as ativacao_saldo_pago,
    a.hm_pagamento_em                                           as ativacao_pagamento_em,
    a.hm_entrevista_em                                          as ativacao_entrevista_em,
    a.hm_tags                                                   as ativacao_tags,
    a.fonte,
    -- `sip_sinal_trilha` é quem pagou o sinal e ainda NÃO é aluno de turma: a linha existe
    -- para dar trilha no GPS, com turma nula de propósito (0109/0110). Marcar aqui evita
    -- que a Central volte a contá-lo como aluno.
    (a.fonte = 'sip_sinal_trilha')                              as so_pagou_sinal,
    -- A view NÃO esconde linha ruim — marca. Esconder foi o pecado da planilha: ela apagou
    -- 157 vencidos e virou lista de acesso, deixando de responder "fulano já foi aluno?".
    -- Aqui a linha continua, com etiqueta, e quem consome decide se filtra.
    (coalesce(nullif(trim(a.email),''), nullif(regexp_replace(coalesce(a.documento,''),'[^0-9]','','g'),'')) is null)
                                                                as sem_chave,
    (a.nome ilike '%teste%' or a.email ilike '%teste%')          as parece_cadastro_de_teste,
    a.comprador_id,
    a.id                                                        as aluno_id
  from public.vw_aluno_360 a
  left join public.thb_turmas t on t.id = a.turma_aurum_id;

comment on view cs.vw_central_alunos is
  '0239: a Central de Alunos GERADA do banco, com o processo da ativacao junto (etapa, '
  'responsavel, saldo). Substitui a planilha mantida a mao, que envelhecia entre exportacoes. '
  'Quem precisar do xlsx exporta daqui. `so_pagou_sinal` = linha de trilha (0109/0110), '
  'nao e aluno de turma.';

-- ---------------------------------------------------------------------------
-- 2) O alerta que faltava: quitou e não virou aluno
--
-- O caso Leonardo não deu erro em lugar nenhum — o card ficou quitado, a base ficou sem a
-- linha, e o único jeito de descobrir foi cruzar as duas na mão, um mês depois. Passa a
-- acender no mesmo monitor que já acusa oferta órfã e card faltando.
--
-- Regra: card QUITADO (dinheiro entrou) e sem linha correspondente em public.thb_alunos.
-- Quem só pagou o sinal fica de fora de propósito — sinal não faz aluno de turma, e a linha
-- de trilha tem `turma_id` nulo (a regra está em [[hm-quem-vira-aluno]]).
-- ---------------------------------------------------------------------------
create or replace function cs.fn_hm_alerta_aluno_sem_base()
 returns integer
 language plpgsql
 security definer
 set search_path to 'cs', 'public', 'pg_temp'
as $function$
declare
  v_novos int := 0;
begin
  -- abre o que está pendente
  insert into cs.hm_alertas (tipo, chave, severidade, detalhe)
  select 'aluno_sem_base',
         ch.id::text,
         'critico',
         format('%s quitou o %s (turma %s) e NAO tem cadastro na base de alunos. '
                'O GPS le a base para criar os acessos: sem essa linha a pessoa pagou e nao '
                'entra em lugar nenhum. Conferir a ficha e provisionar. E-mail: %s',
                cp.nome, ch.produto, coalesce(ch.turma,'?'), cp.email)
    from cs.contatos_hm ch
    join public.compradores cp on cp.id = ch.comprador_id
   where ch.quitado_em is not null
     and ch.cancelamento_efetivado_em is null
     and not exists (
       select 1 from public.thb_alunos a
        where lower(trim(a.email)) = lower(trim(cp.email))
           or (length(regexp_replace(coalesce(cp.documento,''),'[^0-9]','','g')) >= 11
               and regexp_replace(coalesce(a.documento,''),'[^0-9]','','g')
                 = regexp_replace(coalesce(cp.documento,''),'[^0-9]','','g'))
           or a.comprador_id = ch.comprador_id)
     and not exists (
       select 1 from cs.hm_alertas al
        where al.tipo = 'aluno_sem_base' and al.chave = ch.id::text and al.resolvido_em is null);
  get diagnostics v_novos = row_count;

  -- fecha sozinho o que já foi resolvido (senão o alerta vira ruído permanente e o time
  -- aprende a ignorar a tela inteira)
  update cs.hm_alertas al
     set resolvido_em = now()
   where al.tipo = 'aluno_sem_base'
     and al.resolvido_em is null
     and exists (
       select 1 from cs.contatos_hm ch
         join public.compradores cp on cp.id = ch.comprador_id
        where ch.id::text = al.chave
          and (ch.cancelamento_efetivado_em is not null
            or ch.quitado_em is null
            or exists (select 1 from public.thb_alunos a
                        where lower(trim(a.email)) = lower(trim(cp.email))
                           or a.comprador_id = ch.comprador_id)));

  return v_novos;
end $function$;

comment on function cs.fn_hm_alerta_aluno_sem_base() is
  '0239: acende quando um card QUITADO nao tem linha em public.thb_alunos — a pessoa pagou e '
  'o GPS nao vai criar acesso nenhum. Auto-resolve quando o cadastro aparece, o card e '
  'cancelado ou a quitacao e desfeita. Sinal nao conta: sinal nao faz aluno de turma.';

-- ---------------------------------------------------------------------------
-- 3) Varredura inicial + verificação
-- ---------------------------------------------------------------------------
do $$
declare
  v_novos int;
  v_central int;
  v_ativacao int;
  v_nomes text;
begin
  select cs.fn_hm_alerta_aluno_sem_base() into v_novos;

  select count(*) into v_central from cs.vw_central_alunos;
  select count(*) into v_ativacao from cs.vw_central_alunos where esta_na_ativacao;
  if v_central = 0 then
    raise exception '0239: cs.vw_central_alunos devolveu 0 linhas — a view nao pode nascer vazia.';
  end if;

  select string_agg(detalhe, ' | ') into v_nomes
    from cs.hm_alertas where tipo = 'aluno_sem_base' and resolvido_em is null;

  raise notice '0239: Central gerada com % pessoas, % delas com processo aberto na ativacao.', v_central, v_ativacao;
  raise notice '0239: alertas aluno_sem_base abertos agora: %', coalesce(v_nomes, 'nenhum');
end $$;
