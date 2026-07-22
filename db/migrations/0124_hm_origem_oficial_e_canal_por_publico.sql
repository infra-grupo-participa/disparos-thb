-- =====================================================================
-- 0124_hm_origem_oficial_e_canal_por_publico
--
-- A planilha do Marcio (Compradores/Sócios T39) é a FONTE DE VERDADE da origem.
-- 3 públicos: no evento HT ATM (06-07/07) o ALUNO DA BASE é "Programa de
-- Implementação" e o LEAD é "HT ATM"; nos eventos Live (25-26/06) e Ex aluno
-- (13/07) o evento vale para todos. Corrige a 0123 (evento ganhava sempre).
--
-- 1) cs.hm_origem_oficial: override manual por e-mail/CPF (a planilha), com
--    prioridade máxima — a operação corrige qualquer caso ali.
-- 2) fn_tag_hm_origem: canal = override → Imersão POA → (HT ATM: base=Programa,
--    lead=HT ATM) → Live/Ex aluno (todos) → edição HT → aluno-base=Programa →
--    Venda direta.
--
-- OBS: a versão final de fn_tag_hm_origem está na 0125 (matching de público
-- passa a ignorar sip_sinal_trilha). Esta migration cria a tabela + a 1ª versão.
-- =====================================================================

create table if not exists cs.hm_origem_oficial (
  id         bigint generated always as identity primary key,
  email      text,
  documento  text,
  canal      text not null,
  fonte      text default 'planilha T39',
  criado_em  timestamptz not null default now()
);
create index if not exists hm_origem_oficial_email_idx on cs.hm_origem_oficial (lower(email));
create index if not exists hm_origem_oficial_doc_idx   on cs.hm_origem_oficial (documento);

-- fn_tag_hm_origem v1 (override + escada por público) — ver corpo definitivo na 0125.
-- (aplicada no banco; a 0125 substitui pelo corpo final)
