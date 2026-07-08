-- =====================================================================
-- 0040_cs_hm_sync_todos_funis
-- Generaliza o reprocesso de origem: a classificação (público/turma/evento) é
-- validada pelo CONTEXTO DA PESSOA NA BASE DE ALUNOS (public.vw_aluno_360),
-- não pela oferta/funil da venda. Podem existir vendas de vários funis no HM;
-- todas devem ser classificadas pela base.
--
-- Antes, cs.fn_sync_hm_atm só varria cards com compra do sinal z391kxd9. Agora
-- varre TODOS os cards de cs.contatos_hm (qualquer funil) e reaplica
-- cs.fn_tag_hm_origem — que já deriva público/turma da base e o evento (quando
-- houver) pela data da compra do sinal. O trigger de venda já classifica
-- qualquer entrada sinal/compra_cheia. Idempotente.
-- p_desde filtra por data de criação do card (default: todos).
-- =====================================================================

create or replace function cs.fn_sync_hm_atm(
  p_desde timestamptz default '2000-01-01 00:00:00-03'
)
returns table (cards_alvo integer, aurum integer, hm integer, novo integer)
language plpgsql
security definer
set search_path = cs, public, pg_temp
as $fn$
declare
  r     record;
  v_pub text;
  n_alvo int := 0; n_a int := 0; n_h int := 0; n_n int := 0;
begin
  for r in
    select ch.comprador_id, ch.id as card_id
      from cs.contatos_hm ch
     where ch.criado_em >= p_desde
  loop
    n_alvo := n_alvo + 1;

    -- Limpa as tags gerenciadas por esta lógica (mantém externas: "No grupo" etc)
    -- e a nota de origem, para reaplicar do zero pela regra atual.
    update cs.contatos_hm
       set tags = (
         select coalesce(array_agg(t), '{}')
           from unnest(tags) t
          where t not in ('HT ATM','Aurum','HM','Novo','Live Direto ao Ponto')
            and t not in (select codigo from public.thb_turmas)
       ),
       observacoes = nullif(trim(both E'\n' from
         regexp_replace(coalesce(observacoes, ''), E'\\n?⟦(HT ATM|HM origem)⟧.*$', '')), '')
     where id = r.card_id;

    delete from cs.interacoes i
     where i.contato_hm_id = r.card_id
       and i.tipo = 'sistema'
       and (i.descricao like 'Origem HM:%' or i.descricao like 'Aluno identificado na base (HT ATM)%');

    v_pub := cs.fn_tag_hm_origem(r.comprador_id);
    if    v_pub = 'Aurum' then n_a := n_a + 1;
    elsif v_pub = 'HM'    then n_h := n_h + 1;
    else                       n_n := n_n + 1;
    end if;
  end loop;

  return query select n_alvo, n_a, n_h, n_n;
end
$fn$;
