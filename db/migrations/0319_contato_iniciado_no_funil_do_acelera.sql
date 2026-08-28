-- 0319_contato_iniciado_no_funil_do_acelera
--
-- ── O pedido (Victor, 28/08) ────────────────────────────────────────────────
-- "Cria uma parte no kanban pra 'contato iniciado'."
--
-- A etapa faz falta agora porque a operação mudou: com 1.910 cards e a
-- abordagem começando por MENSAGEM (a copy de WhatsApp), existe um estado que o
-- funil não tinha nome para representar — já falei com a pessoa e estou
-- esperando resposta. Sem ele, o vendedor ou deixa o card em Lead (e amanhã não
-- lembra em quem já tocou) ou joga em "Não atendeu", que significa outra coisa:
-- ligou e ninguém atendeu.
--
-- ── Reativa, não cria ───────────────────────────────────────────────────────
-- `acel_contato_inicial` já existe desde a 0307 e foi desativado pela 0313/0314
-- quando o funil foi enxugado. Reativar preserva o histórico e evita duas etapas
-- com o mesmo significado na mesma tabela. Só o rótulo muda para o que o Victor
-- pediu, "Contato iniciado".
--
-- Entra entre Lead (10) e Não atendeu (20), que é a ordem em que o trabalho
-- acontece: o lead chega, eu mando mensagem, e só depois ligo.
--
-- ⚠️ SÓ O ACELERA: tudo filtra evento = 'ACELERA'.

update cs.estagios
   set ativo = true,
       nome  = 'Contato iniciado',
       ordem = 15
 where evento = 'ACELERA' and chave = 'acel_contato_inicial';

comment on table cs.estagios is
  'Etapas do funil por evento. ativo=false tira do kanban sem apagar: preserva histórico e não quebra a FK de cs.contatos.estagio_id.';
