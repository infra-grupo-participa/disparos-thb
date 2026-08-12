-- 0204_canal_ht30_12_08.sql
-- QUARTA EDIÇÃO DO PITCH: a live do HT de HOJE (12/08) vende de novo a MESMA
-- oferta `rlgjsrul` (entrada R$697) das lives de 09/08, 10/08 e 11/08. Canal
-- próprio — "HT30 - 12-08" — para a régua do board do HM continuar respondendo
-- "qual live converteu mais?".
--
-- Nada de estrutura muda: a 0167 deu janela a `cs.hm_origem_por_oferta`
-- ([vale_de, vale_ate), início inclusivo / fim exclusivo). Uma edição nova é
-- UMA LINHA na tabela, não backfill. Mesmo caminho da 0160 e da 0179.
--
-- ---------------------------------------------------------------------------
-- ⚠️ O CORTE AQUI É 20:00, NÃO 12:00 — e isso é DIFERENTE das anteriores
--
-- Instrução explícita do Marcio (12/08): "somente compras a partir das 20h valem
-- como HT30 - 12/08".
--
-- As migrations 0167/0179 cortavam ao MEIO-DIA porque eram aplicadas à noite,
-- depois da live: naquele momento, tudo que tivesse entrado no dia já era da
-- live da véspera ou da edição nova, e o meio-dia separava os dois lados com
-- folga. Hoje é diferente — esta migration está sendo aplicada às 14h52, ANTES
-- da live das 20h. Cortar ao meio-dia mudaria de canal uma venda que aconteceu
-- 7 horas ANTES da live que passaria a levar o crédito por ela.
--
-- Medido antes de aplicar (12/08, 14h52 BRT), compras aprovadas de `rlgjsrul`:
--   · Diego Lopes Brum ....... 12/08 02:37 → rescaldo da live de 11/08
--   · Gustavo Júdice Paiva ... 12/08 12:44 → ainda rescaldo: a live de hoje
--                                             só começa às 20h
--   · compras a partir de 12/08 20:00 ....... 0 (a live ainda não rodou)
--
-- Ou seja: NENHUM card existente muda de canal. Os dois de hoje ficam onde estão,
-- em "HT30 - 11-08", que é a verdade — nenhuma live de hoje tinha ido ao ar
-- quando eles compraram.
--
-- A REGRA GERAL que fica: o corte é o HORÁRIO DA LIVE que abre a edição, não uma
-- convenção fixa. Meio-dia funcionou nas anteriores por serem retroativas.
--
-- Idempotente: roda de novo sem efeito.

-- ---------------------------------------------------------------------------
-- 1) A janela da 3ª edição (11/08) fecha às 20:00 de hoje
-- ---------------------------------------------------------------------------
update cs.hm_origem_por_oferta
   set vale_ate = '2026-08-12 20:00:00-03',
       nota = 'Live do HT de 11/08/2026 (3a edicao do pitch da entrada R$697). '
              'Mesma oferta das lives anteriores na Hotmart: o que separa os canais e a janela de compra. '
              'Vale ate 12/08 20:00 BRT (0204): a partir do inicio da live de 12/08 a oferta pertence a ela. '
              'Cobre o rescaldo do dia 12 ate as 20h (Diego 02:37, Gustavo 12:44).'
 where oferta_codigo = 'rlgjsrul'
   and origem = 'HT30 - 11-08';

-- ---------------------------------------------------------------------------
-- 2) A 4ª edição — a oferta a partir do início da live de hoje
-- ---------------------------------------------------------------------------
insert into cs.hm_origem_por_oferta (oferta_codigo, origem, nota, produto, vale_de, vale_ate)
values ('rlgjsrul', 'HT30 - 12-08',
        'Live do HT de 12/08/2026, 20h (4a edicao do pitch da entrada R$697). Mesma oferta das tres '
        'lives anteriores: o que separa os canais e a janela de compra. Corte as 20:00 (e nao ao meio-dia '
        'como a 0167/0179) por instrucao do Marcio: so compra a partir das 20h vale como 12-08, porque '
        'esta migration foi aplicada ANTES da live. Sem fim ate a proxima edicao fechar a janela.',
        'HM', '2026-08-12 20:00:00-03', null)
on conflict (oferta_codigo, coalesce(vale_de, '-infinity'::timestamptz)) do update
  set origem  = excluded.origem,
      nota    = excluded.nota,
      produto = excluded.produto,
      vale_ate = excluded.vale_ate;

-- ---------------------------------------------------------------------------
-- 3) Conferência (sai no log da aplicação)
-- ---------------------------------------------------------------------------
do $$
declare v_linhas int; v_apos int; v_antes int;
begin
  select count(*) into v_linhas from cs.hm_origem_por_oferta where oferta_codigo = 'rlgjsrul';
  select count(*) into v_apos   from public.compras
   where oferta_codigo = 'rlgjsrul'
     and status in ('APPROVED','COMPLETE','COMPLETED')
     and coalesce(data_compra, data_aprovacao) >= '2026-08-12 20:00:00-03';
  -- as duas de hoje que NÃO podem mudar de canal
  select count(*) into v_antes from public.compras
   where oferta_codigo = 'rlgjsrul'
     and status in ('APPROVED','COMPLETE','COMPLETED')
     and coalesce(data_compra, data_aprovacao) >= '2026-08-12 00:00:00-03'
     and coalesce(data_compra, data_aprovacao) <  '2026-08-12 20:00:00-03';
  raise notice '0204: % janelas na oferta rlgjsrul; % compras na janela de 12-08; % compras de hoje seguem em 11-08',
               v_linhas, v_apos, v_antes;
  if v_linhas <> 4 then
    raise exception '0204: esperava 4 janelas (09-08, 10-08, 11-08, 12-08), achei %', v_linhas;
  end if;
end $$;
