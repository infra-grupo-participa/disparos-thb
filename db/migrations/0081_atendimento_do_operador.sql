-- =====================================================================
-- 0081_atendimento_do_operador
-- O Atende Simples sai. O que fica é o registro FEITO PELO OPERADOR — e ele
-- passa a valer para qualquer canal, não só telefone: uma conversa no WhatsApp
-- ou um atendimento presencial contam tanto quanto uma ligação.
--
-- A tabela continua sendo cs.ligacoes (renomear seria destrutivo e não ganharia
-- nada); `canal` é quem diz o que aconteceu. A view cs.atendimentos existe para
-- o código novo ler pelo nome certo.
--
-- O HISTÓRICO É PRESERVADO. As chamadas gravadas pelo webhook do Atende Simples
-- continuam aqui, contando nos painéis — só ninguém mais escreve por lá. As
-- colunas do PABX (direction, status_pabx, from_number, dnis, billed_duration,
-- attendant_email) ficam: apagá-las apagaria dado real já coletado.
-- =====================================================================

alter table cs.ligacoes add column if not exists canal text not null default 'ligacao';

alter table cs.ligacoes drop constraint if exists cs_ligacoes_canal_chk;
alter table cs.ligacoes add constraint cs_ligacoes_canal_chk
  check (canal in ('ligacao', 'whatsapp', 'presencial', 'outro'));

comment on column cs.ligacoes.canal is
  'Por onde o atendimento aconteceu. O default ligacao cobre todo o histórico do Atende Simples, que era só telefone.';

-- `resultado` continua com o mesmo vocabulário para TODOS os canais — é o que
-- deixa o histórico somar com o novo. O que muda é o rótulo na tela: 'atendeu'
-- lê-se "Atendeu" na ligação, "Respondeu" no WhatsApp, "Compareceu" no
-- presencial. Semântica única: houve conversa de verdade.
comment on column cs.ligacoes.resultado is
  'atendeu = houve conversa. nao_atendeu | caixa_postal | ocupado | numero_errado. Os valores do PABX (abandonou, recusada, falhou) sobrevivem no histórico.';

create index if not exists ix_ligacoes_canal on cs.ligacoes (canal);

-- O que o "Meu dia" consulta o tempo todo: o que EU registrei HOJE.
create index if not exists ix_ligacoes_operador_dia
  on cs.ligacoes (operador, criado_em desc);

-- ----- Casar de vez o histórico do discador ---------------------------
-- As métricas refaziam o cruzamento telefone→comprador A CADA CONSULTA, porque
-- o webhook só casava no evento `call.finished` e muita chamada ficava sem
-- vínculo. Sem o discador, esse cruzamento não tem mais razão de existir: o
-- operador escolhe o contato ao registrar.
--
-- Então casamos UMA VEZ, aqui, o que sobrou (mesma regra de sempre: últimos 8
-- dígitos de from_number ou dnis; quem bate com 2+ compradores é AMBÍGUO e fica
-- sem vínculo — nunca atribuir errado). Depois disto, `comprador_id` é a fonte
-- da verdade e a query da métrica vira um join simples.
with chamadas as (
  select l.id,
         right(regexp_replace(coalesce(l.from_number, ''), '\D', '', 'g'), 8) as f8,
         right(regexp_replace(coalesce(l.dnis, ''),        '\D', '', 'g'), 8) as d8
    from cs.ligacoes l
   where l.comprador_id is null
),
parts as (
  select comprador_id, right(regexp_replace(telefone, '\D', '', 'g'), 8) as t8
    from cs.contatos_evento
   where telefone is not null
     and length(regexp_replace(telefone, '\D', '', 'g')) >= 8
),
casados as (
  select c.id,
         count(distinct p.comprador_id) as n,
         min(p.comprador_id::text) as comprador_id
    from chamadas c
    join lateral (values (c.f8), (c.d8)) s(t8) on length(s.t8) = 8
    join parts p on p.t8 = s.t8
   group by c.id
)
update cs.ligacoes l
   set comprador_id = k.comprador_id::uuid
  from casados k
 where l.id = k.id and k.n = 1 and l.comprador_id is null;

-- NOTA sobre o nome: seria natural criar uma view `cs.atendimentos` aqui, mas
-- esse nome JÁ EXISTE e é outra coisa — a tabela do inbox que mede o tempo de
-- primeira resposta (FRT) ao lead que escreveu. São conceitos distintos: lá é
-- "quanto demoramos a responder", aqui é "o que o operador fez". Duas coisas
-- com o mesmo nome confundem mais do que um nome antigo esclarece, então a
-- tabela segue sendo cs.ligacoes; "atendimento" é o vocabulário da tela.
