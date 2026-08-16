-- 0241_carteira_so_conta_quem_e_do_comercial.sql
--
-- Passo intermediário, aplicado e SUBSTITUÍDO pela 0242 na mesma noite (16/08/2026).
-- Fica registrado porque o histórico de migrations do banco tem os três números, e um
-- arquivo faltando aqui é drift entre repo e produção — a armadilha que já mordeu antes.
--
-- O QUE ELA CORRIGIU DA 0240
-- A 0240 media "quem atuou no card" olhando QUALQUER usuário ativo. Como a ativação
-- (Ana Camila, Thomas) e os admins encostam em todo card depois do pagamento, 99 cards
-- saíam com origem 'ambas' — inclusive 65 sem dono nenhum, com R$ 461 mil recebidos.
-- A 0241 passou a considerar só quem é do comercial:
--
--     papel = 'disparador' AND ativo AND NOT equipe_ativacao
--
-- Critério declarativo, tirado das colunas que já existem em cs.usuarios — nunca uma
-- lista de nomes no SQL, que envelhece na primeira contratação.
--
-- Corrigiu também uma inconsistência da 0240: o CASE do NOME não seguia a mesma ordem do
-- CASE da ORIGEM, então um card podia sair com origem 'ambas' e nome vindo do campo do
-- card. Desde então o nome DERIVA da origem — uma escada só, impossível divergir.
--
-- POR QUE FOI SUBSTITUÍDA
-- Com a exclusividade estrita, 39 cards ficaram em 'ambas'. Medido: os 39 são TODOS
-- Jusy + Jonathan Mendes (nenhum Jusy + Kelly). Descartar a carteira porque o SDR também
-- tocou no card apaga trabalho de quem trabalhou — a 0242 passa a desempatar por peso da
-- evidência. Ver o cabeçalho dela.
--
-- Esta migration não executa nada: o estado final da view é o da 0242, e rodar a versão
-- intermediária aqui só criaria uma view que a próxima sobrescreve no mesmo minuto.
do $$
begin
  raise notice '0241: passo intermediário — a definição vigente de cs.vw_hm_carteira é a da 0242.';
end $$;
