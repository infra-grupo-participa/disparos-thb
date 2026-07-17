-- =====================================================================
-- 0102_hm_reclassificar_reembolsados_legado
--
-- A 0101 separou o PEDIDO (Reclamada) do FATO (Reembolsado), mas os cards
-- antigos foram todos rebatizados como "Reclamada" — inclusive os que já
-- tinham sido reembolsados de fato. Este ajuste move para "Reembolsado" só
-- os que carregam a prova do fato consumado:
--   • hotmart_cancelado_em preenchido (reembolso/chargeback confirmado na Hotmart), OU
--   • cancelamento_em preenchido (cancelamento definitivo registrado à mão).
-- Os demais em "Reclamada" continuam onde estão (pedido, aluno ainda ativo).
--
-- Só mexe em estagio_id. NÃO toca na base THB (o aluno já foi marcado quando
-- o cancelamento se consumou). Reversível: basta devolver o estagio_id.
-- Idempotente.
-- =====================================================================

update cs.contatos_hm ch
   set estagio_id = (select id from cs.estagios where evento='HM' and chave='hm_reembolsado'),
       atualizado_em = now()
 where ch.estagio_id = (select id from cs.estagios where evento='HM' and chave='hm_cancelamento')
   and (ch.hotmart_cancelado_em is not null or ch.cancelamento_em is not null);

-- Deixa o rastro no histórico de cada card movido.
insert into cs.interacoes (contato_hm_id, tipo, descricao, autor)
select ch.id, 'sistema',
       'Reclassificado para "Reembolsado" — cancelamento já constava consumado (ajuste 0102).',
       'sistema'
  from cs.contatos_hm ch
 where ch.estagio_id = (select id from cs.estagios where evento='HM' and chave='hm_reembolsado')
   and (ch.hotmart_cancelado_em is not null or ch.cancelamento_em is not null)
   and not exists (
     select 1 from cs.interacoes i
      where i.contato_hm_id = ch.id
        and i.descricao like 'Reclassificado para "Reembolsado"%'
   );
