-- 0162_aurum_saldo_no_card.sql
-- Fecha o saldo do Aurum DENTRO do card (pedido do Marcio, 10/08): "quando eu clico
-- em reunião comercial, acordo do saldo específico, o saldo cheio tem que ser 60 mil".
--
-- Duas correções — uma de dado, uma de código (esta migration cobre a de dado).
--
-- ---------------------------------------------------------------------------
-- 🐛 CPF PERDEU O ZERO À ESQUERDA na exportação do Google Sheets
--
-- 4 dos 20 cards do Aurum (Claudio Marcio, Gilmar Afonso, Marcos Adriano, Swellen)
-- abriam SEM saldo nenhum. Não era falta de dado: o CSV do Victor trazia
-- `1559535911` (10 dígitos) enquanto `public.compradores.documento` guarda
-- `01559535911` (11) — o Sheets trata CPF como NÚMERO e come o zero inicial.
-- Como a ficha casa por documento, o join simplesmente não achava.
--
-- Correção: `lpad(documento, 11, '0')` nos que têm de 8 a 10 dígitos. CNPJ (14) fica
-- intocado — daí a janela fechada em vez de "tudo que for < 11".
--
-- 🔑 PADRÃO REUTILIZÁVEL: ao ingerir QUALQUER planilha com CPF, normalizar com lpad
-- antes de casar. O sintoma é traiçoeiro — não dá erro, só "não encontra", e some
-- exatamente nos CPFs que começam com zero (~10% da base).
-- ---------------------------------------------------------------------------

update cs.aurum_pagamento_aluno
   set documento = lpad(documento, 11, '0'),
       atualizado_em = now()
 where length(documento) between 8 and 10;

-- Verificação (esperado: 20 de 20 cards do Aurum com saldo):
--   select count(*) cards, count(a.documento) com_saldo
--     from cs.contatos_hm ch
--     join public.compradores co on co.id = ch.comprador_id
--     left join cs.vw_aurum_saldo a
--       on regexp_replace(coalesce(co.documento,''), '[^0-9]', '', 'g') = a.documento
--    where ch.produto = 'AURUM';
