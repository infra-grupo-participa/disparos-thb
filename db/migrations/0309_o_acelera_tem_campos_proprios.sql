-- 0309_o_acelera_tem_campos_proprios
--
-- ── O pedido (Victor, 26/08 — dia do lançamento) ────────────────────────────
-- "No kanban do Acelera tem muita coisa que não vai ser usada. Marca 'edição
--  100', não sei o que é isso. Preciso do nível do lead (quente/morno/frio), da
--  profissão, da origem, e de saber se preencheu o pré-checkout e se comprou. Se
--  comprou, vai pra Vendido sozinho. Se preencheu e não comprou, um alerta."
--
-- ── Por que campo próprio, e não tag ────────────────────────────────────────
-- Dava para enfiar tudo em `tags` (o board já filtra por tag) e não custaria
-- migration. Mas "comprou" precisa DISPARAR uma ação (mover o card) e "preencheu
-- e não comprou" precisa ser uma pergunta barata de fazer — as duas coisas ficam
-- frágeis em cima de um array de texto livre, onde um acento ou um plural mudam
-- o significado sem ninguém perceber.
--
-- Datas em vez de booleanos: "quando comprou" responde tudo o que "comprou"
-- responderia, e ainda diz há quanto tempo — que é o que o comercial pergunta.

alter table cs.contatos
  add column if not exists nivel_lead     text,
  add column if not exists origem_lead    text,
  add column if not exists precheckout_em timestamptz,
  add column if not exists comprou_em     timestamptz;

-- O nível é vocabulário fechado: o comercial lê "Quente" no card e age. Texto
-- livre aqui viraria "quente", "QUENTE", "muito quente" — e o chip não pintaria.
alter table cs.contatos drop constraint if exists contatos_nivel_lead_check;
alter table cs.contatos add constraint contatos_nivel_lead_check
  check (nivel_lead is null or nivel_lead in ('Quente','Morno','Frio'));

comment on column cs.contatos.nivel_lead is
  '0309: temperatura do lead na entrega da lista (Quente/Morno/Frio). Preenchido na importação, não calculado — quem classifica é quem monta a lista.';
comment on column cs.contatos.origem_lead is
  '0309: de onde o lead veio (ex.: CPL2, chat da live, indicação). Texto livre: a lista de origens muda a cada lançamento.';
comment on column cs.contatos.precheckout_em is
  '0309: quando preencheu o pré-checkout. Não-nulo + comprou_em nulo = o alerta "preencheu e não comprou".';
comment on column cs.contatos.comprou_em is
  '0309: quando comprou. Não-nulo manda o card para Vendido (trigger abaixo) e o comercial para de ligar.';

create index if not exists idx_contatos_acelera_funil
  on cs.contatos (evento, comprou_em, precheckout_em) where evento = 'ACELERA';

-- ── Comprou → Vendido, sem passo manual ─────────────────────────────────────
-- O pedido foi explícito: "se ela comprou, já vai pra vendida, sem precisar
-- fazer nada manual". O gatilho é a MARCAÇÃO da compra (comprou_em passando de
-- nulo para uma data), não qualquer update na linha — assim editar uma tag de
-- quem já comprou não arrasta o card de volta.
create or replace function cs.fn_acelera_comprou_vai_para_vendido()
returns trigger
language plpgsql
security definer
set search_path to 'cs','public','pg_temp'
as $fn$
declare v_vendido int;
begin
  if new.evento <> 'ACELERA' then return new; end if;
  if new.comprou_em is null or (tg_op = 'UPDATE' and old.comprou_em is not null) then
    return new;
  end if;
  select id into v_vendido from cs.estagios where chave = 'acel_vendido';
  if v_vendido is not null and new.estagio_id is distinct from v_vendido then
    new.estagio_id := v_vendido;
  end if;
  return new;
end $fn$;

drop trigger if exists trg_acelera_comprou on cs.contatos;
create trigger trg_acelera_comprou
  before insert or update of comprou_em on cs.contatos
  for each row execute function cs.fn_acelera_comprou_vai_para_vendido();

comment on function cs.fn_acelera_comprou_vai_para_vendido() is
  '0309: compra marcada leva o card do Acelera para Vendido. Dispara na virada de comprou_em (nulo → data), nunca em update qualquer — senão mexer numa tag de quem ja comprou puxaria o card de volta.';
