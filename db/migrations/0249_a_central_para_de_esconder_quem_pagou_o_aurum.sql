-- 0249_a_central_para_de_esconder_quem_pagou_o_aurum.sql
--
-- MEDIDO em 16/08/2026 contra os 2 anos de export da Hotmart (cs.hotmart_pessoa, 0248):
--
--   267 pessoas pagaram AURUM — R$ 7.887.006,59 de contrato em 625 transações
--   142 delas aparecem na Central como aluno do AURUM
--   **125 não aparecem**:
--        98 têm cadastro em thb_alunos mas SEM turma_aurum  → R$ 1.407.412,80
--        27 não têm cadastro nenhum                          → R$   451.000,00
--
-- E do outro lado, dos 223 alunos AURUM que a Central lista:
--        60 são sócios (`acompanha_titular`) — não pagam, e está certo
--        21 estão marcados como quitado/sem situação e NÃO TÊM pagamento na Hotmart
--
-- A leitura errada que isso produz é grave e silenciosa: quem abre a Central e não acha a
-- pessoa conclui que ela não pagou. Um dos 125 pagou R$ 55.000 e some da tela.
--
-- O QUE ESTA MIGRATION FAZ — e o que deliberadamente NÃO faz:
--
--   FAZ: a Central passa a mostrar o financeiro do AURUM de QUALQUER pessoa que pagou,
--        vindo do retrato da Hotmart, casado por e-mail. Independe de `turma_aurum_id`.
--        Quem pagou aparece com o que pagou, mesmo sem turma atribuída.
--
--   NÃO FAZ: não atribui turma, não concede acesso, não cria card na Ativação, não escreve
--        em thb_alunos. Atribuir turma é conceder acesso a produto — e há pelo menos dois
--        grupos entre os 125 em que isso seria errado: os 35 que pagaram só a reserva de
--        R$ 1.000 do evento de agosto (ainda não são alunos) e os do A7 de 2024 que não
--        renovaram (o acesso já venceu). Quem decide isso é a operação, com a lista na mão.
--
-- É a mesma correção da 0246, aplicada ao outro produto: o defeito não era número errado,
-- era informação verdadeira que a tela não mostrava. Corrige-se NOMEANDO, não igualando.

-- ---------------------------------------------------------------------------------------
-- 1. A conciliação por pessoa: o ciclo corrente em destaque, o histórico somado atrás.
-- ---------------------------------------------------------------------------------------
create or replace view cs.vw_aurum_conciliacao as
with corrente as (
  select distinct on (lower(email))
         lower(email)      as email,
         nome_hotmart, documento, ciclo, n_transacoes,
         total_contrato, total_bruto, total_liquido,
         pacote_declarado, primeiro_pago_em, ultimo_pago_em, ofertas, export_em
    from cs.hotmart_pessoa
   where produto = 'Aurum'
   order by lower(email), ultimo_pago_em desc
), historico as (
  select lower(email) as email,
         count(*)                     as ciclos,
         sum(n_transacoes)            as tx_total,
         sum(total_contrato)          as contrato_total,
         sum(total_bruto)             as bruto_total,
         min(primeiro_pago_em)        as desde,
         string_agg(distinct ciclo, ' · ' order by ciclo) as ciclos_lista
    from cs.hotmart_pessoa
   where produto = 'Aurum'
   group by 1
)
select c.email,
       c.nome_hotmart,
       c.documento,
       c.ciclo                     as ciclo_corrente,
       c.total_contrato            as ciclo_contratado,
       c.total_bruto               as ciclo_pago_no_cartao,
       c.pacote_declarado          as ciclo_pacote,
       -- só faz sentido falar em "falta" quando a oferta declarou o pacote no nome dela
       case when c.pacote_declarado is not null
            then round(c.pacote_declarado - c.total_contrato, 2) end as ciclo_falta,
       case
         when c.pacote_declarado is null                                then 'sem pacote declarado'
         when c.pacote_declarado - c.total_contrato >  1                then 'devendo'
         when c.pacote_declarado - c.total_contrato < -1                then 'pagou acima do pacote'
         else 'quitado'
       end                         as ciclo_situacao,
       c.primeiro_pago_em, c.ultimo_pago_em, c.ofertas,
       h.ciclos, h.ciclos_lista, h.tx_total, h.contrato_total, h.bruto_total, h.desde,
       c.export_em
  from corrente c join historico h using (email);

comment on view cs.vw_aurum_conciliacao is
  '0249: o financeiro do AURUM por pessoa, a partir do retrato da Hotmart (cs.hotmart_pessoa). O ciclo CORRENTE e o mais recente; o historico soma todos. Nunca some ciclo_contratado com contrato_total: quem renova paga o pacote de novo, e somar 2 anos contra 1 pacote fazia 91 alunos parecerem estar pagando a mais (R$ 1,67 milhao de falso excedente).';

-- ---------------------------------------------------------------------------------------
-- 2. A Central ganha as colunas do AURUM, no fim, sem quebrar consumidor existente.
--    Mesma técnica da 0246: lê a definição vigente e embrulha, para as branches convergirem.
-- ---------------------------------------------------------------------------------------
do $$
declare
  v_def text;
begin
  select rtrim(btrim(pg_get_viewdef('cs.vw_central_alunos'::regclass, true)), ';') into v_def;

  if position('aurum_ciclo' in v_def) > 0 then
    raise notice '0249: as colunas do AURUM ja existem — nada a fazer.';
    return;
  end if;

  execute format($sql$
    create or replace view cs.vw_central_alunos as
    select b.*,
           au.ciclo_corrente        as aurum_ciclo,
           au.ciclo_situacao        as aurum_situacao,
           au.ciclo_pacote          as aurum_pacote,
           au.ciclo_contratado      as aurum_contratado,
           au.ciclo_falta           as aurum_falta,
           au.contrato_total        as aurum_pago_historico,
           au.ciclos                as aurum_ciclos,
           au.ultimo_pago_em        as aurum_ultimo_pagamento
      from ( %s ) b
      left join cs.vw_aurum_conciliacao au on au.email = lower(b.email)
  $sql$, v_def);

  raise notice '0249: Central passa a expor aurum_ciclo/situacao/pacote/contratado/falta/pago_historico/ciclos/ultimo_pagamento.';
end $$;

comment on view cs.vw_central_alunos is
  '0239 + 0246 + 0249: a Central de Alunos gerada. TRES financeiros distintos, que NAO devem ser somados nem comparados entre si: (a) valor_total/valor_pago/saldo_devedor = CONTRATO DE ACESSO (public.thb_alunos, planilha de acessos); (b) programa_* = PROGRAMA DE IMPLEMENTACAO do HM (cs.vw_hm_carteira); (c) aurum_* = AURUM (cs.vw_aurum_conciliacao, retrato da Hotmart). Sao contratos diferentes da mesma pessoa. As colunas aurum_* aparecem para quem PAGOU, tenha ou nao turma_aurum_id atribuida — 125 pagantes do AURUM nao tinham turma e sumiam da tela.';

-- ---------------------------------------------------------------------------------------
-- 3. Medição de fechamento: o que a Central passa a enxergar.
-- ---------------------------------------------------------------------------------------
do $$
declare v_pag int; v_vis int; v_semcad int; v_r numeric;
begin
  select count(*) into v_pag from cs.vw_aurum_conciliacao;
  select count(*) into v_vis
    from cs.vw_aurum_conciliacao au
    join public.thb_alunos a on lower(a.email) = au.email and a.cancelado_em is null;
  select count(*), coalesce(sum(contrato_total),0) into v_semcad, v_r
    from cs.vw_aurum_conciliacao au
   where not exists (select 1 from public.thb_alunos a
                      where lower(a.email) = au.email and a.cancelado_em is null);
  raise notice '0249: % pagantes do AURUM · % com cadastro na Central · % sem cadastro (R$ %).',
    v_pag, v_vis, v_semcad, round(v_r,2);
end $$;
