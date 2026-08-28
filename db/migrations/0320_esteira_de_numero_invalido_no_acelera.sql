-- 0320_esteira_de_numero_invalido_no_acelera
--
-- ── O pedido (Victor, 28/08) ────────────────────────────────────────────────
-- "Cria no sistema uma esteira pra número inválido."
--
-- Faz falta a partir de hoje: a abordagem dos 1.910 cards começa por mensagem
-- de WhatsApp, e parte dos números não existe, não tem WhatsApp ou nunca vai
-- responder. Sem uma etapa própria, esse card só tem dois destinos ruins:
--
--   • fica em "Contato iniciado" para sempre, e o vendedor volta nele amanhã
--     achando que a pessoa ainda pode responder;
--   • ou vai para "Sem interesse", que é MENTIRA sobre o lead. A pessoa não
--     recusou nada, o número é que não presta. Misturar os dois estraga a
--     leitura de quanto a lista de fato rejeitou a oferta.
--
-- is_final = true (é desfecho, como Vendido e Sem interesse) e ordem 55, ao lado
-- de "Sem interesse": as duas saídas sem venda ficam juntas e o Vendido continua
-- fechando o board à direita.
--
-- ⚠️ SÓ O ACELERA: filtra evento = 'ACELERA'. `chave` é UNIQUE na tabela
-- inteira, por isso o prefixo acel_.

insert into cs.estagios (chave, nome, ordem, cor, is_inicial, is_final, ativo, evento, aba, origem_movimento)
select 'acel_numero_invalido', 'Número inválido', 55, '#78716c', false, true, true, 'ACELERA', 'comercial', 'operador'
 where not exists (select 1 from cs.estagios where chave = 'acel_numero_invalido');

comment on column cs.estagios.is_final is
  'Etapa de desfecho: o card para aqui. Vendido, Sem interesse e Número inválido. Serve para separar quem recusou de quem nunca foi alcançado.';
