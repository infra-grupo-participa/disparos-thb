-- 0161_gerente_distribuidor.sql
-- GERENTE DISTRIBUIDOR — o caso da Kelly (pedido do Marcio, 10/08/2026).
--
-- "Todas as compras de aurum e hm sejam associadas automaticamente pra Kelly, e ela
--  pode designar para os demais operadores os alunos, INDEPENDENTE DA EQUIPE."
--
-- Isso quebra de propósito a hierarquia da 0143: hoje `podeAtribuirPara` só deixa o
-- GESTOR atribuir dentro da PRÓPRIA equipe (`destino.equipe_id === ator.equipe_id`);
-- atravessar equipes era exclusividade do MASTER.
--
-- Por que uma FLAG e não um `Nivel` novo: nível governa também o que a pessoa VÊ, o
-- que edita e se abre card cancelado. Dar tudo isso a quem só precisa repassar aluno
-- seria escalada de privilégio silenciosa. A flag é cirúrgica — o gerente segue com a
-- visibilidade e os limites do nível dele; só ganha furar a cerca de equipe ao
-- ATRIBUIR. O admin/master continua distribuindo como sempre (decisão do Marcio:
-- "mantém o admin podendo distribuir também").
--
-- ⚠️ Efeito colateral CONHECIDO e aceito: hoje a venda nova é carimbada por EQUIPE e
-- cai no POOL, de onde qualquer operador se serve. Com a Kelly como DONA, o card sai
-- do pool — ninguém puxa sozinho e a distribuição depende dela. Se ela faltar, a fila
-- para. Mitigação: admin também distribui, e toda atribuição fica na timeline.
-- Idempotente.

-- 1) A flag -------------------------------------------------------------------
alter table cs.usuarios
  add column if not exists gerente_distribuidor boolean not null default false;

comment on column cs.usuarios.gerente_distribuidor is
  'Distribui card para operador de QUALQUER equipe (0161, caso Kelly). Nao concede visibilidade nem edicao extra: so fura a cerca de equipe em podeAtribuirPara.';

-- 2) Kelly ---------------------------------------------------------------------
update cs.usuarios set gerente_distribuidor = true
 where lower(btrim(email)) = 'kelly@advmais.com';

-- 3) Responsável padrao das vendas novas de HM e AURUM --------------------------
-- `cs.hm_config` (0146) ja guarda a EQUIPE padrao carimbada na criacao do card.
-- Acrescentamos o RESPONSAVEL padrao: quem recebe a venda nova. NULL = comportamento
-- historico (cai no pool). Singleton id=1, igual ao resto da config.
alter table cs.hm_config
  add column if not exists responsavel_padrao_id uuid references cs.usuarios(id) on delete set null;

comment on column cs.hm_config.responsavel_padrao_id is
  'Usuario que recebe toda venda NOVA de HM/AURUM como responsavel (0161). NULL = cai no pool, como antes.';

update cs.hm_config
   set responsavel_padrao_id = (select id from cs.usuarios where lower(btrim(email)) = 'kelly@advmais.com'),
       atualizado_em = now()
 where id = 1;

-- 4) O carimbo -----------------------------------------------------------------
-- Estende o trigger dedicado da 0146 (mesma estratégia "mínima e à prova de drift":
-- não reescrevemos `fn_seed_contato_hm`, que é longa e mudaria em dois lugares).
-- Carimba equipe E responsável no card novo, e só quando ele não veio com dono
-- explícito — cadastro manual que já escolheu o responsável continua mandando.
--
-- ⚠️ Vale para HM **e AURUM** (os dois boards, como o Marcio pediu). O ETHB fica de
-- fora: board sem operação definida ainda; entra quando tiver dono.
create or replace function cs.fn_hm_carimba_equipe_padrao()
returns trigger language plpgsql
set search_path to 'cs','public','pg_temp'
as $function$
declare
  v_equipe uuid;
  v_resp   uuid;
begin
  if new.equipe_padrao_id is not null or new.responsavel_id is not null then
    return new;  -- já nasceu com equipe/dono explícito: respeita
  end if;

  select equipe_padrao_id, responsavel_padrao_id
    into v_equipe, v_resp
    from cs.hm_config where id = 1;

  if v_equipe is not null then
    update cs.contatos_hm set equipe_padrao_id = v_equipe where id = new.id;
  end if;

  -- Responsável padrão só nos boards com operação definida (0161).
  if v_resp is not null and coalesce(new.produto, 'HM') in ('HM','AURUM') then
    update cs.contatos_hm
       set responsavel_id = v_resp,
           atualizado_em  = now()
     where id = new.id;

    insert into cs.interacoes (contato_hm_id, tipo, descricao, autor)
    values (new.id, 'sistema',
            'Venda nova atribuída automaticamente ao responsável padrão (0161) — a distribuição para o operador é feita por quem gerencia',
            'sistema');
  end if;

  return new;
end$function$;

-- o trigger em si não muda (AFTER INSERT em cs.contatos_hm), mas recriamos para
-- garantir que aponta para a função nova mesmo se a 0146 não tiver rodado aqui.
drop trigger if exists trg_hm_carimba_equipe_padrao on cs.contatos_hm;
create trigger trg_hm_carimba_equipe_padrao
  after insert on cs.contatos_hm
  for each row execute function cs.fn_hm_carimba_equipe_padrao();
