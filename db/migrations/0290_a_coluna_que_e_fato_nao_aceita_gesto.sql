-- =====================================================================
-- 0290_a_coluna_que_e_fato_nao_aceita_gesto
--
-- D1 (decisão do Marcio): 5 colunas do HM viram IMUTÁVEIS por gesto manual —
-- entrada E saída travadas para quem não é master: hm_boleto_gerado,
-- hm_pagamento_parcelado, hm_pagamento_realizado, hm_cancelamento,
-- hm_reembolsado. A trava de ação (lib/services/hm.ts, B2) precisa de UMA
-- fonte para "essa coluna é fato, não gesto" — sem isso a lista vira mais um
-- array hardcoded espalhado (era o caso de HM_ESTAGIOS_CANCELAMENTO antes
-- desta migration, ver a otimização no fim do comentário).
--
-- TRÊS NATUREZAS (D2 dá o motivo de existir uma terceira, além de
-- hotmart/operador):
--
--   'hotmart'  — o webhook da Hotmart escreve aqui sozinho, e SÓ ele deveria:
--     hm_boleto_gerado    (0186: a Hotmart emitiu boleto/PIX, ninguém tocou)
--     hm_cancelamento     (0048: pedido de reembolso — webhook OU confirmação
--                          manual do fato, nunca arrasto)
--     hm_reembolsado       (0101: reembolso executado — idem)
--
--   'derivada' — ninguém arrasta um card para cá: a coluna é o REFLEXO de
--     outra coisa acontecer, não um lugar onde o card "mora". São as colunas-
--     espelho descritas em app/hm/kanban/page.tsx (colunaNaAba) — o card
--     mora em `ativacao`, e o Comercial só desenha esta coluna por cima:
--     hm_pagamento_parcelado  (0108, espelho de mensalidade em curso)
--     hm_pagamento_realizado  (0028, espelho de quitado — moverEstagioHm já
--                              trata como gatilho especial: registra o
--                              pagamento e redireciona para a Ativação)
--
--   'operador' — todo o resto, INCLUSIVE hm_aguardando_pagamento. D2 é
--     explícito: essa coluna representa "sinal pago, já em cobrança do
--     saldo" — o webhook PODE colocar o card aqui automaticamente (quando o
--     sinal compensa), mas o OPERADOR segue livre para tirar o card dali na
--     mão (ligar, negociar, mover para "Contato Inicial"). Não é fato imóvel
--     como as 5 de cima: é só o ponto de partida mais comum.
--
-- Por que 'operador' é o DEFAULT (e não uma enumeração positiva das 33+
-- chaves restantes): estágio novo que ninguém classificar nasce editável —
-- errar para o lado do gesto manual é o erro seguro aqui (uma coluna de fato
-- esquecida sem a natureza certa travaria menos do que deveria; a inversa,
-- uma coluna comum travada por engano, prenderia o board inteiro).
--
-- Aditiva e idempotente: coluna nova com default, UPDATE por chave (não
-- reescreve o resto), check constraint permissiva o bastante para não
-- quebrar em cima de estágio HT/CNHF/SEM que nunca vai usar 'hotmart'/
-- 'derivada' (ficam 'operador' pelo default, e não há problema nisso: a
-- trava em lib/services/hm.ts só é chamada pelo módulo HM).
-- =====================================================================

begin;

alter table cs.estagios
  add column if not exists origem_movimento text not null default 'operador';

alter table cs.estagios drop constraint if exists estagios_origem_movimento_check;
alter table cs.estagios
  add constraint estagios_origem_movimento_check
  check (origem_movimento in ('hotmart', 'operador', 'derivada'));

comment on column cs.estagios.origem_movimento is
  '0290 (D1/D2): quem tem autoridade para mover um card PARA ou PARA FORA desta coluna.
   ''hotmart''  = a Hotmart é a fonte do fato (boleto emitido, cancelamento pedido,
                  reembolso executado) — webhook ou confirmação manual do FATO, nunca
                  arrasto. Bloqueia entrada E saída para quem não é master (D1/D3).
   ''derivada'' = a coluna é ESPELHO de outra coisa (pagamento parcelado/realizado
                  refletido do estado real na Ativação, app/hm/kanban/page.tsx
                  colunaNaAba) — não é "lugar", é reflexo. Mesma trava de entrada/saída.
   ''operador'' = movimento humano normal (default). Inclui hm_aguardando_pagamento
                  de propósito (D2): o webhook PODE colocar o card lá quando o sinal
                  compensa, mas o operador segue livre para tirá-lo dali — não é fato
                  imóvel como as 5 colunas travadas.';

-- Classificação — só as chaves citadas na decisão do Marcio; o resto fica no
-- default ''operador'' (não precisa de UPDATE).
update cs.estagios set origem_movimento = 'hotmart'
 where evento = 'HM' and chave in ('hm_boleto_gerado', 'hm_cancelamento', 'hm_reembolsado');

update cs.estagios set origem_movimento = 'derivada'
 where evento = 'HM' and chave in ('hm_pagamento_parcelado', 'hm_pagamento_realizado');

-- Trava de sanidade (padrão da 0232): confirma que as 5 colunas do D1 saíram
-- do default antes de fechar a transação — se uma delas ainda não existir em
-- cs.estagios (evento HM), a migration para em vez de travar silenciosamente
-- menos colunas do que o Marcio pediu.
do $$
declare v_n int;
begin
  select count(*) into v_n from cs.estagios
   where evento = 'HM'
     and chave in ('hm_boleto_gerado', 'hm_pagamento_parcelado', 'hm_pagamento_realizado',
                    'hm_cancelamento', 'hm_reembolsado')
     and origem_movimento in ('hotmart', 'derivada');
  if v_n <> 5 then
    raise exception '0290: esperava 5 colunas classificadas (hotmart/derivada), achei %. '
      'Alguma das 5 chaves do D1 nao existe em cs.estagios (evento=HM) -- conferir '
      'hm_boleto_gerado (0186, nunca versionada no repo) antes de aplicar.', v_n;
  end if;
end $$;

commit;
