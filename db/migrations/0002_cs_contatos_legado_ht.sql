-- =====================================================================
-- 0002_cs_contatos_legado_ht
-- Estende o overlay cs.contatos com a edição do HT e as métricas de CS
-- importadas da planilha legada (Google Sheets de acompanhamento).
--
-- Modelo: NÃO cria compras. Cada linha do CSV é casada por e-mail/telefone
-- com um comprador já existente (public.compradores, via view cs.contatos_ht)
-- e essas colunas são preenchidas no overlay. Compradores recorrentes (em
-- várias edições) ficam com a EDIÇÃO MAIS RECENTE em `edicao_ht`.
--
-- Prefixo `legado_` = dado histórico vindo da planilha (≠ tracking nativo,
-- que continua em cs.interacoes / cs.disparos).
-- =====================================================================

alter table cs.contatos
  add column if not exists edicao_ht                  text,        -- HT21..HT27 (mais recente do comprador)
  add column if not exists legado_documento           text,        -- CPF/CNPJ informado na planilha
  add column if not exists legado_no_grupo            boolean,     -- "No Grupo"
  add column if not exists legado_pesquisa            boolean,     -- "Pesquisa"
  add column if not exists legado_ja_ht               boolean,     -- "Já HT?"
  add column if not exists legado_qtd_ht              int,         -- "Qtd. vezes"
  add column if not exists legado_ja_hm               boolean,     -- "Já HM?"
  add column if not exists legado_e_aluno             boolean,     -- "É aluno?"
  add column if not exists legado_instrucao           text,        -- "Instrução" (ex.: THB)
  add column if not exists legado_ativado             boolean,     -- "Ativado"
  add column if not exists legado_ativacao_em         timestamptz, -- "Ativação"
  add column if not exists legado_t_primeiro_contato_h numeric,    -- "T. 1º Contato (h)"
  add column if not exists legado_t_ativacao_h        numeric,     -- "T. Ativação (h)"
  add column if not exists legado_sla_h               numeric,     -- "SLA (h)"
  add column if not exists legado_importado_em        timestamptz; -- carimbo do import

-- "1º Contato" reaproveita a coluna nativa cs.contatos.primeiro_contato_em
-- (preenchida pelo import só quando ainda estiver nula).

create index if not exists cs_contatos_edicao_ht_idx
  on cs.contatos (edicao_ht) where edicao_ht is not null;
