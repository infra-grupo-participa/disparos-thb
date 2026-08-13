-- 0215 — A sobrecarga ambígua que quebrava o login de quem pagou os R$ 15.000
--
-- SINTOMA (medido em produção, 12/08/2026)
-- Cinco pessoas quitaram o saldo do HM e continuaram na base de alunos como
-- "Só sinal pago", valor_pago R$ 697. O card ficou com aluno_id nulo. Nenhuma
-- tela acusou nada — só uma interação no histórico do card:
--
--     Falha ao criar o aluno na base THB
--     (function cs.fn_hm_valores_derivados(uuid) is not unique)
--
-- CAUSA
-- A 0196/0197 criou a versão com filtro de produto — `(uuid, text DEFAULT 'HM')` —
-- e NÃO derrubou a versão antiga de um argumento. Com as duas no catálogo, toda
-- chamada de 1 argumento fica ambígua e o Postgres recusa antes de executar.
-- Três famílias ficaram assim:
--
--   cs.fn_hm_valores_derivados(uuid)        vs (uuid, text DEFAULT 'HM')
--   cs.fn_hm_tem_lastro(uuid)               vs (uuid, text DEFAULT 'HM')
--   cs.fn_hm_cancelar(uuid,text,text)       vs (uuid,text,text,text DEFAULT NULL)
--
-- O QUE ISSO DERRUBOU
--   · cs.fn_seed_contato_hm       — provisiona o aluno em toda compra cheia e em
--                                   todo pagamento de saldo. Falha engolida por
--                                   `exception when others`: o dinheiro entra, o
--                                   login não nasce e ninguém fica sabendo.
--   · cs.fn_hm_provisionar_derivado — mesmo caminho quando o operador marca o
--                                   pagamento pelo kanban.
--   · cs.fn_hm_cancelar_por_email
--     cs.fn_hm_cancelar_por_transacao — os dois caminhos de cancelamento da
--                                   Hotmart chamam fn_hm_cancelar com 3 args.
--   · lib/services/hm.ts:432      — cancelamento manual pela tela, 3 args.
--
-- A versão de 2 argumentos é a de 1 mais o filtro de produto, e o default 'HM'
-- reproduz o comportamento antigo. Em fn_hm_cancelar o default é NULL, que é
-- "todos os boards" — exatamente o que a versão de 3 args fazia. Derrubar as
-- antigas é, para todo chamador existente, comportamento idêntico.

begin;

drop function if exists cs.fn_hm_valores_derivados(uuid);
drop function if exists cs.fn_hm_tem_lastro(uuid);
drop function if exists cs.fn_hm_cancelar(uuid, text, text);

-- Trava: se alguém recriar uma sobrecarga que volte a colidir, a migration cai.
do $$
declare v int;
begin
  select count(*) into v
    from (
      select p.proname, p.oid, (p.pronargs - p.pronargdefaults) as min_args, p.pronargs
        from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'cs' and p.prokind = 'f'
    ) a
    join (
      select p.proname, p.oid, (p.pronargs - p.pronargdefaults) as min_args, p.pronargs
        from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'cs' and p.prokind = 'f'
    ) b on a.proname = b.proname and a.oid < b.oid
   where greatest(a.min_args, b.min_args) <= least(a.pronargs, b.pronargs);

  if v > 0 then
    raise exception 'ainda existem % pares de sobrecarga ambigua no schema cs', v;
  end if;
end $$;

-- Backfill: reprovisiona quem ficou pelo caminho. O alvo é quem tem a interação
-- de falha registrada — evidência no banco, não lista escrita à mão.
do $$
declare r record; v_aluno uuid; v_n int := 0;
begin
  for r in
    select distinct ch.comprador_id, cp.nome
      from cs.interacoes i
      join cs.contatos_hm ch on ch.id = i.contato_hm_id
      join public.compradores cp on cp.id = ch.comprador_id
     where i.descricao like 'Falha ao criar o aluno na base THB%'
  loop
    v_aluno := cs.fn_hm_provisionar_derivado(r.comprador_id);
    if v_aluno is not null then
      v_n := v_n + 1;
      insert into cs.interacoes (contato_hm_id, tipo, descricao, autor)
      select ch.id, 'sistema',
             'Aluno provisionado no acerto da 0215 — a falha anterior era a sobrecarga ambígua de cs.fn_hm_valores_derivados, não um problema do pagamento',
             'sistema'
        from cs.contatos_hm ch
       where ch.comprador_id = r.comprador_id and coalesce(ch.produto,'HM') = 'HM';
    end if;
  end loop;
  raise notice 'reprovisionados: %', v_n;
end $$;

commit;
