-- 0206 — Dicionário de tags do HM (E). O catálogo (cs.tags, 0067) tinha nome,
-- cor e tipo — bastava para colorir o chip, não para explicar o que ele SIGNIFICA.
-- Um operador novo olha "Origem T29.2" ou "HT ATM" no card e não sabe o que é
-- sem perguntar. Aqui entra o metadado: DESCRIÇÃO (o que a tag quer dizer) e
-- CATEGORIA (a família — público/canal/turma/origem_base/produto/operacional),
-- com a COR passando a ser DERIVADA da categoria por padrão.
--
-- Aditivo puro: 2 ALTER TABLE (colunas novas, nenhuma NOT NULL sem default) +
-- 1 CREATE TABLE + inserts. Nada é removido, renomeado ou reescrito destrutivamente.
--
-- ⚠️ NENHUMA TAG É RENOMEADA AQUI. cs.fn_tag_hm_origem, cs.fn_sync_hm_atm e
-- cs.fn_hm_health_check gravam os nomes de tag LITERAIS (ver definição das três
-- funções — nenhuma lê cs.tags.cor/descricao/categoria, todas comparam string
-- contra cs.contatos_hm.tags). Renomear uma tag aqui sem tocar essas funções
-- criaria órfã na próxima venda. Só se ACRESCENTA metadado a nomes que já existem.
--
-- ⚠️ RE_TAG_GERENCIADA (lib/services/hm-tags.ts:14, /^(Origem|Turma|Aurum) /)
-- barra o operador de criar essas tags pela API — são espelho automático do
-- campo turma, não gesto manual. Por isso as ~57 tags em uso e ausentes do
-- catálogo (a maioria "Origem Txx"/"Turma Txx"/"Aurum Ax") são inseridas aqui
-- por SQL direto, com tipo='sistema' (mesmo tratamento das tags que os
-- triggers já gravavam) — e criarTagHm CONTINUA recusando esse prefixo depois
-- desta migration: catalogar não é liberar a criação manual.
--
-- Levantamento (conferido antes de escrever): 71 tags em uso em cs.contatos_hm
-- (select distinct unnest(tags)), 13 já no catálogo (12 'sistema' + 1 'livre'
-- "reembolso") → 57 fora do catálogo, todas capturadas abaixo.

-- ── 1. Metadado no catálogo ──────────────────────────────────────────────────
alter table cs.tags
  add column if not exists descricao text,
  add column if not exists categoria text
    check (categoria in ('publico','canal','turma','origem_base','produto','operacional'));

comment on column cs.tags.descricao is
  'O que a tag SIGNIFICA — texto para quem olha o card sem contexto (0206).';
comment on column cs.tags.categoria is
  'Família da tag (0206): publico/canal/turma/origem_base/produto/operacional. '
  'Junto com cs.tag_categoria.cor, deriva a cor exibida — cs.tags.cor vira override opcional.';

-- ── 2. Paleta por categoria ───────────────────────────────────────────────────
create table if not exists cs.tag_categoria (
  categoria   text primary key check (categoria in ('publico','canal','turma','origem_base','produto','operacional')),
  rotulo      text not null,
  cor         text not null,
  descricao   text
);

comment on table cs.tag_categoria is
  'Paleta e rótulo por FAMÍLIA de tag (0206). cs.tags.cor null = herda daqui; '
  'preenchido = override pontual (ex.: uma tag de sistema com cor histórica própria).';

insert into cs.tag_categoria (categoria, rotulo, cor, descricao) values
  ('publico',      'Público',       '#10b981', 'Quem a pessoa é para o HM: lead novo ou já aluno de qual produto.'),
  ('canal',        'Canal',         '#3b82f6', 'Por onde a pessoa entrou na esteira (a live, o evento, a renovação).'),
  ('turma',        'Turma',         '#7c3aed', 'Turma ATUAL do aluno no HM — espelho automático do campo turma do card.'),
  ('origem_base',  'Origem/Base',   '#f59e0b', 'De qual turma/base o aluno VEIO antes de entrar na esteira atual (THB ou Aurum).'),
  ('produto',      'Produto',       '#06b6d4', 'Qual produto/oferta a pessoa comprou ou tem acesso.'),
  ('operacional',  'Operacional',   '#64748b', 'Marcador de rotina do time (livre, sem automação por trás).')
on conflict (categoria) do nothing;

-- ── 3. Metadado nas tags de SISTEMA já catalogadas (0067 e seguintes) ────────
-- Cor mantida (não é override — é a cor ORIGINAL virando explícita); só
-- descricao/categoria são novidade.
update cs.tags set categoria = 'publico',
  descricao = 'Ainda não é aluno de nenhum produto — primeiro contato na esteira.'
 where evento = 'HM' and nome = 'Lead novo';
update cs.tags set categoria = 'publico',
  descricao = 'Já é aluno do Holding Total/THB (identificado na base vw_aluno_360).'
 where evento = 'HM' and nome = 'Aluno THB';
update cs.tags set categoria = 'publico',
  descricao = 'Já é aluno do Aurum (espaço de instrução aurum ou com turma_aurum_id preenchida).'
 where evento = 'HM' and nome = 'Aluno Aurum';
update cs.tags set categoria = 'canal',
  descricao = 'Entrou pela oferta de acesso ao ETHB SP (oferta 6qxsk9kq) — renovação de acesso, não venda nova do HM.'
 where evento = 'HM' and nome = 'Venda direta';
update cs.tags set categoria = 'canal',
  descricao = 'Comprou pela live "Direto ao Ponto" de lançamento da T39 (25–27/06/2026).'
 where evento = 'HM' and nome = 'Live Direto ao Ponto';
update cs.tags set categoria = 'canal',
  descricao = 'Comprou pela janela HT ATM da T39 (06–08/07/2026) — aluno NOVO (sem histórico prévio na base).'
 where evento = 'HM' and nome = 'HT ATM';
update cs.tags set categoria = 'canal',
  descricao = 'Comprou pela janela "Ex aluno Direto ao Ponto" da T39 (13–14/07/2026) — aluno que já tinha passagem pela base.'
 where evento = 'HM' and nome = 'Ex aluno Direto ao Ponto';
update cs.tags set categoria = 'canal',
  descricao = 'Comprou identificado NA BASE (vw_aluno_360) durante a janela HT ATM — em vez de "HT ATM" puro, marca quem já era conhecido.'
 where evento = 'HM' and nome = 'HM - Programa de Implementação';
update cs.tags set categoria = 'canal',
  descricao = 'Captação da turma T40 pela live HT29 de 26/07/2026 (vale até a janela seguinte de venda de entrada).'
 where evento = 'HM' and nome = 'HT29 - 26-07';
update cs.tags set categoria = 'canal',
  descricao = 'Comprou pela Imersão POA (evento presencial) — canal com regra própria (fn_hm_canal_imersao).'
 where evento = 'HM' and nome = 'Imersão POA';
-- HT26/HT27/HT28: janelas antigas de captação (edições anteriores do HT), hoje
-- só rótulo histórico nos cards que já carregam a tag — sem janela ativa em
-- cs.hm_evento_janela/hm_origem_por_oferta.
update cs.tags set categoria = 'canal',
  descricao = 'Comprou na janela de captação da edição HT26 (edição anterior do HT, sem janela ativa hoje).'
 where evento = 'HM' and nome = 'HT26';
update cs.tags set categoria = 'canal',
  descricao = 'Comprou na janela de captação da edição HT27 (edição anterior do HT, sem janela ativa hoje).'
 where evento = 'HM' and nome = 'HT27';
update cs.tags set categoria = 'canal',
  descricao = 'Comprou na janela de captação da edição HT28 (edição anterior do HT, sem janela ativa hoje).'
 where evento = 'HM' and nome = 'HT28';

-- ── 4. As ~57 tags em uso e AUSENTES do catálogo — tipo 'sistema' porque são
-- geradas por trigger/função (turma, origem, canal por oferta), nunca digitadas
-- pelo operador. RE_TAG_GERENCIADA continua barrando a criação manual delas.

-- Canais HT29/HT30 restantes (janela por oferta, cs.hm_origem_por_oferta):
insert into cs.tags (evento, nome, tipo, categoria, descricao) values
  ('HM', 'HT29',          'sistema', 'canal', 'Rótulo curto da edição HT29 — precede a tag com data ("HT29 - 26-07"); aparece em cards antigos migrados sem a data.'),
  ('HM', 'HT30 - 09-08',  'sistema', 'canal', 'Live do HT de 09/08/2026, 1ª edição do pitch da entrada R$697 da T30 (janela até 10/08 12h BRT).'),
  ('HM', 'HT30 - 10-08',  'sistema', 'canal', 'Live do HT de 10/08/2026, 2ª edição do mesmo pitch da entrada R$697 (janela até 11/08 12h BRT).'),
  ('HM', 'HT30 - 11-08',  'sistema', 'canal', 'Live do HT de 11/08/2026, 3ª edição do mesmo pitch da entrada R$697 (janela aberta até a próxima live que vender entrada — 0205).'),
  ('HM', 'Renovação',     'sistema', 'canal', 'Comprou uma renovação de acesso (não é a entrada original do produto).'),
  ('HM', 'AURUM',         'sistema', 'produto', 'Tem oferta/pacote do produto Aurum vinculado ao card (categoria de produto, distinta do público "Aluno Aurum").'),
  ('HM', 'Acesso ETHB',   'sistema', 'produto', 'Tem acesso ao ETHB (Encontro do Time Holding Brasil) provisionado.'),
  ('HM', 'ETHB SP',       'sistema', 'produto', 'Comprou o pitch do Aurum no Encontro do Time Holding Brasil - São Paulo (05/08/2026, oferta qm4lu7py).')
on conflict (evento, nome) do nothing;

-- Origem T3..T38 (de qual turma da BASE THB o aluno veio antes desta esteira —
-- fn_tag_hm_origem grava 'Origem ' || turma_codigo quando identifica o aluno em
-- vw_aluno_360; a lista é exatamente as turmas em uso hoje nos cards).
insert into cs.tags (evento, nome, tipo, categoria, descricao)
select 'HM', 'Origem T' || n, 'sistema', 'origem_base',
       'Aluno já pertencia à turma T' || n || ' da base THB antes de entrar nesta esteira (campo turma_origem espelhado em tag).'
  from unnest(array['3','4','5','6','7','10','11','12','14','15','16','17','18','19','20',
                     '21','22','23','24','25','26','27','28','29','29.2','30','31','32',
                     '33','34','35','36','37','38']) n
on conflict (evento, nome) do nothing;

-- Turma T5..T40 (turma ATUAL do aluno no HM — espelha o campo `turma` do card;
-- cs.contatos_hm.turma troca "Turma X" pela nova no PATCH da ficha, ver
-- app/api/hm/contato/[id]/route.ts).
insert into cs.tags (evento, nome, tipo, categoria, descricao)
select 'HM', 'Turma T' || n, 'sistema', 'turma',
       'Turma ATUAL do aluno no HM é a T' || n || ' — espelho automático do campo turma do card.'
  from unnest(array['5','10','17','18','27','30','31','32','35','39','40']) n
on conflict (evento, nome) do nothing;

-- Aurum A1..A9 (turma do Aurum vinculada — thb_turmas.codigo via turma_aurum_id).
insert into cs.tags (evento, nome, tipo, categoria, descricao)
select 'HM', 'Aurum A' || n, 'sistema', 'origem_base',
       'Aluno vinculado à turma A' || n || ' do Aurum (thb_turmas, campo turma_aurum_id).'
  from unnest(array['1','4','5','6','7','8','9']) n
on conflict (evento, nome) do nothing;

-- Operacional: "reembolso" já existia como 'livre' (0067) — só ganha metadado,
-- sem trocar o tipo (segue editável/excluível pelo admin, como sempre foi).
update cs.tags set categoria = 'operacional',
  descricao = 'Marcador manual do time para acompanhar um pedido de reembolso em andamento.'
 where evento = 'HM' and nome = 'reembolso';

-- ── 5. Permissões ─────────────────────────────────────────────────────────────
-- Schema cs não usa RLS por linha (conferido: cs.tags e a maioria das tabelas de
-- catálogo do módulo seguem GRANT direto à role do app — a autorização por
-- escopo/equipe vive na aplicação, em lib/services/visibilidade.ts, não em
-- policy de Postgres). cs.tag_categoria é tabela de PALETA, sem dado sensível
-- nem por usuário — mesmo tratamento: leitura liberada, escrita fica com o
-- dono da migration (a paleta não é editável pela API, só por SQL direto).
grant select on cs.tag_categoria to disparos_app;

-- ── 6. Conferência ────────────────────────────────────────────────────────────
do $$
declare v_sem_categoria int; v_orfas int;
begin
  select count(*) into v_sem_categoria from cs.tags where evento = 'HM' and categoria is null;
  if v_sem_categoria > 0 then
    raise exception '0206: % tag(s) do HM ainda sem categoria — catálogo incompleto', v_sem_categoria;
  end if;

  -- Tags em uso nos cards que continuam fora do catálogo (não deveria sobrar
  -- nenhuma depois dos inserts acima — se sobrar, é tag nova surgida entre o
  -- levantamento e a aplicação desta migration, não um erro de escrita).
  select count(*) into v_orfas
    from (select distinct unnest(tags) t from cs.contatos_hm) x
   where t not in (select nome from cs.tags where evento = 'HM');
  if v_orfas > 0 then
    raise notice '0206: % tag(s) em uso surgiram depois do levantamento e seguem fora do catálogo — conferir manualmente.', v_orfas;
  end if;

  raise notice '0206: dicionário aplicado — % tags no catálogo HM.',
    (select count(*) from cs.tags where evento = 'HM');
end $$;
