-- 0253_por_que_nao_e_15_mil_tem_que_estar_escrito.sql
--
-- Pedido do João, literal: *"Com base nessas configurações que a gente fez, a situação deles
-- e tal, o valor que ele paga, porque não é 15 mil. Isso precisa tá mapeado."*
--
-- MEDIDO em 16/08/2026 sobre as 242 pessoas que pagaram a entrada do programa:
--
--   **45 pessoas pagam menos de R$ 15.000 e a tela não explica R$ 75.952,09 do abatimento.**
--
-- A conta que deveria fechar — `crédito do ciclo anterior + pacote = 15.000` — não fecha,
-- por três motivos diferentes:
--
--   B) 40 pessoas · R$ 39.941,18 — o pacote está CONGELADO na oferta de saldo, e o crédito
--      exibido continua sendo recalculado com `CURRENT_DATE`. Os dois lados da conta estão
--      em datas diferentes, então a diferença cresce todo dia. Exemplo: Jessica Bronze tem
--      crédito exibido de R$ 4.315,07 e pacote de R$ 9.082,19 — somam R$ 13.397,26, e
--      faltam R$ 1.602,74 que são exatamente o crédito consumido desde que a oferta foi
--      montada. Ver [[O saldo de quem tem crédito muda todo dia]].
--
--   C) 3 pessoas · R$ 24.352,08 — não têm crédito nenhum e mesmo assim o pacote é menor:
--      Quelen Soper paga R$ 2.375,24 e Acácia Branca R$ 5.200. É **desconto negociado**,
--      não crédito. A tela não tinha onde dizer isso.
--
--   A) 2 pessoas · R$ 11.658,83 — têm `credito_base_paga` preenchido (Pedro Henrique pagou
--      R$ 12.000 em 30/04) e o abatimento foi aplicado no pacote, mas a coluna
--      `credito_ciclo_anterior` mostra **zero**. O desconto existe e a explicação sumiu.
--      Pedro aparece "quitado" tendo pago R$ 1.329 de um pacote de R$ 5.268,49, e nada na
--      tela diz por quê.
--
-- Nenhum dos três é dinheiro errado: o pacote cobrado está certo em todos. O que está errado
-- é a tela **afirmar um desconto e não conseguir explicá-lo** — e é justamente a pergunta que
-- a diretoria faz primeiro.
--
-- A CORREÇÃO é fechar a identidade por construção, com o abatimento saindo da subtração e
-- não de uma segunda fórmula:
--
--     pacote_base − pacote_efetivo = abatimento_total          (sempre fecha)
--     abatimento_total − crédito estimado = abatimento negociado
--
-- `abatimento_total` é a verdade contratual: é o desconto que a pessoa REALMENTE recebeu,
-- congelado junto com a oferta. `credito_ciclo_anterior` continua sendo o pró-rata de hoje —
-- útil para quem ainda NÃO recebeu oferta, e por isso fica, mas deixa de ser a explicação.
--
-- A formatação de moeda em português, que `to_char` sozinho não entrega.
create or replace function cs.fn_brl(p numeric)
returns text language sql immutable as $$
  select case when p is null then null else
    'R$ ' || translate(to_char(p, 'FM999G999G999D00'), '.,', ',.')
  end;
$$;

comment on function cs.fn_brl(numeric) is
  '0253: formata numero como moeda brasileira. to_char sozinho usa o lc_numeric do servidor (en_US) e devolve "R$ 2,375.24".';

-- ⚠️ Duas coisas que esta migration errou na primeira aplicação e que já estão corrigidas
-- aqui (a correção rodou como 0253b na base):
--   · `to_char(x,'FM999G999D00')` usa o lc_numeric do servidor, que é en_US, e a frase saía
--     "R$ 2,375.24". Número em português é obrigação, não estilo: um brasileiro lendo
--     "R$ 2,375.24" não sabe se são dois mil ou dois e pouco, e a dúvida sozinha já derruba
--     a confiança no relatório. Agora usa `cs.fn_brl`.
--   · `entrada_qualquer_ofertas` separa os códigos por ESPAÇO, não por ';'. Quem pagou as
--     duas entradas ("rlgjsrul z391kxd9" — os mesmos casos da 0247) virava um código só e
--     ficava sem pacote base. Passa a quebrar por qualquer não-alfanumérico.
--   · **a frase decompunha o abatimento em "crédito + resto", e essa conta não existe.**
--     Medido: 27 pessoas têm exatamente o mesmo abatimento de R$ 1.927,32 (pacote de
--     R$ 13.072,68 para todas) e crédito registrado de R$ 0,00 a R$ 1.795,91. Se o
--     abatimento é idêntico e o crédito é diferente, o crédito não é a causa: R$ 1.927,32 é
--     o preço da oferta de saldo padrão (R$ 12.772,68 + R$ 300 contra os R$ 15.000 cheios).
--     Quando o crédito EXPLICA, ele bate exato — 14 pessoas com abatimento de R$ 1.040,32
--     têm crédito de R$ 1.040,32. Agora o crédito só é dado como explicação quando o número
--     fecha (`credito_explica_o_abatimento`); quando não fecha, a frase diz que o abatimento
--     veio da oferta e menciona o crédito sem fingir saber quanto dele entrou.
--     Inventar decomposição é pior que não explicar: quem lê "R$ 887,00 abatidos na oferta"
--     assume que alguém decidiu esses R$ 887,00 e vai procurar essa decisão em ata.
--
-- Camada aditiva sobre a definição vigente: lê `pg_get_viewdef`, desembrulha uma camada
-- anterior desta mesma migration se houver, e recola. `create or replace view` aceita colunas
-- novas NO FIM, então nenhum consumidor existente quebra — inclusive a Central, que lê esta
-- view pela camada da 0246.
do $$
declare v_def text; v_miolo text;
begin
  select rtrim(btrim(pg_get_viewdef('cs.vw_hm_carteira'::regclass, true)), ';') into v_def;

  if position('explicacao_do_valor' in v_def) > 0 then
    v_miolo := cs.fn_desembrulha_camada_0250(v_def);
    if v_miolo is null or position('pacote_efetivo' in v_miolo) = 0
       or position('explicacao_do_valor' in v_miolo) > 0 then
      raise exception '0253: nao consegui desembrulhar a camada anterior com seguranca — nada foi alterado.';
    end if;
    v_def := v_miolo;
    raise notice '0253: camada anterior removida; recolando.';
  end if;

  if position('entrada_qualquer_ofertas' in v_def) = 0 then
    raise exception '0253: cs.vw_hm_carteira nao expoe entrada_qualquer_ofertas — sem ela nao da para achar o pacote base.';
  end if;

  execute format($sql$
create or replace view cs.vw_hm_carteira as
select b.*,
       pb.pacote_base,
       -- o abatimento que de fato aconteceu, por subtração — não por uma segunda fórmula
       case when pb.pacote_base is not null and b.pacote_efetivo is not null
            then round(pb.pacote_base - b.pacote_efetivo, 2) end as abatimento_total,
       case when pb.pacote_base is not null and b.pacote_efetivo is not null
            then round(pb.pacote_base - b.pacote_efetivo
                       - coalesce(b.credito_ciclo_anterior, 0), 2) end as abatimento_negociado,
       case
         when pb.pacote_base is null or b.pacote_efetivo is null then
           'Pacote ainda não definido para esta pessoa.'
         when pb.pacote_base - b.pacote_efetivo <= 1 then
           'Paga o pacote cheio de ' || cs.fn_brl(pb.pacote_base) || '.'
         -- o crédito só vale como explicação quando o número FECHA com o abatimento
         when abs(pb.pacote_base - b.pacote_efetivo - coalesce(b.credito_ciclo_anterior,0)) <= 1 then
           'Paga ' || cs.fn_brl(b.pacote_efetivo) || ' em vez de ' || cs.fn_brl(pb.pacote_base)
           || ': ' || cs.fn_brl(b.credito_ciclo_anterior)
           || ' de crédito do que já tinha pago no ciclo anterior.'
         when coalesce(b.credito_ciclo_anterior, 0) > 1 then
           'Paga ' || cs.fn_brl(b.pacote_efetivo) || ' em vez de ' || cs.fn_brl(pb.pacote_base)
           || ': ' || cs.fn_brl(pb.pacote_base - b.pacote_efetivo)
           || ' de abatimento, definido pela oferta que foi enviada a ela. Há '
           || cs.fn_brl(b.credito_ciclo_anterior)
           || ' de crédito do ciclo anterior registrado, que provavelmente já está embutido '
           || 'nesse valor — o sistema não sabe separar as duas partes.'
         else
           'Paga ' || cs.fn_brl(b.pacote_efetivo) || ' em vez de ' || cs.fn_brl(pb.pacote_base)
           || ': ' || cs.fn_brl(pb.pacote_base - b.pacote_efetivo)
           || ' de abatimento, definido pela oferta que foi enviada a ela.'
       end as explicacao_do_valor,
       case when pb.pacote_base is not null and b.pacote_efetivo is not null
            then abs(pb.pacote_base - b.pacote_efetivo
                     - coalesce(b.credito_ciclo_anterior, 0)) <= 1 end as credito_explica_o_abatimento
  from ( %s ) b
  left join lateral (
    select max(cat.pacote_cheio) as pacote_base
      from public.hm_product_catalog cat
     where cat.entrada_do_programa
       and cat.offer_code = any (regexp_split_to_array(lower(coalesce(b.entrada_qualquer_ofertas, b.sinal_ofertas, '')), '[^a-z0-9]+'))
  ) pb on true
  $sql$, v_def);

  raise notice '0253: cs.vw_hm_carteira ganha pacote_base, abatimento_total, abatimento_negociado e explicacao_do_valor.';
end $$;

comment on column cs.vw_hm_carteira.abatimento_total is
  '0253: pacote_base - pacote_efetivo. E o desconto que a pessoa REALMENTE recebeu, congelado junto com a oferta. Fecha por construcao; use este, nao credito_ciclo_anterior, para explicar por que o valor nao e R$ 15.000.';
comment on column cs.vw_hm_carteira.abatimento_negociado is
  '0253: a parte do abatimento que NAO e explicada pelo credito pro-rata de hoje. Vale como desconto comercial ou como credito ja consumido desde que a oferta foi montada.';
comment on column cs.vw_hm_carteira.explicacao_do_valor is
  '0253: a frase pronta que responde "por que nao e 15 mil". 45 das 242 pessoas pagam menos que o pacote cheio e a tela nao explicava R$ 75.952,09 desse abatimento.';

comment on column cs.vw_hm_carteira.credito_explica_o_abatimento is
  '0253: true quando o credito do ciclo anterior bate EXATAMENTE com o abatimento. Quando e false, o abatimento veio da oferta enviada e o credito registrado nao explica. Medido em 16/08/2026: 197 pessoas true, 45 false.';
