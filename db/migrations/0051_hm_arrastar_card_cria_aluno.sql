-- =====================================================================
-- 0051_hm_arrastar_card_cria_aluno
-- Fecha a última porta pela qual um aluno pago deixava de existir na base.
--
-- Havia DUAS formas de dizer "esta pessoa pagou":
--   a) o botão "Registrar pagamento" da ficha → provisiona o aluno em thb_alunos;
--   b) arrastar o card para "Pagamento Realizado" no kanban → só marca a flag.
-- Quem usava (b) mandava o card para a Ativação sem que o aluno nascesse na base
-- mestre — o GPS nunca ficava sabendo. Foi o que aconteceu com Dilcele, João
-- Borges e Renato Nicolodi: cards em "Entrevista Agendada", nenhum na base.
--
-- Esta função é o caminho único: dado o comprador, deriva os valores (0049/0050),
-- cria ou atualiza o aluno e marca para conferência humana quando o número é
-- ambíguo. O serviço do kanban passa a chamá-la ao mover o card para pago.
--
-- Quando só existe o sinal na Hotmart (pagamento combinado fora da plataforma),
-- o aluno nasce mesmo assim — com o financeiro sinalizado, porque o sistema não
-- tem como saber quanto foi acordado. Preferir um cadastro honesto e marcado a
-- nenhum cadastro: sem a linha na base, ninguém cria o acesso da pessoa.
-- Aditiva e idempotente.
-- =====================================================================

create or replace function cs.fn_hm_provisionar_derivado(p_comprador_id uuid)
returns uuid
language plpgsql
security definer
set search_path = cs, public, pg_temp
as $fn$
declare
  v_val   record;
  v_aluno uuid;
begin
  select * into v_val from cs.fn_hm_valores_derivados(p_comprador_id);
  v_aluno := cs.fn_hm_provisionar_aluno(p_comprador_id, v_val.valor_total, v_val.valor_pago);
  if v_aluno is null then return null; end if;

  if v_val.ambiguo then
    update public.thb_alunos
       set tratamento_manual = coalesce(tratamento_manual,
             'Financeiro a conferir — pagamento marcado no kanban em '||to_char(now(),'DD/MM/YYYY')||
             ': a Hotmart não registra o valor total (parcela, oferta recorrente ou acordo fora da plataforma)')
     where id = v_aluno;
  end if;

  return v_aluno;
end$fn$;

grant execute on function cs.fn_hm_provisionar_derivado(uuid) to disparos_app;

-- Backfill: cards que já estão na Ativação marcados como pagos, mas sem aluno.
do $backfill$
declare
  r       record;
  v_aluno uuid;
begin
  for r in
    select ch.id as card_id, ch.comprador_id
      from cs.contatos_hm ch
      join cs.estagios e on e.id = ch.estagio_id and e.aba = 'ativacao'
     where ch.apto_ativacao and ch.aluno_id is null
  loop
    begin
      v_aluno := cs.fn_hm_provisionar_derivado(r.comprador_id);
      if v_aluno is not null then
        insert into cs.interacoes (contato_hm_id, tipo, descricao, autor)
        values (r.card_id, 'sistema',
                'Aluno criado na base THB — o card estava pago na Ativação sem cadastro (migration 0051)', 'sistema');
      end if;
    exception when others then
      insert into cs.interacoes (contato_hm_id, tipo, descricao, autor)
      values (r.card_id, 'sistema', 'Falha ao criar o aluno na base THB ('||sqlerrm||')', 'sistema');
    end;
  end loop;
end$backfill$;
