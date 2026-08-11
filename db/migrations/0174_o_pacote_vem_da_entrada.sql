-- 0174_o_pacote_vem_da_entrada.sql
-- "O saldo tem que se adaptar conforme o pagamento do sinal que o cara deu. O primeiro
--  pagamento dele sinaliza a forma como vai ser acordado. A oferta pode mudar: na semana
--  passada era 300, essa semana ja e 697." (Marcio, 10/08/2026)
--
-- ---------------------------------------------------------------------------
-- O QUE ESTAVA ERRADO
--
-- A regua do HM vivia em CONSTANTE dentro do SQL. A 0166 precisou de um WHEN novo e de uma
-- migration inteira so para dizer "a oferta rlgjsrul custa 15.000". A proxima oferta — o
-- Marcio ja falou em R$497 — pediria outro WHEN, outra migration, outro deploy. E o `14700`
-- (que e 15.000 − 300) e a resposta ERRADA para quem entrou por outra porta: quem pagou os
-- R$2.000 da nz3ob9r2 nao deve 14.700.
--
-- Preco de porta e um FATO DA OFERTA. Ele passa a morar onde as ofertas ja moram.
--
-- ---------------------------------------------------------------------------
-- O QUE NAO E OBVIO — a porta tem PRECO e tem NATUREZA
--
-- Nao basta guardar o valor. As duas portas que existem hoje se comportam diferente, e as
-- duas estao certas:
--   · z391kxd9 (R$300)  e preco de TABELA — aluno da base ainda desconta o pro-rata do
--     acesso antigo por cima (pacote = 15.000 − credito). 184 cards dependem disso.
--   · rlgjsrul (R$697)  e CONDICAO FECHADA — a 0166 registra a decisao do Marcio: "os 697
--     ja sao a condicao fechada, nao ha pro-rata por cima". Foi isso que tirou 5 alunos da
--     base do limbo `incalculavel`.
-- Guardar so o preco colapsaria os dois e tiraria o desconto de 184 pessoas EM SILENCIO.
-- Por isso duas colunas, nao uma.
--
-- ---------------------------------------------------------------------------
-- ESTA MIGRATION NAO MUDA O VALOR DE NINGUEM — DE PROPOSITO
--
-- As ofertas sao semeadas exatamente com o comportamento que a view ja tinha:
--   z391kxd9 → 15.000, ABERTA (pro-rata continua valendo)
--   rlgjsrul → 15.000, FECHADA (identico a 0166)
--   nz3ob9r2, 6qxsk9kq, qm4lu7py → SEM preco: caem no ramo antigo, intocados
-- Medido em ensaio revertido antes de aplicar (secao 6.1 do plano):
--   cards que mudam de saldo_a_perseguir: <PREENCHER>
--   cards que mudam de pacote_regra:      <PREENCHER>
--   cards que mudam de situacao:          <PREENCHER>
--   linhas da view antes/depois:          <PREENCHER>/<PREENCHER>
-- Daqui para a frente, mudar o acordo de um grupo e um UPDATE de UMA LINHA, explicito,
-- decidido pelo Marcio, e mensuravel antes pelo mesmo instrumento (cs.hm_financeiro_marco).
--
-- ---------------------------------------------------------------------------
-- O QUE FICOU DE FORA, DE PROPOSITO
--   · nz3ob9r2 (R$2.000, 9 cards) — sem preco ate o Marcio dizer qual e o pacote daquela
--     porta e se ela e fechada. Preco chutado e dinheiro cobrado errado.
--   · O ramo AURUM continua lendo cs.aurum_parametros. Da para unifica-lo nestas colunas e
--     apagar o ramo (0175), mas nao no meio de uma live.
--   · fn_hm_prorata, hm-ficha.ts e a pagina do contato ainda tem 14.700/15.000 cravados em
--     outros papeis (link de saldo sugerido, texto de tela). Listados no plano como
--     CONFLITO; nenhum deles cobra ninguem hoje.
--
-- Idempotente. Sem janela de indisponibilidade: create or replace view.

-- ---------------------------------------------------------------------------
-- BLOCO A — o preco da porta vira coluna
-- ---------------------------------------------------------------------------
alter table public.hm_product_catalog
  add column if not exists pacote_cheio numeric(12,2);
alter table public.hm_product_catalog
  add column if not exists entrada_condicao_fechada boolean not null default false;

comment on column public.hm_product_catalog.pacote_cheio is
  'Quanto custa o PROGRAMA COMPLETO para quem entra por esta oferta. NULL = a oferta nao e porta de entrada do programa (ou o preco ainda nao foi decidido) e a regua nao a usa. E a presenca deste valor que define "e entrada": nao existe flag separado.';
comment on column public.hm_product_catalog.entrada_condicao_fechada is
  'true = o preco desta entrada JA E a condicao final; aluno da base NAO desconta pro-rata por cima (decisao do Marcio para a rlgjsrul, 0166). false = preco de tabela, o pro-rata continua valendo. Mudar isto reprecifica todo mundo que entrou por esta porta — medir antes com cs.hm_financeiro_marco.';

-- Solidificacao: o banco passa a impedir sozinho duas incoerencias.
alter table public.hm_product_catalog
  drop constraint if exists hm_product_catalog_pacote_positivo;
alter table public.hm_product_catalog
  add  constraint hm_product_catalog_pacote_positivo
  check (pacote_cheio is null or pacote_cheio > 0);

-- "condicao fechada" sem preco e uma declaracao vazia — e silenciosa: a view leria
-- entrada_pacote null e cairia no ramo antigo sem que ninguem soubesse.
alter table public.hm_product_catalog
  drop constraint if exists hm_product_catalog_fechada_exige_pacote;
alter table public.hm_product_catalog
  add  constraint hm_product_catalog_fechada_exige_pacote
  check (not entrada_condicao_fechada or pacote_cheio is not null);

-- ---------------------------------------------------------------------------
-- BLOCO B — semear as portas que existem, reproduzindo o comportamento atual
-- ---------------------------------------------------------------------------
update public.hm_product_catalog
   set pacote_cheio = 15000.00, entrada_condicao_fechada = false
 where offer_code = 'z391kxd9';   -- R$300, 184 cards. ABERTA: o pro-rata do aluno da base
                                  -- continua descontando. Flipar para true tira 30 cards de
                                  -- `incalculavel` E repreca os outros 184 — nao e aqui.

update public.hm_product_catalog
   set pacote_cheio = 15000.00, entrada_condicao_fechada = true
 where offer_code = 'rlgjsrul';   -- R$697, 21 cards. FECHADA: reproduz a 0166 letra por letra
                                  -- (saldo 14.303, sem pro-rata, sem `incalculavel`).

-- As tres que ficam SEM preco, e por que. Escrito como UPDATE explicito para que a ausencia
-- seja uma decisao registrada, e nao um esquecimento.
update public.hm_product_catalog
   set pacote_cheio = null, entrada_condicao_fechada = false
 where offer_code in ('nz3ob9r2','6qxsk9kq','qm4lu7py');
--   nz3ob9r2 R$2.000 — o pacote daquela porta nao foi decidido. Ver BLOQUEIO B1.
--   6qxsk9kq R$2.497 — e ACESSO ETHB ate Dez/2026, nao o programa. Quitado nesse valor, nao
--                      deve saldo. Coerente com concede_trilha=false (0114).
--   qm4lu7py R$1.000 — e o AURUM. Parametros proprios em cs.aurum_parametros (0158).

-- ---------------------------------------------------------------------------
-- BLOCO C — o instrumento: fotografia do financeiro antes de cada mudanca de regua
--
-- Nao e tabela de apoio desta migration; e o aparelho que faltava. Toda vez que alguem for
-- mexer no preco de uma porta, tira um marco antes e compara depois. Historico nao se
-- apaga: cada marco fica.
-- ---------------------------------------------------------------------------
create table if not exists cs.hm_financeiro_marco (
  marco             text        not null,   -- 'pre-0174', 'pre-flip-z391kxd9', ...
  contato_hm_id     uuid        not null,
  pacote_regra      numeric,
  saldo_a_perseguir numeric,
  situacao          text,
  tirado_em         timestamptz not null default now(),
  primary key (marco, contato_hm_id)
);
comment on table cs.hm_financeiro_marco is
  'Fotografia de pacote/saldo/situacao antes de mudar a regua do HM. Serve para provar quem mudou de valor e para voltar atras. Nunca sobrescreve: um marco por evento.';

insert into cs.hm_financeiro_marco (marco, contato_hm_id, pacote_regra, saldo_a_perseguir, situacao)
select 'pre-0174', f.contato_hm_id, f.pacote_regra, f.saldo_a_perseguir, f.situacao
  from cs.vw_hm_financeiro f
on conflict (marco, contato_hm_id) do nothing;

grant select on cs.hm_financeiro_marco to disparos_app;

-- ---------------------------------------------------------------------------
-- BLOCO D — a view. Os pontos que mudam em relacao a 0166 estao marcados "0174".
-- Nomes, tipos e ORDEM das colunas identicos: create or replace exige, e o board, a tabela,
-- os exports e fn_hm_sugestao_financeira (0116) leem daqui.
-- ---------------------------------------------------------------------------
create or replace view cs.vw_hm_financeiro as
 WITH base AS (
   SELECT ch.id AS contato_hm_id, ch.comprador_id, cp.nome, cp.email, ch.turma, ch.turma_origem,
     ch.estagio_id, ch.valor_total, COALESCE(ch.valor_pago, 0::numeric) AS pago, ch.quitado_em,
     ch.oferta_saldo_codigo, ch.link_saldo_enviado_em, ch.cancelamento_efetivado_em,
     ch.acesso_preexistente, ch.credito_valor_pago, ch.credito_compra_em, ch.produto,
     CASE WHEN 'Aluno THB'::text = ANY (ch.tags) THEN 'aluno_base'::text
          WHEN 'Aluno Aurum'::text = ANY (ch.tags) THEN 'aluno_base'::text
          WHEN 'Lead novo'::text = ANY (ch.tags) THEN 'lead_novo'::text
          ELSE 'nao_classificado'::text END AS publico,
     -- 0174: A ENTRADA E O CONTRATO. Substitui o `entrada_697` cravado da 0166.
     -- Uma linha por card, garantida por LIMIT 1 com ORDEM TOTAL — a 0168 mostrou que
     -- subquery que devolve 2 linhas derruba a view inteira, e a 0169 mostrou que
     -- `select into` sem ordem escolhe ao acaso sem levantar erro.
     ent.oferta_codigo                     AS entrada_oferta,
     ent.pacote_cheio                      AS entrada_pacote,
     COALESCE(ent.condicao_fechada, false) AS entrada_fechada,
     COALESCE((SELECT sum(p3.valor) FROM cs.hm_pagamentos p3
                WHERE p3.comprador_id = ch.comprador_id
                  AND p3.oferta_codigo = ent.oferta_codigo), 0) AS entrada_pago,
     (SELECT pr.credito FROM cs.fn_hm_prorata(ch.comprador_id)
        pr(dias_usados, dias_restantes, valor_dia, consumido, credito, saldo_a_pagar)) AS credito_hoje,
     (SELECT COALESCE(sum(p.valor),0) FROM cs.hm_pagamentos p
       WHERE p.comprador_id = ch.comprador_id
         AND cs.fn_hm_pagamento_do_produto(p.oferta_codigo, ch.produto)
         AND (ch.credito_compra_em IS NULL OR p.pago_em::date > ch.credito_compra_em)) AS pago_no_ciclo,
     (SELECT max(p.pago_em) FROM cs.hm_pagamentos p
       WHERE p.comprador_id = ch.comprador_id
         AND cs.fn_hm_pagamento_do_produto(p.oferta_codigo, ch.produto)) AS ultimo_pagamento_em,
     ((SELECT count(*) FROM cs.hm_pagamentos p
        WHERE p.comprador_id = ch.comprador_id AND p.categoria = 'mensalidade'
          AND cs.fn_hm_pagamento_do_produto(p.oferta_codigo, ch.produto)))::integer AS parcelas_pagas,
     ((SELECT max(c.parcelas) FROM compras c
        WHERE c.comprador_id = ch.comprador_id
          AND (c.status::text = ANY (ARRAY['APPROVED','COMPLETE','COMPLETED']))
          AND c.metodo_pagamento::text = 'HOTMART_INSTALLMENTS'))::integer AS parcelas_contratadas,
     (SELECT max(p.valor) FROM cs.hm_pagamentos p
       WHERE p.comprador_id = ch.comprador_id AND p.categoria = 'mensalidade'
         AND cs.fn_hm_pagamento_do_produto(p.oferta_codigo, ch.produto)) AS valor_parcela
   FROM cs.contatos_hm ch
   JOIN compradores cp ON cp.id = ch.comprador_id
   -- 0174: a porta de entrada. LEFT = card sem entrada catalogada continua no ramo antigo.
   LEFT JOIN LATERAL (
     SELECT p.oferta_codigo, cat.pacote_cheio,
            cat.entrada_condicao_fechada AS condicao_fechada
       FROM cs.hm_pagamentos p
       JOIN public.hm_product_catalog cat ON cat.offer_code = p.oferta_codigo
      WHERE p.comprador_id = ch.comprador_id
        AND cat.categoria = 'sinal'
        AND cat.pacote_cheio IS NOT NULL
        -- nao cruza board: card do HM nao pesca entrada do AURUM (regressao da 0172)
        AND cs.fn_hm_pagamento_do_produto(p.oferta_codigo, ch.produto)
        -- mesma janela de pago_no_ciclo: pacote do ciclo A menos pagamento do ciclo B
        -- seria uma conta entre coisas diferentes
        AND (ch.credito_compra_em IS NULL OR p.pago_em::date > ch.credito_compra_em)
      ORDER BY p.pago_em ASC, p.oferta_codigo ASC, p.id ASC
      LIMIT 1
   ) ent ON true
 ), regra AS (
   SELECT b.*,
     -- 0174: entrada com condicao fechada nao acumula pro-rata por cima (era `entrada_697 > 0`)
     CASE WHEN b.entrada_fechada THEN 0::numeric
          WHEN b.publico = 'lead_novo' THEN 0::numeric ELSE b.credito_hoje END AS credito,
     CASE WHEN b.produto = 'AURUM'
            THEN (select valor from cs.aurum_parametros where chave='pacote_cheio')
          -- 0174: o pacote vem da PORTA. Subtrair `credito_hoje` NULL devolve NULL de
          -- proposito — aluno da base sem pro-rata calculado continua `incalculavel`.
          WHEN b.entrada_pacote IS NOT NULL
            THEN round(b.entrada_pacote
                       - (CASE WHEN b.entrada_fechada OR b.publico = 'lead_novo'
                               THEN 0::numeric ELSE b.credito_hoje END), 2)
          -- Fallback historico: card SEM entrada catalogada (entrou por compra cheia, por
          -- diferenca, ou por oferta antiga sem preco). 15.000 e o pacote do HM ate 10/08 e
          -- NAO deve mudar: mexer aqui repreca gente velha. Oferta nova nao passa por aqui.
          WHEN b.publico = 'lead_novo' THEN 15000::numeric
          WHEN b.credito_hoje IS NOT NULL THEN round(15000::numeric - b.credito_hoje, 2)
          ELSE NULL::numeric END AS pacote_regra,
     -- DEPRECADA (0174): nenhuma linha de TS/TSX le `saldo_regra`. O numero que a operacao
     -- persegue e `saldo_a_perseguir` = pacote_regra − pago_no_ciclo. Mantida so por
     -- compatibilidade de forma; generalizada para nao mentir. Remover depois de varrer os
     -- consumidores (licao da 0167).
     CASE WHEN b.produto = 'AURUM'
            THEN ((select valor from cs.aurum_parametros where chave='pacote_cheio')
                - (select valor from cs.aurum_parametros where chave='entrada'))
          WHEN b.entrada_pacote IS NOT NULL
            THEN round(b.entrada_pacote - b.entrada_pago
                       - (CASE WHEN b.entrada_fechada OR b.publico = 'lead_novo'
                               THEN 0::numeric ELSE b.credito_hoje END), 2)
          WHEN b.publico = 'lead_novo' THEN 14700::numeric
          WHEN b.credito_hoje IS NOT NULL THEN round(14700::numeric - b.credito_hoje, 2)
          ELSE NULL::numeric END AS saldo_regra
   FROM base b
 )
 SELECT r.contato_hm_id, r.comprador_id, r.nome, r.email, r.turma, r.turma_origem, r.estagio_id,
   r.publico, r.credito_valor_pago, r.credito_compra_em, r.credito, r.pacote_regra, r.saldo_regra,
   r.valor_total AS pacote_cravado, r.pago,
   CASE WHEN r.valor_total IS NOT NULL THEN GREATEST(r.valor_total - r.pago, 0) END AS saldo_cravado,
   -- INALTERADO: o pacote cravado continua ganhando da regua.
   COALESCE(CASE WHEN r.valor_total IS NOT NULL THEN GREATEST(r.valor_total - r.pago, 0) END,
            CASE WHEN r.pacote_regra IS NOT NULL THEN GREATEST(r.pacote_regra - r.pago_no_ciclo, 0) END) AS saldo_a_perseguir,
   CASE WHEN r.valor_total IS NOT NULL AND r.pacote_regra IS NOT NULL
        THEN round(r.valor_total - r.pacote_regra, 2) END AS divergencia_regra,
   r.quitado_em IS NOT NULL AS quitado, r.cancelamento_efetivado_em IS NOT NULL AS cancelado,
   r.oferta_saldo_codigo, r.link_saldo_enviado_em IS NOT NULL AS oferta_enviada,
   CASE WHEN r.cancelamento_efetivado_em IS NOT NULL THEN 'cancelado'
        WHEN r.quitado_em IS NOT NULL THEN 'quitado'
        WHEN (EXISTS (SELECT 1 FROM cs.hm_pagamentos p
                       WHERE p.comprador_id = r.comprador_id AND p.categoria = 'mensalidade'
                         AND cs.fn_hm_pagamento_do_produto(p.oferta_codigo, r.produto))) THEN 'mensalidade_em_curso'
        -- 0174: era `r.entrada_697 = 0`. Mesma semantica, generalizada: entrada de condicao
        -- fechada tira o card do limbo; entrada de preco de tabela nao.
        WHEN r.publico = 'aluno_base' AND r.credito_hoje IS NULL AND NOT r.entrada_fechada THEN 'incalculavel'
        WHEN r.link_saldo_enviado_em IS NOT NULL THEN 'oferta_enviada'
        ELSE 'saldo_parado' END AS situacao,
   r.pago_no_ciclo, r.ultimo_pagamento_em, r.parcelas_pagas, r.parcelas_contratadas, r.valor_parcela,
   CASE WHEN COALESCE(r.valor_total, r.pacote_regra) > 0
        THEN round(100 * r.pago / COALESCE(r.valor_total, r.pacote_regra), 1) END AS pago_pct,
   ab.pago_em AS ultimo_abatimento_em, ab.valor AS ultimo_abatimento_valor,
   ab.categoria AS ultimo_abatimento_categoria
 FROM regra r
 LEFT JOIN LATERAL (SELECT p.pago_em, p.valor, p.categoria FROM cs.hm_pagamentos p
    WHERE p.comprador_id = r.comprador_id
      AND (p.categoria = ANY (ARRAY['mensalidade','saldo','compra_cheia']))
      AND cs.fn_hm_pagamento_do_produto(p.oferta_codigo, r.produto)
    ORDER BY p.pago_em DESC LIMIT 1) ab ON true;

grant select on cs.vw_hm_financeiro to disparos_app;

-- ---------------------------------------------------------------------------
-- BLOCO E — o novo silencio ganha alarme
--
-- A 0157 documenta o furo classico: oferta fora do catalogo, venda invisivel, ninguem avisa.
-- As colunas novas criam um furo IRMAO e mais discreto: oferta de entrada cadastrada CERTA,
-- mas SEM pacote_cheio. A venda aparece, o card nasce, e o pacote sai 15.000 pelo fallback
-- historico — pode estar errado e nao ha sintoma. Alarme antes que alguem descubra por
-- reclamacao de aluno.
--
-- As excecoes nao sao lista de codigos (isso seria o proximo fossil): sao derivadas dos
-- fatos que ja existem — concede_trilha=false (acesso, nao programa) e produto<>'HM' (Aurum).
-- ---------------------------------------------------------------------------
-- backend: ADICIONAR este bloco DENTRO de cs.fn_hm_health_check(), logo depois do item
-- (1) OFERTA ORFA, como (1b). Nao criar funcao nova.
--
--   insert into cs.hm_alertas (tipo, chave, severidade, detalhe)
--   select 'entrada_sem_pacote', cat.offer_code, 'critico',
--          'Oferta de entrada '||cat.offer_code||' ('||coalesce(cat.notes,'sem nota')||') esta no '
--          ||'catalogo como sinal e SEM pacote_cheio: '||count(*)||' venda(s) aprovada(s) caindo no '
--          ||'pacote historico de 15.000. Definir o preco da porta em public.hm_product_catalog.'
--     from public.compras c
--     join public.hm_product_catalog cat on cat.offer_code = c.oferta_codigo
--    where c.status in ('APPROVED','COMPLETE','COMPLETED')
--      and cat.categoria = 'sinal'
--      and cat.pacote_cheio is null
--      and cat.concede_trilha                      -- acesso/renovacao nao e entrada do programa
--      and coalesce((select o.produto from cs.hm_origem_por_oferta o
--                     where o.oferta_codigo = cat.offer_code
--                     order by o.vale_de desc nulls last limit 1), 'HM') = 'HM'   -- Aurum tem regra propria
--      and coalesce(c.data_aprovacao, c.data_compra) >= v_cutoff
--    group by cat.offer_code, cat.notes
--    on conflict do nothing;
--
-- ⚠️ Antes de aplicar: rodar Q5 da secao 6.0. Se `qm4lu7py` vier com concede_trilha=true E
-- produto='HM' em hm_origem_por_oferta, ela dispararia alarme falso — nesse caso corrigir o
-- produto dela na hm_origem_por_oferta (que e o dado certo, e ja e usado pela 0168/0169),
-- NAO adicionar excecao por codigo aqui.
