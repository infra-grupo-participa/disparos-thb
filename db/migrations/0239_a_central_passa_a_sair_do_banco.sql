-- 0239_a_central_passa_a_sair_do_banco.sql
-- A Central de Alunos deixa de ser planilha mantida à mão e passa a SAIR do banco,
-- já com o processo da ativação dentro.
--
-- Decisão do Marcio (14/08/2026): "a ativação passa a alimentar a Central — é o processo
-- de encaminhamento dos alunos, para a gente saber onde estão os processos".
--
-- ---------------------------------------------------------------------------
-- O QUE A MEDIÇÃO MOSTROU — o cano já existe; quem está velha é a planilha
--
-- 285 cards ativos · 180 na planilha · **105 fora**. Desses 105, **97 JÁ ESTÃO em
-- public.thb_alunos**. O provisionamento (`fn_hm_provisionar_aluno`, `sip_ativacao_hm`,
-- `sip_sinal_trilha`) funciona.
--
-- Os 8 que não estavam em lugar nenhum, um a um:
--   · Kelly A. e Bruno Hermann ......... "Boleto Gerado", nenhuma compra aprovada. CORRETO.
--   · Gilmar Afonso, Roberto Pires,
--     Edson Rodrigo, Thereza Christina .. AURUM, só a entrada de R$ 1.000 do evento. CORRETO.
--   · Lidiane Praxedes ................. oferta 6qxsk9kq, boleto ainda gerado.
--   · **Leonardo Gomes de C. M. Leite ... QUITADO, T39, e fora da base. Furo.**
--
-- O buraco não era de 111 pessoas. A varredura do alerta (parte 2) achou **2**: Leonardo
-- e Cristiano Barreto Espindola Siebra — os dois da MESMA oferta `6qxsk9kq` (R$ 2.497).
-- O vault já tinha registrado esses dois nomes em 23/07 como os casos dessa oferta que o
-- matching não achava na base. O padrão voltou; agora tem alarme.
--
-- Enquanto a Central for um arquivo que alguém exporta e edita, ela volta a envelhecer na
-- semana seguinte — a planilha oficial parou em 14/08 e o `Resumo` dela em 28/07, ainda
-- anunciando 1.662 pessoas quando a aba tem 1.501. A correção não é um processo novo de
-- cópia: é a Central passar a ser uma CONSULTA.
--
-- Aditivo: cria uma view e um alerta. Não altera tabela, não altera dado, não toca
-- `public.thb_alunos`. Idempotente.

-- ---------------------------------------------------------------------------
-- 1) A Central, gerada — UMA LINHA POR CADASTRO
--
-- ⚠️ A primeira versão desta view (aplicada e corrigida na mesma noite) saía direto de
-- `vw_aluno_360`, que devolve **uma linha por card**. Como uma pessoa tem card por produto
-- desde a 0163, as 15 pessoas com card no HM **e** no AURUM viravam 30 linhas — e a Central
-- anunciava 1.824 pessoas quando são 1.794. O Marcio pegou olhando o número: "tem gente
-- duplicada aí". Agora a view agrupa por `thb_alunos.id` e agrega os processos.
--
--   1.824  linhas da versão errada (o card duplicava a pessoa)
--   1.809  cadastros           ← o que esta view devolve
--   1.794  pessoas             (15 cadastros duplicados: mesmo CPF, e-mails diferentes)
--   1.654  pessoas que são aluno de turma (fora: 122 só-sinal, 21 sem chave/teste)
--     456  com acesso vigente
--
-- A view **não mescla** os duplicados: marca com `pessoa_duplicada` e `cadastros_da_pessoa`.
-- Mesclar é decisão humana — e dos 15, **dois não são duplicata**: `08834775724` (Marcello
-- Benevides / Maria Helena Seabra) e `53646257000181` (Pala Soc / Suely Pala) são duas
-- pessoas dividindo um documento. Juntá-las seria pior do que deixá-las separadas.
--
-- E ela **marca em vez de esconder**. Esconder foi o pecado da planilha: apagou 157 vencidos
-- e deixou de responder "fulano já foi aluno?".
-- ---------------------------------------------------------------------------
drop view if exists cs.vw_central_alunos;
create view cs.vw_central_alunos as
with base as (
  select
    a.id                                                        as aluno_id,
    max(a.nome)                                                 as nome,
    -- documento normalizado: a planilha tem 24 CPFs de sócio destruídos por notação
    -- científica (3,79E+10 -> 37900000000) e 69 linhas sem documento nenhum
    nullif(regexp_replace(coalesce(max(a.documento),''), '[^0-9]', '', 'g'), '') as documento,
    lower(trim(max(a.email)))                                   as email,
    max(coalesce(a.telefone_e164, a.telefone))                  as telefone,
    max(a.cidade)                                               as cidade,
    max(a.estado)                                               as estado,
    max(a.produto)                                              as produto,
    max(a.instrucao)                                            as instrucao,
    max(a.turma_codigo)                                         as turma,
    max(t.codigo)                                               as turma_aurum,
    max(a.nivel_resultado)                                      as nivel,
    max(a.oferta)                                               as oferta,
    max(a.tipo_oferta)                                          as tipo_oferta,
    max(a.regra_acesso)                                         as regra_acesso,
    max(a.data_compra_importada)::date                          as data_da_compra,
    max(a.data_expiracao)::date                                 as data_de_expiracao,
    max(a.tempo_acesso)                                         as tempo_acesso,
    max(a.status_acesso)                                        as status_acesso,
    max(a.status_pagamento)                                     as status_de_cobranca,
    max(a.valor_total)                                          as valor_total,
    max(a.valor_pago)                                           as valor_pago,
    max(a.saldo_devedor)                                        as saldo_devedor,
    max(a.ultimo_pagamento)                                     as ultimo_pagamento,
    max(a.origem_acesso)                                        as origem_acesso,
    bool_or(a.eh_socio)                                         as eh_socio,
    max(a.socio_de_nome)                                        as socio_de_nome,
    max(a.num_socios)                                           as num_socios,
    -- ---- o que a planilha nunca teve: onde o processo está -------------------
    -- Uma pessoa pode ter processo em mais de um board (HM e AURUM). Antes isso duplicava
    -- a linha do aluno; agora vem agregado, e `processos_na_ativacao` diz quantos são.
    bool_or(coalesce(a.tem_esteira_hm,false))                   as esta_na_ativacao,
    count(distinct a.hm_estagio) filter (where a.hm_estagio is not null) as processos_na_ativacao,
    string_agg(distinct a.hm_estagio,     ' + ')                as ativacao_etapa,
    string_agg(distinct a.hm_estagio_aba, ' + ')                as ativacao_aba,
    string_agg(distinct a.hm_responsavel, ' + ')                as ativacao_responsavel,
    string_agg(distinct a.hm_turma,       ' + ')                as ativacao_turma_vendida,
    bool_or(coalesce(a.hm_saldo_pago,false))                    as ativacao_saldo_pago,
    max(a.hm_pagamento_em)                                      as ativacao_pagamento_em,
    max(a.hm_entrevista_em)                                     as ativacao_entrevista_em,
    max(a.fonte)                                                as fonte,
    max(a.comprador_id::text)::uuid                             as comprador_id
  from public.vw_aluno_360 a
  left join public.thb_turmas t on t.id = a.turma_aurum_id
  group by a.id
), pessoa as (
  -- Agrupa cadastros da MESMA pessoa: mesmo documento, ou e-mails que compartilham
  -- documento. Só etiqueta — para o duplicado ficar visível sem ninguém decidir sozinho.
  -- Limite declarado: quem não tem documento (18 linhas) não entra em cluster nenhum.
  select b.*,
         coalesce(
           (select min(b2.documento) from base b2 where b2.email = b.email and b2.documento is not null),
           b.documento, b.email, b.aluno_id::text
         )                                                      as pessoa_chave
    from base b
)
select p.*,
       count(*) over (partition by p.pessoa_chave)              as cadastros_da_pessoa,
       (count(*) over (partition by p.pessoa_chave) > 1)        as pessoa_duplicada,
       -- linha de trilha (0109/0110): pagou o sinal e NÃO é aluno de turma
       (p.fonte = 'sip_sinal_trilha')                           as so_pagou_sinal,
       (p.email is null and p.documento is null)                as sem_chave,
       (p.nome ilike '%teste%' or p.email ilike '%teste%'
        or p.email ilike '%joaozao%')                           as parece_cadastro_de_teste
  from pessoa p;

comment on view cs.vw_central_alunos is
  '0239: Central de Alunos GERADA do banco, UMA LINHA POR CADASTRO (nao por card). Processo '
  'da ativacao agregado — pessoa com card no HM e no AURUM aparece uma vez, com os dois '
  'processos. pessoa_duplicada/cadastros_da_pessoa marcam quem tem mais de um cadastro '
  '(nunca mescla sozinho). so_pagou_sinal = linha de trilha, nao e aluno de turma.';

-- ---------------------------------------------------------------------------
-- 2) O alerta que faltava: quitou e não virou aluno
--
-- O caso Leonardo não deu erro em lugar nenhum — o card ficou quitado, a base ficou sem a
-- linha, e só o cruzamento manual achou, um mês depois. Passa a acender no mesmo monitor
-- que já acusa oferta órfã e card faltando.
--
-- Quem só pagou o sinal fica de fora de propósito: sinal não faz aluno de turma, e a linha
-- de trilha nasce com `turma_id` nulo (regra em [[hm-quem-vira-aluno]]).
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
  insert into cs.hm_alertas (tipo, chave, severidade, detalhe)
  select 'aluno_sem_base', ch.id::text, 'critico',
         format('%s quitou o %s (turma %s) e NAO tem cadastro na base de alunos. O GPS le a '
                'base para criar os acessos: sem essa linha a pessoa pagou e nao entra em '
                'lugar nenhum. Conferir a ficha e provisionar. E-mail: %s',
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

  -- fecha sozinho o que já foi resolvido: alerta que não sai da tela treina o time a
  -- ignorar a tela inteira (hoje há 75 `sem_canal` abertos ao lado)
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
  v_linhas int; v_pessoas int; v_dup int; v_novos int; v_nomes text;
begin
  select count(*), count(distinct pessoa_chave), count(*) filter (where pessoa_duplicada)
    into v_linhas, v_pessoas, v_dup
    from cs.vw_central_alunos;

  if v_linhas = 0 then
    raise exception '0239: cs.vw_central_alunos devolveu 0 linhas — nao pode nascer vazia.';
  end if;

  -- a trava que a versao errada nao tinha: uma linha por cadastro, nunca por card
  if v_linhas <> (select count(*) from (select distinct aluno_id from cs.vw_central_alunos) x) then
    raise exception '0239: a view voltou a duplicar cadastro (% linhas para % ids). '
                    'Alguem tirou o group by e o card por produto multiplicou a pessoa.',
                    v_linhas, (select count(distinct aluno_id) from cs.vw_central_alunos);
  end if;

  select cs.fn_hm_alerta_aluno_sem_base() into v_novos;
  select string_agg(detalhe, ' || ') into v_nomes
    from cs.hm_alertas where tipo = 'aluno_sem_base' and resolvido_em is null;

  raise notice '0239: Central com % cadastros / % pessoas · % cadastros duplicados marcados.',
               v_linhas, v_pessoas, v_dup;
  raise notice '0239: aluno_sem_base abertos: %', coalesce(v_nomes, 'nenhum');
end $$;
