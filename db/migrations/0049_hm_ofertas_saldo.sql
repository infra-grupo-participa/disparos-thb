-- =====================================================================
-- 0049_hm_ofertas_saldo
-- O sistema estava CEGO para a maior parte dos pagamentos de saldo do HM.
--
-- Diagnóstico: cs.fn_seed_contato_hm move o card para a Ativação (e cria o
-- aluno na base THB) quando entra uma compra da categoria 'diferenca'. Mas o
-- public.hm_product_catalog só conhecia DUAS ofertas de saldo — 2vibw97m e
-- 2mxcjw8t. O comercial, porém, envia um link diferente para cada valor de
-- saldo (o valor muda conforme o crédito pró-rata do acesso antigo do aluno).
-- Resultado: 13 pagamentos aprovados em julho/2026 (ikgazdy8, 2jaj1deq,
-- o1sxigxl, cx3rwir9, 5uqyub1h, wkd93am7) NÃO existiam para o sistema. Os
-- cards foram arrastados à mão no kanban — e nenhum desses alunos nasceu em
-- public.thb_alunos, ou seja, o GPS nunca recebeu o insumo para criar o acesso
-- de gente que já tinha pago dezenas de milhares de reais.
--
-- Esta migration:
--   1) cria cs.hm_ofertas_saldo — o catálogo de links de saldo COM O VALOR
--      NOMINAL de cada um (a aba "Links pagamento saldo" da planilha);
--   2) registra essas ofertas no hm_product_catalog como 'diferenca', que é o
--      que faz o gatilho de venda reconhecê-las daqui para a frente;
--   3) corrige cs.fn_hm_valores_derivados para usar o valor nominal;
--   4) reprocessa (backfill) quem pagou e ficou para trás.
--
-- Por que o valor nominal importa (o bug financeiro escondido):
-- quem paga ikgazdy8 (12.772,68) está pagando o saldo JÁ COM O DESCONTO do
-- pró-rata. O cálculo antigo assumia pacote de 15.000 e concluía
-- 300 + 12.772,68 = 13.072,68 pago → "dívida" de 1.927,32 que não existe.
-- O correto: o pacote dele é 300 (sinal) + o valor da oferta que ele pagou.
-- Aditiva e idempotente.
-- =====================================================================

-- 1) Catálogo de links de saldo ----------------------------------------------
-- `valor` é o valor NOMINAL da oferta (o que quita o saldo), não o que a
-- Hotmart registra em compras.preco — em oferta recorrente, preco é a PARCELA.
-- `recorrente` distingue o par de links que existe para cada valor (à vista /
-- recorrente), e é o que permite a ficha sugerir o link certo para o acordo.
create table if not exists cs.hm_ofertas_saldo (
  codigo      text primary key,
  valor       numeric,          -- null = valor não confirmado (ver 2mxcjw8t)
  recorrente  boolean not null default false,
  link        text not null,
  ativo       boolean not null default true,
  criado_em   timestamptz not null default now()
);

insert into cs.hm_ofertas_saldo (codigo, valor, recorrente, link) values
  ('1ayp826g', 13960.27, false, 'https://pay.hotmart.com/L97981750T?off=1ayp826g'),
  ('x0waxuab', 13960.27, true,  'https://pay.hotmart.com/L97981750T?off=x0waxuab'),
  ('2jaj1deq', 13254.87, false, 'https://pay.hotmart.com/L97981750T?off=2jaj1deq'),
  ('8a87ktsr', 13254.87, true,  'https://pay.hotmart.com/L97981750T?off=8a87ktsr'),
  ('ikgazdy8', 12772.68, false, 'https://pay.hotmart.com/L97981750T?off=ikgazdy8'),
  ('o1sxigxl', 12772.68, true,  'https://pay.hotmart.com/L97981750T?off=o1sxigxl'),
  ('cx3rwir9', 11675.34, false, 'https://pay.hotmart.com/L97981750T?off=cx3rwir9'),
  ('nu1t1h67', 11675.34, true,  'https://pay.hotmart.com/L97981750T?off=nu1t1h67'),
  ('ntebmlv0', 11084.28, false, 'https://pay.hotmart.com/L97981750T?off=ntebmlv0'),
  ('5f843knv', 11084.28, true,  'https://pay.hotmart.com/L97981750T?off=5f843knv'),
  ('5uqyub1h', 11042.47, false, 'https://pay.hotmart.com/L97981750T?off=5uqyub1h'),
  ('b13te6c0', 11042.47, true,  'https://pay.hotmart.com/L97981750T?off=b13te6c0'),
  ('bgu5i1zd',  6500.00, true,  'https://pay.hotmart.com/L97981750T?off=bgu5i1zd'),
  ('wkd93am7',  4900.00, false, 'https://pay.hotmart.com/L97981750T?off=wkd93am7'),
  ('2vibw97m', 14700.00, false, 'https://pay.hotmart.com/L97981750T?off=2vibw97m'),
  -- 2mxcjw8t entra SEM valor de propósito: na planilha ele aparece rotulado
  -- ora como "Saldo R$ 12.700 de R$ 15.000", ora com valor R$ 14.700. Enquanto
  -- a divergência não for resolvida, o cálculo cai no fallback (soma das
  -- compras) em vez de afirmar um número que pode estar errado.
  ('2mxcjw8t', null,     true,  'https://pay.hotmart.com/L97981750T?off=2mxcjw8t')
on conflict (codigo) do update set
  valor = excluded.valor, recorrente = excluded.recorrente,
  link = excluded.link, ativo = true;

grant select on cs.hm_ofertas_saldo to disparos_app;

-- 2) O gatilho de venda passa a reconhecer esses links -----------------------
-- Sem esta linha, uma venda por ikgazdy8 continua invisível: fn_seed_contato_hm
-- lê a categoria do hm_product_catalog e ignora a compra quando não a encontra.
insert into public.hm_product_catalog (offer_code, categoria, notes)
select o.codigo, 'diferenca',
       'Saldo HM' ||
       coalesce(' R$ ' || to_char(o.valor, 'FM999G999D00'), '') ||
       case when o.recorrente then ' (recorrente)' else '' end
  from cs.hm_ofertas_saldo o
on conflict (offer_code) do nothing;

-- 3) Valores derivados: o pacote é o sinal + a oferta de saldo que ele pagou --
create or replace function cs.fn_hm_valores_derivados(p_comprador_id uuid)
returns table (valor_total numeric, valor_pago numeric, ambiguo boolean)
language plpgsql
stable
security definer
set search_path = cs, public, pg_temp
as $fn$
declare
  v_soma         numeric := 0;   -- tudo que a Hotmart registrou como pago
  v_cheia        numeric := 0;
  v_tem_sinal    boolean := false;
  v_installments boolean := false;
  v_saldo_nominal numeric;       -- valor da oferta de saldo paga (se houver)
  v_saldo_recorrente boolean := false;
  v_total        numeric;
  v_pago         numeric;
begin
  select coalesce(sum(c.preco), 0),
         coalesce(sum(c.preco) filter (where cat.categoria = 'compra_cheia'), 0),
         bool_or(cat.categoria = 'sinal'),
         bool_or(c.metodo_pagamento = 'HOTMART_INSTALLMENTS')
    into v_soma, v_cheia, v_tem_sinal, v_installments
    from public.compras c
    join public.hm_product_catalog cat on cat.offer_code = c.oferta_codigo
   where c.comprador_id = p_comprador_id
     and c.status in ('APPROVED','COMPLETE','COMPLETED')
     and cat.categoria in ('sinal','compra_cheia','diferenca');

  -- A oferta de saldo carrega o desconto do pró-rata: quem pagou ikgazdy8
  -- (12.772,68) quitou. O pacote dele é 300 + 12.772,68, não 15.000.
  select os.valor, os.recorrente into v_saldo_nominal, v_saldo_recorrente
    from public.compras c
    join cs.hm_ofertas_saldo os on os.codigo = c.oferta_codigo
   where c.comprador_id = p_comprador_id
     and c.status in ('APPROVED','COMPLETE','COMPLETED')
   order by coalesce(c.data_aprovacao, c.data_compra) desc
   limit 1;

  if v_tem_sinal and v_saldo_nominal is not null then
    v_total := 300 + v_saldo_nominal;
  elsif v_tem_sinal then
    v_total := 15000::numeric;   -- ainda não pagou o saldo (ou oferta sem valor)
  else
    v_total := v_cheia;          -- entrou pela compra cheia
  end if;

  v_pago := least(v_soma, v_total);
  -- Centavos de arredondamento da Hotmart (ex.: 12.772,65) não são dívida.
  if v_total - v_pago < 1 then v_pago := v_total; end if;

  return query select
    v_total,
    v_pago,
    -- Ambíguo quando o número pode ser parcela, não total pago: boleto
    -- parcelado, oferta recorrente ainda em curso, ou saldo aberto.
    (v_installments or (v_saldo_recorrente and v_pago < v_total) or v_pago < v_total);
end$fn$;

grant execute on function cs.fn_hm_valores_derivados(uuid) to disparos_app;

-- 4) Backfill: quem pagou o saldo e o sistema não viu ------------------------
-- Só toca em quem tem compra 'diferenca' aprovada. Idempotente: o provisionamento
-- faz upsert e os índices únicos de comprador/e-mail impedem duplicata.
do $backfill$
declare
  r        record;
  v_val    record;
  v_aluno  uuid;
  v_pend   smallint;
  v_aba    text;
begin
  select id into v_pend from cs.estagios where evento='HM' and chave='hm_pendente_liberacao' limit 1;

  for r in
    select ch.id as card_id, ch.comprador_id, ch.estagio_id, ch.aluno_id,
           max(coalesce(c.data_aprovacao, c.data_compra)) as pago_em
      from cs.contatos_hm ch
      join public.compras c on c.comprador_id = ch.comprador_id
       and c.status in ('APPROVED','COMPLETE','COMPLETED')
      join public.hm_product_catalog cat on cat.offer_code = c.oferta_codigo
     where cat.categoria = 'diferenca'
     group by ch.id, ch.comprador_id, ch.estagio_id, ch.aluno_id
  loop
    select aba into v_aba from cs.estagios where id = r.estagio_id;

    -- Card ainda no Comercial: o pagamento nunca o empurrou. Empurra agora.
    if coalesce(v_aba, 'comercial') = 'comercial' then
      update cs.contatos_hm
         set estagio_id = v_pend, apto_ativacao = true,
             pagamento_em = coalesce(pagamento_em, r.pago_em), atualizado_em = now()
       where id = r.card_id;
      insert into cs.interacoes (contato_hm_id, tipo, descricao, autor, estagio_anterior_id, estagio_novo_id)
      values (r.card_id, 'mudanca_estagio',
              'Pagamento do saldo reconhecido (link fora do catálogo) — movido para "Pendente de Liberação"',
              'sistema', r.estagio_id, v_pend);
    else
      update cs.contatos_hm
         set apto_ativacao = true, pagamento_em = coalesce(pagamento_em, r.pago_em), atualizado_em = now()
       where id = r.card_id;
    end if;

    -- O que realmente faltava: o aluno na base mestre (insumo do GPS).
    if r.aluno_id is null then
      begin
        select * into v_val from cs.fn_hm_valores_derivados(r.comprador_id);
        v_aluno := cs.fn_hm_provisionar_aluno(r.comprador_id, v_val.valor_total, v_val.valor_pago);
        if v_aluno is not null then
          if v_val.ambiguo then
            update public.thb_alunos
               set tratamento_manual = coalesce(tratamento_manual,
                     'Financeiro a conferir — saldo pago em oferta recorrente/parcelada: compras.preco guarda a parcela, não o total')
             where id = v_aluno;
          end if;
          insert into cs.interacoes (contato_hm_id, tipo, descricao, autor)
          values (r.card_id, 'sistema', 'Aluno criado na base THB no reprocessamento do saldo (migration 0049)', 'sistema');
        end if;
      exception when others then
        insert into cs.interacoes (contato_hm_id, tipo, descricao, autor)
        values (r.card_id, 'sistema', 'Falha ao criar o aluno na base THB no reprocessamento ('||sqlerrm||')', 'sistema');
      end;
    end if;
  end loop;
end$backfill$;
