-- 0255_o_catalogo_ganha_a_face_comercial.sql
-- O catálogo (`public.hm_product_catalog`) passa a guardar o que a planilha do
-- Marcio ("Links necessários.xlsx") traz e hoje não tem onde morar: nome
-- comercial, preço de vitrine, explicação, link, o produto_checkout da URL,
-- dono individual da oferta, se é recorrente, se está ativa e de onde veio o
-- dado. TUDO DESCRITIVO — vitrine, não régua.
--
-- ---------------------------------------------------------------------------
-- POR QUE "DESCRITIVO" NÃO É DETALHE MENOR
--
-- Medido em produção, 16/08/2026 (orquestrador, MCP Supabase, projeto
-- mbvybujpkwuorhtdzcde): as 96 linhas do catálogo têm `price_brl` nulo nas 96
-- — a coluna existe e nunca foi preenchida. `pacote_cheio` (0174),
-- `entrada_condicao_fechada` (0174), `entrada_do_programa` (0240) e
-- `concede_trilha` (0114) são a RÉGUA — decidem quanto cada aluno deve e se
-- ganha trilha. As colunas desta migration NUNCA entram nessas contas. Mudar
-- `valor_tabela` não recobra ninguém; é o preço que a operação CITA ao aluno.
--
-- ---------------------------------------------------------------------------
-- CATEGORIA VIRA LEGADO, NÃO SOME
--
-- `categoria` (sinal/compra_cheia/diferenca) já mistura três eixos diferentes
-- — achado do analista de dados em 16/08 (disparos-brain, "Categoria sinal do
-- catálogo mistura três coisas"): produto (HM x AURUM), papel na jornada
-- (entrada x saldo) e se é preço de tabela ou condição fechada. A migration
-- não apaga a coluna (nada lê menos por causa dela) nem reescreve nenhuma
-- linha existente — só nasce `papel`, o eixo novo, deliberadamente NULO em
-- toda linha atual: preenchê-lo pela `categoria` velha SERIA reclassificar
-- sem medir, e "categoria='sinal'" já mente para 3 ofertas medidas
-- (6qxsk9kq, nz3ob9r2, qm4lu7py — R$62.988 fora do eixo certo). `papel` só
-- ganha valor por PROMOÇÃO explícita (0257) ou edição humana na tela
-- ({base}/ofertas, B6/F6), nunca por backfill cego.
--
-- ---------------------------------------------------------------------------
-- ATIVO NASCE TRUE PARA TODO MUNDO, DE PROPÓSITO
--
-- O Marcio reuniu "muitas ofertas, não todas" na planilha. Ausência na
-- planilha NÃO é sinal de oferta morta — um `ativo = false where offer_code
-- not in (planilha)` desligaria oferta viva em silêncio (ex.: as 33 ofertas
-- do HM já catalogadas, que respondem por R$1.162.716,74 aprovados, sequer
-- estão listadas por completo na planilha). `ativo` só muda por ato humano na
-- tela, nunca por esta migration.
--
-- ---------------------------------------------------------------------------
-- ESTA MIGRATION NÃO ESCREVE UMA LINHA SEQUER DE VALOR
--
-- Só ADD COLUMN (todas nulas ou com default seguro) + CHECK. Nenhum UPDATE em
-- coluna existente. A prova é o bloco CONTAR ANTES/DEPOIS no rodapé — as duas
-- contagens têm que bater byte a byte.
--
-- Idempotente (add column if not exists / drop constraint if exists + add).

-- ---------------------------------------------------------------------------
-- CONTAR ANTES (rodar e colar a saída ANTES de aplicar — e de novo DEPOIS;
-- as duas têm que ser idênticas, prova de que nenhuma linha existente mudou):
--
--   select count(*)                                              as total,
--          count(*) filter (where pacote_cheio is not null)      as com_pacote_cheio,
--          count(*) filter (where entrada_condicao_fechada)      as condicao_fechada,
--          count(*) filter (where entrada_do_programa)           as com_entrada_programa,
--          count(*) filter (where concede_trilha = false)        as sem_trilha,
--          count(*) filter (where categoria is not null)         as com_categoria,
--          count(*) filter (where product_id is null)            as sem_product_id
--     from public.hm_product_catalog;
-- ---------------------------------------------------------------------------

alter table public.hm_product_catalog
  add column if not exists nome_comercial    text,
  add column if not exists valor_tabela      numeric(12,2),
  add column if not exists explicacao        text,
  add column if not exists link              text,
  add column if not exists produto_checkout  text,
  add column if not exists dono_email        text,
  add column if not exists recorrente        boolean not null default false,
  add column if not exists ativo             boolean not null default true,
  add column if not exists origem_do_dado    text not null default 'migration',
  add column if not exists origem_ref        text,
  add column if not exists papel             text,
  add column if not exists atualizado_por    text,
  add column if not exists atualizado_em     timestamptz;

comment on column public.hm_product_catalog.categoria is
  '0255: LEGADO. Mistura três eixos (produto, papel na jornada, tabela x condição
   fechada) — mentia para 3 ofertas medidas em 16/08 (6qxsk9kq, nz3ob9r2, qm4lu7py).
   Não foi apagada porque leitores existentes ainda a usam (grep em db/migrations e
   lib/); código NOVO deve ler `papel`, `product_id`/produto_checkout e
   entrada_do_programa/pacote_cheio/concede_trilha em vez desta coluna.';

comment on column public.hm_product_catalog.valor_tabela is
  '0255: PREÇO DE VITRINE, para a operação citar ao aluno. NÃO É RÉGUA DE COBRANÇA
   — quem decide o que a pessoa deve é pacote_cheio (0174) e entrada_do_programa
   (0240). Mudar valor_tabela não recobra ninguém.';

comment on column public.hm_product_catalog.link is
  '0255: link de checkout da Hotmart desta oferta especificamente (não confundir
   com o link de saldo escolhido por VALOR em cs.hm_ofertas_saldo, 0049).';

comment on column public.hm_product_catalog.produto_checkout is
  '0255: o segmento da URL da Hotmart (ex.: "L97981750T" em
   pay.hotmart.com/L97981750T?off=...) — hoje o sistema só conhece o product_id
   NUMÉRICO (cs.hm_produto_hotmart, 0195). De-para em
   cs.hm_produto_checkout_de_para (0255), só DESCRITIVO — não alimenta o
   roteamento de dinheiro (cs.fn_hm_pagamento_do_produto continua intocada).';

comment on column public.hm_product_catalog.origem_do_dado is
  '0255: de onde veio esta linha/edição — webhook (oferta nova detectada na
   compra) · planilha (promovida de cs.oferta_planilha_staging, 0257) · migration
   (semeada por arquivo .sql) · manual (editada na tela {base}/ofertas, master).';

comment on column public.hm_product_catalog.origem_ref is
  '0255: referência da origem — nome do arquivo de migration, id/lote de
   cs.oferta_planilha_staging, ou e-mail de quem editou manualmente.';

comment on column public.hm_product_catalog.papel is
  '0255: o papel da oferta na jornada, separado de `categoria` (legado, mistura
   eixos). NULL = ainda não classificado — não inferir de categoria sem medir.
   Valores: entrada · saldo · pacote_cheio · renovacao · ingresso ·
   upgrade_ingresso · transmissao · acordo_individual.';

alter table public.hm_product_catalog
  drop constraint if exists hm_product_catalog_valor_tabela_positivo;
alter table public.hm_product_catalog
  add  constraint hm_product_catalog_valor_tabela_positivo
  check (valor_tabela is null or valor_tabela > 0);

alter table public.hm_product_catalog
  drop constraint if exists hm_product_catalog_link_https;
alter table public.hm_product_catalog
  add  constraint hm_product_catalog_link_https
  check (link is null or link like 'https://%');

alter table public.hm_product_catalog
  drop constraint if exists hm_product_catalog_origem_do_dado_valida;
alter table public.hm_product_catalog
  add  constraint hm_product_catalog_origem_do_dado_valida
  check (origem_do_dado in ('webhook', 'planilha', 'migration', 'manual'));

alter table public.hm_product_catalog
  drop constraint if exists hm_product_catalog_papel_valido;
alter table public.hm_product_catalog
  add  constraint hm_product_catalog_papel_valido
  check (papel is null or papel in (
    'entrada', 'saldo', 'pacote_cheio', 'renovacao', 'ingresso',
    'upgrade_ingresso', 'transmissao', 'acordo_individual'
  ));

alter table public.hm_product_catalog
  drop constraint if exists hm_product_catalog_dono_email_formato;
alter table public.hm_product_catalog
  add  constraint hm_product_catalog_dono_email_formato
  check (dono_email is null or dono_email like '%_@_%');

-- ---------------------------------------------------------------------------
-- De-para produto_checkout (URL) <-> product_id (numérico da Hotmart).
-- SÓ DESCRITIVO: não é lida por cs.fn_hm_pagamento_do_produto nem por nenhuma
-- view financeira — essas continuam por cs.hm_produto_hotmart (0195) /
-- cs.hm_origem_por_oferta (0167), que esta migration NÃO toca. Servir de
-- roteamento de dinheiro seria decisão de outra migration, medida à parte.
--
-- Pares provados (medido pelo orquestrador em produção, 16/08): os outros
-- dois (FIRE, TRANSMISSAO) ficam com product_id NULO — não há select em
-- produção que prove o número, e chutar aqui erraria roteamento se algum dia
-- esta tabela virar fonte de outra coisa.
-- ---------------------------------------------------------------------------
create table if not exists cs.hm_produto_checkout_de_para (
  produto_checkout text primary key,
  product_id       text,
  produto          text not null,
  provado          boolean not null default false,
  nota             text,
  criado_em        timestamptz not null default now()
);

comment on table cs.hm_produto_checkout_de_para is
  '0255: de-para produto_checkout (segmento da URL Hotmart) <-> product_id
   numérico. DESCRITIVO — vitrine do catálogo (public.hm_product_catalog),
   não alimenta roteamento de dinheiro (isso continua em
   cs.hm_produto_hotmart / cs.hm_origem_por_oferta, intactas).';

insert into cs.hm_produto_checkout_de_para (produto_checkout, product_id, produto, provado, nota) values
  ('L97981750T', '5064314', 'HM',           true,  'Provado: cs.hm_produto_hotmart já mapeia 5064314 -> HM (0195).'),
  ('P84471811S', '3094405', 'AURUM',        true,  'Provado: cs.hm_produto_hotmart já mapeia 3094405 -> AURUM (0195).'),
  ('R101026783U','5951389', 'ETHB',         true,  'Provado: "Encontro do Time HB" 5951389, medido em produção 16/08 (327 compras, R$292.772,24 aprovados). NÃO inserido em cs.hm_produto_hotmart nesta migration — isso mudaria roteamento de dinheiro e alertas, fora do escopo desta entrega.'),
  ('G106745288D', null,     'FIRE',         false, '0255b: medido pelo orquestrador em produção 16/08 — ZERO compras em public.compras para as ofertas deste produto_checkout (frw73xd5, b6feodjs). cs.hotmart_eventos também não serve de segunda fonte (152 linhas, só 15-17/07/2026, só HM/Holding Total/ETHB — amostra de 3 dias, não contador contínuo). NÃO É OMISSÃO, É AUSÊNCIA DE EVIDÊNCIA: não há hoje nenhuma fonte no banco que prove o product_id — não chutar.'),
  ('F84471622V',  null,     'TRANSMISSAO',  false, '0255b: medido pelo orquestrador em produção 16/08 — ZERO compras em public.compras para a oferta deste produto_checkout (ljiov5j3). Mesma ausência de evidência do FIRE (ver nota acima) — cs.hotmart_eventos não cobre este produto na janela que tem. NÃO É OMISSÃO, É AUSÊNCIA DE EVIDÊNCIA: não chutar.')
on conflict (produto_checkout) do update set
  product_id = excluded.product_id,
  produto    = excluded.produto,
  provado    = excluded.provado,
  nota       = excluded.nota;

revoke insert, update, delete on cs.hm_produto_checkout_de_para from disparos_app;
grant select on cs.hm_produto_checkout_de_para to disparos_app;

-- ---------------------------------------------------------------------------
-- PONTES DE LEITURA/ESCRITA para a tela {base}/ofertas (B6, master-only).
--
-- `disparos_app` não tem GRANT em `public.hm_product_catalog` (0044: "a role
-- NÃO tem select em public.compras nem em public.hm_product_catalog"). Mesmo
-- padrão de ponte SECURITY DEFINER já usado em 0044/0075/0082/0200 — a role
-- recebe só EXECUTE, nunca acesso direto à tabela.
-- ---------------------------------------------------------------------------
create or replace function cs.fn_hm_catalogo_listar(
  p_busca   text    default '',
  p_ativo   boolean default null,
  p_papel   text    default null,
  p_origem  text    default null,
  p_limite  int     default 500
)
returns table (
  offer_code text, product_id text, product_name text, categoria text,
  nome_comercial text, valor_tabela numeric, explicacao text, link text,
  produto_checkout text, dono_email text, recorrente boolean, ativo boolean,
  origem_do_dado text, origem_ref text, papel text,
  pacote_cheio numeric, entrada_condicao_fechada boolean,
  entrada_do_programa boolean, concede_trilha boolean,
  atualizado_por text, atualizado_em timestamptz
)
language sql
stable
security definer
set search_path = cs, public, pg_temp
as $fn$
  select offer_code, product_id, product_name, categoria,
         nome_comercial, valor_tabela, explicacao, link,
         produto_checkout, dono_email, recorrente, ativo,
         origem_do_dado, origem_ref, papel,
         pacote_cheio, entrada_condicao_fechada, entrada_do_programa,
         concede_trilha, atualizado_por, atualizado_em
    from public.hm_product_catalog
   where (p_busca = '' or offer_code ilike '%' || p_busca || '%'
          or coalesce(nome_comercial, '') ilike '%' || p_busca || '%'
          or coalesce(product_name, '') ilike '%' || p_busca || '%')
     and (p_ativo is null or ativo = p_ativo)
     and (p_papel is null or papel = p_papel)
     and (p_origem is null or origem_do_dado = p_origem)
   order by coalesce(nome_comercial, product_name, offer_code)
   limit greatest(coalesce(p_limite, 500), 1)
$fn$;

comment on function cs.fn_hm_catalogo_listar(text, boolean, text, text, int) is
  '0255: leitura do catálogo (público.hm_product_catalog) para a tela
   {base}/ofertas, master-only (guard na rota). SECURITY DEFINER porque
   disparos_app não tem SELECT direto na tabela.';

revoke all on function cs.fn_hm_catalogo_listar(text, boolean, text, text, int) from public;
grant execute on function cs.fn_hm_catalogo_listar(text, boolean, text, text, int) to disparos_app;

-- Atualização das colunas DESCRITIVAS apenas — `p_patch` é um objeto jsonb com
-- SÓ as chaves que a pessoa quer mudar (permite `valor_tabela: null` de
-- propósito, sem confundir com "não mexer"). As colunas de RÉGUA
-- (pacote_cheio, entrada_condicao_fechada, entrada_do_programa,
-- concede_trilha) e `categoria` NÃO aparecem aqui — não têm como esta função
-- tocá-las, por desenho, não por disciplina de quem chama.
create or replace function cs.fn_hm_catalogo_atualizar(p_offer_code text, p_patch jsonb, p_por text)
returns table (ok boolean, offer_code text, motivo text)
language plpgsql
volatile
security definer
set search_path = cs, public, pg_temp
as $fn$
begin
  if not exists (select 1 from public.hm_product_catalog where offer_code = p_offer_code) then
    return query select false, p_offer_code, 'offer_code não encontrado no catálogo';
    return;
  end if;

  update public.hm_product_catalog set
    nome_comercial   = case when p_patch ? 'nome_comercial'   then nullif(p_patch->>'nome_comercial', '')   else nome_comercial   end,
    valor_tabela     = case when p_patch ? 'valor_tabela'     then nullif(p_patch->>'valor_tabela', '')::numeric else valor_tabela end,
    explicacao       = case when p_patch ? 'explicacao'       then nullif(p_patch->>'explicacao', '')       else explicacao       end,
    link             = case when p_patch ? 'link'             then nullif(p_patch->>'link', '')             else link             end,
    produto_checkout = case when p_patch ? 'produto_checkout' then nullif(p_patch->>'produto_checkout', '') else produto_checkout end,
    dono_email       = case when p_patch ? 'dono_email'       then nullif(p_patch->>'dono_email', '')       else dono_email       end,
    recorrente       = case when p_patch ? 'recorrente'       then (p_patch->>'recorrente')::boolean        else recorrente       end,
    ativo            = case when p_patch ? 'ativo'            then (p_patch->>'ativo')::boolean             else ativo            end,
    papel            = case when p_patch ? 'papel'            then nullif(p_patch->>'papel', '')            else papel            end,
    atualizado_por   = p_por,
    atualizado_em    = now()
  where offer_code = p_offer_code;

  return query select true, p_offer_code, null::text;
end;
$fn$;

comment on function cs.fn_hm_catalogo_atualizar(text, jsonb, text) is
  '0255: PATCH das colunas descritivas do catálogo (nunca pacote_cheio/
   entrada_condicao_fechada/entrada_do_programa/concede_trilha/categoria —
   essas colunas nem aparecem no corpo da função, não é filtro, é ausência).
   p_patch só aplica as chaves presentes; ausente = não mexe.';

revoke all on function cs.fn_hm_catalogo_atualizar(text, jsonb, text) from public;
grant execute on function cs.fn_hm_catalogo_atualizar(text, jsonb, text) to disparos_app;

-- ---------------------------------------------------------------------------
-- CONFERÊNCIA NOMINAL — falha a migration se alguma coluna existente mudou de
-- valor (a prova de "nenhum backfill que reclassifica").
-- ---------------------------------------------------------------------------
do $$
declare
  v_papel_preenchido int;
begin
  select count(*) into v_papel_preenchido from public.hm_product_catalog where papel is not null;
  if v_papel_preenchido <> 0 then
    raise exception '0255: papel deveria nascer 100%% NULO e achei % linhas preenchidas — alguma outra migration já mexeu aqui.', v_papel_preenchido;
  end if;
  raise notice '0255: catálogo ganhou 13 colunas descritivas + 2 funções de acesso (listar/atualizar). papel NULO em todas as linhas (confirmado). de-para produto_checkout: % linhas.',
    (select count(*) from cs.hm_produto_checkout_de_para);
end $$;

-- Volta:
--   drop function if exists cs.fn_hm_catalogo_atualizar(text, jsonb, text);
--   drop function if exists cs.fn_hm_catalogo_listar(text, boolean, text, text, int);
--   drop table if exists cs.hm_produto_checkout_de_para;
--   alter table public.hm_product_catalog
--     drop column if exists nome_comercial, drop column if exists valor_tabela,
--     drop column if exists explicacao, drop column if exists link,
--     drop column if exists produto_checkout, drop column if exists dono_email,
--     drop column if exists recorrente, drop column if exists ativo,
--     drop column if exists origem_do_dado, drop column if exists origem_ref,
--     drop column if exists papel, drop column if exists atualizado_por,
--     drop column if exists atualizado_em;
--   Nenhuma view financeira lê estas colunas — reversível sem quebrar nada.
