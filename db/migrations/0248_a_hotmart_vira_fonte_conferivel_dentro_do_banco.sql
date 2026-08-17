-- 0248_a_hotmart_vira_fonte_conferivel_dentro_do_banco.sql
--
-- Durante toda a auditoria do HM (0240–0247) a fonte independente — os exports
-- `sales_history` da Hotmart — viveu como CSV na pasta Downloads de uma máquina só. Isso tem
-- dois defeitos que já cobraram preço:
--
--   1. **Ninguém além de quem tem o arquivo consegue refazer a conferência.** O número vai
--      para a diretoria e não há como reabrir a conta depois.
--   2. **Export tem data de validade** e isso não fica registrado em lugar nenhum. O export
--      de 14/08 21:37 acusou duas mulheres de não ter pago boletos que foram quitados em
--      15/08. A lente estava certa; o arquivo é que já era velho. Sem carimbar QUANDO o
--      retrato foi tirado, todo alarme falso desse tipo se repete.
--
-- Esta migration cria a tabela onde o retrato da Hotmart passa a morar, com o carimbo da
-- data do export. É tabela de CONFERÊNCIA, não de operação: nada no sistema cobra ninguém
-- a partir dela. Ela existe para responder "de onde veio esse número" sem depender de
-- arquivo em Downloads.
--
-- O grão é PESSOA × PRODUTO × CICLO. Não é PESSOA × PRODUTO, e a diferença custou uma
-- conclusão errada de R$ 1,67 milhão: medindo por pessoa, 91 alunos do AURUM apareciam
-- "pagando a mais". Eles não pagaram a mais — renovaram. Quem cursa A7 em 2024 e renova em
-- 2026 paga DOIS pacotes, e a soma dos dois nunca cabe em um. É a mesma lição do HM vista
-- pelo avesso: lá, crédito de ciclo anterior estava sendo contado como pagamento deste.
--
-- As TRÊS medidas de valor ficam separadas porque a Hotmart devolve três números por
-- transação e confundi-los gera erro de milhão:
--   bruto    = o que o CARTÃO do comprador foi debitado, com a taxa de parcelamento
--   contrato = o valor NEGOCIADO — o único que fecha contra o pacote ("R$ 5.000 de R$ 25.000")
--   líquido  = o que a empresa RECEBE
-- Junia Camarinha, sinal do A7: bruto 6.352,44 · contrato 5.000,00 · líquido 4.799,00.
-- Medir pacote pelo bruto fazia 45 pessoas parecerem estar pagando a mais só por parcelar.
create table if not exists cs.hotmart_pessoa (
  id                bigserial primary key,
  produto           text not null,
  ciclo             text,
  email             text not null,
  nome_hotmart      text,
  documento         text,
  n_transacoes      int  not null default 0,
  total_contrato    numeric(14,2) not null default 0,
  total_bruto       numeric(14,2),
  total_liquido     numeric(14,2),
  primeiro_pago_em  date,
  ultimo_pago_em    date,
  -- lidos do NOME da oferta, que é onde a operação escreveu o contrato:
  --   'Aurum 2025.02 - Sinal (R$ 4.700 de R$ 47.000)' -> pacote 47.000
  --   'Aurum - A7 - Saldo (R$ 20.000)'                -> saldo  20.000
  -- É leitura de texto livre, então vale como INDÍCIO forte, nunca como verdade contratual.
  pacote_declarado  numeric(14,2),
  saldo_declarado   numeric(14,2),
  ofertas           text,
  -- quando o RETRATO foi tirado na Hotmart (não quando foi importado aqui)
  export_em         timestamptz not null,
  importado_em      timestamptz not null default now(),
  unique (produto, ciclo, email, export_em)
);

-- reaplicação sobre base que já tinha a versão sem ciclo/medidas separadas
alter table cs.hotmart_pessoa add column if not exists ciclo          text;
alter table cs.hotmart_pessoa add column if not exists total_contrato numeric(14,2) not null default 0;
alter table cs.hotmart_pessoa add column if not exists total_bruto    numeric(14,2);
alter table cs.hotmart_pessoa add column if not exists total_liquido  numeric(14,2);
alter table cs.hotmart_pessoa drop column if exists total_pago;

comment on table cs.hotmart_pessoa is
  '0248: retrato da Hotmart por pessoa x produto, importado dos exports sales_history. Fonte de CONFERENCIA independente do razao (cs.hm_pagamentos) e do banco (public.compras) — nenhuma cobranca sai daqui. export_em carimba QUANDO o retrato foi tirado: sem isso, pagamento feito depois do export vira falso positivo de auditoria (aconteceu em 15/08/2026).';
comment on column cs.hotmart_pessoa.pacote_declarado is
  'Valor do pacote lido do nome da oferta ("... de R$ 47.000"). Indicio, nao contrato.';
comment on column cs.hotmart_pessoa.export_em is
  'Data/hora do export na Hotmart. Auditoria contra retrato mais velho que o fato acusa o banco errado.';

create unique index if not exists hotmart_pessoa_chave_idx
  on cs.hotmart_pessoa (produto, coalesce(ciclo,''), lower(email), export_em);
create index if not exists hotmart_pessoa_email_idx   on cs.hotmart_pessoa (lower(email));
create index if not exists hotmart_pessoa_produto_idx on cs.hotmart_pessoa (produto, export_em desc);

-- A visão sempre devolve o retrato MAIS RECENTE de cada pessoa x produto x ciclo. Quem
-- consultar isto nunca pega um export velho por engano.
create or replace view cs.vw_hotmart_pessoa_atual as
select distinct on (produto, coalesce(ciclo,''), lower(email)) *
  from cs.hotmart_pessoa
 order by produto, coalesce(ciclo,''), lower(email), export_em desc;

comment on view cs.vw_hotmart_pessoa_atual is
  '0248: o retrato mais recente de cada pessoa x produto x ciclo em cs.hotmart_pessoa.';
