-- =====================================================================
-- 0054_hm_so_vira_aluno_quem_quitou
-- Regra do negócio, dita pelo time: quem pagou SÓ o sinal de R$300 ainda NÃO é
-- aluno. Vira aluno da T39 (e entra na base mestre, insumo do GPS) quem quita ou
-- parcela o valor do HM. O sinal é só o filtro de curiosos.
--
-- O backfill da 0051 violou isso: ele tratou "card marcado como pago no kanban"
-- como quitação e provisionou 3 pessoas que só tinham o sinal na Hotmart —
--   • Dilcele Assis Guerra — CRIADA na base sem lastro nenhum;
--   • JOAO BORGES (T12) e RENATO NICOLODI (T21) — já existiam, e tiveram a TURMA
--     sobrescrita para T39 e o financeiro reescrito como "pagou 300, deve 14.700".
-- (Décio Rodrigues não foi atingido: o card dele está no Comercial.)
--
-- Esta migration reverte o estrago e fecha a porta: o provisionamento automático
-- passa a exigir LASTRO — uma compra aprovada de 'diferenca' (saldo) ou
-- 'compra_cheia'. Arrastar o card não é mais suficiente para criar um aluno.
--
-- Pagamento combinado FORA da Hotmart continua possível — mas pela ficha, no
-- botão "Registrar pagamento", onde uma pessoa informa os valores e assume a
-- afirmação. Um arrasto acidental não pode criar matrícula.
-- =====================================================================

-- 1) Só provisiona quem tem lastro de quitação -------------------------------
create or replace function cs.fn_hm_provisionar_derivado(p_comprador_id uuid)
returns uuid
language plpgsql
security definer
set search_path = cs, public, pg_temp
as $fn$
declare
  v_val    record;
  v_aluno  uuid;
  v_quitou boolean;
begin
  -- Lastro = a Hotmart registrou o pagamento do saldo ou a compra cheia.
  -- Só o sinal não basta: pela regra do programa, ele não faz ninguém aluno.
  select exists (
    select 1
      from public.compras c
      join public.hm_product_catalog cat on cat.offer_code = c.oferta_codigo
     where c.comprador_id = p_comprador_id
       and c.status in ('APPROVED','COMPLETE','COMPLETED')
       and cat.categoria in ('diferenca','compra_cheia')
  ) into v_quitou;

  if not v_quitou then
    return null;   -- o card pode até estar na Ativação; aluno, não vira.
  end if;

  select * into v_val from cs.fn_hm_valores_derivados(p_comprador_id);
  v_aluno := cs.fn_hm_provisionar_aluno(p_comprador_id, v_val.valor_total, v_val.valor_pago);
  if v_aluno is null then return null; end if;

  if v_val.ambiguo then
    update public.thb_alunos
       set tratamento_manual = coalesce(tratamento_manual,
             'Financeiro a conferir — pagamento marcado no kanban em '||to_char(now(),'DD/MM/YYYY')||
             ': a Hotmart não registra o valor total (parcela ou oferta recorrente)')
     where id = v_aluno;
  end if;

  return v_aluno;
end$fn$;

grant execute on function cs.fn_hm_provisionar_derivado(uuid) to disparos_app;

-- 2) Reverte quem virou aluno sem ter quitado ---------------------------------
-- 2a) Alunos que NASCERAM do backfill sem lastro: apaga o cadastro. Só toca em
-- linhas criadas pelo próprio funil (fonte 'sip_ativacao_hm') e sem nenhuma
-- compra de quitação — nunca em cadastro histórico.
with sem_lastro as (
  select a.id, a.comprador_id
    from public.thb_alunos a
   where a.fonte = 'sip_ativacao_hm'
     and not exists (
       select 1 from public.compras c
         join public.hm_product_catalog cat on cat.offer_code = c.oferta_codigo
        where c.comprador_id = a.comprador_id
          and c.status in ('APPROVED','COMPLETE','COMPLETED')
          and cat.categoria in ('diferenca','compra_cheia'))
)
delete from public.thb_alunos a using sem_lastro s where a.id = s.id;

-- 2b) Alunos que JÁ EXISTIAM e tiveram turma/financeiro sobrescritos pelo
-- backfill: devolve a turma de origem (congelada no card pela 0053) e zera o
-- bloco financeiro — os valores anteriores não foram preservados, então afirmar
-- qualquer número aqui seria pior do que admitir que não sabemos.
update public.thb_alunos a
   set turma_id = t.id,
       valor_total = null, valor_pago = null, saldo_devedor = null,
       situacao_financeira = null, status_pagamento = null, ultimo_pagamento = null,
       tratamento_manual = coalesce(a.tratamento_manual,
         'Turma e financeiro foram sobrescritos por engano em 13/07/2026 (backfill do HM) e revertidos: '
         || 'a pessoa pagou só o sinal e não é aluna da T39. Os valores anteriores não foram preservados — conferir na base histórica.'),
       atualizado_em = now()
  from cs.contatos_hm ch
  join public.thb_turmas t on t.codigo = ch.turma_origem
 where a.comprador_id = ch.comprador_id
   and a.fonte <> 'sip_ativacao_hm'
   and ch.turma_origem is not null
   and not exists (
     select 1 from public.compras c
       join public.hm_product_catalog cat on cat.offer_code = c.oferta_codigo
      where c.comprador_id = ch.comprador_id
        and c.status in ('APPROVED','COMPLETE','COMPLETED')
        and cat.categoria in ('diferenca','compra_cheia'));

-- 2c) Desfaz o vínculo no card e deixa o rastro na timeline.
do $rastro$
declare r record;
begin
  for r in
    select ch.id as card_id, ch.comprador_id
      from cs.contatos_hm ch
     where ch.aluno_id is not null
       and not exists (
         select 1 from public.compras c
           join public.hm_product_catalog cat on cat.offer_code = c.oferta_codigo
          where c.comprador_id = ch.comprador_id
            and c.status in ('APPROVED','COMPLETE','COMPLETED')
            and cat.categoria in ('diferenca','compra_cheia'))
  loop
    update cs.contatos_hm set aluno_id = null, atualizado_em = now() where id = r.card_id;
    insert into cs.interacoes (contato_hm_id, tipo, descricao, autor)
    values (r.card_id, 'sistema',
            'Vínculo com a base THB desfeito: só o sinal de R$300 foi pago — pela regra do programa, ainda não é aluno. '
            'Se houve pagamento fora da Hotmart, registre em "Registrar pagamento" na ficha.',
            'sistema');
  end loop;
end$rastro$;
