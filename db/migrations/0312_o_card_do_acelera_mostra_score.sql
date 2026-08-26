-- 0312_o_card_do_acelera_mostra_score
--
-- ── O pedido (Victor, 26/08) ────────────────────────────────────────────────
-- "No card só está o nome e o responsável. Precisa mostrar a profissão, o nível
--  e o score, pra ver qual é o mais quente."
--
-- O score vinha sendo gravado como TEXTO dentro de origem_lead ("CNHF · score
-- 101") — servia para conferir a procedência, não para ordenar nem comparar. Vira
-- coluna própria: número é para contar, texto é para ler.

alter table cs.contatos add column if not exists score_lead int;

comment on column cs.contatos.score_lead is
  '0312: score do cruzamento de listas do CNHF (ficha + palavras da Central + chat + workbook + pesquisa). Quanto maior, mais quente. Preenchido na importação da lista, não calculado aqui.';

create index if not exists idx_contatos_acelera_score
  on cs.contatos (evento, score_lead desc) where evento = 'ACELERA';
