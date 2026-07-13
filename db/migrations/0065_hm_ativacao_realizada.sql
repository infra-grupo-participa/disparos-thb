-- =====================================================================
-- 0065_hm_ativacao_realizada
-- A ativação ganha uma linha de chegada.
--
-- Até aqui o checklist (Searchie, comunidade THB, grupo de informes, pesquisa)
-- travava a SAÍDA de "Acesso Liberado". Era uma trava no meio do caminho: prendia
-- o card numa etapa qualquer da esteira e não dizia nada sobre o aluno estar
-- ativado — porque "ativado" não era um lugar, era um estado invisível espalhado
-- em quatro colunas de TRUE/FALSE.
--
-- Agora "ativado" é uma coluna: o card só entra em "Ativação Realizada" quando as
-- quatro condições estão cumpridas (o serviço recusa e diz o que falta). O resto
-- do kanban fica livre — arrastar para qualquer etapa, para frente ou para trás,
-- deixa de esbarrar em trava nenhuma.
--
-- É a última etapa da esteira (is_final), depois de "Entrevista Finalizada".
--
-- Aditiva e idempotente.
-- =====================================================================

insert into cs.estagios (chave, nome, ordem, cor, is_inicial, is_final, ativo, evento, aba)
values ('hm_ativacao_realizada', 'Ativação Realizada', 110, '#10b981', false, true, true, 'HM', 'ativacao')
on conflict (chave) do update set
  nome   = excluded.nome,
  ordem  = excluded.ordem,
  cor    = excluded.cor,
  is_final = true,
  ativo  = true,
  evento = excluded.evento,
  aba    = excluded.aba;
