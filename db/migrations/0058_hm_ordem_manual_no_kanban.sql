-- =====================================================================
-- 0058_hm_ordem_manual_no_kanban
-- Dá ao operador o controle da ordem vertical dos cards dentro da coluna.
--
-- Até aqui a posição do card na coluna era um efeito colateral: a esteira
-- ordenava por `atualizado_em desc`, então qualquer toque no card (uma nota, uma
-- tag, o responsável) o jogava para o topo. A fila que o operador enxergava
-- mudava sozinha, e não havia como dizer "este aqui é o próximo".
--
-- Agora cada card carrega uma `ordem` dentro do seu estágio, escrita pelo arrasto
-- vertical no board. `atualizado_em` continua sendo o desempate (cards que nunca
-- foram ordenados à mão), e a ordem 0 é o topo — onde entra quem chega sem gesto
-- de posição (webhook, troca de etapa pela ficha).
--
-- A view cs.contatos_hm_kanban já expõe `ordem` (0056), e por isso a coluna também
-- é garantida lá: a view NÃO pode ser recriada aqui — public.vw_aluno_360, que
-- alimenta o GPS, depende dela.
--
-- Aditiva e idempotente.
-- =====================================================================

alter table cs.contatos_hm add column if not exists ordem integer not null default 0;

-- Backfill: congela a ordem que os operadores já viam (atualizado_em desc) como
-- ordem inicial de cada coluna — ninguém abre o board e encontra tudo trocado.
-- Só toca em quem ainda está no default (0), então rodar de novo não embaralha.
with fila as (
  select id,
         row_number() over (
           partition by estagio_id
           order by atualizado_em desc nulls last, criado_em desc
         ) as pos
    from cs.contatos_hm
)
update cs.contatos_hm c
   set ordem = f.pos
  from fila f
 where f.id = c.id
   and c.ordem = 0;

-- A leitura do board é sempre "os cards de um estágio, na ordem".
create index if not exists idx_contatos_hm_estagio_ordem
  on cs.contatos_hm (estagio_id, ordem);
