-- 0195_aurum_nao_perde_dinheiro.sql
-- O AURUM passa a ter o mesmo rigor de dinheiro que o HM.
--
-- Pedido do Marcio (11/08): "as mensalidades deles vão cair ali; se a gente deixa
-- uma passar, é dinheiro deixando de entrar". Esta migration fecha os quatro pontos
-- por onde um pagamento do AURUM se perde HOJE, em silêncio.
--
-- ---------------------------------------------------------------------------
-- PROVA DE QUE O BURACO É REAL — achado ao auditar, não hipótese
--
-- Rangel José do Carmo comprou **Aurum, R$ 1.376,35 em 12x, hoje 11:02**
-- (oferta `x72l7aq9`, produto 3094405, APPROVED). Hoje, nesta base:
--   · não tem card em esteira nenhuma;
--   · não tem linha no razão (`cs.hm_pagamentos`);
--   · não está em `public.hm_product_catalog`;
--   · **não gerou alerta** — porque o alerta de oferta órfã (0188/0189) filtra
--     `produto_id in ('5064314','3507214')`, os dois produtos do HM. O Aurum é 3094405.
-- Ou seja: uma venda do Aurum de hoje é invisível para o sistema inteiro.
--
-- ---------------------------------------------------------------------------
-- OS QUATRO BURACOS
--
-- 1) QUEM É O DONO DO PAGAMENTO. `cs.fn_hm_pagamento_do_produto(oferta, produto)`
--    decide a que board um pagamento pertence lendo `cs.hm_origem_por_oferta` — que é
--    a tabela de CANAL DE AQUISIÇÃO, preenchida à mão por campanha. Oferta que não
--    está lá resolve `'HM'` por omissão. Consequências, todas silenciosas:
--      · mensalidade do AURUM não abate saldo do AURUM (a view não a reconhece);
--      · pior, ela conta como pagamento do HM de quem tem os dois cards;
--      · `cs.fn_hm_compra_cancelada` (0193) usa a MESMA função para achar o card a
--        cancelar: cancelamento do Aurum bateria no card do HM, ou em nenhum.
--    Correção: fallback pelo `produto_id` da própria Hotmart, via mapa explícito
--    `cs.hm_produto_hotmart`. Canal continua tendo a última palavra quando existe.
--
-- 2) O SALDO DO AURUM NÃO ABATIA PAGAMENTO. A 0194 fez o board ler o saldo da planilha
--    (59.000 − crédito), o que estava certo para a foto de ontem e ERRADO para amanhã:
--    o número não se mexia quando a pessoa pagasse. Agora o saldo é
--    `59.000 − crédito − pagamentos do AURUM que não sejam a entrada do evento`, numa
--    função única (`cs.fn_aurum_saldo`) que a ficha e o board leem — não dá mais para
--    as duas telas discordarem, que foi o defeito que a 0194 encontrou.
--
-- 3) O ALERTA NÃO OLHAVA PARA O AURUM. Os dois alertas de oferta órfã (na hora, 0189;
--    e a varredura diária, 0188) filtram os produtos do HM. Passam a olhar todo produto
--    listado em `cs.hm_produto_hotmart` — hoje HM e AURUM, amanhã o que for cadastrado.
--
-- 4) CATALOGAR NÃO TRAZIA O DINHEIRO DE VOLTA. `fn_hm_fecha_alerta_ao_catalogar` (0190)
--    fechava o alerta e parava aí: a compra que entrou antes do catálogo continuava fora
--    do razão para sempre, e alguém precisava lançar na mão (foi assim nos casos Nelci,
--    Vanessa, Quelen, Mauricio). Agora catalogar RELANÇA as compras aprovadas daquela
--    oferta — `fn_hm_lancar_compra` é idempotente (unique em transação+parcela), então
--    relançar é seguro.
--
-- Idempotente. Não escreve em `cs.contatos_hm`.

-- ---------------------------------------------------------------------------
-- 1) Mapa produto da Hotmart -> board
-- ---------------------------------------------------------------------------
create table if not exists cs.hm_produto_hotmart (
  produto_id text primary key,
  produto    text not null,
  nota       text,
  criado_em  timestamptz not null default now()
);

comment on table cs.hm_produto_hotmart is
  '0195: de que board é um produto da Hotmart. Usado como fallback quando a oferta ainda não foi cadastrada em cs.hm_origem_por_oferta (que é tabela de CANAL, preenchida por campanha). Sem isto, toda oferta nova do Aurum era tratada como HM.';

insert into cs.hm_produto_hotmart (produto_id, produto, nota) values
  ('5064314', 'HM',    'Holding Masters — produto principal do HM'),
  ('3507214', 'HM',    'Holding - Holding Masters — downsell/reserva do HM'),
  ('3094405', 'AURUM', 'Aurum — entrada, renovação e saldo do board AURUM')
on conflict (produto_id) do update set produto = excluded.produto, nota = excluded.nota;

-- A resolução por oferta passa a consultar compras por oferta_codigo; sem índice isso
-- vira seq scan dentro da view do board.
create index if not exists idx_compras_oferta_codigo on public.compras (oferta_codigo);

-- ---------------------------------------------------------------------------
-- 2) De quem é o pagamento: canal primeiro, produto da Hotmart depois
--
-- Era IMMUTABLE lendo tabela — mentira que autoriza o planner a congelar o resultado.
-- Vira STABLE (nenhum índice depende dela; conferido em pg_index).
-- ---------------------------------------------------------------------------
create or replace function cs.fn_hm_pagamento_do_produto(p_oferta text, p_produto text)
 returns boolean
 language sql
 stable
 set search_path to 'cs', 'public', 'pg_temp'
as $function$
  select coalesce(
    -- 1º: canal cadastrado para a oferta (o que a operação declarou)
    (select o.produto from cs.hm_origem_por_oferta o
      where o.oferta_codigo = p_oferta and o.produto is not null
      order by o.vale_de desc nulls last
      limit 1),
    -- 2º: o produto da Hotmart em que essa oferta foi vendida (o fato)
    (select m.produto from public.compras c
       join cs.hm_produto_hotmart m on m.produto_id = c.produto_id
      where c.oferta_codigo = p_oferta
        and c.status in ('APPROVED','COMPLETE','COMPLETED')
      order by coalesce(c.data_aprovacao, c.data_compra) desc nulls last
      limit 1),
    'HM'
  ) = coalesce(p_produto, 'HM');
$function$;

comment on function cs.fn_hm_pagamento_do_produto(text, text) is
  '0195: a que board pertence um pagamento. Canal (cs.hm_origem_por_oferta) tem prioridade; sem canal, cai no produto da Hotmart (cs.hm_produto_hotmart). Antes devolvia HM para toda oferta não cadastrada — mensalidade do Aurum contava para o HM.';

-- ---------------------------------------------------------------------------
-- 3) O saldo do AURUM, em um lugar só
--
--   (pacote 60.000 − entrada 1.000) − crédito da planilha − o que já pagou do AURUM
--
-- Pagamento de categoria 'sinal' fica de fora: é a entrada de R$ 1.000 do evento, já
-- descontada na base. Exceção ("não cobrar") devolve NULL — zero pintaria o card de
-- quitado. Sem linha na planilha (venda nova), crédito é zero e a conta segue valendo.
-- ---------------------------------------------------------------------------
create or replace function cs.fn_aurum_saldo(p_comprador uuid)
 returns numeric
 language sql
 stable
 set search_path to 'cs', 'public', 'pg_temp'
as $function$
  with a as (
    select ap.credito, ap.excecao
      from cs.aurum_pagamento_aluno ap
     where ap.comprador_id = p_comprador
     order by ap.atualizado_em desc, ap.documento
     limit 1
  ), pago as (
    select coalesce(sum(p.valor), 0::numeric) as valor
      from cs.hm_pagamentos p
     where p.comprador_id = p_comprador
       and p.categoria is distinct from 'sinal'
       and cs.fn_hm_pagamento_do_produto(p.oferta_codigo, 'AURUM')
  )
  select case
           when (select excecao from a) then null::numeric
           else greatest(
             round(
               ( (select valor from cs.aurum_parametros where chave = 'pacote_cheio')
               - (select valor from cs.aurum_parametros where chave = 'entrada')
               - coalesce((select credito from a), 0::numeric)
               - (select valor from pago)
               ), 2),
             0::numeric)
         end;
$function$;

comment on function cs.fn_aurum_saldo(uuid) is
  '0195: fonte ÚNICA do saldo do AURUM — ficha e board leem daqui. 59.000 − credito da planilha − pagamentos do AURUM fora da entrada. NULL quando excecao (nao cobrar).';

-- A ficha passa a ler a mesma função (era 59.000 − credito, sem abater pagamento).
create or replace view cs.vw_aurum_saldo as
 with p as (
   select (select valor from cs.aurum_parametros where chave = 'pacote_cheio') as pacote,
          (select valor from cs.aurum_parametros where chave = 'entrada')      as entrada
 )
 select a.documento, a.nome, a.email, a.telefone, a.comprador_id, a.origem_instrucao,
        a.ultima_oferta, a.ultima_compra_em, a.valor_pago, a.credito, a.situacao,
        a.excecao, a.excecao_motivo, a.obs,
        p.pacote as pacote_cheio,
        p.entrada as entrada_paga,
        p.pacote - p.entrada as base_saldo,
        cs.fn_aurum_saldo(a.comprador_id) as saldo_a_pagar,
        case
          when a.excecao then 'Nao cobrar - '::text || coalesce(a.excecao_motivo, a.situacao)
          when coalesce(a.credito, 0::numeric) > 0::numeric then 'Deve com credito abatido'::text
          else 'Deve o pacote cheio (sem credito)'::text
        end as rotulo_operador
   from cs.aurum_pagamento_aluno a
   cross join p;

-- ---------------------------------------------------------------------------
-- 4) Alerta de oferta órfã passa a cobrir todo produto mapeado (inclui AURUM)
-- ---------------------------------------------------------------------------
create or replace function cs.fn_hm_alerta_oferta_orfa_na_compra()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'cs', 'public', 'pg_temp'
as $function$
begin
  if new.status not in ('APPROVED','COMPLETE','COMPLETED') then return new; end if;
  if new.oferta_codigo is null then return new; end if;
  -- 0195: era a lista fixa dos dois produtos do HM. Agora vale para todo produto de
  -- esteira cadastrado — o Aurum (3094405) estava fora e a venda do Rangel (11/08,
  -- R$ 1.376,35) não gerou alerta nenhum.
  if not exists (select 1 from cs.hm_produto_hotmart m where m.produto_id = new.produto_id) then
    return new;
  end if;
  if exists (select 1 from public.hm_product_catalog cat where cat.offer_code = new.oferta_codigo) then
    return new;
  end if;

  begin
    insert into cs.hm_alertas (tipo, chave, severidade, detalhe)
    values ('oferta_orfa', new.oferta_codigo, 'critico',
            format('AGORA: %s pagou R$ %s na oferta %s (%s), que NAO esta em hm_product_catalog — o card nao vai andar e o pagamento nao entra no razao. Catalogar em public.hm_product_catalog (categoria: sinal, diferenca ou compra_cheia) e, se for saldo, em cs.hm_ofertas_saldo. Transacao %s.',
                   coalesce((select cp.nome from public.compradores cp where cp.id = new.comprador_id), '?'),
                   to_char(new.preco, 'FM999G999D00'),
                   new.oferta_codigo,
                   coalesce((select m.produto from cs.hm_produto_hotmart m where m.produto_id = new.produto_id), '?'),
                   coalesce(new.hotmart_transaction, '?')));
  exception when others then
    null;  -- alerta jamais derruba a venda
  end;

  return new;
end$function$;

create or replace function cs.fn_hm_alerta_oferta_orfa()
 returns integer
 language plpgsql
 security definer
 set search_path to 'cs', 'public', 'pg_temp'
as $function$
declare
  v_n integer := 0;
begin
  insert into cs.hm_alertas (tipo, chave, severidade, detalhe)
  select 'oferta_orfa',
         c.oferta_codigo,
         case when max(c.preco) >= 1000 then 'critico' else 'aviso' end,
         format('Oferta %s (%s / produto %s) tem %s compra(s) aprovada(s) somando R$ %s, mas NAO esta em public.hm_product_catalog — o trigger ignora e o card nao anda. Catalogar com a categoria certa (sinal, diferenca ou compra_cheia).',
                c.oferta_codigo,
                coalesce(max(m.produto), '?'),
                coalesce(max(c.produto_nome), '?'),
                count(*),
                to_char(sum(c.preco), 'FM999G999D00'))
    from public.compras c
    join cs.hm_produto_hotmart m on m.produto_id = c.produto_id
    left join public.hm_product_catalog cat on cat.offer_code = c.oferta_codigo
   where c.status in ('APPROVED','COMPLETE','COMPLETED')
     and cat.offer_code is null
     and c.oferta_codigo is not null
     and not exists (select 1 from cs.hm_alertas a
                      where a.tipo = 'oferta_orfa' and a.chave = c.oferta_codigo
                        and a.resolvido_em is null)
   group by c.oferta_codigo
   on conflict do nothing;

  get diagnostics v_n = row_count;
  return v_n;
end$function$;

-- ---------------------------------------------------------------------------
-- 5) Catalogar a oferta traz o dinheiro que já tinha entrado
-- ---------------------------------------------------------------------------
create or replace function cs.fn_hm_fecha_alerta_ao_catalogar()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'cs', 'public', 'pg_temp'
as $function$
declare
  r record;
begin
  update cs.hm_alertas
     set resolvido_em = now()
   where tipo = 'oferta_orfa'
     and chave = new.offer_code
     and resolvido_em is null;

  -- 0195: fechar o alerta não trazia o dinheiro. As compras que entraram ANTES do
  -- catálogo ficavam fora do razão para sempre (fn_hm_lancar_compra desiste quando a
  -- categoria é nula) e alguém tinha de lançar na mão. Relançar é seguro: o unique
  -- (transacao, parcela) faz o segundo lançamento virar no-op.
  for r in
    select c.id from public.compras c
     where c.oferta_codigo = new.offer_code
       and c.status in ('APPROVED','COMPLETE','COMPLETED')
  loop
    begin
      perform cs.fn_hm_lancar_compra(r.id);
    exception when others then
      null;  -- nunca derruba o cadastro da oferta
    end;
  end loop;

  return new;
end$function$;

comment on function cs.fn_hm_fecha_alerta_ao_catalogar() is
  '0190 + 0195: catalogar a oferta baixa o alerta E relança no razão as compras aprovadas que já tinham entrado com ela. Antes o dinheiro só voltava por migration manual.';

-- ---------------------------------------------------------------------------
-- 6) A view do board lê o saldo do AURUM da função única
-- ---------------------------------------------------------------------------
create or replace view cs.vw_hm_financeiro as
 WITH base AS (
         SELECT ch.id AS contato_hm_id,
            ch.comprador_id,
            cp.nome,
            cp.email,
            ch.turma,
            ch.turma_origem,
            ch.estagio_id,
            ch.valor_total,
            COALESCE(ch.valor_pago, 0::numeric) AS pago,
            ch.quitado_em,
            ch.oferta_saldo_codigo,
            ch.link_saldo_enviado_em,
            ch.cancelamento_efetivado_em,
            ch.acesso_preexistente,
            ch.credito_valor_pago,
            ch.credito_compra_em,
            ch.produto,
                CASE
                    WHEN 'Aluno THB'::text = ANY (ch.tags) THEN 'aluno_base'::text
                    WHEN 'Aluno Aurum'::text = ANY (ch.tags) THEN 'aluno_base'::text
                    WHEN 'Lead novo'::text = ANY (ch.tags) THEN 'lead_novo'::text
                    ELSE 'nao_classificado'::text
                END AS publico,
            ent.oferta_codigo AS entrada_oferta,
            ent.pacote_cheio AS entrada_pacote,
            ent.valor AS entrada_valor,
            ent.pago_em AS entrada_pago_em,
            COALESCE(ent.condicao_fechada, false) AS entrada_fechada,
            COALESCE(( SELECT sum(p3.valor) AS sum
                   FROM cs.hm_pagamentos p3
                  WHERE p3.comprador_id = ch.comprador_id AND p3.oferta_codigo = ent.oferta_codigo), 0::numeric) AS entrada_pago,
            ( SELECT pr.credito
                   FROM cs.fn_hm_prorata(ch.comprador_id) pr(dias_usados, dias_restantes, valor_dia, consumido, credito, saldo_a_pagar)) AS credito_hoje,
            -- [0194/0195] AURUM: saldo da fonte única, que já abate o que a pessoa pagou.
            CASE WHEN ch.produto = 'AURUM'::text THEN cs.fn_aurum_saldo(ch.comprador_id) ELSE NULL::numeric END AS aurum_saldo,
            ( SELECT COALESCE(sum(p.valor), 0::numeric) AS "coalesce"
                   FROM cs.hm_pagamentos p
                  WHERE p.comprador_id = ch.comprador_id AND cs.fn_hm_pagamento_do_produto(p.oferta_codigo, ch.produto) AND (ch.credito_compra_em IS NULL OR p.pago_em::date > ch.credito_compra_em) AND NOT (ent.pago_em IS NOT NULL AND p.pago_em < ent.pago_em AND p.categoria = 'sinal'::text AND p.oferta_codigo IS DISTINCT FROM ent.oferta_codigo)) AS pago_no_ciclo,
            ( SELECT max(p.pago_em) AS max
                   FROM cs.hm_pagamentos p
                  WHERE p.comprador_id = ch.comprador_id AND cs.fn_hm_pagamento_do_produto(p.oferta_codigo, ch.produto)) AS ultimo_pagamento_em,
            (( SELECT count(*) AS count
                   FROM cs.hm_pagamentos p
                  WHERE p.comprador_id = ch.comprador_id AND p.categoria = 'mensalidade'::text AND cs.fn_hm_pagamento_do_produto(p.oferta_codigo, ch.produto)))::integer AS parcelas_pagas,
            (( SELECT max(c.parcelas) AS max
                   FROM compras c
                  WHERE c.comprador_id = ch.comprador_id AND (c.status::text = ANY (ARRAY['APPROVED'::text, 'COMPLETE'::text, 'COMPLETED'::text])) AND c.metodo_pagamento::text = 'HOTMART_INSTALLMENTS'::text))::integer AS parcelas_contratadas,
            ( SELECT max(p.valor) AS max
                   FROM cs.hm_pagamentos p
                  WHERE p.comprador_id = ch.comprador_id AND p.categoria = 'mensalidade'::text AND cs.fn_hm_pagamento_do_produto(p.oferta_codigo, ch.produto)) AS valor_parcela
           FROM cs.contatos_hm ch
             JOIN compradores cp ON cp.id = ch.comprador_id
             LEFT JOIN LATERAL ( SELECT p.oferta_codigo,
                    cat.pacote_cheio,
                    p.valor,
                    p.pago_em,
                    cat.entrada_condicao_fechada AS condicao_fechada
                   FROM cs.hm_pagamentos p
                     JOIN hm_product_catalog cat ON cat.offer_code = p.oferta_codigo
                  WHERE p.comprador_id = ch.comprador_id AND cat.categoria = 'sinal'::text AND cat.pacote_cheio IS NOT NULL AND cs.fn_hm_pagamento_do_produto(p.oferta_codigo, ch.produto) AND (ch.credito_compra_em IS NULL OR p.pago_em::date > ch.credito_compra_em)
                  ORDER BY p.pago_em DESC, p.valor DESC, p.id DESC
                 LIMIT 1) ent ON true
        ), regra AS (
         SELECT b.contato_hm_id,
            b.comprador_id,
            b.nome,
            b.email,
            b.turma,
            b.turma_origem,
            b.estagio_id,
            b.valor_total,
            b.pago,
            b.quitado_em,
            b.oferta_saldo_codigo,
            b.link_saldo_enviado_em,
            b.cancelamento_efetivado_em,
            b.acesso_preexistente,
            b.credito_valor_pago,
            b.credito_compra_em,
            b.produto,
            b.publico,
            b.entrada_oferta,
            b.entrada_pacote,
            b.entrada_valor,
            b.entrada_pago_em,
            b.entrada_fechada,
            b.entrada_pago,
            b.credito_hoje,
            b.aurum_saldo,
            b.pago_no_ciclo,
            b.ultimo_pagamento_em,
            b.parcelas_pagas,
            b.parcelas_contratadas,
            b.valor_parcela,
                CASE
                    WHEN b.publico = 'lead_novo'::text THEN 0::numeric
                    ELSE b.credito_hoje
                END AS credito,
                CASE
                    WHEN b.produto = 'AURUM'::text THEN ( SELECT aurum_parametros.valor
                       FROM cs.aurum_parametros
                      WHERE aurum_parametros.chave = 'pacote_cheio'::text)
                    WHEN b.entrada_pacote IS NOT NULL THEN round(b.entrada_pacote -
                    CASE
                        WHEN b.publico = 'lead_novo'::text THEN 0::numeric
                        ELSE COALESCE(b.credito_hoje, 0::numeric)
                    END, 2)
                    WHEN b.publico = 'lead_novo'::text THEN 15000::numeric
                    WHEN b.credito_hoje IS NOT NULL THEN round(15000::numeric - b.credito_hoje, 2)
                    ELSE NULL::numeric
                END AS pacote_regra,
                CASE
                    WHEN b.produto = 'AURUM'::text THEN b.aurum_saldo
                    WHEN b.entrada_pacote IS NOT NULL THEN round(b.entrada_pacote - b.entrada_pago -
                    CASE
                        WHEN b.publico = 'lead_novo'::text THEN 0::numeric
                        ELSE COALESCE(b.credito_hoje, 0::numeric)
                    END, 2)
                    WHEN b.publico = 'lead_novo'::text THEN 14700::numeric
                    WHEN b.credito_hoje IS NOT NULL THEN round(14700::numeric - b.credito_hoje, 2)
                    ELSE NULL::numeric
                END AS saldo_regra
           FROM base b
        )
 SELECT r.contato_hm_id,
    r.comprador_id,
    r.nome,
    r.email,
    r.turma,
    r.turma_origem,
    r.estagio_id,
    r.publico,
    r.credito_valor_pago,
    r.credito_compra_em,
    r.credito,
    r.pacote_regra,
    r.saldo_regra,
    r.valor_total AS pacote_cravado,
    r.pago,
        CASE
            WHEN r.valor_total IS NOT NULL THEN GREATEST(r.valor_total - r.pago, 0::numeric)
            ELSE NULL::numeric
        END AS saldo_cravado,
        CASE
            WHEN r.produto = 'AURUM'::text THEN COALESCE(
                CASE
                    WHEN r.valor_total IS NOT NULL THEN GREATEST(r.valor_total - r.pago, 0::numeric)
                    ELSE NULL::numeric
                END, r.aurum_saldo)
            ELSE COALESCE(
                CASE
                    WHEN r.valor_total IS NOT NULL THEN GREATEST(r.valor_total - r.pago, 0::numeric)
                    ELSE NULL::numeric
                END,
                CASE
                    WHEN r.pacote_regra IS NOT NULL THEN GREATEST(r.pacote_regra - r.pago_no_ciclo, 0::numeric)
                    ELSE NULL::numeric
                END)
        END AS saldo_a_perseguir,
        CASE
            WHEN r.valor_total IS NOT NULL AND r.pacote_regra IS NOT NULL THEN round(r.valor_total - r.pacote_regra, 2)
            ELSE NULL::numeric
        END AS divergencia_regra,
    r.quitado_em IS NOT NULL AS quitado,
    r.cancelamento_efetivado_em IS NOT NULL AS cancelado,
    r.oferta_saldo_codigo,
    r.link_saldo_enviado_em IS NOT NULL AS oferta_enviada,
        CASE
            WHEN r.cancelamento_efetivado_em IS NOT NULL THEN 'cancelado'::text
            WHEN r.quitado_em IS NOT NULL THEN 'quitado'::text
            WHEN (EXISTS ( SELECT 1
               FROM cs.hm_pagamentos p
              WHERE p.comprador_id = r.comprador_id AND p.categoria = 'mensalidade'::text AND cs.fn_hm_pagamento_do_produto(p.oferta_codigo, r.produto))) THEN 'mensalidade_em_curso'::text
            WHEN r.publico = 'aluno_base'::text AND r.credito_hoje IS NULL AND NOT r.entrada_fechada THEN 'incalculavel'::text
            WHEN r.link_saldo_enviado_em IS NOT NULL THEN 'oferta_enviada'::text
            ELSE 'saldo_parado'::text
        END AS situacao,
    r.pago_no_ciclo,
    r.ultimo_pagamento_em,
    r.parcelas_pagas,
    r.parcelas_contratadas,
    r.valor_parcela,
        CASE
            WHEN COALESCE(r.valor_total, r.pacote_regra) > 0::numeric THEN round(100::numeric * r.pago / COALESCE(r.valor_total, r.pacote_regra), 1)
            ELSE NULL::numeric
        END AS pago_pct,
    ab.pago_em AS ultimo_abatimento_em,
    ab.valor AS ultimo_abatimento_valor,
    ab.categoria AS ultimo_abatimento_categoria,
    r.entrada_oferta,
    r.entrada_valor,
    r.entrada_pago_em
   FROM regra r
     LEFT JOIN LATERAL ( SELECT p.pago_em,
            p.valor,
            p.categoria
           FROM cs.hm_pagamentos p
          WHERE p.comprador_id = r.comprador_id AND (p.categoria = ANY (ARRAY['mensalidade'::text, 'saldo'::text, 'compra_cheia'::text])) AND cs.fn_hm_pagamento_do_produto(p.oferta_codigo, r.produto)
          ORDER BY p.pago_em DESC
         LIMIT 1) ab ON true;

revoke insert, update, delete on cs.vw_hm_financeiro from disparos_app;
grant select on cs.vw_hm_financeiro to disparos_app;
grant select on cs.vw_aurum_saldo to disparos_app;
grant select on cs.hm_produto_hotmart to disparos_app;

-- ---------------------------------------------------------------------------
-- 7) Varredura retroativa: o que já entrou e ninguém viu
-- ---------------------------------------------------------------------------
do $$
declare
  v_novos int;
  v_orfas int;
begin
  v_novos := cs.fn_hm_alerta_oferta_orfa();

  select count(distinct c.oferta_codigo) into v_orfas
    from public.compras c
    join cs.hm_produto_hotmart m on m.produto_id = c.produto_id
    left join public.hm_product_catalog cat on cat.offer_code = c.oferta_codigo
   where c.status in ('APPROVED','COMPLETE','COMPLETED') and cat.offer_code is null;

  raise notice '0195: % alertas novos de oferta orfa; % ofertas orfas no total', v_novos, v_orfas;
end $$;

-- ---------------------------------------------------------------------------
-- 8) Conferência
-- ---------------------------------------------------------------------------
do $$
declare v_div int; v_aurum int;
begin
  select count(*) into v_div
    from cs.contatos_hm ch
    join cs.vw_hm_financeiro f on f.contato_hm_id = ch.id
    join cs.aurum_pagamento_aluno a on a.comprador_id = ch.comprador_id
    join cs.vw_aurum_saldo s on s.documento = a.documento
   where ch.produto = 'AURUM' and f.saldo_a_perseguir is distinct from s.saldo_a_pagar;
  if v_div > 0 then
    raise exception '0195: % cards do AURUM com board != ficha', v_div;
  end if;

  select count(*) into v_aurum from cs.contatos_hm where produto = 'AURUM';
  raise notice '0195: ok — % cards AURUM, board e ficha na mesma fonte', v_aurum;
end $$;
