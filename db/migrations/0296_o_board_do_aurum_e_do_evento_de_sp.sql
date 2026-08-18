-- 0296_o_board_do_aurum_e_do_evento_de_sp
--
-- ── O pedido (Marcio, 18/08) ─────────────────────────────────────────────────
-- "Padronizamos registrar no kanban só vendas do evento de SP. Preciso das
--  pessoas com TAG do ETHB SP."
--
-- ── O que os dados dizem ─────────────────────────────────────────────────────
-- 41 fichas AURUM: 35 com a tag `ETHB SP`, 6 sem.
--
-- ⚠️ As 6 NÃO são "gente de POA/GO". São lançamentos de SALDO — quem já era
-- aluno pagando o saldo do Aurum, não venda do evento. A confusão vem do
-- resumo `⟦HM origem⟧` exibido na ficha, que mostra a CIDADE ONDE A PESSOA
-- MORA (cs.fn_tag_hm_origem monta com `concat_ws('/', al.cidade, al.estado)`
-- vindo de public.vw_aluno_360, o endereço residencial). Gente de Porto
-- Alegre, Piracanjuba/GO, Cachoeira do Sul/RS e São José/SC comprou o evento
-- de SP — o que é normal. Não existe evento AURUM em POA nem em Goiás:
-- cs.eventos tem só HT/SEM/HM/CNHF, e cs.hm_origem_por_oferta tem uma única
-- linha para AURUM.
--
-- ── Por que a tag é o critério certo ────────────────────────────────────────
-- Só UMA oferta gera a tag `ETHB SP` no AURUM:
--   qm4lu7py — "Pitch do Aurum no Encontro do Time Holding Brasil - Sao Paulo,
--               05/08/2026" (cs.hm_origem_por_oferta, produto=AURUM)
-- Quem comprou essa oferta veio do evento. Quem entrou por oferta de saldo
-- (vg96e2tc, fysepc10, z950cse4, x72l7aq9...) não é venda de evento — é
-- pagamento de quem já estava dentro.
--
-- ── A decisão ────────────────────────────────────────────────────────────────
-- FILTRO DE TELA, não exclusão. As 6 fichas somam R$ 134.165,01 no razão,
-- todas com aluno provisionado, acesso liberado e 5–7 interações de histórico.
-- Apagá-las levaria a timeline junto (as FKs de cs.interacoes/cs.hm_versoes
-- são ON DELETE CASCADE) e tiraria o dinheiro do relatório do AURUM. Elas
-- continuam inteiras no sistema — financeiro, aluno, timeline — só não ocupam
-- o board.
--
-- A mudança de comportamento vive em app/api/hm/kanban/route.ts (o SELECT do
-- board ganhou `and (k.produto <> 'AURUM' or k.tags @> array['ETHB SP'])`).
-- Esta migration não altera dado nenhum: registra a regra no banco, para que
-- quem for mexer no board depois saiba por que o filtro existe, e deixa a
-- consulta de conferência pronta.

comment on table cs.hm_origem_por_oferta is
  '0157/0167: de qual evento/canal veio cada oferta, com janela de validade opcional (vale_de/vale_ate) — a mesma oferta pode servir a edicoes diferentes da mesma live. 0296: para o AURUM esta tabela e o que decide quem entra no BOARD: so a oferta qm4lu7py (pitch do Aurum no ETHB SP, 05/08/2026) gera a tag "ETHB SP", e o kanban do AURUM mostra apenas quem tem essa tag. Quem entrou por oferta de saldo (pagamento de quem ja estava dentro) continua existindo no sistema, fora do board. NAO usar a cidade da pessoa como criterio: o resumo da ficha exibe o endereco residencial, e aluno de POA/GO comprou o evento de SP.';

-- ── Conferência (não altera nada) ───────────────────────────────────────────
do $$
declare
  v_total int; v_com_tag int; v_sem_tag int; v_dinheiro numeric;
begin
  select count(*) into v_total from cs.contatos_hm where produto = 'AURUM';

  select count(*) into v_com_tag from cs.contatos_hm
   where produto = 'AURUM' and tags @> array['ETHB SP'];

  v_sem_tag := v_total - v_com_tag;

  select coalesce(sum(p.valor), 0) into v_dinheiro
    from cs.contatos_hm ch
    join cs.hm_pagamentos p on p.comprador_id = ch.comprador_id
   where ch.produto = 'AURUM' and not (coalesce(ch.tags, '{}') @> array['ETHB SP']);

  raise notice '0296: AURUM tem % ficha(s): % com a tag ETHB SP (ficam no board), % sem a tag (saem do board, seguem no sistema — R$ % no razao).',
    v_total, v_com_tag, v_sem_tag, v_dinheiro;

  if v_com_tag = 0 then
    raise exception '0296: nenhuma ficha AURUM tem a tag "ETHB SP" — o filtro do board esvaziaria a tela. Abortado: conferir cs.fn_tag_hm_origem e cs.hm_origem_por_oferta antes de aplicar o filtro.';
  end if;
end $$;

-- ── Verificação (rodar à mão) ───────────────────────────────────────────────
-- Quem SAI do board (e por que), sem nada ser apagado:
--
-- select cp.nome, ch.tags, ch.plano,
--        (select coalesce(sum(p.valor),0) from cs.hm_pagamentos p
--          where p.comprador_id = ch.comprador_id) as no_razao
--   from cs.contatos_hm ch join public.compradores cp on cp.id = ch.comprador_id
--  where ch.produto = 'AURUM' and not (coalesce(ch.tags,'{}') @> array['ETHB SP']);
--
-- Se uma dessas passar a ser venda de evento, basta a tag entrar (pela oferta
-- em cs.hm_origem_por_oferta) que ela volta ao board sozinha — nada a desfazer.
