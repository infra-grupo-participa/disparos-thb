-- =====================================================================
-- 0059_hm_imersao_poa_entra_no_funil
-- A Imersão POA vendeu o HM e o sistema não viu.
--
-- O gatilho de venda só cria card para compra a partir de 25/06/2026 (o corte
-- que separa a T39 das turmas antigas). Mas a Imersão POA vendeu o HM com a
-- oferta `nz3ob9r2` ("Sinal 2k — evento HT/Imersão") entre 08 e 17/06 — ANTES do
-- corte. Resultado: 7 compradores ficaram sem card no kanban, embora a planilha
-- de controle os liste como "ALUNOS T39 - Imersão POA" e o comercial os trate
-- como tal (com reunião marcada, acordo de pagamento, checklist de ativação).
-- Três deles já pagaram a compra cheia de 13k.
--
-- A lição: o corte por DATA é grosseiro demais. A T39 tem duas ofertas de
-- entrada — o sinal de R$300 (z391kxd9, HT ATM / Live) e o sinal de R$2.000
-- (nz3ob9r2, Imersão). Cada uma tem sua própria janela.
--
-- Não mexo no corte global (isso mudaria o passado de outras ofertas): trato a
-- oferta da Imersão explicitamente, a partir de 01/06/2026 — a janela da imersão
-- de junho. Os sinais de 18/04 (imersão anterior, gente que já quitou e é aluno
-- de turma antiga) continuam de fora, como devem.
-- Idempotente.
-- =====================================================================

-- 1) Cria os cards que faltaram ---------------------------------------------
insert into cs.contatos_hm (comprador_id, estagio_id, turma, plano, categoria_entrada)
select distinct c.comprador_id,
       (select id from cs.estagios where evento='HM' and chave='hm_comprou'),
       'T39',
       'Sinal R$2.000 (Imersão)',
       'sinal'
  from public.compras c
 where c.oferta_codigo = 'nz3ob9r2'
   and c.status in ('APPROVED','COMPLETE','COMPLETED')
   and coalesce(c.data_aprovacao, c.data_compra) >= '2026-06-01'
on conflict (comprador_id) do nothing;

-- 2) Quem já quitou vai para a Ativação (mesma regra da 0050) ----------------
-- Eles já são alunos na base (foram cadastrados por outra fonte) — o que faltava
-- era o card. Não reprovisiono nada: só coloco o card onde ele deveria estar.
update cs.contatos_hm ch
   set estagio_id = (select id from cs.estagios where evento='HM' and chave='hm_pendente_liberacao'),
       apto_ativacao = true,
       pagamento_em = coalesce(ch.pagamento_em, x.pago_em),
       aluno_id = coalesce(ch.aluno_id, a.id),
       atualizado_em = now()
  from (
    select c.comprador_id, max(coalesce(c.data_aprovacao, c.data_compra)) as pago_em
      from public.compras c
      join public.hm_product_catalog cat on cat.offer_code = c.oferta_codigo
     where c.status in ('APPROVED','COMPLETE','COMPLETED')
       and cat.categoria in ('compra_cheia','diferenca')
     group by c.comprador_id
  ) x
  left join public.thb_alunos a on a.comprador_id = x.comprador_id
 where ch.comprador_id = x.comprador_id
   and ch.plano = 'Sinal R$2.000 (Imersão)'
   and ch.estagio_id = (select id from cs.estagios where evento='HM' and chave='hm_comprou');

-- 3) O canal de aquisição da Imersão -----------------------------------------
-- fn_tag_hm_origem (0052/0053) só conhecia as janelas do sinal de R$300. Quem
-- entrou pelo sinal de R$2.000 ficaria sem canal nenhum. A oferta identifica o
-- evento sozinha: nz3ob9r2 é vendido NA imersão — aqui o produto É o canal, ao
-- contrário do z391kxd9, que é usado em todos os eventos (por isso lá o canal
-- vem do ingresso do HT e da janela de data — ver 0052).
create or replace function cs.fn_hm_canal_imersao(p_comprador_id uuid)
returns text
language sql
stable
security definer
set search_path = cs, public, pg_temp
as $fn$
  select 'Imersão POA'
    from public.compras c
   where c.comprador_id = p_comprador_id
     and c.oferta_codigo = 'nz3ob9r2'
     and c.status in ('APPROVED','COMPLETE','COMPLETED')
     and coalesce(c.data_aprovacao, c.data_compra) >= '2026-06-01'
   limit 1;
$fn$;

grant execute on function cs.fn_hm_canal_imersao(uuid) to disparos_app;
