-- 0179_canal_ht30_11_08.sql
-- TERCEIRA EDIÇÃO DO PITCH: a live do HT de HOJE (11/08) vende de novo a MESMA
-- oferta `rlgjsrul` (entrada R$697) das lives de 09/08 e 10/08. O Marcio quer o
-- público de hoje num canal próprio — "HT30 - 11-08" — para a régua do board do HM
-- continuar respondendo "qual live converteu mais?".
--
-- Nada de estrutura muda aqui: a 0167 já deu janela a `cs.hm_origem_por_oferta`
-- ([vale_de, vale_ate), início inclusivo / fim exclusivo). Uma edição nova do pitch
-- é exatamente o que aquela migration prometeu: UMA LINHA na tabela, não backfill.
--
-- ---------------------------------------------------------------------------
-- ONDE CORTAR — e quem muda de valor
--
-- Corte: **11/08/2026 12:00 BRT**, o mesmo critério da 0167. Compra de madrugada e
-- de manhã é rescaldo da live da véspera, não da live de hoje; ao meio-dia os dois
-- lados ficam folgados.
--
-- Medido antes de aplicar (11/08, 20:30 BRT):
--   · compras de `rlgjsrul` a partir de 11/08 12:00 ......... 0
--   · última compra da oferta ............................... 11/08 10:17 BRT
--   · cards hoje com "HT30 - 10-08" ......................... 18
--   · cards hoje com "HT30 - 09-08" ......................... 22
-- Ou seja: NENHUM card existente muda de canal. As duas compras de hoje (00:0x e
-- 10:17) ficam onde estão, em "HT30 - 10-08" — são rescaldo da live de ontem.
--
-- Idempotente: roda de novo sem efeito.

-- ---------------------------------------------------------------------------
-- 1) A janela da 2ª edição fecha ao meio-dia de hoje
-- ---------------------------------------------------------------------------
update cs.hm_origem_por_oferta
   set vale_ate = '2026-08-11 12:00:00-03',
       nota = 'Live do HT de 10/08/2026, 20h (2a edicao do pitch da entrada R$697). '
              'Mesma oferta da vespera na Hotmart: o que separa os canais e a janela de compra. '
              'Vale ate 11/08 12:00 BRT (0179): a partir dai a oferta pertence a live de 11/08.'
 where oferta_codigo = 'rlgjsrul'
   and origem = 'HT30 - 10-08';

-- ---------------------------------------------------------------------------
-- 2) A 3ª edição — tudo que a oferta vender do meio-dia de hoje em diante
-- ---------------------------------------------------------------------------
insert into cs.hm_origem_por_oferta (oferta_codigo, origem, nota, produto, vale_de, vale_ate)
values ('rlgjsrul', 'HT30 - 11-08',
        'Live do HT de 11/08/2026 (3a edicao do pitch da entrada R$697). Mesma oferta das duas '
        'lives anteriores: o que separa os canais e a janela de compra. Sem fim ate a proxima edicao.',
        'HM', '2026-08-11 12:00:00-03', null)
on conflict (oferta_codigo, coalesce(vale_de, '-infinity'::timestamptz)) do update
  set origem  = excluded.origem,
      nota    = excluded.nota,
      produto = excluded.produto,
      vale_ate = excluded.vale_ate;

-- ---------------------------------------------------------------------------
-- 3) Conferência (sai no log da aplicação)
-- ---------------------------------------------------------------------------
do $$
declare v_linhas int; v_apos int;
begin
  select count(*) into v_linhas from cs.hm_origem_por_oferta where oferta_codigo = 'rlgjsrul';
  select count(*) into v_apos   from public.compras
   where oferta_codigo = 'rlgjsrul'
     and status in ('APPROVED','COMPLETE','COMPLETED')
     and coalesce(data_compra, data_aprovacao) >= '2026-08-11 12:00:00-03';
  raise notice '0179: % janelas na oferta rlgjsrul; % compras caem na janela de 11-08', v_linhas, v_apos;
  if v_linhas <> 3 then
    raise exception '0179: esperava 3 janelas (09-08, 10-08, 11-08), achei %', v_linhas;
  end if;
end $$;
