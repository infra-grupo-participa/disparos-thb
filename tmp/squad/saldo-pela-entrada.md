# Tarefa: o saldo do HM tem que sair da ENTRADA que a pessoa pagou

## O pedido do Marcio (10/08/2026, ~21h)

> "O saldo tem que se adaptar conforme o pagamento do sinal que o cara deu. O primeiro
> pagamento dele sinaliza a forma como vai ser acordado. A oferta pode mudar: na semana
> passada era 300, essa semana já é 697. A gente precisa dessa inteligência — a primeira
> compra dele é o sinal, e o saldo tem que ser 14.303, não 14.700. Preciso que o sistema
> se adapte a isso."

Ou seja: **a primeira compra de entrada (categoria `sinal`) define o acordo.** Pacote e saldo
saem dela, e não de constante escrita no código. Quando a próxima oferta for R$497, ninguém
deve precisar de migration nova.

## Contexto medido no banco (10/08 21h, projeto `mbvybujpkwuorhtdzcde`, schema `cs`)

### Como está hoje — `cs.vw_hm_financeiro` (última alteração: 0166)

Três ramos, com números **fossilizados no SQL**:

```sql
pacote_regra =
  CASE WHEN produto='AURUM'        THEN (select valor from cs.aurum_parametros where chave='pacote_cheio')
       WHEN entrada_697 > 0        THEN 15000            -- 0166, cravado na oferta rlgjsrul
       WHEN publico='lead_novo'    THEN 15000
       WHEN credito_hoje IS NOT NULL THEN 15000 - credito_hoje
       ELSE NULL END

saldo_regra =
  CASE WHEN produto='AURUM'        THEN pacote_cheio - entrada (parâmetros do Aurum)
       WHEN entrada_697 > 0        THEN 15000 - entrada_697    -- 0166
       WHEN publico='lead_novo'    THEN 14700                  -- <<< 15000-300 CRAVADO
       WHEN credito_hoje IS NOT NULL THEN 14700 - credito_hoje -- <<< idem
       ELSE NULL END
```

`entrada_697` é literalmente `sum(valor) where oferta_codigo='rlgjsrul'`. Uma oferta nova
significa mais um `WHEN` e mais uma migration — é exatamente o que o Marcio não quer.

O `14700` também é a resposta errada para quem entrou por outra porta: quem pagou sinal de
R$2.000 (`nz3ob9r2`, 9 cards) deveria dever 13.000, e hoje cai no ramo do 14.700 ou no do
pró-rata.

### As ofertas de ENTRADA que já existem (compras aprovadas)

| oferta | categoria | valor | vendas | período |
|---|---|---|---|---|
| `z391kxd9` | sinal | R$ 300 | 185 | 25/06 → 02/08 |
| `rlgjsrul` | sinal | R$ 697 | 21 | 09/08 → 10/08 (as duas lives do HT) |
| `nz3ob9r2` | sinal | R$ 2.000 | 11 | 18/04 → 17/06 |
| `6qxsk9kq` | sinal | R$ 2.497 | 4 | 23/06 → 03/08 | **exceção**: é ACESSO até Dez/2026, não o programa. Quitado nesse valor, não deve saldo. |
| `qm4lu7py` | sinal | R$ 1.000 | 34 | 05/08 → 07/08 | é do **AURUM**, tem parâmetros próprios (`cs.aurum_parametros`) |

Também há `compra_cheia` (12k/13k/15k, quem paga tudo de uma vez) e `reserva` (~2k, downsell).

### Distribuição atual dos 265 cards por PRIMEIRA entrada

| entrada | cards | saldo hoje (min–max) |
|---|---|---|
| `z391kxd9` R$300 | 184 | 0 – 14.700 |
| `rlgjsrul` R$697 | 21 | 14.303 |
| (sem sinal) | 13 | 12.447 – 15.000 |
| `nz3ob9r2` R$2.000 | 9 | 0 – 6.619 |
| `6qxsk9kq` R$2.497 | 3 | 0 |
| `qm4lu7py` R$1.000 | 1 | null |

### Situação dos cards

| situação | cards |
|---|---|
| saldo_parado | 133 |
| quitado | 47 |
| incalculavel | 30 (todos `aluno_base` sem crédito pró-rata calculado) |
| mensalidade_em_curso | 35 |
| cancelado | 14 |
| oferta_enviada | 7 |

`pacote_cravado` (`cs.contatos_hm.valor_total`) é o override manual e **precede a regra** —
83 cards têm valor cravado. Isso não pode ser quebrado.

## Restrições que NÃO podem ser violadas

1. **Produção viva.** A live do HT está convertendo agora; vendas caem a cada minuto pelo
   webhook da Hotmart. Nada de janela de indisponibilidade.
2. **Ninguém pode mudar de valor em silêncio.** Antes de aplicar, CONTAR quantos cards mudam
   de `saldo_a_perseguir` e por quê. Card que muda de valor sem explicação é dinheiro cobrado
   errado do aluno. Ver `[[feedback-migration-backfill-reclassifica]]`.
3. `valor_total` cravado continua ganhando da regra.
4. O Aurum tem parâmetros próprios (`cs.aurum_parametros`) — não misturar.
5. `6qxsk9kq` (acesso R$2.497) não é entrada do programa: quitado, sem saldo.
6. A view é lida pelo board, pela tabela, pelos exports e pelo dashboard. Mudança de
   cardinalidade ou de nome de coluna quebra tudo — **hoje mesmo isso já derrubou o board
   duas vezes** (ver 0168 e 0171).
7. Migration nova = número livre a partir de **0174**.

## Como testar (obrigatório, foi o que achou os bugs de hoje)

`build`/`lint`/`typecheck` NÃO enxergam regra de banco. O teste que vale é venda de verdade
em transação revertida:

```sql
do $$
declare v uuid; r text; ...
begin
  insert into public.compradores (...) returning id into v;
  insert into public.compras (... oferta_codigo, status 'APPROVED' ...);
  -- ler card, tags, cs.vw_hm_financeiro
  r := format(...);
  raise exception '%', r;   -- reverte tudo e devolve o relatório
end $$;
```

Confirmar resíduo zero depois (contagem de `cs.contatos_hm` antes/depois — hoje: 265).

## Registro da squad

### Arquiteto (10/08/2026, ~23h)

> ⚠️ **Nota de método.** Este subagente NÃO teve acesso ao banco (o MCP Supabase não está
> exposto aqui e não existe `.env.local` no repo — só `.env.local.example`). Tudo que está
> abaixo foi derivado (a) dos números já medidos no briefing e (b) da leitura das migrations
> 0044, 0046, 0049, 0056, 0075, 0114, 0116, 0122, 0157, 0158, 0163, 0166, 0167, 0168, 0169,
> 0171, 0172 e do código que lê a view. **As medições de impacto são tarefa do backend**, com
> as queries exatas prontas na seção 6. Nenhum número deste plano deve ser repetido ao Marcio
> como "medido" antes de o backend rodar a seção 6.

---

#### 1. O conceito

**A ENTRADA é o contrato.** A oferta pela qual a pessoa entrou declara duas coisas sobre o
acordo, e são fatos da OFERTA — não da pessoa, não do card, não do SQL:

| fato | pergunta que responde |
|---|---|
| `pacote_cheio` | quanto custa o programa completo para quem entra por esta porta |
| `entrada_condicao_fechada` | esse preço **já é a condição final**, ou ainda comporta desconto de pró-rata para aluno da base? |

O segundo campo é o que quase passou despercebido e é o coração da coisa. Hoje existem
**dois comportamentos diferentes** para duas portas, e ambos estão certos:

- `z391kxd9` (R$300) — preço de tabela. Aluno da base ainda ganha o crédito pró-rata por
  cima (`pacote = 15.000 − crédito`). 184 cards dependem disso.
- `rlgjsrul` (R$697) — **condição fechada**. A 0166 registra a decisão do Marcio em letra:
  *"os 697 já são a condição fechada, não há pró-rata por cima"*. Foi isso que tirou 5 alunos
  da base do limbo `incalculavel`.

Um modelo com **só** `pacote_cheio` colapsaria os dois. Se eu cadastrasse
`z391kxd9.pacote_cheio = 15000` e aplicasse a regra nova sem o segundo campo, os alunos da
base que entraram pelos R$300 **perderiam o desconto do pró-rata em silêncio** e passariam a
dever 15.000 em vez de 15.000 − crédito. Isso é dinheiro cobrado a mais de gente real. É
exatamente o padrão de [[feedback-migration-backfill-reclassifica]].

Consequência de desenho que vale escrever: **`pacote_cheio` sozinho não é o modelo. A porta
tem preço E tem natureza.**

---

#### 2. Onde mora o dado — decisão e o que descartei

**DECISÃO: duas colunas novas em `public.hm_product_catalog`.**

```
public.hm_product_catalog
  offer_code       (PK, já existe)
  categoria        (já existe)  -- sinal | compra_cheia | diferenca | renovacao
  concede_trilha   (já existe, 0114)
  pacote_cheio              numeric(12,2)  NULL              ← NOVO
  entrada_condicao_fechada  boolean NOT NULL DEFAULT false   ← NOVO
```

Regra de leitura: **é entrada do programa ⟺ `categoria = 'sinal' AND pacote_cheio IS NOT NULL`.**
Não existe um terceiro booleano `eh_entrada_do_programa`. A presença do preço *é* a
declaração. Dois campos que dizem a mesma coisa é convite a divergirem.

**Por que o catálogo e não outro lugar.** A 0157 e a 0171 provam que *toda* venda já é
obrigada a passar por `public.hm_product_catalog` — `fn_seed_contato_hm` faz
`if v_cat is null then return new` e a venda evapora. Cadastrar a oferta ali **já é um passo
obrigatório e não-esquecível**. Pendurar o preço no mesmo passo faz "cadastrar a oferta"
voltar a ser *uma* operação completa. É o oposto de criar mais um lugar para esquecer.

**Descartei — tabela nova `cs.hm_entradas`.** Seria um SEGUNDO registro de oferta. Os bugs
0114, 0156, 0157 e 0159 são todos a mesma família: *oferta cadastrada num lugar e não no
outro*. Uma terceira tabela multiplica esse modo de falha em vez de fechá-lo. Ganho zero:
preço de oferta não precisa de janela — quando o preço muda, a Hotmart emite **outro
`offer_code`** (é literalmente o que aconteceu de 300 → 697).

**Descartei — reusar `cs.hm_origem_por_oferta`.** Duas razões, uma conceitual e uma cicatriz.
Conceitual: aquela tabela responde *"de qual campanha veio"* (marketing); preço é contrato.
Cicatriz: a 0167 tirou a PK dela para dar duas janelas à `rlgjsrul`, e a 0168 registra o
resultado — `ERROR 21000: more than one row returned by a subquery` derrubando a view, o
board, a tabela e os relatórios. Colocar **dinheiro** numa tabela que hoje é multi-linha por
oferta é pedir o mesmo incidente com consequência pior.

**Descartei — reusar `cs.hm_ofertas_saldo`.** É o catálogo da SAÍDA (links de quitação com o
pró-rata já embutido, 0049). Natureza oposta.

**Descartei — reusar `concede_trilha` como "é entrada".** Tentador: `6qxsk9kq` já está com
`false` desde a 0114, e o comentário da coluna diz literalmente *"a oferta dá direito ao
programa de implementação"*. Mas as ofertas de `compra_cheia` também têm `concede_trilha =
true` e **não são entrada**. Sobrecarregar o flag faria "quem não recebe trilha imediata"
virar "quem não deve saldo" — um dia alguém troca a política de trilha e zera a cobrança de
um grupo sem perceber. Um flag, um significado.

**Descartei — tabela de parâmetros `cs.hm_parametros` para o 15.000 de fallback.** Chega a ser
elegante (espelharia `cs.aurum_parametros`), mas o fallback não é sobre ofertas novas — é
sobre os 13 cards antigos sem sinal. Criar tabela para deixar bonito é o oposto do critério
de otimização. O literal fica, com nome e comentário, em **um** ponto da view.

---

#### 3. Qual é "a entrada"

**DECISÃO: a primeira compra de entrada catalogada, do produto do card, dentro do ciclo do card.**
Ordem total, sem empate possível.

```
entrada := primeiro registro em cs.hm_pagamentos onde
             a oferta está em hm_product_catalog com categoria='sinal'
             e pacote_cheio IS NOT NULL
             e cs.fn_hm_pagamento_do_produto(oferta, ch.produto)      -- não cruza board
             e (ch.credito_compra_em IS NULL OR pago_em::date > ch.credito_compra_em)
           ordenado por pago_em ASC, oferta_codigo ASC, id ASC
           LIMIT 1
```

Justificativa de cada cláusula:

- **primeira, não última.** É o que o Marcio disse: *"o primeiro pagamento dele sinaliza a
  forma como vai ser acordado"*. Pela última, alguém que pagou 300 em julho, negociou, e
  compra qualquer coisa nova em agosto teria o acordo **reescrito por baixo** de uma
  negociação em andamento.
- **dentro do ciclo (`credito_compra_em`).** Não é preferência, é aritmética: o número que a
  operação persegue é `pacote_regra − pago_no_ciclo`, e `pago_no_ciclo` **já** filtra por
  `credito_compra_em`. Se a entrada viesse de fora dessa janela, estaríamos subtraindo
  pagamentos do ciclo B de um pacote do ciclo A. É esse filtro que responde à pergunta
  "sinal de 300 em julho e 697 agora": se houve renovação/crédito no meio, o ciclo corta; se
  não houve, vale a primeira, que é o contrato original.
- **`fn_hm_pagamento_do_produto`.** O `entrada_697` da 0166 é um `sum(valor) where
  oferta_codigo='rlgjsrul'` **cru, sem filtro de produto**. Desde a 0163 a mesma pessoa tem
  card em HM e AURUM; a 0172 documenta exatamente esse cruzamento indo para o card errado.
  Sem este filtro, um card do AURUM herdaria o pacote de uma entrada do HM.
- **ordem total (`pago_em, oferta_codigo, id`).** Lição direta da 0168/0169: `LIMIT 1` sem
  desempate não levanta erro — escolhe uma linha ao acaso, e o bug aparece semanas depois.
- **fonte = `cs.hm_pagamentos`, não `public.compras`.** É o razão, é de onde saem
  `pago_no_ciclo`, `parcelas_pagas` e `ultimo_pagamento_em`. Pacote e pago precisam vir do
  mesmo livro. Degradação segura: se a compra existe mas o pagamento não foi lançado (o
  buraco da 0157), `entrada` vem NULL e o card cai no ramo antigo — ou seja, **exatamente o
  comportamento de hoje**; e o alerta `oferta_orfa` do health check já grita nesse caso.

---

#### 4. Os três casos especiais

**`6qxsk9kq` (R$2.497, acesso ETHB até Dez/2026, 3 cards).**
`pacote_cheio = NULL`, explicitamente, com comentário. Categoria continua `'sinal'` (mexer
nisso desviaria o ramo dedicado de `fn_seed_contato_hm`, que roteia essa oferta direto para
"Pendente de Liberação"). Com `pacote_cheio` nulo ela **não é porta de entrada do programa**,
não entra na régua, e os 3 cards seguem no caminho de hoje (quitados, saldo 0). Coerente com
`concede_trilha = false` que a 0114 já lhe deu — mas por um campo próprio, não por carona.

**AURUM (`qm4lu7py`, R$1.000).**
`pacote_cheio = NULL`. O ramo `produto = 'AURUM'` continua **primeiro** no CASE e intocado,
lendo `cs.aurum_parametros`. Além disso o filtro por produto (seção 3) garante que um card HM
não pesque a entrada do Aurum e vice-versa — hoje o `entrada_697` não tinha essa garantia.

> Deferido de propósito: dava para unificar (`qm4lu7py.pacote_cheio = 60000`,
> `entrada_condicao_fechada = true`) e **apagar o ramo AURUM inteiro** da view — uma regra em
> vez de duas. Não faço agora porque `cs.aurum_parametros` é lido também por
> `lib/services/hm-ficha.ts:75` e pela view do overlay da 0158; mexer no board do Aurum
> durante a live do HT é risco sem urgência. Fica como **0175**, com o caminho já aberto pelas
> colunas novas.

**Os 30 `incalculavel` (aluno da base sem crédito pró-rata).**
Continuam `incalculavel`. A condição só troca de forma, não de resultado:
`entrada_697 = 0` vira `NOT entrada_fechada`. Com `z391kxd9` cadastrada como **aberta**, os 30
seguem esperando o crédito do analista e o card segue dizendo "saldo a definir" (0165) — que é
o comportamento correto: não sabemos, e afirmar 14.700 seria cobrar errado.

> O botão que muda a vida deles existe e está documentado: virar
> `z391kxd9.entrada_condicao_fechada = true` tira os 30 do limbo **e** repreça os outros 184.
> É um `UPDATE` de uma linha com efeito em 214 pessoas. Por isso é **BLOQUEIO B2**, e por isso
> a seção 6 entrega o instrumento de medir *antes* de flipar.

---

#### 5. A propriedade central deste desenho: ele nasce NEUTRO

Com a semente proposta —

| oferta | `pacote_cheio` | `entrada_condicao_fechada` | efeito |
|---|---|---|---|
| `z391kxd9` R$300 | 15000 | **false** | lead novo → 15.000 (igual). aluno base → 15.000 − crédito (igual). sem crédito → `incalculavel` (igual) |
| `rlgjsrul` R$697 | 15000 | **true** | 15.000, sem pró-rata por cima → saldo 14.303 (igual à 0166) |
| `nz3ob9r2` R$2.000 | **NULL** | false | cai no ramo antigo → **igual a hoje** (ver B1) |
| `6qxsk9kq` R$2.497 | NULL | false | não é entrada → igual a hoje |
| `qm4lu7py` R$1.000 | NULL | false | ramo AURUM, intocado |

— **a expectativa é ZERO card mudando de `pacote_regra`, de `saldo_a_perseguir` e de
`situacao`.** A 0174 é um refactor puro que troca constante por dado, mais uma capacidade
nova. A mudança de comportamento de qualquer grupo passa a ser um `UPDATE` explícito,
auditável, decidido pelo Marcio, **um por vez**.

Isso não é conveniência — é o que satisfaz a restrição 2 ("ninguém muda de valor em silêncio")
**por construção**, e não por vigilância.

**Se a medição da seção 6.1 der diferente de zero, a 0174 não vai para produção.** Significa
que alguma equivalência acima está errada e precisa ser entendida antes, não depois.

**Uma observação que muda a leitura de tudo:** rastreei os consumidores da view. O número que
a operação persegue é

```
saldo_a_perseguir = coalesce(saldo_cravado, greatest(pacote_regra − pago_no_ciclo, 0))
```

— ou seja, **quem manda no dinheiro é `pacote_regra`**. As colunas `saldo_regra` e
`divergencia_regra` **não são lidas por nenhuma linha de TS/TSX do repo** (conferido em
`lib/` e `app/`; o export financeiro recalcula a divergência ele mesmo, em
`lib/export/hm-financeiro-xlsx.ts:338`). Portanto:

1. o `14700` de `saldo_regra` **nunca cobrou ninguém** — é decoração;
2. a análise de impacto pode e deve se concentrar em `pacote_regra` e `saldo_a_perseguir`;
3. as duas colunas ficam na view (compatibilidade), **generalizadas**, marcadas como
   deprecadas em comentário. Remoção só depois de varredura de consumidores — a 0167 ensinou
   que trocar a forma de algo sem listar os consumidores é parte da migration, não da revisão.

---

#### 6. Migration 0174 — pronta para o backend

Ordem obrigatória: **6.0 medir → 6.1 ensaio revertido → conferir → 6.2 aplicar de verdade.**

##### 6.0 — Medições PRÉVIAS (só leitura; nenhuma escrita)

Rodar e colar os resultados na seção "Backend" antes de escrever qualquer coisa.

```sql
-- Q1. Reconciliar o total. O briefing lista 231 cards por primeira entrada, mas
-- cs.contatos_hm tem 265. Os 34 restantes precisam de nome antes de a régua mudar.
select ch.produto,
       (select cat.categoria from public.hm_product_catalog cat
         where cat.offer_code = (select p.oferta_codigo from cs.hm_pagamentos p
                                  where p.comprador_id = ch.comprador_id
                                  order by p.pago_em, p.oferta_codigo, p.id limit 1)) as cat_primeira,
       count(*)
  from cs.contatos_hm ch
 group by 1,2 order by 3 desc;

-- Q2. RECOMPRA: quem tem mais de uma oferta de entrada. É o caso que define se
-- "primeira" é a resposta certa. Se vier vazio, a pergunta é teórica hoje.
select ch.id, cp.nome, cp.email, ch.produto, ch.credito_compra_em,
       array_agg(distinct p.oferta_codigo order by p.oferta_codigo) as ofertas,
       min(p.pago_em) as primeira, max(p.pago_em) as ultima
  from cs.contatos_hm ch
  join public.compradores cp on cp.id = ch.comprador_id
  join cs.hm_pagamentos p on p.comprador_id = ch.comprador_id
  join public.hm_product_catalog cat on cat.offer_code = p.oferta_codigo and cat.categoria = 'sinal'
 group by ch.id, cp.nome, cp.email, ch.produto, ch.credito_compra_em
having count(distinct p.oferta_codigo) > 1;

-- Q3. Quantos cards a régua nem toca (valor_total cravado ganha sempre).
select count(*) filter (where ch.valor_total is not null) as cravados,
       count(*) filter (where ch.valor_total is null)     as pela_regua,
       count(*) as total
  from cs.contatos_hm ch;

-- Q4. Os 9 do nz3ob9r2 — é aqui que mora o BLOQUEIO B1.
select ch.id, cp.nome, ch.produto, f.publico, ch.valor_total as cravado,
       f.pacote_regra, f.pago, f.pago_no_ciclo, f.saldo_a_perseguir, f.situacao,
       ch.quitado_em, ch.cancelamento_efetivado_em, ch.credito_compra_em, ch.credito_valor_pago
  from cs.contatos_hm ch
  join public.compradores cp on cp.id = ch.comprador_id
  join cs.vw_hm_financeiro f on f.contato_hm_id = ch.id
 where exists (select 1 from cs.hm_pagamentos p
                where p.comprador_id = ch.comprador_id and p.oferta_codigo = 'nz3ob9r2')
 order by f.saldo_a_perseguir desc nulls last;

-- Q5. Estado atual das 5 ofertas de entrada no catálogo (confirmar concede_trilha
-- e produto de qm4lu7py antes de decidir o filtro do health check).
select cat.offer_code, cat.categoria, cat.concede_trilha, cat.notes,
       coalesce((select o.produto from cs.hm_origem_por_oferta o
                  where o.oferta_codigo = cat.offer_code
                  order by o.vale_de desc nulls last limit 1), 'HM') as produto
  from public.hm_product_catalog cat
 where cat.offer_code in ('z391kxd9','rlgjsrul','nz3ob9r2','6qxsk9kq','qm4lu7py');

-- Q6. Índice: confirmar que existe suporte para os subqueries por comprador.
select indexname, indexdef from pg_indexes
 where (schemaname='cs' and tablename='hm_pagamentos')
    or (schemaname='public' and tablename='compras');
```

##### 6.1 — ENSAIO em transação revertida (o teste que vale)

Roda tudo — DDL, seed, view, snapshot, diff — e **derruba no final**. Nada fica.

```sql
do $$
declare
  v_dif int; v_pac int; v_sit int; v_delta numeric;
  v_antes int; v_depois int; v_cards int;
  r record; v_rel text := '';
begin
  select count(*) into v_antes from cs.vw_hm_financeiro;

  -- (1) fotografia ANTES
  create temp table marco_pre on commit drop as
    select f.contato_hm_id, f.pacote_regra, f.saldo_a_perseguir, f.situacao
      from cs.vw_hm_financeiro f;

  -- (2) aplicar: colar aqui, via EXECUTE $sql$ ... $sql$, o conteúdo INTEIRO dos
  --     blocos A, B e D da seção 6.2 (o bloco C não é necessário no ensaio: a
  --     temp table acima faz o papel do marco).

  -- (3) diferença
  select count(*) filter (where m.saldo_a_perseguir is distinct from f.saldo_a_perseguir),
         count(*) filter (where m.pacote_regra      is distinct from f.pacote_regra),
         count(*) filter (where m.situacao          is distinct from f.situacao),
         round(coalesce(sum(coalesce(f.saldo_a_perseguir,0) - coalesce(m.saldo_a_perseguir,0)),0),2),
         count(*)
    into v_dif, v_pac, v_sit, v_delta, v_cards
    from marco_pre m join cs.vw_hm_financeiro f on f.contato_hm_id = m.contato_hm_id;

  select count(*) into v_depois from cs.vw_hm_financeiro;

  v_rel := format(E'\n=== ENSAIO 0174 (revertido) ===\ncards antes %s / depois %s / conferidos %s'
                  || E'\nmudam de SALDO: %s\nmudam de PACOTE: %s\nmudam de SITUACAO: %s'
                  || E'\ndelta total em reais: %s\n',
                  v_antes, v_depois, v_cards, v_dif, v_pac, v_sit, v_delta);

  for r in
    select cp.nome, cp.email, ch.produto, f.publico,
           m.pacote_regra pac_antes, f.pacote_regra pac_depois,
           m.saldo_a_perseguir sal_antes, f.saldo_a_perseguir sal_depois,
           m.situacao sit_antes, f.situacao sit_depois
      from marco_pre m
      join cs.vw_hm_financeiro f on f.contato_hm_id = m.contato_hm_id
      join cs.contatos_hm ch on ch.id = m.contato_hm_id
      join public.compradores cp on cp.id = ch.comprador_id
     where m.saldo_a_perseguir is distinct from f.saldo_a_perseguir
        or m.pacote_regra      is distinct from f.pacote_regra
        or m.situacao          is distinct from f.situacao
     order by abs(coalesce(f.saldo_a_perseguir,0) - coalesce(m.saldo_a_perseguir,0)) desc
     limit 60
  loop
    v_rel := v_rel || format(E'%s <%s> [%s/%s] pacote %s→%s · saldo %s→%s · %s→%s\n',
      r.nome, r.email, r.produto, r.publico, r.pac_antes, r.pac_depois,
      r.sal_antes, r.sal_depois, r.sit_antes, r.sit_depois);
  end loop;

  raise exception '%', v_rel;   -- reverte TUDO e devolve o relatório
end $$;
```

**Portão:** `mudam de SALDO = 0`, `mudam de PACOTE = 0`, `mudam de SITUACAO = 0`,
`cards antes = cards depois = 265`. Qualquer valor diferente → **PARAR e escalar**, não ajustar
a regra até o número fechar.

##### 6.2 — A migration

```sql
-- 0174_o_pacote_vem_da_entrada.sql
-- "O saldo tem que se adaptar conforme o pagamento do sinal que o cara deu. O primeiro
--  pagamento dele sinaliza a forma como vai ser acordado. A oferta pode mudar: na semana
--  passada era 300, essa semana ja e 697." (Marcio, 10/08/2026)
--
-- ---------------------------------------------------------------------------
-- O QUE ESTAVA ERRADO
--
-- A regua do HM vivia em CONSTANTE dentro do SQL. A 0166 precisou de um WHEN novo e de uma
-- migration inteira so para dizer "a oferta rlgjsrul custa 15.000". A proxima oferta — o
-- Marcio ja falou em R$497 — pediria outro WHEN, outra migration, outro deploy. E o `14700`
-- (que e 15.000 − 300) e a resposta ERRADA para quem entrou por outra porta: quem pagou os
-- R$2.000 da nz3ob9r2 nao deve 14.700.
--
-- Preco de porta e um FATO DA OFERTA. Ele passa a morar onde as ofertas ja moram.
--
-- ---------------------------------------------------------------------------
-- O QUE NAO E OBVIO — a porta tem PRECO e tem NATUREZA
--
-- Nao basta guardar o valor. As duas portas que existem hoje se comportam diferente, e as
-- duas estao certas:
--   · z391kxd9 (R$300)  e preco de TABELA — aluno da base ainda desconta o pro-rata do
--     acesso antigo por cima (pacote = 15.000 − credito). 184 cards dependem disso.
--   · rlgjsrul (R$697)  e CONDICAO FECHADA — a 0166 registra a decisao do Marcio: "os 697
--     ja sao a condicao fechada, nao ha pro-rata por cima". Foi isso que tirou 5 alunos da
--     base do limbo `incalculavel`.
-- Guardar so o preco colapsaria os dois e tiraria o desconto de 184 pessoas EM SILENCIO.
-- Por isso duas colunas, nao uma.
--
-- ---------------------------------------------------------------------------
-- ESTA MIGRATION NAO MUDA O VALOR DE NINGUEM — DE PROPOSITO
--
-- As ofertas sao semeadas exatamente com o comportamento que a view ja tinha:
--   z391kxd9 → 15.000, ABERTA (pro-rata continua valendo)
--   rlgjsrul → 15.000, FECHADA (identico a 0166)
--   nz3ob9r2, 6qxsk9kq, qm4lu7py → SEM preco: caem no ramo antigo, intocados
-- Medido em ensaio revertido antes de aplicar (secao 6.1 do plano):
--   cards que mudam de saldo_a_perseguir: <PREENCHER>
--   cards que mudam de pacote_regra:      <PREENCHER>
--   cards que mudam de situacao:          <PREENCHER>
--   linhas da view antes/depois:          <PREENCHER>/<PREENCHER>
-- Daqui para a frente, mudar o acordo de um grupo e um UPDATE de UMA LINHA, explicito,
-- decidido pelo Marcio, e mensuravel antes pelo mesmo instrumento (cs.hm_financeiro_marco).
--
-- ---------------------------------------------------------------------------
-- O QUE FICOU DE FORA, DE PROPOSITO
--   · nz3ob9r2 (R$2.000, 9 cards) — sem preco ate o Marcio dizer qual e o pacote daquela
--     porta e se ela e fechada. Preco chutado e dinheiro cobrado errado.
--   · O ramo AURUM continua lendo cs.aurum_parametros. Da para unifica-lo nestas colunas e
--     apagar o ramo (0175), mas nao no meio de uma live.
--   · fn_hm_prorata, hm-ficha.ts e a pagina do contato ainda tem 14.700/15.000 cravados em
--     outros papeis (link de saldo sugerido, texto de tela). Listados no plano como
--     CONFLITO; nenhum deles cobra ninguem hoje.
--
-- Idempotente. Sem janela de indisponibilidade: create or replace view.

-- ---------------------------------------------------------------------------
-- BLOCO A — o preco da porta vira coluna
-- ---------------------------------------------------------------------------
alter table public.hm_product_catalog
  add column if not exists pacote_cheio numeric(12,2);
alter table public.hm_product_catalog
  add column if not exists entrada_condicao_fechada boolean not null default false;

comment on column public.hm_product_catalog.pacote_cheio is
  'Quanto custa o PROGRAMA COMPLETO para quem entra por esta oferta. NULL = a oferta nao e porta de entrada do programa (ou o preco ainda nao foi decidido) e a regua nao a usa. E a presenca deste valor que define "e entrada": nao existe flag separado.';
comment on column public.hm_product_catalog.entrada_condicao_fechada is
  'true = o preco desta entrada JA E a condicao final; aluno da base NAO desconta pro-rata por cima (decisao do Marcio para a rlgjsrul, 0166). false = preco de tabela, o pro-rata continua valendo. Mudar isto reprecifica todo mundo que entrou por esta porta — medir antes com cs.hm_financeiro_marco.';

-- Solidificacao: o banco passa a impedir sozinho duas incoerencias.
alter table public.hm_product_catalog
  drop constraint if exists hm_product_catalog_pacote_positivo;
alter table public.hm_product_catalog
  add  constraint hm_product_catalog_pacote_positivo
  check (pacote_cheio is null or pacote_cheio > 0);

-- "condicao fechada" sem preco e uma declaracao vazia — e silenciosa: a view leria
-- entrada_pacote null e cairia no ramo antigo sem que ninguem soubesse.
alter table public.hm_product_catalog
  drop constraint if exists hm_product_catalog_fechada_exige_pacote;
alter table public.hm_product_catalog
  add  constraint hm_product_catalog_fechada_exige_pacote
  check (not entrada_condicao_fechada or pacote_cheio is not null);

-- ---------------------------------------------------------------------------
-- BLOCO B — semear as portas que existem, reproduzindo o comportamento atual
-- ---------------------------------------------------------------------------
update public.hm_product_catalog
   set pacote_cheio = 15000.00, entrada_condicao_fechada = false
 where offer_code = 'z391kxd9';   -- R$300, 184 cards. ABERTA: o pro-rata do aluno da base
                                  -- continua descontando. Flipar para true tira 30 cards de
                                  -- `incalculavel` E repreca os outros 184 — nao e aqui.

update public.hm_product_catalog
   set pacote_cheio = 15000.00, entrada_condicao_fechada = true
 where offer_code = 'rlgjsrul';   -- R$697, 21 cards. FECHADA: reproduz a 0166 letra por letra
                                  -- (saldo 14.303, sem pro-rata, sem `incalculavel`).

-- As tres que ficam SEM preco, e por que. Escrito como UPDATE explicito para que a ausencia
-- seja uma decisao registrada, e nao um esquecimento.
update public.hm_product_catalog
   set pacote_cheio = null, entrada_condicao_fechada = false
 where offer_code in ('nz3ob9r2','6qxsk9kq','qm4lu7py');
--   nz3ob9r2 R$2.000 — o pacote daquela porta nao foi decidido. Ver BLOQUEIO B1.
--   6qxsk9kq R$2.497 — e ACESSO ETHB ate Dez/2026, nao o programa. Quitado nesse valor, nao
--                      deve saldo. Coerente com concede_trilha=false (0114).
--   qm4lu7py R$1.000 — e o AURUM. Parametros proprios em cs.aurum_parametros (0158).

-- ---------------------------------------------------------------------------
-- BLOCO C — o instrumento: fotografia do financeiro antes de cada mudanca de regua
--
-- Nao e tabela de apoio desta migration; e o aparelho que faltava. Toda vez que alguem for
-- mexer no preco de uma porta, tira um marco antes e compara depois. Historico nao se
-- apaga: cada marco fica.
-- ---------------------------------------------------------------------------
create table if not exists cs.hm_financeiro_marco (
  marco             text        not null,   -- 'pre-0174', 'pre-flip-z391kxd9', ...
  contato_hm_id     uuid        not null,
  pacote_regra      numeric,
  saldo_a_perseguir numeric,
  situacao          text,
  tirado_em         timestamptz not null default now(),
  primary key (marco, contato_hm_id)
);
comment on table cs.hm_financeiro_marco is
  'Fotografia de pacote/saldo/situacao antes de mudar a regua do HM. Serve para provar quem mudou de valor e para voltar atras. Nunca sobrescreve: um marco por evento.';

insert into cs.hm_financeiro_marco (marco, contato_hm_id, pacote_regra, saldo_a_perseguir, situacao)
select 'pre-0174', f.contato_hm_id, f.pacote_regra, f.saldo_a_perseguir, f.situacao
  from cs.vw_hm_financeiro f
on conflict (marco, contato_hm_id) do nothing;

grant select on cs.hm_financeiro_marco to disparos_app;

-- ---------------------------------------------------------------------------
-- BLOCO D — a view. Os pontos que mudam em relacao a 0166 estao marcados "0174".
-- Nomes, tipos e ORDEM das colunas identicos: create or replace exige, e o board, a tabela,
-- os exports e fn_hm_sugestao_financeira (0116) leem daqui.
-- ---------------------------------------------------------------------------
create or replace view cs.vw_hm_financeiro as
 WITH base AS (
   SELECT ch.id AS contato_hm_id, ch.comprador_id, cp.nome, cp.email, ch.turma, ch.turma_origem,
     ch.estagio_id, ch.valor_total, COALESCE(ch.valor_pago, 0::numeric) AS pago, ch.quitado_em,
     ch.oferta_saldo_codigo, ch.link_saldo_enviado_em, ch.cancelamento_efetivado_em,
     ch.acesso_preexistente, ch.credito_valor_pago, ch.credito_compra_em, ch.produto,
     CASE WHEN 'Aluno THB'::text = ANY (ch.tags) THEN 'aluno_base'::text
          WHEN 'Aluno Aurum'::text = ANY (ch.tags) THEN 'aluno_base'::text
          WHEN 'Lead novo'::text = ANY (ch.tags) THEN 'lead_novo'::text
          ELSE 'nao_classificado'::text END AS publico,
     -- 0174: A ENTRADA E O CONTRATO. Substitui o `entrada_697` cravado da 0166.
     -- Uma linha por card, garantida por LIMIT 1 com ORDEM TOTAL — a 0168 mostrou que
     -- subquery que devolve 2 linhas derruba a view inteira, e a 0169 mostrou que
     -- `select into` sem ordem escolhe ao acaso sem levantar erro.
     ent.oferta_codigo                     AS entrada_oferta,
     ent.pacote_cheio                      AS entrada_pacote,
     COALESCE(ent.condicao_fechada, false) AS entrada_fechada,
     COALESCE((SELECT sum(p3.valor) FROM cs.hm_pagamentos p3
                WHERE p3.comprador_id = ch.comprador_id
                  AND p3.oferta_codigo = ent.oferta_codigo), 0) AS entrada_pago,
     (SELECT pr.credito FROM cs.fn_hm_prorata(ch.comprador_id)
        pr(dias_usados, dias_restantes, valor_dia, consumido, credito, saldo_a_pagar)) AS credito_hoje,
     (SELECT COALESCE(sum(p.valor),0) FROM cs.hm_pagamentos p
       WHERE p.comprador_id = ch.comprador_id
         AND cs.fn_hm_pagamento_do_produto(p.oferta_codigo, ch.produto)
         AND (ch.credito_compra_em IS NULL OR p.pago_em::date > ch.credito_compra_em)) AS pago_no_ciclo,
     (SELECT max(p.pago_em) FROM cs.hm_pagamentos p
       WHERE p.comprador_id = ch.comprador_id
         AND cs.fn_hm_pagamento_do_produto(p.oferta_codigo, ch.produto)) AS ultimo_pagamento_em,
     ((SELECT count(*) FROM cs.hm_pagamentos p
        WHERE p.comprador_id = ch.comprador_id AND p.categoria = 'mensalidade'
          AND cs.fn_hm_pagamento_do_produto(p.oferta_codigo, ch.produto)))::integer AS parcelas_pagas,
     ((SELECT max(c.parcelas) FROM compras c
        WHERE c.comprador_id = ch.comprador_id
          AND (c.status::text = ANY (ARRAY['APPROVED','COMPLETE','COMPLETED']))
          AND c.metodo_pagamento::text = 'HOTMART_INSTALLMENTS'))::integer AS parcelas_contratadas,
     (SELECT max(p.valor) FROM cs.hm_pagamentos p
       WHERE p.comprador_id = ch.comprador_id AND p.categoria = 'mensalidade'
         AND cs.fn_hm_pagamento_do_produto(p.oferta_codigo, ch.produto)) AS valor_parcela
   FROM cs.contatos_hm ch
   JOIN compradores cp ON cp.id = ch.comprador_id
   -- 0174: a porta de entrada. LEFT = card sem entrada catalogada continua no ramo antigo.
   LEFT JOIN LATERAL (
     SELECT p.oferta_codigo, cat.pacote_cheio,
            cat.entrada_condicao_fechada AS condicao_fechada
       FROM cs.hm_pagamentos p
       JOIN public.hm_product_catalog cat ON cat.offer_code = p.oferta_codigo
      WHERE p.comprador_id = ch.comprador_id
        AND cat.categoria = 'sinal'
        AND cat.pacote_cheio IS NOT NULL
        -- nao cruza board: card do HM nao pesca entrada do AURUM (regressao da 0172)
        AND cs.fn_hm_pagamento_do_produto(p.oferta_codigo, ch.produto)
        -- mesma janela de pago_no_ciclo: pacote do ciclo A menos pagamento do ciclo B
        -- seria uma conta entre coisas diferentes
        AND (ch.credito_compra_em IS NULL OR p.pago_em::date > ch.credito_compra_em)
      ORDER BY p.pago_em ASC, p.oferta_codigo ASC, p.id ASC
      LIMIT 1
   ) ent ON true
 ), regra AS (
   SELECT b.*,
     -- 0174: entrada com condicao fechada nao acumula pro-rata por cima (era `entrada_697 > 0`)
     CASE WHEN b.entrada_fechada THEN 0::numeric
          WHEN b.publico = 'lead_novo' THEN 0::numeric ELSE b.credito_hoje END AS credito,
     CASE WHEN b.produto = 'AURUM'
            THEN (select valor from cs.aurum_parametros where chave='pacote_cheio')
          -- 0174: o pacote vem da PORTA. Subtrair `credito_hoje` NULL devolve NULL de
          -- proposito — aluno da base sem pro-rata calculado continua `incalculavel`.
          WHEN b.entrada_pacote IS NOT NULL
            THEN round(b.entrada_pacote
                       - (CASE WHEN b.entrada_fechada OR b.publico = 'lead_novo'
                               THEN 0::numeric ELSE b.credito_hoje END), 2)
          -- Fallback historico: card SEM entrada catalogada (entrou por compra cheia, por
          -- diferenca, ou por oferta antiga sem preco). 15.000 e o pacote do HM ate 10/08 e
          -- NAO deve mudar: mexer aqui repreca gente velha. Oferta nova nao passa por aqui.
          WHEN b.publico = 'lead_novo' THEN 15000::numeric
          WHEN b.credito_hoje IS NOT NULL THEN round(15000::numeric - b.credito_hoje, 2)
          ELSE NULL::numeric END AS pacote_regra,
     -- DEPRECADA (0174): nenhuma linha de TS/TSX le `saldo_regra`. O numero que a operacao
     -- persegue e `saldo_a_perseguir` = pacote_regra − pago_no_ciclo. Mantida so por
     -- compatibilidade de forma; generalizada para nao mentir. Remover depois de varrer os
     -- consumidores (licao da 0167).
     CASE WHEN b.produto = 'AURUM'
            THEN ((select valor from cs.aurum_parametros where chave='pacote_cheio')
                - (select valor from cs.aurum_parametros where chave='entrada'))
          WHEN b.entrada_pacote IS NOT NULL
            THEN round(b.entrada_pacote - b.entrada_pago
                       - (CASE WHEN b.entrada_fechada OR b.publico = 'lead_novo'
                               THEN 0::numeric ELSE b.credito_hoje END), 2)
          WHEN b.publico = 'lead_novo' THEN 14700::numeric
          WHEN b.credito_hoje IS NOT NULL THEN round(14700::numeric - b.credito_hoje, 2)
          ELSE NULL::numeric END AS saldo_regra
   FROM base b
 )
 SELECT r.contato_hm_id, r.comprador_id, r.nome, r.email, r.turma, r.turma_origem, r.estagio_id,
   r.publico, r.credito_valor_pago, r.credito_compra_em, r.credito, r.pacote_regra, r.saldo_regra,
   r.valor_total AS pacote_cravado, r.pago,
   CASE WHEN r.valor_total IS NOT NULL THEN GREATEST(r.valor_total - r.pago, 0) END AS saldo_cravado,
   -- INALTERADO: o pacote cravado continua ganhando da regua.
   COALESCE(CASE WHEN r.valor_total IS NOT NULL THEN GREATEST(r.valor_total - r.pago, 0) END,
            CASE WHEN r.pacote_regra IS NOT NULL THEN GREATEST(r.pacote_regra - r.pago_no_ciclo, 0) END) AS saldo_a_perseguir,
   CASE WHEN r.valor_total IS NOT NULL AND r.pacote_regra IS NOT NULL
        THEN round(r.valor_total - r.pacote_regra, 2) END AS divergencia_regra,
   r.quitado_em IS NOT NULL AS quitado, r.cancelamento_efetivado_em IS NOT NULL AS cancelado,
   r.oferta_saldo_codigo, r.link_saldo_enviado_em IS NOT NULL AS oferta_enviada,
   CASE WHEN r.cancelamento_efetivado_em IS NOT NULL THEN 'cancelado'
        WHEN r.quitado_em IS NOT NULL THEN 'quitado'
        WHEN (EXISTS (SELECT 1 FROM cs.hm_pagamentos p
                       WHERE p.comprador_id = r.comprador_id AND p.categoria = 'mensalidade'
                         AND cs.fn_hm_pagamento_do_produto(p.oferta_codigo, r.produto))) THEN 'mensalidade_em_curso'
        -- 0174: era `r.entrada_697 = 0`. Mesma semantica, generalizada: entrada de condicao
        -- fechada tira o card do limbo; entrada de preco de tabela nao.
        WHEN r.publico = 'aluno_base' AND r.credito_hoje IS NULL AND NOT r.entrada_fechada THEN 'incalculavel'
        WHEN r.link_saldo_enviado_em IS NOT NULL THEN 'oferta_enviada'
        ELSE 'saldo_parado' END AS situacao,
   r.pago_no_ciclo, r.ultimo_pagamento_em, r.parcelas_pagas, r.parcelas_contratadas, r.valor_parcela,
   CASE WHEN COALESCE(r.valor_total, r.pacote_regra) > 0
        THEN round(100 * r.pago / COALESCE(r.valor_total, r.pacote_regra), 1) END AS pago_pct,
   ab.pago_em AS ultimo_abatimento_em, ab.valor AS ultimo_abatimento_valor,
   ab.categoria AS ultimo_abatimento_categoria
 FROM regra r
 LEFT JOIN LATERAL (SELECT p.pago_em, p.valor, p.categoria FROM cs.hm_pagamentos p
    WHERE p.comprador_id = r.comprador_id
      AND (p.categoria = ANY (ARRAY['mensalidade','saldo','compra_cheia']))
      AND cs.fn_hm_pagamento_do_produto(p.oferta_codigo, r.produto)
    ORDER BY p.pago_em DESC LIMIT 1) ab ON true;

grant select on cs.vw_hm_financeiro to disparos_app;

-- ---------------------------------------------------------------------------
-- BLOCO E — o novo silencio ganha alarme
--
-- A 0157 documenta o furo classico: oferta fora do catalogo, venda invisivel, ninguem avisa.
-- As colunas novas criam um furo IRMAO e mais discreto: oferta de entrada cadastrada CERTA,
-- mas SEM pacote_cheio. A venda aparece, o card nasce, e o pacote sai 15.000 pelo fallback
-- historico — pode estar errado e nao ha sintoma. Alarme antes que alguem descubra por
-- reclamacao de aluno.
--
-- As excecoes nao sao lista de codigos (isso seria o proximo fossil): sao derivadas dos
-- fatos que ja existem — concede_trilha=false (acesso, nao programa) e produto<>'HM' (Aurum).
-- ---------------------------------------------------------------------------
-- backend: ADICIONAR este bloco DENTRO de cs.fn_hm_health_check(), logo depois do item
-- (1) OFERTA ORFA, como (1b). Nao criar funcao nova.
--
--   insert into cs.hm_alertas (tipo, chave, severidade, detalhe)
--   select 'entrada_sem_pacote', cat.offer_code, 'critico',
--          'Oferta de entrada '||cat.offer_code||' ('||coalesce(cat.notes,'sem nota')||') esta no '
--          ||'catalogo como sinal e SEM pacote_cheio: '||count(*)||' venda(s) aprovada(s) caindo no '
--          ||'pacote historico de 15.000. Definir o preco da porta em public.hm_product_catalog.'
--     from public.compras c
--     join public.hm_product_catalog cat on cat.offer_code = c.oferta_codigo
--    where c.status in ('APPROVED','COMPLETE','COMPLETED')
--      and cat.categoria = 'sinal'
--      and cat.pacote_cheio is null
--      and cat.concede_trilha                      -- acesso/renovacao nao e entrada do programa
--      and coalesce((select o.produto from cs.hm_origem_por_oferta o
--                     where o.oferta_codigo = cat.offer_code
--                     order by o.vale_de desc nulls last limit 1), 'HM') = 'HM'   -- Aurum tem regra propria
--      and coalesce(c.data_aprovacao, c.data_compra) >= v_cutoff
--    group by cat.offer_code, cat.notes
--    on conflict do nothing;
--
-- ⚠️ Antes de aplicar: rodar Q5 da secao 6.0. Se `qm4lu7py` vier com concede_trilha=true E
-- produto='HM' em hm_origem_por_oferta, ela dispararia alarme falso — nesse caso corrigir o
-- produto dela na hm_origem_por_oferta (que e o dado certo, e ja e usado pela 0168/0169),
-- NAO adicionar excecao por codigo aqui.
```

##### 6.3 — Caminho de volta

Reversível, e sem precisar de banco parado:

1. `create or replace view cs.vw_hm_financeiro as ...` com o corpo **exato** de
   `db/migrations/0166_saldo_da_oferta_697.sql` (o arquivo está no repo, íntegro).
2. `update public.hm_product_catalog set pacote_cheio = null, entrada_condicao_fechada = false;`
3. As colunas e as constraints **ficam** — são aditivas e inertes com valor nulo. Remover
   coluna é destruir histórico de decisão; deprecar é suficiente.
4. `cs.hm_financeiro_marco` (marco `pre-0174`) guarda o valor de cada card antes, para conferir
   que a volta bateu:
   ```sql
   select count(*) from cs.hm_financeiro_marco m
     join cs.vw_hm_financeiro f on f.contato_hm_id = m.contato_hm_id
    where m.marco = 'pre-0174'
      and (m.pacote_regra is distinct from f.pacote_regra
        or m.saldo_a_perseguir is distinct from f.saldo_a_perseguir);
   ```
   → tem que voltar a **0**.

---

#### 7. Casos de teste — venda simulada em transação revertida

Todos no padrão do briefing: `do $$ ... insert ... raise exception '%' $$`, tudo volta.
Depois de cada bloco, confirmar resíduo zero: `select count(*) from cs.contatos_hm` = 265.

| # | cenário | resultado esperado |
|---|---|---|
| T1 | venda `rlgjsrul` (697), lead novo | pacote 15.000 · pago 697 · **saldo 14.303** · `saldo_parado` |
| T2 | venda `rlgjsrul` (697), **aluno da base sem pró-rata** | pacote 15.000 · saldo 14.303 · situação **≠ `incalculavel`** (preserva 0166) |
| T3 | venda `z391kxd9` (300), lead novo | pacote 15.000 · **saldo 14.700** |
| T4 | venda `z391kxd9` (300), aluno da base **com** `credito_valor_pago` + `credito_compra_em` | pacote **15.000 − crédito** · pró-rata preservado |
| T5 | venda `z391kxd9` (300), aluno da base **sem** crédito | situação **`incalculavel`** · `saldo_a_perseguir` NULL (preserva hoje) |
| **T6** | **oferta nova R$497, ZERO migration**: só `insert` em `hm_product_catalog` (`categoria='sinal'`, `concede_trilha=true`, `pacote_cheio=15000`, `entrada_condicao_fechada=true`) + `cs.hm_origem_por_oferta`, e vender | card nasce · pacote 15.000 · **saldo 14.503** · nenhum DDL, nenhum `create or replace`. **É este teste que prova o pedido do Marcio.** |
| T7 | venda `6qxsk9kq` (2.497) | card em "Pendente de Liberação", tags `Acesso ETHB`/`Renovação`, **não** entra na régua de entrada; saldo idêntico ao de hoje |
| T8 | venda `qm4lu7py` (Aurum) para alguém que **também** tem card HM | card AURUM: pacote 60.000 / saldo 59.000. Card HM: pacote **não** contaminado pela entrada do Aurum (regressão 0172) |
| T9 | card com `valor_total = 12000` cravado + entrada catalogada | `saldo_a_perseguir = 12000 − pago`. A régua **não** vence o cravado |
| T10 | recompra: 300 em julho **e** 697 em agosto, mesmo card, `credito_compra_em` nulo | vale a **primeira** (300) → pacote 15.000, aberta. Registrar o número que sair — é a validação da decisão da seção 3 |
| T11 | pessoa com `credito_compra_em` preenchido e sinal **anterior** a essa data | entrada = NULL (fora do ciclo) → ramo antigo. Confirma que a janela corta |
| T12 | forma da view | `select count(*) from cs.vw_hm_financeiro` = 265 antes e depois; mesma lista de colunas via `information_schema.columns` (nome, tipo, `ordinal_position`) |
| T13 | telas | `GET /api/hm/kanban` → 200 com JSON (a 0168 mostra que 500 aqui aparece como "Sem conexão com o servidor"); `/hm/tabela` carrega; export financeiro XLSX gera; `fn_hm_sugestao_financeira` devolve o mesmo `sugestao_valor_total` de antes em 5 cards amostrados |
| T14 | constraints | `insert` com `entrada_condicao_fechada=true` e `pacote_cheio=null` → **erro**; `pacote_cheio=0` → **erro** |
| T15 | health check | `select * from cs.fn_hm_health_check()` roda sem erro; `entrada_sem_pacote` aparece **só** para `nz3ob9r2` (a única entrada HM com trilha e sem preço) |

---

#### 8. CONFLITO — o que no código existente contradiz este desenho

Nenhum bloqueia a 0174; todos precisam estar na mesa.

1. **`cs.fn_hm_prorata` (0056) crava `14700` em `saldo_a_pagar`.** É lido por
   `lib/services/hm-ficha.ts:95` e usado em `:103` para **escolher o link de saldo sugerido**
   em `cs.hm_ofertas_saldo`. Para quem entrar por uma porta que não custa 15.000, o link
   sugerido sai errado — não cobra sozinho, mas manda o operador enviar o checkout errado.
   Correção natural: `saldo_a_pagar` passar a vir de `vw_hm_financeiro.saldo_a_perseguir`.
   **Fora do escopo da 0174** (mexeria na ficha e no board do Aurum ao mesmo tempo).
2. **`lib/services/hm-ficha.ts:78`** — `saldoCheio = { valor: "14700" }` literal para todo card
   não-AURUM. Deveria ler `pacote_regra − pago_no_ciclo` da view.
3. **`app/hm/contatos/[id]/page.tsx:11-14`** — `SALDO_VALOR = "R$ 14.700"` e a oferta
   `2vibw97m` cravadas no componente. Texto de tela que vai contradizer o card ao lado assim
   que existir uma porta de outro preço.
4. **`cs.fn_hm_valores_derivados` (0049 §3, 0050)** — `v_total := 15000` quando há sinal e o
   saldo ainda não foi pago. É o valor que vai para `public.thb_alunos` via
   `fn_hm_provisionar_aluno`. Contradiz diretamente "o pacote vem da entrada": um aluno que
   entrou por porta de outro preço nasce na base THB com 15.000. **É o mais grave da lista** —
   escreve em outra tabela, não é só leitura.
5. **`lib/services/hm.ts:178`** — `(select ... from cs.vw_hm_financeiro f where f.comprador_id=$1)`
   como subquery **escalar**, sem filtro de produto. Desde a 0163 (card por pessoa×produto)
   isso pode devolver 2 linhas: `ERROR 21000` — a mesma família do incidente da 0168, esperando
   a primeira pessoa com card em HM e AURUM passar por esse caminho.
6. **`saldo_regra` e `divergencia_regra` são colunas mortas** — nenhum consumidor em `lib/` ou
   `app/`. A "régua de saldo" que a operação enxerga é `pacote_regra − pago_no_ciclo`. Ficam
   deprecadas nesta migration; remover só depois de varredura de consumidores.
7. **`concede_trilha` parece "é entrada do programa" e não é.** O comentário da 0114 induz a
   isso, mas ofertas de `compra_cheia` também são `true`. Deliberadamente **não** reusado.
8. **O briefing lista 231 cards distribuídos por primeira entrada, mas há 265.** A diferença
   (34) não está explicada. Q1 da seção 6.0 fecha isso antes de qualquer escrita.

---

#### 9. BLOQUEIO — precisa do Marcio, não invento

**B1 — `nz3ob9r2` (R$2.000, 9 cards, vendida 18/04→17/06). Qual é o pacote daquela porta?**
O briefing afirma "deveria dever 13.000", mas isso é dedução, não decisão registrada. Duas
perguntas separadas, ambas dele:
 (a) o programa custa 15.000 para quem entrou pelos 2.000, ou outro valor?
 (b) essa entrada é **condição fechada** (sem pró-rata por cima) ou preço de tabela?
Note que essas vendas são **anteriores ao cutoff da esteira** (25/06) — os cards vieram de
importação, e vários já estão parcialmente pagos (saldo hoje 0 a 6.619). Cravar 15.000 pode
reabrir dívida em quem a operação já tratou como resolvido.
**Enquanto não houver resposta: `pacote_cheio = NULL`** — comportamento idêntico ao de hoje,
zero card movido. Rodar Q4 (seção 6.0) e levar a tabela com nome, saldo de hoje e saldo
hipotético, para ele decidir olhando gente e não abstração.

**B2 — `z391kxd9` (R$300, 184 cards + os 30 `incalculavel`). Aberta ou fechada?**
Este plano mantém **aberta**, que é o comportamento de hoje. Se o Marcio disser "os 300 também
já são a condição fechada" — que é o mesmo raciocínio que ele aplicou aos 697 na 0166 — o
efeito é grande e em duas direções:
 · os **30 cards `incalculavel`** saem do limbo e passam a dever **14.700** cada. Isso é
   ~R$441.000 aparecendo no board de gente que hoje o sistema diz "saldo a definir";
 · os **alunos da base com pró-rata calculado** perdem o desconto e sobem para 15.000 de
   pacote — gente com quem já pode ter havido conversa sobre o valor com desconto.
Não é decisão de arquitetura. É um `UPDATE` de uma linha, e o instrumento para medir antes
(`cs.hm_financeiro_marco` + o ensaio da 6.1) fica pronto nesta migration. **Não flipar junto
com a 0174.**

**B3 (confirmação, não bloqueio) — `compra_cheia` (12k/13k/15k) fica de fora.**
O pacote de quem entrou por compra cheia continua vindo do ramo antigo. Faz sentido estender
`pacote_cheio` a essas ofertas depois, mas isso **moveria valor** e portanto não entra numa
migration que se propõe neutra. Confirmar com o Marcio que a operação aceita isso por ora.

---

#### 10. Tarefas

##### backend-engineer
- [ ] **antes de tudo**: rodar Q1–Q6 (seção 6.0) e colar os resultados na seção "Backend"
      deste arquivo. Q1 e Q2 podem invalidar a decisão da seção 3 — se invalidarem, parar e
      devolver ao arquiteto.
- [ ] rodar o **ensaio revertido** (6.1). Portão: 0 cards mudando de saldo/pacote/situação e
      265 linhas antes e depois. **Se ≠ 0, PARAR** e trazer a lista — não ajustar a regra até o
      número fechar.
- [ ] escrever `db/migrations/0174_o_pacote_vem_da_entrada.sql` com os blocos A–D, preenchendo
      os `<PREENCHER>` do cabeçalho com os números **medidos** no ensaio (nunca com os
      esperados).
- [ ] adicionar o bloco E **dentro** de `cs.fn_hm_health_check()` (não criar função nova), e só
      depois de conferir Q5 quanto ao falso positivo do `qm4lu7py`.
- [ ] rodar T1–T15 (seção 7). T6 e T12 são obrigatórios: T6 prova o pedido do Marcio, T12 prova
      que o board não cai. Confirmar resíduo zero após cada bloco.
- [ ] `GET /api/hm/kanban` respondendo 200 com JSON depois de aplicar — a 0168 mostra que 500
      aqui vira "Sem conexão com o servidor" na tela e ninguém entende.
- [ ] NÃO tocar em `cs.fn_hm_valores_derivados`, `cs.fn_hm_prorata`, `cs.aurum_parametros` nem
      no ramo AURUM da view. São CONFLITO 1/4 e ficam para a 0175.

##### frontend-engineer
- [ ] nada obrigatório nesta migration — os nomes e tipos das colunas não mudam, de propósito.
- [ ] **verificar** (leitura, sem alterar) que `/hm/kanban`, `/hm/tabela`, o drawer, a ficha e
      os dois exports XLSX continuam idênticos após a 0174, e reportar qualquer diferença de
      número na tela.
- [ ] atualizar `docs/hm-modelo-de-dados.md` (hoje diz "300 + 14.700 cheios" e "o pacote é
      `300 + o valor da oferta de saldo`") para registrar que o pacote passa a vir de
      `hm_product_catalog.pacote_cheio` da oferta de entrada, e o que significa
      `entrada_condicao_fechada`. Doc que contradiz o banco é o próximo bug de alguém.

##### security-pentester — **obrigatório**
- [ ] `public.hm_product_catalog` ganhou duas colunas que **definem quanto cada aluno deve**.
      Mapear **quem pode escrever nela**: RLS ligada? grants para `disparos_app` / `anon` /
      `authenticated`? existe rota, RPC ou função `security definer` que faça `insert`/`update`
      nessa tabela? (A varredura estática do repo não achou nenhuma — só migrations. Confirmar
      no banco, não no código.)
- [ ] `cs.hm_financeiro_marco` é tabela nova com **dado financeiro por pessoa** (saldo por card).
      Grant proposto é só `select` para `disparos_app`; conferir que não há
      `insert/update/delete` e que nenhuma rota a expõe.
- [ ] a lateral nova lê `public.hm_product_catalog` **dentro** de uma view que roda como dono
      (`security_invoker` default = false). Conferir se isso amplia a superfície de leitura de
      `public` para quem só tem grant em `cs` — e se `cs.vw_hm_financeiro` deveria ser
      `security_invoker = true`.
- [ ] `cs.fn_hm_pagamento_do_produto` é `IMMUTABLE` mas **lê tabela** (dívida assumida na 0168).
      Avaliar se isso permite resultado obsoleto em plano cacheado agora que a função participa
      da decisão de **dinheiro**, e não só de filtro de exibição.

---

#### 11. Os 5 critérios do Fable

| Critério | O que este plano garante |
|---|---|
| **Segurança** | Nenhuma rota, guard ou RLS muda. A superfície nova é uma tabela de catálogo que **passa a valer dinheiro**: quem escreve `pacote_cheio` repreça um grupo inteiro. Por isso a tarefa do pentester é obrigatória e a auditoria de escrita em `public.hm_product_catalog` é o primeiro item dela. Grant novo: só `select` de `cs.hm_financeiro_marco` para `disparos_app`. |
| **Escalabilidade** | Sai um subquery correlacionado (`entrada_697`), entra **uma** lateral com `LIMIT 1` sobre `cs.hm_pagamentos ⋈ hm_product_catalog` (catálogo ≈ 80 linhas, PK em `offer_code`) — saldo líquido de complexidade ≈ zero. Cardinalidade da view **inalterada**, garantida por `LIMIT 1` com ordem total (lição 0167/0168). A 10× (2.650 cards) o custo continua dominado pelos subqueries que já existiam; Q6 confirma se falta índice em `cs.hm_pagamentos(comprador_id)`, e se faltar é `create index concurrently`, sem janela. **A escalabilidade que importa aqui não é de linhas, é de ofertas**: hoje cada oferta nova custa uma migration e um deploy; depois custa um `insert`. |
| **Solidificação** | Duas invariantes que o banco passa a garantir sozinho: `pacote_cheio > 0` e **"condição fechada exige preço"** (`not entrada_condicao_fechada or pacote_cheio is not null`) — esta última fecha um silêncio real, porque declarar fechada sem preço faria o card cair no fallback sem sintoma. Fora do CHECK, um alarme novo em `cs.fn_hm_health_check` (`entrada_sem_pacote`), com as exceções **derivadas** de `concede_trilha` e do produto, em vez de listadas por código. |
| **UX** | Nada muda na tela — **e isso é o resultado desejado**, não uma omissão: a migration é neutra por construção e o operador não vê número se mexer sem aviso. O ganho de UX é para quem opera a régua: cadastrar a próxima oferta (R$497) vira um `insert` em `hm_product_catalog` — o **mesmo** passo que já é obrigatório para a venda existir. Zero migration, zero deploy, zero espera pelo dev. Quando o Marcio decidir repreçar uma porta, o `cs.hm_financeiro_marco` responde "quem muda e de quanto" **antes** de a mudança acontecer. |
| **Otimização** | Remove três fósseis (o `entrada_697` cravado na `rlgjsrul` e o `14700` de dois ramos), colapsa três `WHEN` em um, e **elimina a classe de migration** que a 0157/0166 representam — a próxima porta não gera SQL nenhum. Marca duas colunas mortas (`saldo_regra`, `divergencia_regra`) para remoção. Também **fecha um bug latente de graça**: a busca da entrada passa a filtrar por produto, coisa que o `entrada_697` não fazia — é a regressão da 0172 esperando a primeira pessoa com card em HM e AURUM. Saldo: menos código, menos constante, menos migration futura, um bug a menos. |

### Backend (a preencher)

### Frontend (10/08/2026, ~23h30)

Escopo: só CONFLITO 2 e 3 (item 8 do arquiteto). Não toquei em `cs.vw_hm_financeiro`,
migration, `fn_hm_prorata` (CONFLITO 1) nem `fn_hm_valores_derivados` (CONFLITO 4).

**CONFLITO 2 — `lib/services/hm-ficha.ts`**
- `saldoCheio` não-Aurum deixou de ser `{ valor: "14700" }` literal (linha 78 antiga) e
  passou a vir de `cs.vw_hm_financeiro.saldo_a_perseguir`, filtrado pelo card
  (`contato_hm_id` já resolvido na primeira query) — `lib/services/hm-ficha.ts:110-115`.
- A consulta `financeiro` (que já lia `fin.situacao` da mesma view) subiu para antes de
  `saldoCheio` e ganhou a coluna `fin.saldo_a_perseguir` — reusa a consulta existente em
  vez de abrir uma segunda ida ao banco (`lib/services/hm-ficha.ts:72-100`). A declaração
  duplicada de `financeiro` mais abaixo no arquivo foi removida.
- `saldo_a_perseguir` já embute `valor_total` cravado com precedência (é a mesma conta que
  o board persegue) e sai `NULL` quando a régua não sabe calcular — nesse caso `saldoCheio`
  vira `null`, não mais um número fixo.
- Comentários do tipo `FichaHm.saldoCheio` e da doc do bloco pró-rata atualizados para não
  falar mais em "14.700" fixo.

**CONFLITO 3 — `app/hm/contatos/[id]/page.tsx`**
- `SALDO_VALOR = "R$ 14.700"` removida. O título "Pagamento do saldo" (linha ~344) agora
  lê o novo estado `saldoCheio` (setado em `recarregar()` a partir de `d.saldoCheio`, que
  já vinha no payload da ficha mas não era consumido pela tela): `brl(saldoCheio)` quando
  há valor, `"saldo a definir"` quando `null` — vocabulário da 0165, igual ao drawer
  (`hm-drawer.tsx:803`).
- `SALDO_CHECKOUT` (link fixo, oferta `2vibw97m`) foi mantido — é o link único da Hotmart,
  não um valor; o cliente escolhe à vista/parcelado lá dentro. Não é um "número cravado".

**Verificado**
- `npm run typecheck` → limpo.
- `npm run lint` → `✔ No ESLint warnings or errors`.
- `npm run build` → sucesso, `/hm/contatos/[id]` compila (7.66 kB).
- Não rodei o app contra o banco (sem `.env.local`/Supabase MCP neste ambiente) — não
  testei em navegador. A migration 0174 e o dado real ficam por conta do backend/DB.

**Residual fora de escopo (não mexi)**
- `app/hm/_components/hm-drawer.tsx:809` e `:1264` ainda têm o padrão
  `num(saldoCheio) || 14700` — falsy-fallback que, agora que `saldoCheio` pode ser um
  número real (inclusive `0` num card quitado por essa conta), reintroduziria o "14.700"
  errado num card com saldo genuinamente zerado. Não estava no CONFLITO 2/3 listado; sinalizo
  porque nasce do mesmo sintoma e vale um follow-up.
- O título "(de R$ 15.000)" em `app/hm/contatos/[id]/page.tsx` continua fixo — o pacote
  total não veio no payload da ficha (só o saldo/diferença). Hoje bate com todas as portas
  cadastradas (`pacote_cheio = 15000` em `z391kxd9` e `rlgjsrul`), mas é literal e não
  estava no CONFLITO 3 nomeado; se o Marcio cadastrar uma porta com pacote diferente de
  15.000, este texto passa a mentir.
- `lib/services/hm-ficha.ts:140` (`alvo = prorata.saldo_a_pagar ?? saldoCheio?.valor ?? "14700"`)
  mantém o fallback `"14700"` para escolher o LINK sugerido em `cs.hm_ofertas_saldo` — é o
  CONFLITO 1 do arquiteto (fora de escopo, depende de `fn_hm_prorata`).

### Fable — veredito (a preencher)
