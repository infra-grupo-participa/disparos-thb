-- 0231 — O pró-rata do HM passa a vir CONGELADO da planilha do Victor
--
-- Pedido do Marcio (13/08), com as duas planilhas em mãos: "dentro desse
-- documento tem tudo sobre o pró-rata de cada aluno; ele explica por que dá
-- recebimento de crédito. O comercial precisa saber por que eles estão recebendo
-- esse crédito." E: "me garante que isso está redondo".
--
-- O QUE A CONFERÊNCIA ACHOU (planilha × produção, 13/08)
--
-- AURUM: **redondo**. Crédito, saldo e observação batem nos 8 casos com valor, e
-- as duas exceções (Erico em revisão, Iara com gratuidade) aparecem como "não
-- cobrar". A 0194 já tinha feito esse trabalho.
--
-- HM: **divergente em 9 dos 12**. Duas causas distintas:
--
--   1. DERIVA DIÁRIA. `cs.fn_hm_prorata` calcula `dias_usados = current_date -
--      credito_compra_em` — recalcula a cada dia. A planilha é uma FOTO da data
--      em que o Victor calculou, e é dela que saiu o LINK de pagamento enviado ao
--      aluno. Resultado: 8 pessoas com 2 a 18 dias de diferença, R$ 21,90 a
--      R$ 175,21 cada. O comercial cobra um valor e o sistema mostra outro.
--   2. CRÉDITO QUE O SISTEMA NÃO TINHA. Patrícia Zupiroli tem R$ 4.369,62 de
--      crédito na planilha e NENHUM no sistema (faltam os insumos no card): o
--      board cobrava dela os R$ 14.700 cheios — **R$ 4.369,62 a mais**.
--
-- POR QUE CONGELAR SÓ O CRÉDITO, E NÃO O SALDO
-- O ensaio revertido mostrou o desastre que seria usar a coluna "Saldo a pagar"
-- da planilha como saldo: **Nelci, Leandro e Vanessa voltariam a dever ~R$ 13 mil
-- cada** — as três já pagaram. Aquela coluna é `14.700 − crédito`, o valor do
-- LINK gerado, não o que resta a receber. O saldo remanescente o razão já calcula
-- certo. Congela-se o FATO (o crédito, que é histórico) e deixa-se o saldo ser
-- consequência. `saldo_link` fica guardado só para conferência.
--
-- MEDIDO NO ENSAIO, ANTES DE APLICAR: 9 cards mudam de 263; **quitados do HM
-- 59 → 59** (ninguém volta a dever, ninguém vira quitado); Patrícia
-- 14.700,00 → 10.330,38. Traves no fim da migration conferem os dois números.
--
-- Mesma decisão que a 0194 tomou para o AURUM, e pelo mesmo motivo: o board lê o
-- número PRONTO da planilha porque é ele que virou link. Ver [[Saldo do AURUM]].

begin;

create table if not exists cs.hm_prorata_planilha (
  email        text primary key,
  nome         text,
  documento    text,
  valor_pago   numeric,
  dias_totais  int,
  dias_usados  int,
  valor_dia    numeric,
  consumido    numeric,
  credito      numeric,
  saldo_link   numeric,
  fonte        text not null default 'HM - T40 CONTROLE DE ATIVACAO / aba VICTOR PRO-RATA ALUNOS',
  importado_em timestamptz not null default now()
);

comment on table cs.hm_prorata_planilha is
  '0231: o pro-rata do HM CONGELADO da planilha do Victor -- a mesma conta que gerou o link de pagamento enviado ao aluno. Espelha o que a 0194 fez para o AURUM.';
comment on column cs.hm_prorata_planilha.saldo_link is
  '0231: 14.700 - credito, o valor do LINK gerado. NAO e o saldo remanescente: quem ja pagou o link tem saldo 0 no razao. Usar este numero como saldo faria tres pessoas ja quitadas voltarem a dever ~R$ 13 mil (medido no ensaio).';

alter table cs.hm_prorata_planilha enable row level security;
grant select on cs.hm_prorata_planilha to disparos_app;

-- Import da aba "VICTOR PRÓ-RATA ALUNOS" — só as 12 linhas COM crédito. As
-- outras 14 da aba não têm pró-rata calculado e não têm o que congelar.
insert into cs.hm_prorata_planilha (email,nome,valor_pago,dias_totais,dias_usados,valor_dia,consumido,credito,saldo_link) values
('nelcifujii@terra.com.br','Nelci Akemi Fujii Tsutsumi',2997,365,207,8.21,1699.67,1297.33,13402.67),
('vanessa.grupojover@gmail.com','Vanessa melo',3997,365,207,10.95,2266.79,1730.21,12969.79),
('vaniakirzner@gmail.com','VANIA KIRZNER',3997,365,207,10.95,2266.79,1730.21,12969.79),
('manuel@dgr.com.br','Manuel Lourenco Dallacqua',3997,365,207,10.95,2266.79,1730.21,12969.79),
('pzupiroliadv@hotmail.com','Patricia Zupiroli Costa',18935,null,null,null,null,4369.62,10330.38),
('advmaysavirginia@gmail.com','MAYSA VIRGINIA MOREIRA GOMES',3997,365,207,10.95,2266.79,1730.21,12969.79),
('leandrobgcursos01@gmail.com','Leandro Bulhoes',3997,365,207,10.95,2266.79,1730.21,12969.79),
('elianelpborges@gmail.com','ELIANE LOBATO PEIXOTO BORGES',2997,365,207,8.21,1699.67,1297.33,13402.67),
('rodrigodiguere@gmail.com','Rodrigo Alexandre Assis Silva',12000,365,133,32.88,4372.60,7627.40,7072.60),
('adreizza@gmail.com','Adreiza Farias de Oliveira',3997,365,207,10.95,2266.79,1730.21,12969.79),
('varroni.neto@gmail.com','Armando Varroni Neto',3997,365,220,10.95,2409.15,1587.85,12715.15),
('ribeirocellino@rcdadvogados.com.br','Rogerio Ribeiro Cellino',14997,365,254,41.09,10436.27,4560.73,9742.27)
on conflict (email) do update set
  nome=excluded.nome, valor_pago=excluded.valor_pago, dias_totais=excluded.dias_totais,
  dias_usados=excluded.dias_usados, valor_dia=excluded.valor_dia, consumido=excluded.consumido,
  credito=excluded.credito, saldo_link=excluded.saldo_link, importado_em=now();

-- MESMA assinatura (uuid) — nada de argumento novo aqui: a 0215 já cobrou caro
-- por sobrecarga ambígua, e esta função é lida pela view financeira.
create or replace function cs.fn_hm_prorata(p_comprador_id uuid)
returns table(dias_usados integer, dias_restantes integer, valor_dia numeric, consumido numeric, credito numeric, saldo_a_pagar numeric)
language sql stable security definer set search_path to 'cs','public','pg_temp'
as $b$
  select * from (
    -- 1) A planilha VENCE. Casa por e-mail (o documento vem sem zero à esquerda
    --    em parte das linhas — a mesma armadilha que a 0194 encontrou no AURUM).
    select pl.dias_usados, greatest(pl.dias_totais - pl.dias_usados, 0), pl.valor_dia, pl.consumido,
           pl.credito, round(14700 - pl.credito, 2)
      from cs.hm_prorata_planilha pl
      join public.compradores co on lower(co.email) = pl.email
     where co.id = p_comprador_id and pl.credito is not null
     limit 1
  ) congelado
  union all
  select * from (
    -- 2) Sem linha congelada, o cálculo de sempre.
    select d.usados, greatest(ch.credito_dias_totais - d.usados, 0),
           round(ch.credito_valor_pago / nullif(ch.credito_dias_totais,0), 2),
           round(ch.credito_valor_pago * least(d.usados, ch.credito_dias_totais)::numeric / nullif(ch.credito_dias_totais,0), 2),
           round(ch.credito_valor_pago * greatest(ch.credito_dias_totais - d.usados,0)::numeric / nullif(ch.credito_dias_totais,0), 2),
           round(14700 - (ch.credito_valor_pago * greatest(ch.credito_dias_totais - d.usados,0)::numeric / nullif(ch.credito_dias_totais,0)), 2)
      from cs.contatos_hm ch
      cross join lateral (select greatest((current_date - ch.credito_compra_em),0) as usados) d
     where ch.comprador_id = p_comprador_id and coalesce(ch.produto,'HM')='HM'
       and ch.credito_valor_pago is not null and ch.credito_compra_em is not null
       and not exists (select 1 from cs.hm_prorata_planilha pl2
                         join public.compradores co2 on lower(co2.email)=pl2.email
                        where co2.id = p_comprador_id and pl2.credito is not null)
     order by ch.criado_em asc limit 1
  ) calculado
  limit 1;
$b$;

comment on function cs.fn_hm_prorata(uuid) is
  '0231: a planilha do Victor VENCE o calculo diario. O credito e um fato da data em que foi calculado e e o numero que gerou o link enviado ao aluno; recalcular por current_date fazia o sistema divergir do link (2 a 18 dias de deriva, R$ 21,90 a R$ 175,21 por pessoa). Sem linha congelada, cai no calculo de sempre.';

-- Travas: os dois números que o ensaio prometeu.
do $$
declare v_q int; v_pat numeric;
begin
  select count(*) into v_q from cs.vw_hm_financeiro f join cs.contatos_hm ch on ch.id=f.contato_hm_id
   where coalesce(ch.produto,'HM')='HM' and f.quitado;
  if v_q <> 59 then
    raise exception '0231: quitados do HM mudou de 59 para % -- alguem foi reclassificado', v_q;
  end if;
  select round(f.saldo_a_perseguir,2) into v_pat
    from cs.vw_hm_financeiro f join cs.contatos_hm ch on ch.id=f.contato_hm_id
    join public.compradores cp on cp.id=ch.comprador_id
   where lower(cp.email)='pzupiroliadv@hotmail.com' and coalesce(ch.produto,'HM')='HM';
  if v_pat is distinct from 10330.38 then
    raise exception '0231: Patricia deveria ficar com saldo 10330.38 e ficou com %', v_pat;
  end if;
end $$;

commit;
