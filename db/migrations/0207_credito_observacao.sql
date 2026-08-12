-- 0207 — credito_obs (F4): o MOTIVO do crédito pró-rata manual, em texto livre.
--
-- O crédito em si é CALCULADO (cs.fn_hm_prorata, a partir de credito_oferta/
-- credito_compra_em/credito_valor_pago/credito_dias_totais) — mas o pró-rata é
-- MANUAL: alguém do time decide conceder e por quê ("pagou a diferença da T35
-- na promoção X", "acordo verbal com o Marcio em 10/08"). Sem um lugar para
-- esse motivo, o número fica "confia em mim" — o mesmo problema que
-- cs.aurum_pagamento_aluno.obs/excecao_motivo já resolve no Aurum (lidos em
-- lib/services/hm-ficha.ts:191). Aqui é o equivalente no HM.
--
-- Aditivo puro: uma coluna nullable, sem default, sem tocar em dado existente.
--
-- ⚠️ NÃO importa as observações da planilha antiga — o Marcio ainda não liberou
-- esse import (decisão de negócio pendente). A coluna nasce vazia; quem
-- preenche é o operador, daqui para frente, pela ficha.

alter table cs.contatos_hm
  add column if not exists credito_obs text;

comment on column cs.contatos_hm.credito_obs is
  '0207: motivo do credito pro-rata MANUAL (por que este valor/data foi concedido). '
  'O credito em si e CALCULADO (cs.fn_hm_prorata) — este campo e so a justificativa em '
  'texto livre, mesmo padrao de cs.aurum_pagamento_aluno.obs/excecao_motivo. '
  'Nasce vazio: NAO importado da planilha (import pendente de decisao do Marcio).';

do $$
begin
  if not exists (
    select 1 from information_schema.columns
     where table_schema='cs' and table_name='contatos_hm' and column_name='credito_obs'
  ) then
    raise exception '0207: coluna credito_obs não foi criada';
  end if;
  raise notice '0207: cs.contatos_hm.credito_obs disponível.';
end $$;
