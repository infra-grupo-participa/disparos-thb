-- 0183 — trava de banco: pagamento NUNCA pode nascer de compra não paga.
--
-- ⚠️ APLICADA EM PRODUÇÃO em 11/08/2026
-- (supabase_migrations: 0183_pagamento_nunca_de_compra_nao_paga).
--
-- ── POR QUE ──────────────────────────────────────────────────────────────────────
-- Pedido do Marcio: "garante pra mim que todo o boleto gerado vai ser sinalizado como
-- boleto gerado e não como pagamento. Não pode ter erro nessa diferenciação."
--
-- A garantia já existia, mas em UM lugar só: o `if` de status dentro de
-- cs.fn_hm_lancar_compra:
--     if not found or v_c.status not in ('APPROVED','COMPLETE','COMPLETED') then return null;
-- Se alguém escrever outro caminho de inserção (script de correção, backfill,
-- importação de planilha, função nova), nada no banco impediria lançar dinheiro que
-- não entrou. Esta migration move a regra do CÓDIGO para o DADO.
--
-- ── ⚠️ NÃO CONFUNDIR COM REEMBOLSO ───────────────────────────────────────────────
-- Em REFUNDED / CHARGEBACK / PROTESTED o dinheiro ENTROU e depois voltou — o pagamento
-- PERMANECE no razão, que é append-only (histórico financeiro). A auditoria de 11/08
-- encontrou 10 pagamentos assim e todos estão CORRETOS:
--     8 × sinal REFUNDED (R$ 2.400,00) · 1 × compra_cheia REFUNDED (R$ 13.000,01)
--     1 × sinal PROTESTED (R$ 1.000,00)
-- A trava proíbe o OPOSTO: pagamento de compra que NUNCA foi paga.
--
-- Estados bloqueados (nenhum representa dinheiro recebido):
--   BILLET_PRINTED · PRINTED_BILLET · WAITING_PAYMENT · STARTED · EXPIRED
--
-- Pagamento sem `compra_id` (ajuste/lançamento manual do financeiro) NÃO é afetado:
-- a trava é sobre o que se origina de uma compra da Hotmart.
--
-- ── LIMITE CONHECIDO DESTA TRAVA (auditoria de 11/08) ────────────────────────────
-- O gatilho é `before insert or update of compra_id, valor ON cs.hm_pagamentos`, ou
-- seja, ele valida no momento em que o pagamento nasce ou é revinculado/revalorado.
-- Ele NÃO tem espelho em public.compras. Consequência: se uma compra estava APPROVED
-- quando o pagamento foi lançado (trigger aprovou, corretamente) e DEPOIS alguém
-- rebaixar `public.compras.status` para EXPIRED/BILLET_PRINTED — por bug, script de
-- correção em massa ou reprocessamento indevido —, o pagamento já lançado permanece,
-- sem erro nem alerta.
--
-- Isso é DE PROPÓSITO para REFUNDED/CHARGEBACK/PROTESTED (o dinheiro entrou e voltou;
-- o razão é histórico). O ângulo não coberto é só o rebaixamento indevido para um
-- estado de espera, que exige acesso de escrita a public.compras fora do webhook
-- (service_role/admin). Fechar isso exigiria uma trava adicional em public.compras
-- impedindo sair de aprovado para espera quando já existe pagamento vinculado —
-- decisão de produto, não aplicada aqui.
-- Quem for rodar UPDATE em massa em public.compras.status: leia isto antes.

begin;

create or replace function cs.fn_hm_pagamento_exige_compra_paga()
returns trigger
language plpgsql
security definer
set search_path to 'cs','public','pg_temp'
as $function$
declare
  v_status text;
begin
  if new.compra_id is null then
    return new;
  end if;

  select c.status into v_status from public.compras c where c.id = new.compra_id;

  if v_status in ('BILLET_PRINTED','PRINTED_BILLET','WAITING_PAYMENT','STARTED','EXPIRED') then
    raise exception
      'cs.hm_pagamentos: compra % está em "%" — dinheiro ainda não entrou, não pode virar pagamento (0183)',
      new.compra_id, v_status
      using hint = 'Boleto/PIX gerado é sinalizado em cs.contatos_hm.aguardando_pagamento_em. O pagamento só é lançado quando a compra for aprovada.';
  end if;

  return new;
end$function$;

drop trigger if exists trg_hm_pagamento_exige_compra_paga on cs.hm_pagamentos;
create trigger trg_hm_pagamento_exige_compra_paga
  before insert or update of compra_id, valor on cs.hm_pagamentos
  for each row execute function cs.fn_hm_pagamento_exige_compra_paga();

comment on function cs.fn_hm_pagamento_exige_compra_paga() is
  '0183: impede que compra em estado de espera (boleto impresso, PIX pendente, expirada) gere linha em cs.hm_pagamentos. Reembolso/chargeback NÃO são bloqueados — ali o dinheiro entrou e voltou, e o razão é histórico.';

commit;

-- ── AUDITORIA EXECUTADA EM PRODUÇÃO (comprador sintético, removido depois) ────────
--
-- Bateria 1 — boleto não pode virar pagamento (9/9 PASSOU):
--   1. BILLET_PRINTED gera pagamento? ......... 0 pagamentos          ✅
--   2. Card na coluna de espera + marcado ..... Aguardando Pagamento  ✅
--   3. PRINTED_BILLET (outra grafia) .......... 0 pagamentos          ✅
--   4. WAITING_PAYMENT ........................ 0 pagamentos          ✅
--   5. Saldo ignora boleto não pago ........... 15.000 (nada abatido) ✅
--   6. Boleto EXPIRADO ........................ 0 pagamentos          ✅
--   7. Compensou: vira pagamento .............. 1 pagamento           ✅
--   7b. Compensou: saldo 15.000 − 697 ......... 14.303,00             ✅
--   7c. Compensou: sai da fila de espera ...... Contato Inicial       ✅
--
-- Bateria 2 — a trava desta migration (4/4 PASSOU):
--   A. Forçar pagamento de boleto por INSERT direto ... bloqueado     ✅
--   B. Ajuste manual (sem compra_id) .................. permitido     ✅
--   C. Compra aprovada lança normalmente .............. 1 pagamento   ✅
--   D. Reembolso preserva o histórico ................. permitido     ✅
--
-- Estado após tudo: 0 resíduos de teste · board 284 cards ·
-- vw_aluno_360 1.812 linhas · 0 pagamentos de compra em estado de espera.
