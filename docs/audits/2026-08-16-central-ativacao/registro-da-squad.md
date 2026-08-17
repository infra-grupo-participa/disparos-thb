# Tarefa: polir a Central de Ativação — ofertas, dashboard, relatórios

Data: 2026-08-16. Orquestrador: Opus. Projeto: `C:\Users\João\projetos\sistema-disparos-participa`.
Vault: `C:\Users\João\segundo-cerebro-ias\vault\12 Brains de projeto\disparos-brain\`.

## O que o João pediu (verbatim resumido)

1. **Ofertas/links.** Planilha `C:\Users\João\Downloads\Links necessários.xlsx` (exportada em
   UTF-8 para `C:\Users\João\AppData\Local\Temp\claude\C--Users-Jo-o\d67f67c3-72e6-4207-9fa3-805d9a075404\scratchpad\ofertas-planilha.csv`,
   67 linhas úteis, colunas: Produto · Nome · Valor · Explicação · Nome da oferta na Hotmart · Código · Link).
   Backlog pendente da ativação. Ele reuniu "muitas, não todas". Quer tudo mapeado no sistema,
   com inteligência e verificação de nossa parte — o que bate, o que falta, o que conflita.
2. **Dados corretos.** "Não pode ter nenhum dado errado, um real que seja errado."
3. **Dashboard / navegação.** A carteira de clientes do comercial ficou boa, mas o painel
   ("nave") está confuso, principalmente misturado com atividades do sistema. Quer repaginação
   que dê para navegar e entender, com leitura de longo prazo.
4. **Relatórios (feature nova).** Aba de Relatórios: dropdown com vários tipos de relatório,
   escolher data/período, gerar. Ex.: carteira de clientes do comercial, relatório diário das
   ações do comercial, visão geral. Saída HTML imprimível → PDF com identidade do Grupo Participa.
5. **Protocolar processos.** Burocratizar/registrar os processos para não haver divergência de dados.

## Regras não negociáveis

- Nenhum número na tela sem origem rastreável no banco. Medir antes de afirmar.
- Migration para toda mudança de schema. Backfill só com contagem de quem muda de VALOR antes.
- Nada de tela sem rota; nada de rota sem link na navegação.
- Validar UI no Chromium (build verde não prova tela boa).

## Registro

### Orquestrador (16/08 — abertura)
Contexto coletado: repo Next.js (app router, drizzle, supabase), últimos commits tratam do
financeiro do HM/AURUM e da carteira do comercial. Planilha exportada. Squad acionada nas
fases: planejamento → requisitos → codificação → testes → validação (fable).

---

### Analista de dados (16/08 — levantamento de ofertas)

**Sem acesso ao banco.** Não existe `.env.local` no repo (só `.env.local.example`), não há
`DATABASE_URL` no ambiente e não há MCP de Postgres/Supabase exposto nesta sessão. Nenhum
número abaixo saiu de `select` em produção. Origem de cada número: (a) parse do CSV do João,
(b) parse das migrations em `db/migrations/`, (c) medições já registradas no vault por sessões
anteriores — essas vêm marcadas `[vault]`.

#### 1. Onde vive o catálogo

| tabela | grão | colunas (provadas no repo) | quem escreve |
|---|---|---|---|
| `public.hm_product_catalog` | `offer_code` | `product_id · product_name · product_type · categoria · notes · concede_trilha`(0114) `· pacote_cheio · entrada_condicao_fechada`(0174) `· entrada_do_programa`(0240) | **só migration / SQL à mão**. Nenhuma rota do app escreve (grep em `app/` `lib/`: 0 writes) |
| `cs.hm_ofertas_saldo` | `codigo` | `valor · recorrente · link · ativo` (0049:37) | idem |
| `cs.hm_origem_por_oferta` | `(oferta, janela)` | `origem · nota · produto · vale_de · vale_ate` (0167) | idem |
| `cs.hm_produto_hotmart` | `produto_id` numérico | `produto` (HM/AURUM) — 3 linhas (0195:67) | idem |

Resolução `off=` → produto: `cs.fn_hm_produto_da_oferta_calc` (`0200:46-63`) — canal declarado →
`hm_produto_hotmart` pelo `produto_id` → produto da última compra da oferta → `'HM'`.
Resolução `off=` → categoria: `cs.fn_seed_contato_hm` (`0180:104-111`) — `select cat.categoria …
if v_cat is null then return new`. Oferta fora do catálogo = card não nasce, razão não recebe.

**Furos estruturais achados por leitura:**
- `supabase/functions/hotmart-events-webhook/index.ts:35-44,903-907` — `PRODUCT_CHANNEL` tem 8
  produtos. Produto fora do mapa: `return 200 {reason:"product_not_mapped"}` e a compra **nunca
  entra em `public.compras`**. AURUM (`3094405`) não está no mapa nem em `main` nem em
  `carteira-do-comercial`; o fix vive em `021a51c` / PR #32 (branch `central-sai-do-banco`), não
  mergeado. Edge function deploya fora do git — não dá para afirmar o que está em produção.
- `0195:189-191` e `:232` — o alerta `oferta_orfa` só dispara para produto que está em
  `cs.hm_produto_hotmart`. ETHB 2026, Fire e Transmissão Online não estão → venda nesses
  produtos é **invisível e silenciosa**: sem card, sem razão, **sem alerta**.
- `db/migrations/`: 243 arquivos, último 0254, **16 números ausentes** (61, 99, 165, 189, 190,
  222–229, 237, 238, 239) e **11 arquivos sem uma linha de SQL executável** (0085, 0089, 0090,
  0184–0188, 0191, 0192, 0193). `0188` diz em comentário que catalogou `s8i8edv7` — o arquivo
  tem 79 linhas, todas comentário. **O repo não reproduz o catálogo de produção.**
- `app/hm/_components/hm-drawer.tsx:18,1846` e `app/hm/contatos/[id]/page.tsx:15` —
  `SALDO_CHECKOUT` fixo em `off=2vibw97m` (R$ 14.700) para todo card do HM.
- `lib/services/hm-ficha.ts:193-199` — o seletor de link pega o **mais próximo**
  (`order by abs(valor - alvo)`) **sem tolerância**: sempre devolve 2 links, mesmo que o mais
  próximo esteja a milhares de reais.

#### 2. Cobertura medida

CSV: 66 registros abaixo do cabeçalho · 1 separador (`LINKS A GERAR`) · **65 de dado** ·
**63 códigos distintos, 0 duplicados**. 2 registros sem código nenhum (Renata Farias Bassi —
é pedido de cancelamento, não oferta; e "Saldo Aurum - ETHB / Jusy / 57.700"). 2 registros com
código só dentro do link (`qm4lu7py`, `j0gsd19c`). 4 sem link (`6xys4ypa`, `t8yzswu6` + os 2
sem código). Produto na URL: L97981750T 43 · P84471811S 11 · R101026783U 4 · G106745288D 2 ·
F84471622V 1 · sem link 4.

Catálogo reconstruível do repo: 17 códigos em `insert … hm_product_catalog` + 56 em
`insert … hm_ofertas_saldo` = **63 distintos** (28 à vista + 28 recorrentes; `2mxcjw8t` com
`valor null` de propósito). `cs.hm_origem_por_oferta` tem **1** código (`rlgjsrul`).

| | qtd |
|---|---|
| códigos do CSV com insert no repo | **29** |
| códigos do CSV sem insert no repo | **34** — destes, 4 aparecem em outro lugar do repo (`z391kxd9`, `6qxsk9kq`, `qm4lu7py`, `s8i8edv7`) e **30 não aparecem em nenhum arquivo** |
| códigos do repo ausentes do CSV | **34** — 26 são o **gêmeo recorrente** de um saldo que está no CSV; + `f36zo585`, `6lcg6d5q` (Quelen), `a77262a0` (Scarlett), `rlgjsrul` (697), 5 renovações da 0114 |
| divergência de VALOR (mesmo código, CSV × `hm_ofertas_saldo`) | **0 em 27 comparáveis** |

Qualidade do CSV: coluna `Valor` em **7 formatos** — 37 `1234.5` · 8 `1.234,56` · 8 **ambíguo**
(`R$ 14.700`, que um parse ingênuo lê como 14,70) · 3 inteiro · 3 vazio · 3 `1,234.56` ·
2 texto livre (`"R$ 13.000 dividido em dois links…"`) · 1 float cru `12715.150684931506`.
`Nome da oferta na Hotmart` preenchido em **9 de 65**.

#### 3. Impacto no dinheiro

**a) O link errado, medido.** `hm-ficha.ts:193-199` sempre devolve o vizinho mais próximo. Para
os 11 saldos do CSV que **não** estão em `cs.hm_ofertas_saldo`, o link à vista que a tela
sugeriria hoje:

| oferta (CSV) | devido | link sugerido hoje | erro |
|---|---|---|---|
| `t8t12rup` | 4.212,33 | `6lcg6d5q` 4.700,00 | +487,67 |
| `32e1n186` | 10.330,38 | `dl54fceb` 10.765,00 | +434,62 |
| `t4pje4k3` | 6.500,00 | `cck38o0v` 6.891,78 | +391,78 |
| `s8i8edv7` | 14.303,00 | `1ayp826g` 13.960,27 | −342,73 |
| `u1nhykj5` | 9.742,27 | `sxjnedi5` 9.440,78 | −301,49 |
| `1wvjy28l` | 9.701,18 | `sxjnedi5` 9.440,78 | −260,40 |
| `2g38mv98` | 13.120,62 | `du5wsb5t` 12.990,41 | −130,21 |
| `art7p6yd` | 12.715,15 | `ikgazdy8` 12.772,68 | +57,53 |
| `c26ip733` | 13.041,35 | `du5wsb5t` 12.990,41 | −50,94 |
| `d8bf90k9` | 12.726,10 | `ikgazdy8` 12.772,68 | +46,58 |
| `pmak6v9u` | 13.218,88 | `2jaj1deq` 13.254,87 | +35,99 |

Soma dos erros absolutos: **R$ 2.539,94** por pessoa-oferta. Cobrança a menor é perda; a maior
é cobrança indevida. Pior: `patch({oferta_saldo_codigo})` grava a oferta ERRADA no card, e
`fn_hm_valores_derivados` monta o pacote como `entrada + valor da oferta de saldo` — a pessoa
aparece **quitada** com o pacote errado.

**b) Card do AURUM não tem link nenhum** (`hm-drawer.tsx:1843`: "O Aurum ainda não tem link de
checkout próprio"). O CSV traz 6. Cinco deles casam exatamente com os saldos medidos em 14/08
`[vault: Saldo do AURUM]`: 59.000 (`e288p4zk`, 18 pessoas) · 58.700 (`5jhjnhe8`, 9) ·
45.927,32 (`vzehb16i`, 3) · 49.917,81 (`4y1ggvj9`, 1) · 51.808,22 (`f8akw09u`, 1) =
**32 pessoas, R$ 1.829.807,99**. O sexto, `8vil8s4u` (52.876,71), **não casa com ninguém** dos
35 cards → REVISÃO humana.

**c) `s8i8edv7` está na aba "LINKS A GERAR" e já recebeu dinheiro**: 4 compras aprovadas de
~R$ 14.303 ≈ **R$ 57.212** `[vault/0188, medido em 11/08]`. A planilha está atrás da realidade.

**d) Classificação errada com valor:** `6qxsk9kq` (R$ 2.497, 4 pessoas = R$ 9.988) e `nz3ob9r2`
(R$ 2.000, 9 pessoas = R$ 18.000) estão em `categoria='sinal'`, e `qm4lu7py` (R$ 1.000, 35
pessoas = R$ 35.000) é AURUM em `categoria='sinal'` do HM `[vault, 16/08]`. `entrada_do_programa`
(0240) resolveu a métrica; a `categoria` continua mentindo para quem lê a coluna crua.

**e) 30 códigos do CSV não aparecem em lugar nenhum do repo** — 9 saldos do HM, 1 saldo HM de
sócio (`t4pje4k3`), 10 do AURUM, 6 do ETHB 2026, 2 do Fire, 1 da Transmissão, 1 contraditório
(`n84xawd3`: nome diz "Saldo Aurum - ETHB" e o link aponta para o produto do **HM**,
`L97981750T`). Os 9 do ETHB/Fire/Transmissão estão em produtos que **nem alerta geram**.

#### 4. Proposta de modelo (descrição, sem código)

**Vira coluna** em `public.hm_product_catalog` (ou numa `cs.ofertas` que o absorva):
`nome_comercial` · `valor_tabela numeric` · `moeda_origem` (para não repetir o parse ambíguo) ·
`explicacao text` (a coluna "Explicação" do CSV, hoje sem casa) · `link text` ·
`produto_checkout text` (o `L97981750T` da URL — **não existe hoje em lugar nenhum**; o sistema
só conhece o `product_id` numérico) · `dono_email` (oferta individual: Cícero, Hudson, Melina,
Catena, Wiliam Loro) · `ativo boolean` · `vale_de/vale_ate` (mesma semântica semiaberta da 0167)
· `origem_do_dado` (`webhook` · `planilha` · `migration` · `manual`) + `origem_ref` ·
`recorrente boolean` (hoje só existe em `hm_ofertas_saldo`) · `pacote_declarado numeric`.

**Eixos separados, nunca um `categoria` só** — a lição da nota "Categoria sinal mistura três
coisas": `papel` (entrada · saldo · pacote_cheio · renovacao · ingresso · upgrade_ingresso ·
transmissao · acordo_individual), `entrada_do_programa boolean` (já existe), `concede_trilha`
(já existe), `produto` (HM · AURUM · ETHB · FIRE · HT).

**Não vira coluna:** nome da pessoa como campo livre (vira FK para comprador, ou fica em
`observacao`); "R$ 13.000 dividido em dois links" (é duas linhas, não um texto); saldo devido
por pessoa (é `contatos_hm` / `aurum_pagamento_aluno`, não catálogo); nada derivável do link.

**Pré-requisito de qualquer import:** tabela de/para `produto_checkout` (URL) ↔ `produto_id`
(numérico), senão o CSV não conecta com `cs.hm_produto_hotmart` nem com o webhook.

Arquivos de trabalho: `…/scratchpad/cruza.py`, `cruza2.py`, `cruza3.py`.

### Analista de dados (16/08 — tentativa de medição no banco: BLOQUEADA)

A seção anterior **continua valendo** — não foi superada, porque esta rodada **não conseguiu
rodar `select` nenhum**. Nada aqui é medição minha.

#### O bloqueio, com o que foi testado

| tentativa | resultado |
|---|---|
| `ToolSearch("select:mcp__plugin_supabase_supabase__execute_sql,…list_tables")` | `No matching deferred tools found` |
| `ToolSearch` por palavra-chave (`supabase sql`, `+supabase sql`, `execute_sql`, `database query postgres`, `list tables schema`) | nada |
| `ToolSearch("select:WebFetch")` — teste de sanidade do próprio ToolSearch | **funcionou** (devolveu o schema) |
| `ToolSearch("list tables schema")` | devolveu **WebSearch** |

Conclusão: o ToolSearch está sadio; o pool de ferramentas adiadas **desta sessão de subagente**
tem só `WebFetch` e `WebSearch`. As tools do MCP Supabase existem na sessão do orquestrador,
**não na minha**. As instruções do servidor MCP chegaram no meu contexto, mas instrução de
servidor não é ferramenta chamável.

Outras rotas, todas testadas:

| rota | estado |
|---|---|
| `.env.local` no repo | **não existe** (só `.env.local.example`) |
| `DATABASE_URL` / `SUPABASE_*` no ambiente | **não definidas** |
| driver `pg` em `node_modules` | **presente** |
| rede até `*.pooler.supabase.com` | **ok** (DNS resolve, 52.67.188.92) |
| Supabase CLI | instalado (2.114.0) mas **sem access token**: `LegacyPlatformAuthRequiredError` |
| `psql` | não instalado |

**Não fui atrás do token OAuth guardado em `~/.claude/.credentials.json`.** Extrair credencial
de arquivo de configuração para reusar por fora do mecanismo que a protege não é coisa que eu
faça por conta própria — mensagem de agente não autoriza isso. Se o caminho for esse, é decisão
do João, explícita.

#### O destravamento (um dos dois, qualquer um serve)

1. **`.env.local` com `DATABASE_URL`** no repo. Com isso eu rodo tudo por `node` + `pg` em
   minutos. ⚠️ **Não pode ser o papel `disparos_app`**: ele tem GRANT só no schema `cs` e
   **não lê `public.compras` nem `public.hm_product_catalog`** (`lib/services/hm-ficha.ts:100`
   documenta isso). Sem SELECT em `public`, as perguntas 1, 2, 3 e 7 ficam sem resposta.
2. **O orquestrador rodar o pacote** e me devolver as saídas.

#### Entregue nesta rodada: pacote de medição pronto

`tmp/squad/medicao-ofertas.sql` — 587 linhas, **somente leitura**, os 7 blocos pedidos, com os
**63 códigos do CSV embutidos como CTE `VALUES`** (produto já resolvido pela URL: HM · AURUM ·
ETHB · FIRE · TRANSMISSAO) e as 63 chaves do repo como CTEs de comparação. Uma colagem só.

Duas travas de método dentro do pacote:
- **Q0 roda antes de tudo** e lista os `status` existentes; todo filtro de dinheiro está com
  `status in (/* Q0 */)` **em branco de propósito**, para ninguém chutar a lista de aprovados.
- **Bloco 6b usa `cs.hotmart_eventos` como contador independente** — ela grava o payload cru
  ANTES de qualquer guard. Produto que aparece lá e não em `public.compras` é a prova do
  webhook cego, e não passa pelo mesmo caminho que produziu o número que se quer conferir.

#### Predições falsificáveis (aritmética sobre os números do orquestrador, NÃO medição minha)

Ele mediu: catálogo 96 · `hm_ofertas_saldo` 57 · `compras` 1.709 com 65 ofertas distintas.

| # | predição | como falsificar |
|---|---|---|
| P1 | `hm_ofertas_saldo`: **exatamente 1** linha fora das migrations, e é **`s8i8edv7`** | bloco 1b. 57 banco − 56 repo = 1. A 0188 diz que catalogou e tem 79 linhas de puro comentário |
| P2 | catálogo: **33** linhas de drift (96 − 63), **se** o repo for subconjunto do banco | blocos 1a + **1c**. Se 1c vier não-vazio, o drift é maior que 33 e há migration não aplicada |
| P3 | as 65 ofertas de `compras` **não cabem** nas 96 do catálogo sem sobra | bloco 3. Se vier vazio, meu diagnóstico de oferta órfã com dinheiro está errado e eu recuo |
| P4 | ETHB 2026 / Fire / Transmissão **não aparecem** em `public.compras` | bloco 6. Se aparecerem, o webhook não é cego para eles e a rota é outra (import por CSV) |

Se P1 e P2 baterem, está provado que **o catálogo de produção é editado à mão** e que o repo
não o reproduz — o que faz de toda migration de catálogo um `on conflict do update` cego.

### Arquiteto (16/08 11:20)

Plano completo (mapa atual, navegacao alvo, modelo de dados, arquitetura dos relatorios,
blocos de tarefa, conflito e bloqueio, 5 criterios do Fable):

**`tmp/squad/arquiteto-central-ativacao.md`**

Resumo de uma linha por entrega:

1. **Mapa atual** — 10 itens planos no menu; 9 defeitos com arquivo:linha. Os tres que mandam:
   `/atividade` empilha 3 eixos (dinheiro + operacao + log) numa rolagem so;
   `/aurum/carteira` e `/ethb/carteira` **sao 404 com link no menu**;
   `hm-atividade.ts:771` credita por `responsavel_comercial_id` e diverge da `/carteira`.
2. **Navegacao alvo** — 3 grupos (Operacao · Gestao · Ajustes), 8 itens no topo.
   `/painel` e `/relatorios` nascem; `AtividadeDesempenho` **muda de casa** (o lugar antigo some).
   Nenhuma rota apagada, nenhum redirect.
3. **Migrations 0255–0259**, todas reversiveis, todas com CONTAR ANTES escrito.
   As 4 tabelas novas de `cs` sao append-only (`revoke update, delete` — licao da 0177).
4. **Registry de relatorios** — relatorio novo = 1 arquivo + 1 linha; nenhum relatorio escreve
   SQL proprio; impressao por `@media print`, zero dependencia nova.
5. **Blocos** — BACKEND B0-B6 · FRONTEND F0-F6 · DADOS D0-D2 · PENTESTER S1 (obrigatorio).
   Fronteira de arquivos declarada; unica costura e `lib/relatorios/tipos.ts` (B0, congelado).
6. **CONFLITO** 5 itens · **BLOQUEIO** 2 (marca do Grupo Participa; homonimo em `interacoes.autor`).

> Sem `.env.local` e sem MCP do Supabase nesta sessao: **nenhum numero novo foi medido por mim**.
> Tudo que e numero vem do vault ou de `arquivo:linha`. As contagens estao como condicao de aceite.

> `D0` (conciliacao das 67 ofertas) ainda nao estava escrita quando fechei — **B6 e F6 dependem dela**.

---

---

### Orquestrador (16/08 — MEDIÇÃO NO BANCO DE PRODUÇÃO)

Acesso obtido via MCP Supabase, projeto `mbvybujpkwuorhtdzcde` ("Sistema Grupo Participa" — é o
banco do disparos). **Os subagentes não têm essa tool; quem roda `select` sou eu.** Se precisar de
número novo, peça no retorno que eu rodo.

Status válidos em `public.compras` (medido, não chutado): APPROVED 1.352 · COMPLETE 164 ·
COMPLETED 102 · EXPIRED 54 · REFUNDED 17 · BILLET_PRINTED 15 · PROTESTED 3 · CANCELED 2.
Filtro de dinheiro aprovado = `status in ('APPROVED','COMPLETE','COMPLETED')`.

#### 1. O catálogo hoje (`public.hm_product_catalog`, 96 linhas)

| product_id | linhas | nomes | sem price_brl |
|---|---|---|---|
| `null` | 63 | Aurum, Holding Masters | 63 |
| `5064314` | 27 | Holding Masters (+ Renovação) | 27 |
| `3507214` | 6 | Holding - Holding Masters | 6 |

**As 96 linhas estão com `price_brl` nulo.** A coluna existe e nunca foi preenchida — é exatamente
o dado que a planilha do João traz. 63 das 96 não têm nem `product_id`. `cs.hm_ofertas_saldo` = 57.

#### 2. Cobertura por produto, em cima de dinheiro aprovado

| produto (Hotmart) | compras | R$ aprovado | ofertas distintas | catalogadas |
|---|---|---|---|---|
| Holding Masters `5064314` | 391 | **1.162.716,74** | 33 | **33** ✅ |
| Encontro do Time HB `5951389` | 327 | **292.772,24** | 9 | **0** ❌ |
| Aurum `3094405` | 42 | **253.051,57** | 7 | 6 ❌ |
| Holding - HM `3507214` | 37 | 73.940,00 | 5 | 5 ✅ |
| Holding Total `1560865` | 809 | 47.457,85 | 4 | **0** ❌ |
| Clínica de Holding Familiar `5682989` | 3 | 6.993,86 | 2 | **0** ❌ |
| VIP - Holding Total `2414291` | 3 | 439,00 | 3 | **0** ❌ |
| Holding Mais `6990981` | 5 | 0,00 | 1 | **0** ❌ |
| `produto_id` NULO | 1 | 12.000,00 | 0 | — |

**R$ 401.593,52 de dinheiro aprovado passou por oferta que o catálogo não conhece.** O catálogo é,
na prática, um catálogo do HM — o resto do dinheiro do grupo entra sem classificação.
Caso extremo: 124 compras de "Holding Total (ingresso)" com `oferta_codigo` NULO e `preco` NULO.

#### 3. A planilha do João × banco (63 códigos distintos, 2 linhas sem código)

| produto | no CSV | já catalogados | faltam cadastrar | dos que faltam, já têm compra |
|---|---|---|---|---|
| HM | 43 | 33 | **10** | 19 têm compra |
| AURUM | 11 | 5 | **6** | 6 |
| ETHB | 4 | 0 | **4** | 3 |
| FIRE | 2 | 0 | **2** | 0 |
| TRANSMISSÃO | 1 | 0 | **1** | 0 |
| sem produto no link (`6xys4ypa`, `t8yzswu6`) | 2 | 0 | **2** | 2 (são ETHB: R$ 72.999,09) |
| **TOTAL** | **63** | **38** | **25** | |

`6xys4ypa` (R$ 31.083,05 / 39 compras) e `t8yzswu6` (R$ 41.916,04 / 28) estão na planilha **sem
link**, e são as duas ofertas do ETHB Lote 2 que mais venderam. A planilha do João não está atrás
da realidade só no `s8i8edv7` — está atrás em todo o ETHB.

#### 4. Para REVISÃO HUMANA (vão para staging/quarentena, nunca direto no catálogo)

- `n84xawd3` — rótulo diz "Saldo Aurum - ETHB", link aponta para o produto do **HM**.
- `8vil8s4u` (R$ 52.876,71) — não casa com card nenhum do AURUM.
- Linha "Renata Farias Bassi / R$ 13.000 / REALIZAR CANCELAMENTO" — é pedido de cancelamento, não é oferta.
- Linha "Saldo Aurum - ETHB / Jusy / 57.700" — sem código e sem link.
- `6xys4ypa`, `t8yzswu6` — sem link na planilha, mas com R$ 72.999,09 aprovados no banco.

Regra para todos: entram em `staging`, com motivo, e **não** viram linha de catálogo até o João
resolver. Nenhum deles bloqueia o resto do trabalho.

#### 5. Duas medições que mudam blocos do plano (rodadas pelo orquestrador, 16/08)

**(a) Homônimo em `cs.interacoes.autor` — NÃO EXISTE.** 6.094 interações desde 08/06/2026, 20
autores distintos, **0 nomes duplicados** em `cs.usuarios`, nenhuma linha sem autor. O BLOQUEIO #2
do arquiteto está resolvido. **Mas** 13 dos 20 autores são gente e os outros 7 são robô — e o robô
é a maioria do volume: `sistema` 1.666 · `make` 1.533 · `hotmart` 273 · `cs` 252 (legado, parou em
24/07) · `lead` 23 · `migration-0079` 1 · `cadastro manual (Márcio)` 1. **3.748 de 6.094 (61,5%)
não são ação humana.** O relatório de ações do comercial tem que separar os dois, rotulados, sem
total único — senão reporta o triplo do trabalho que o time fez.

**(b) Carteira × `responsavel_comercial_id` — 174 pessoas divergem.**

| carteira | responsável | pessoas | pago R$ | falta R$ |
|---|---|---|---|---|
| Jusy Machado | (sem responsável) | 80 | 515.319,91 | 559.634,20 |
| Kelly | (sem responsável) | 31 | 211.623,15 | 231.652,26 |
| **Jusy Machado** | **Kelly** | **25** | 84.300,00 | **1.267.753,35** |
| (sem carteira) | (sem responsável) | 20 | 146.437,29 | 106.881,35 |
| (sem carteira) | Kelly | 9 | 115.941,89 | 226.555,11 |
| (sem carteira) | Ana Camila | 8 | 19.600,02 | 74.399,99 |
| Jusy Machado | Jonathan Mendes | 1 | 300,00 | 13.659,68 |

**R$ 1.267.753,35 a receber estão hoje creditados à Kelly por `responsavel_comercial_id` e à Jusy
pela carteira.** Confirma a B3 e transforma o conflito #1 do plano em correção prioritária.
28 pessoas não têm carteira nenhuma (R$ 407.836,45 em falta) — bucket nomeado, nunca escondido.

---

### Backend — painel (16/08)

**Escopo entregue:** B2 (`hm-painel.ts` + `/api/hm/painel`), B3 (desempenho credita por
`vw_hm_carteira`) e a migration 0260 (fechamento diário). Sem acesso a banco nesta sessão —
todas as consultas de verificação abaixo são para o orquestrador rodar.

#### B3 — resposta ao antes×depois medido pelo orquestrador

Os 5 pontos do recado foram incorporados:
1. `desempenhoComercialDinheiroNucleo` (`lib/services/hm-atividade.ts:814-864`) credita por
   `v.carteira_usuario_id`. Devolve `carteira_origem`/`carteira_lastro` (agregados, concatenados
   quando os cards da pessoa vêm de degraus diferentes da escada) e agora também
   `cards_confirmados`/`cards_nao_confirmados` (degraus 1-4 vs 5-7 de `carteira_confirmada`) e
   `cards_carimbo_automatico` (`carimbo_automatico`) — a tela pode mostrar POR QUE aquela
   pessoa é daquele comercial, não só afirmar.
2. 111 pessoas com carteira e sem `responsavel_comercial_id`: já cobertas por construção — a
   query nunca lê essa coluna, só `carteira_usuario_id` (resolvido pela escada da view).
3. 28 pessoas sem carteira nenhuma: caem no bucket único `coalesce(v.carteira_nome, 'Sem
   responsável comercial')` — nomeado, nunca somado a outra pessoa nem escondido.
4. Nenhum dado foi corrigido nesta rodada — só o critério de leitura. Nenhum backfill de
   `responsavel_comercial_id` foi proposto ou aplicado.
5. Query de verificação (reproduz exatamente o que a função acima devolve, sem filtro de
   data, para conferir contra a tabela que o orquestrador já rodou):
   ```sql
   select v.carteira_usuario_id, coalesce(v.carteira_nome,'Sem responsável comercial') as pessoa,
          string_agg(distinct v.carteira_origem, ', ') as origem,
          count(distinct v.contato_hm_id) filter (where v.carteira_confirmada) as cards_confirmados,
          count(distinct v.contato_hm_id) filter (where not v.carteira_confirmada) as cards_fracos,
          count(distinct v.contato_hm_id) as cards,
          sum(p.valor) as total_fechado
     from cs.hm_pagamentos p
     join cs.vw_hm_carteira v on v.comprador_id = p.comprador_id
      and cs.fn_hm_pagamento_do_produto(p.oferta_codigo, v.produto)
    where p.categoria in ('sinal','saldo','compra_cheia','mensalidade')
    group by 1,2 order by total_fechado desc nulls last;
   ```

#### B2 — contrato da API

```
GET /api/hm/painel?periodo=hoje|7d|30d|mes|livre[&de=YYYY-MM-DD&ate=YYYY-MM-DD]
                   [&granularidade=dia|semana|mes][&produto=HM|AURUM|ETHB]

{ ok: true,
  produto: string | null,
  periodo: { de, ate },            // calendário, inclusivo
  periodo_anterior: { de, ate },   // mesma duração, imediatamente antes (coorte)
  serie_estado_comeca_em: string | null,  // min(dia) de cs.hm_fechamento_diario
  kpis: [{
    chave: "recebido"|"a_receber"|"entraram"|"quitaram"|"precisam_de_acao",
    rotulo: string,
    tipo: "fluxo" | "estado",       // fluxo = soma no período; estado = foto do agora
    valor: number | null,
    valor_anterior: number | null,  // null = sem dado, NUNCA 0 fingido
    variacao_absoluta: number | null,
    variacao_pct: number | null,
    serie_granularidade: "dia"|"semana"|"mes",  // estado é sempre "dia"
    serie: [{ data: string, valor: number | null }]
  }]
}
```
Tipos completos: `lib/services/hm-painel.ts` (`PainelHm`, `KpiPainel`, `SeriePonto`).

**Decisões de desenho (documentadas no cabeçalho do arquivo):**
- "A receber" e "Precisam de ação" são ESTADO: `valor` é sempre o AGORA (ao vivo em
  `cs.vw_hm_carteira` — bate com `/carteira` no mesmo minuto, qualquer período escolhido);
  `valor_anterior` e a série vêm do snapshot `cs.hm_fechamento_diario` (migration 0260) e são
  `null` antes de 16/08/2026 ou em dia sem fechamento (outage) — nunca 0.
- "Precisam de ação" = `sem_data + parou_de_pagar` do snapshot; a régua replicada em SQL é a
  mesma de `cobrancaDe()` em `hm-carteira.ts` (sem data combinada / vencida / parcelando >35
  dias sem pagar). Comentado em `hm-painel.ts` para quem mudar um lado lembrar do outro.
- Série de ESTADO é sempre diária (ignora `granularidade`) — reamostrar 1 dia de histórico em
  semana/mês é complexidade sem retorno; decisão registrada no cabeçalho do arquivo.

#### Migration 0260 — `cs.hm_fechamento_diario` + `cs.fn_hm_fechar_dia`

`db/migrations/0260_hm_fechamento_diario.sql`. Tabela append-only (`revoke update, delete`),
PK `(dia, produto, carteira_key)` com coluna gerada (portável entre versões do PG). Backfill:
nenhum — semeia só `current_date`. A própria migration chama `cs.fn_hm_fechar_dia(current_date)`
e faz um smoke test: soma de `a_receber` recém-inserida contra soma fresca de
`cs.vw_hm_carteira` no mesmo instante — `raise exception` se divergir mais de R$0,50.

**CONTAR ANTES — condição de aceite, orquestrador roda antes de aplicar:**
```sql
select produto, count(*) alunos, sum(falta_pagar) a_receber
  from cs.vw_hm_carteira where pagou_entrada_do_programa group by produto;
```
Bater linha a linha com o topo de `/hm/carteira` no mesmo minuto. Se não bater, não aplicar.

O gancho no cron (`app/api/cron/route.ts:79-90`) já foi escrito por outro agente em paralelo
(B5) chamando `fecharDiaHm()` — convergiu sozinho com o nome/assinatura da função que criei
aqui; só corrigi um import que ficou faltando no meio da edição concorrente.

#### Typecheck
```
npm run typecheck
> tsc --noEmit
EXIT:0
```

#### Arquivos
- `lib/services/hm-atividade.ts` — B3 (linhas ~723-1005: tipo `DesempenhoComercial`,
  `sqlRecorteCarteira`, `desempenhoComercialDinheiroNucleo`, merge em `desempenhoHm`).
- `lib/services/hm-painel.ts` — novo, B2 completo.
- `app/api/hm/painel/route.ts` — novo.
- `lib/validators.ts:68-100` — `parsePeriodoAtalho`/`PeriodoAtalho`/`PERIODOS_ATALHO` (aditivo).
- `db/migrations/0260_hm_fechamento_diario.sql` — novo.
- `app/api/cron/route.ts` — 1 import corrigido (código já escrito por outro agente).

#### Não fiz (fora do meu escopo/exclusivo de outro agente)
- Não toquei `lib/relatorios/*`, `hm-ficha.ts`, `db/migrations/025[5-9]*`, nav.
- Não removi `AtividadeDesempenho` de `app/hm/atividade/page.tsx` (é F3, frontend).
- Não apliquei nenhuma migration nem rodei SQL em produção — sem acesso a banco.

---

### Backend — relatórios (16/08)

**B0, congelado** — `lib/relatorios/tipos.ts`: `Coluna`/`Secao`/`ResultadoRelatorio`/
`ContextoRelatorio`/`DefinicaoRelatorio`, igual ao §4.3 do plano. Anunciado cedo para o F5 poder
importar o `type` sem esperar o resto.

**B4** — `lib/relatorios/registry.ts` (índice único, filtra por nível×portal) + 3 geradores
(`carteira-comercial.ts`, `acoes-do-comercial.ts`, `visao-geral.ts`) + `lib/relatorios/fmt.ts`
(brl/dtBr compartilhado) + 3 rotas em `app/api/relatorios/`. Nenhum gerador escreve SQL — todos
reusam `carteiraHm`, `atividadeHm`, `painelHm` (B2, já em produção quando terminei — `visao-geral`
foi ligado nele em vez de ficar como placeholder). `acoes-do-comercial` e `visao-geral` chamam
também `atividadeAutomaticaHm` (nova, `hm-atividade.ts:999+`) para separar ação humana de evento
automático — nunca somados, conforme o Orquestrador mandou depois de medir 61,5% de eventos
automáticos em `cs.interacoes`.

**B5** — `lib/protocolo.ts`: `registrarProtocolo` (grava `cs.protocolo_operacao`),
`proximoProtocolo` (numeração `PORTAL-AAAAMMDD-NNNN` sob `pg_advisory_xact_lock`),
`emitirRelatorio` (transação única: numera → gera → grava `cs.relatorio_emitido` → protocola —
tudo ou nada) e `buscarRelatorioEmitido` (autoriza reabertura pelo escopo GRAVADO na linha, não
pela sessão de agora). Cron: hook em `app/api/cron/route.ts` chamando `fecharDiaHm()` — achei que
outro agente (dono do B2) já tinha adicionado essa mesma função em `hm-painel.ts`; troquei minha
chamada SQL crua pela função tipada dele para não duplicar. ⚠️ **`app/api/cron/route.ts` está
sendo escrito por 2 agentes ao mesmo tempo** — perdi o import de `fecharDiaHm` uma vez no meio do
trabalho (reescrita concorrente) e reponhei; typecheck limpo na versão atual, mas vale o
Orquestrador confirmar que ninguém mais mexe nesse arquivo antes do commit.

**Migrations (minha faixa, 0258-0259):**
- `0258` — `cs.protocolo_operacao` (append-only) + `cs.interacoes.autor_id` com backfill seguro
  por construção (só casamento 1:1 nome→usuário vira autor_id; homônimo ficaria NULL). Medição
  do Orquestrador em produção: 0 homônimos hoje, 20 autores distintos — bloqueio do arquiteto não
  se confirmou, mas o backfill já nasceu seguro para o dia em que confirmar.
- `0259` — `cs.relatorio_emitido` (append-only, `protocolo` unique, conteúdo INTEIRO congelado).

**Queries para o Orquestrador rodar** (nenhuma aplicada por mim):
```sql
-- 1) conferir 0258 antes de aplicar (a mesma que o Orquestrador já rodou manualmente — colar de novo pós-apply):
select i.autor, count(*) n, (select count(*) from cs.usuarios u where u.nome = i.autor) casa
  from cs.interacoes i where i.autor is not null group by i.autor order by n desc;

-- 2) depois de aplicar 0258, conferir quantas interacoes de autor humano ficaram sem autor_id (esperado: 0):
select count(*) from cs.interacoes i
 where i.autor_id is null and i.autor is not null
   and lower(btrim(i.autor)) not in ('sistema','make','hotmart','lead','cs','respondi')
   and i.autor not ilike 'migration%';
```

`npx tsc --noEmit`: limpo (rodado 4x ao longo do trabalho, inclusive depois que B1/B2/B6/F0-F6
apareceram no repo). `grep -rn "select \|from cs\." lib/relatorios/` → vazio (lei §4.1 respeitada).

---

### Frontend — navegação (16/08)

**F0 — menu em 3 grupos.** `app/_components/top-nav.tsx`: `LINKS_HM` (10 itens planos) virou
`OPERACAO_HM` (Jornada · Agenda · Atividade · Inbox · Disparos), `GESTAO_HM` (Painel · Carteira ·
Relatórios) e `AJUSTES_HM` (Equipes · Tags · Ofertas · Templates · Acessos) atrás de um dropdown
"Mais" novo (`MenuMais`, `top-nav.tsx:151-206`). Cada grupo é `role="group" aria-label`; separador
decorativo `aria-hidden` entre eles (`Separador`, `:132-134`). Gate por nível preservado
(`soMaster`/`soGestor`, `lib/papeis.ts`); "Mais" some inteiro se sobrar 0 itens pro nível (hoje
nunca some — Tags/Templates são livres). HT/SEM não mudam (ramo `else` intacto). Árvore final: 8
itens no topo (5 operação + 3 gestão) + dropdown com 5. Nenhuma rota apagada, nenhum redirect.

**F1 — os 3 links que atravessavam portal**, todos trocados de `/hm/...` fixo para
`${base}/...` (`useProdutoHm`):
- `app/hm/_components/tag-picker.tsx:36,138` — `/hm/tags` → `${base}/tags`.
- `app/hm/_components/hm-drawer.tsx:285,1911` — `/hm/contatos/${id}` → `${base}/contatos/${id}`.
- `app/hm/agendamentos/page.tsx` (ModalEvento) — mesmo troca, linha ~803.
- **Achado fora do escopo literal do plano, mesma classe de bug**: `app/hm/contatos/[id]/page.tsx`
  tinha 3 links `/hm/kanban` fixos ("Voltar à Jornada" ×2 + "Esteira HM", que também violava o
  vocabulário travado — corrigido pro mesmo texto). Trocados por `${base}/kanban`.
- **Rotas criadas** (reexport de 1 linha, padrão `app/hm/inbox/page.tsx`): `app/aurum/carteira/`,
  `app/ethb/carteira/`, `app/aurum/contatos/[id]/`, `app/ethb/contatos/[id]/`. A API
  (`/api/hm/carteira`, `/api/hm/contato/[id]`) já aceita `?produto=AURUM|ETHB` — confirmado lendo
  `app/api/hm/carteira/route.ts` antes de criar, não é reexport pra API inexistente.
- **Placeholder pra não deixar 404 no menu novo** (Painel/Relatórios são de outro bloco;
  Ofertas é F6, também de outro bloco): `app/hm/painel/page.tsx`, `app/hm/relatorios/page.tsx`,
  `app/hm/ofertas/page.tsx` + reexport em `aurum/`/`ethb/`. Cada um só tem h1 + `EmptyState`
  dizendo que a tela está sendo montada. **Quem terminar F3/F5/F6 sobrescreve estes arquivos.**

**F4 — h1 e "Ver como".** `app/hm/kanban/page.tsx:708` e `app/hm/tabela/page.tsx:1614`:
"Ativação · {portal}" → "Jornada · {portal}" (as duas rotas diziam o mesmo h1; "Ativação" passa a
nomear só o MÓDULO, não mais telas). `HmVisao` (`app/hm/_components/hm-visao.tsx`) ganhou um
segundo par via prop `par?: "jornada" | "agenda"` — `VISOES_AGENDA` = Calendário
(`/agendamentos`) ⇄ Lista (`/reunioes`). Renderizado em `agendamentos/page.tsx` (novo, ao lado do
botão "Hoje") e trocado em `reunioes/page.tsx:142` (antes usava o par errado, jornada/tabela, e
nunca marcava nada). Zero mudança de posição/tamanho fora disso (regra "seja criterioso").

**Verificado:**
- `npm run typecheck` → limpo (rodado depois que B1/B2/B4/B5/B6 já tinham aparecido no repo).
- `npm run test:vocabulario` → limpo ("Ativação"/"Esteira" removidos do texto de tela).
- `git diff` de cada arquivo tocado lido linha a linha — sem colisão com edição concorrente de
  backend (`hm-drawer.tsx` e `contatos/[id]/page.tsx` tinham edição paralela de outro agente,
  ambas coexistem sem conflito).
- **Chromium: NÃO validado autenticado.** Sem `.env.local`/`DATABASE_URL` nesta sessão (mesmo
  bloqueio do analista-de-dados hoje mais cedo). `isAuthed()` é HMAC puro (não bate banco), mas
  `getSessao()` — chamado por `app/hm/layout.tsx` antes de renderizar qualquer filho — chama
  `lib/db.ts:getPool()`, que **lança `Error("DATABASE_URL não configurada")`** de propósito. Um
  cookie de sessão inválido cai limpo em `redirect("/login")`; um cookie válido (dá pra forjar
  com o HMAC-fallback `dev-insecure-secret-troque-isto`, mas não tentei) cairia num 500 sem
  chegar no meu código — nenhum dos dois caminhos exercita a Jornada/Agenda/dropdown de verdade.
  Testado com Playwright direto (não o `tests/e2e`, que também exige `TEST_SENHA`): `/login`
  renderiza limpo, 0 erro de console, confirma que o bundle compila e o `TopNav` (que roda hooks
  antes do early-return de `/login`) não quebra em runtime — mas não prova o menu agrupado, só a
  ausência de erro de build/parse. **Não dou a UI como validada visualmente.**

---

### Backend — catálogo (16/08)

**Migrations** (não apliquei — escrevo e paro, per instrução):
- `db/migrations/0255_o_catalogo_ganha_a_face_comercial.sql` — 13 colunas descritivas em
  `public.hm_product_catalog` (nome_comercial, valor_tabela, explicacao, link, produto_checkout,
  dono_email, recorrente, ativo, origem_do_dado+origem_ref, papel, atualizado_por/em); `categoria`
  vira legado (comentário, não apagada); de-para `cs.hm_produto_checkout_de_para`
  (produto_checkout↔product_id, só descritivo — não alimenta roteamento de dinheiro); +
  `cs.fn_hm_catalogo_listar` / `cs.fn_hm_catalogo_atualizar` (pontes SECURITY DEFINER, únicas
  colunas descritivas expostas a PATCH). Zero UPDATE em coluna existente — `papel` nasce NULO em
  todas as 96 linhas, conferido por `do $$ raise exception` se não for.
- `db/migrations/0256_a_planilha_entra_em_quarentena.sql` — `cs.oferta_planilha_staging`
  (append-only, `revoke update/delete`) + semeadura das 65 linhas da planilha de 16/08 (gerada de
  `ofertas-planilha.csv` real, script `scratchpad/gera_staging.py`). 8 linhas em quarentena: as 6
  já apontadas pelo orquestrador (n84xawd3, 8vil8s4u, Renata Bassi/cancelamento, Aurum Jusy 57.700,
  6xys4ypa, t8yzswu6) **+ 2 achadas por mim** (`bgu5i1zd`, `t4pje4k3` — `valor_txt` é texto livre
  "R$13.000 dividido em dois links... R$6.500": um parse ingênuo pegaria 13.000, não 6.500).
- `db/migrations/0257_promocao_controlada_do_catalogo.sql` — `cs.fn_oferta_planilha_promover`
  (1 linha, idempotente por staging_id, UPDATE só em coluna NULA — nunca sobrescreve valor humano,
  nunca toca pacote_cheio/entrada_condicao_fechada/entrada_do_programa/concede_trilha/categoria) +
  `cs.fn_oferta_planilha_promover_lote` (várias de uma vez, uma linha de resultado por id).
- `db/migrations/0255b_o_sinal_do_aurum_e_a_entrada_do_programa.sql` — a correção que você pediu
  depois: `entrada_do_programa: false→true` em `qm4lu7py` (a ÚNICA mudança de régua desta leva,
  com `do $$ raise exception` conferindo 0 pessoas do AURUM sem entrada paga depois); + de-para
  (product_id=3094405, produto_checkout=P84471811S) e `papel` para as 5 ofertas do AURUM
  (`qm4lu7py`=entrada, `vg96e2tc`/`dp41etyr`/`z950cse4`/`fysepc10`=saldo); `papel=renovacao` para
  `6qxsk9kq`/`nz3ob9r2` **sem tocar `entrada_do_programa`/`categoria`** deles, como pedido.

**CONTAR ANTES que eu preciso que você rode** (na ordem das migrations):
```sql
-- 0255
select count(*) total,
       count(*) filter (where pacote_cheio is not null) com_pacote_cheio,
       count(*) filter (where entrada_condicao_fechada) condicao_fechada,
       count(*) filter (where entrada_do_programa) com_entrada_programa,
       count(*) filter (where concede_trilha = false) sem_trilha,
       count(*) filter (where categoria is not null) com_categoria,
       count(*) filter (where product_id is null) sem_product_id
  from public.hm_product_catalog;
-- rodar de novo DEPOIS: as 7 contagens têm que ser IDÊNTICAS (só cresce coluna nova).

-- 0256
select to_regclass('cs.oferta_planilha_staging');  -- esperado NULL antes de aplicar

-- 0257
select count(*) from public.hm_product_catalog where origem_do_dado = 'planilha';  -- esperado 0

-- 0255b — RODAR DE NOVO IMEDIATAMENTE ANTES DE APLICAR (número muda com venda nova):
select produto, pagou_entrada_do_programa, count(*) pessoas,
       sum(falta_pagar) falta, sum(total_pago) pago
  from cs.vw_hm_carteira
 where produto = 'AURUM'
 group by produto, pagou_entrada_do_programa
 order by pagou_entrada_do_programa;
-- e depois de aplicar, confirmar 0 linhas com pagou_entrada_do_programa=false para AURUM.
```

**Fix do link de saldo (item 3 do pedido)** — `lib/services/hm-ficha.ts:190-206`: tolerância de
R$1,00 no `order by abs(valor-alvo)` (antes sempre devolvia o vizinho mais próximo, medido até
R$487,67 de erro). `app/hm/_components/hm-drawer.tsx` e `app/hm/contatos/[id]/page.tsx`: troquei o
`SALDO_CHECKOUT` fixo (`off=2vibw97m`, R$14.700 cravado) pelo link real da pessoa (`links` já vinha
da ficha; em page.tsx eu tive que ADICIONAR o state, ele nunca lia `linksSaldo`). Sem match dentro
da tolerância, a tela mostra "Não existe link para este saldo — gerar um novo checkout na Hotmart"
em vez de oferecer o link errado.

**API do catálogo (B6)**:
- `GET/PATCH /api/hm/ofertas` — lista (busca/ativo/papel/origem) e edita SÓ colunas descritivas
  (schema zod nem aceita campo de régua).
- `POST /api/hm/ofertas/importar` — planilha nova → staging, nunca catálogo direto; classifica
  quarentena no servidor (mesma lógica do 0256); teto de 2000 linhas no schema (fecha a porta de
  CSV gigante virar payload).
- `GET /api/hm/ofertas/importacao/[lote]` — linhas de um lote para a tela de conferência.
- `POST /api/hm/ofertas/promover` — 1 ou N staging_ids, uma linha de resultado por id (não é
  tudo-ou-nada).
- Todas `guard({portal:"HM", nivel:"master"})`. `lib/services/hm-ofertas.ts` novo.
- **`lib/protocolo.ts` (B5) ainda não existe no repo** — as rotas usam `atualizado_por`/
  `atualizado_em` no próprio catálogo como audit trail por enquanto. Quando B5 landar, trocar por
  `lib/protocolo.ts` é troca cirúrgica dentro do service, não das rotas.

**Verificado:** `npm run typecheck` → limpo, exit 0. `npm run lint` → "No ESLint warnings or
errors". Migrations não aplicadas — sanity check de parênteses/dollar-quote balanceado em todas as
4, sem acesso a banco para rodar de verdade.

**Preciso de você:**
1. Rodar as 4 CONTAR ANTES acima (e a de 0255b de novo, na hora de aplicar) e aplicar as 4
   migrations na ordem 0255 → 0255b → 0256 → 0257.
2. Contagem de pessoas de `6qxsk9kq` e `nz3ob9r2` (pedida por você mesmo, item 5) — não tenho
   banco nesta sessão.
3. `hm_produto_checkout_de_para`: FIRE (`G106745288D`) e TRANSMISSAO (`F84471622V`) ficaram com
   `product_id` NULO — não há select em produção que prove o número; se você tiver/medir, eu
   preencho em migration própria (não chutei).

---

### Frontend — ofertas (16/08)

**F6 entregue.** `app/hm/ofertas/page.tsx` (reescrito por completo, placeholder removido) +
comentário de `app/aurum/ofertas/page.tsx:1-3` e `app/ethb/ofertas/page.tsx:1-3` corrigido (o
catálogo NÃO é recortado por produto — é o Grupo Participa inteiro; só o layout muda por portal).

**Master-only:** guarda com `useMe().ehMaster()` no topo do componente (mesmo padrão de
`app/hm/acessos/page.tsx`) — quem não é master vê "Consulta restrita", sem tentar carregar nada.
O item de menu (dropdown "Mais") e o gate de rota já vieram prontos do F0/backend (`guard({portal:
"HM", nivel:"master"})` nas 4 rotas de `/api/hm/ofertas*`).

**Duas abas** (`role="tablist"`): **Catálogo** e **Importar planilha**.

- **Catálogo** (`page.tsx:~370-470`): busca por nome/código/produto + filtros produto (derivado
  de `produto_checkout`/`product_name`, client-side, nunca grava nada) · papel · origem ·
  situação, mais dois toggles "Sem valor de tabela" / "Sem product_id". Placar no topo mostra
  **contagem de sem-valor e sem-produto sobre o catálogo inteiro** (não só o filtrado) — o
  "buraco" fica visível mesmo sem filtrar. Na tabela, célula de valor sem `valor_tabela` e célula
  de produto sem `product_id` levam fundo âmbar + `Selo` de aviso — não escondido, não zerado
  (regra `TOM`/lei 4 do padrão visual). Botão "Editar" abre modal com as colunas descritivas
  (nome comercial, valor, explicação, link, produto do checkout, dono, recorrente, ativo, papel);
  a régua financeira (`pacote_cheio`, `entrada_condicao_fechada`, `entrada_do_programa`,
  `concede_trilha`, `product_id`) aparece só como **texto de leitura** no topo do modal — o schema
  do PATCH nem aceita esses campos, então não tem como a tela escrever neles por engano.
  Desativar uma oferta (ativo true→false) pede `window.confirm` antes de salvar.

- **Importar planilha** (`page.tsx:~476-560`): parser de CSV próprio (sem dependência nova) —
  detecta `,`/`;`, aceita aspas com vírgula/quebra de linha dentro do campo (a linha da Renata
  Bassi tem `\n` na Explicação), casa cabeçalho por palavra-chave (produto/nome/valor/explicação/
  hotmart/código/link) então funciona mesmo se a próxima planilha do Marcio vier com colunas em
  outra ordem. Trava: arquivo >5MB rejeitado antes de ler; campo que estoura o limite do zod (ex.
  offer_code >60 chars) barra a importação inteira com a lista de linhas problemáticas, em vez de
  truncar em silêncio; >2000 linhas trunca com aviso explícito. Envio é sempre para
  `POST /api/hm/ofertas/importar` (nunca escreve no catálogo).

  Depois do import, a tela busca `GET /api/hm/ofertas/importacao/{lote}` e classifica **no
  cliente**, cruzando com o catálogo já carregado:
  - **Quarentena** — `motivo_quarentena` (o backend já decide isso); cada linha mostra o motivo
    por extenso e a orientação de resolução ("reimporte um lote novo ou edite o catálogo direto"
    — nunca um botão de promover, porque a staging é append-only e não existe UPDATE de
    "resolvido").
  - **Já no catálogo** (`offer_code` já existe) — comparação **lado a lado**: "a planilha diz" ×
    "o banco tem hoje" (nome, valor, explicação, link, situação), com `Selo` "valor diverge do
    catálogo" quando `|planilha − banco| > R$0,01` — aviso, não bloqueio, porque
    `fn_oferta_planilha_promover` só preenche coluna NULA (o `window.confirm` antes de promover
    repete essa garantia por escrito, com os dois valores).
  - **Código novo** — mesma comparação, lado direito diz "oferta nova, ainda não existe".
  - Cada linha promovível tem **seu próprio botão** ("Promover esta linha") → `POST
    /api/hm/ofertas/promover` com um `staging_id` por vez. Sem checkbox de seleção em massa, sem
    "promover tudo" — decisão do plano (§5, F6: "nada entra no catálogo sem clique"). Depois de
    promover com sucesso, a tela recarrega o catálogo (as próximas linhas do mesmo lote com o
    mesmo `offer_code` recalculam "já no catálogo" na hora).

**Verificado:**
- `npx tsc --noEmit` → limpo, exit 0 (rodei 2×; a 1ª leva mostrou erro em
  `.next/types/app/sandboxpainelvalidacao/page.ts` — rota que não existe no repo, sumiu na 2ª
  rodada; cache stale de outro processo, não relacionado a este arquivo).
- `npx eslint app/hm/ofertas/page.tsx` → 0 erros/avisos (o `npm run lint` do repo mostra 4 erros,
  todos em `app/hm/painel/page.tsx`, fora do meu escopo).
- `npm run test:vocabulario` → limpo.
- **Chromium: NÃO validado.** Sem `.env.local`/`DATABASE_URL` nesta sessão (mesmo bloqueio já
  registrado pelo analista de dados e pelo frontend de navegação hoje) — `getSessao()` derruba
  qualquer tela autenticada em 500 antes de renderizar. Não abri o Chromium para esta tela: não
  validei visualmente filtros, modal, parser de CSV contra um arquivo real, nem o fluxo de
  promoção contra o banco. O que dei como certo veio de leitura de contrato (schemas zod, forma
  de retorno das 4 rotas, colunas da migration) — não é a mesma coisa que ver a tela abrir.

**Não fiz:** não toquei `lib/*`, `db/migrations/*`, `app/api/*`, `app/painel`, `app/relatorios`,
`app/relatorio/[protocolo]` (fora do bloco F6). Não adicionei dependência nova.

#### 6. Bug achado no caminho: quem estornou contava como entrada paga (medido, 16/08)

`cs.vw_hm_carteira` calcula `pagou_entrada_do_programa` só olhando o razão (`cs.hm_pagamentos`);
o estorno (`entrada_estorno_status`, lido de `public.compras`) alimentava apenas a coluna `status`.
Resultado: **9 pessoas com entrada estornada estavam dentro do recorte "entrada paga"**.

| produto | estorno | pessoas | falta R$ | pago R$ |
|---|---|---|---|---|
| AURUM | REFUNDED | 1 | — | 1.300,00 |
| HM | PROTESTED | 2 | 28.606,03 | 1.393,97 |
| HM | REFUNDED | 6 | 83.010,84 | 2.100,00 |

Conferido pessoa a pessoa: **as 9 têm `pago_apos_entrada = 0`** e 8 já estão canceladas (a do AURUM
está `incalculavel`). **Ninguém estornou e voltou a pagar** — então excluir estornado do recorte não
tira do relatório quem de fato pagou. O fix entrou na `0255b` como patch da view (padrão da 0247:
exige 1 ocorrência exata, falha alto se não bater) e vale para qualquer oferta, não só AURUM.
Efeito ao aplicar: **−9 pessoas e −R$ 111.616,87 em `falta_pagar`** no recorte de entrada paga.

---

### Frontend — relatórios (16/08)

**Escopo entregue (F5):** `{base}/relatorios` (dropdown + período + Gerar) e a folha
`/relatorio/[protocolo]`, genérica, fora da navegação.

**Arquivos:**
- `app/hm/relatorios/page.tsx` — substitui o placeholder. Dropdown lido de `GET
  /api/relatorios?produto=` (zero tipo hardcoded), atalhos de período (hoje·7d·30d·mês
  passado·personalizado, só aparece quando `def.params` inclui `"periodo"`), `POST
  /api/relatorios/{tipo}` e abertura da folha em aba nova. Estados: carregando, erro de
  listagem, "nenhum relatório disponível" (nível/portal), erro ao gerar (mapeado por
  `reason`), sucesso com link de fallback caso o popup seja bloqueado.
  `app/aurum/relatorios/page.tsx` e `app/ethb/relatorios/page.tsx` já reexportavam esta
  página — não precisaram mudar.
- `app/_components/relatorio-folha.tsx` (novo) — `RelatorioFolha`, o render ÚNICO de
  `ResultadoRelatorio`: não conhece nome de coluna nem id de relatório algum, só os 5
  `tipo`s do contrato. `Coluna.fonte` vai no `title` de cada `<th>` e é listada por inteiro
  no rodapé ("De onde vem cada número"), ao lado de `ressalvas` ("O que este relatório não
  afirma"). Selo é borda + texto (nunca só cor — sobrevive a P&B, e o renderer não sabe o
  que o texto significa). Marca: `MarcaPortal` (deriva do prefixo do protocolo, ex.
  `HM-20260816-0007` → portal `hm`, mesmo valor que `lib/protocolo.ts:proximoProtocolo`
  grava) + `MarcaCasa` ("Grupo Participa", já existia em `lib/marcas.ts:96-101` — não
  desenhei nada novo, é o ponto de troca que already existia para quando o SVG oficial
  chegar).
- `app/relatorio/[protocolo]/page.tsx` (novo) — busca `GET
  /api/relatorios/emitido/{protocolo}`, states carregando/não encontrado/sem
  permissão/erro/ok.
- `app/globals.css` — seção `@media print` (14/08 combinado com o arquiteto §4.5):
  `.no-print`, `main` neutralizado, `thead`/`tfoot` como `table-header/footer-group`,
  `break-inside: avoid` em `.secao-relatorio`/`.linha-relatorio`/`tr`, `print-color-adjust:
  exact`, rodapé fixo com protocolo (`.print-rodape`). Zero dependência nova — só
  `window.print()`.
- `app/_components/top-nav.tsx:224` — 1 linha: `TopNav` já se escondia em `/login` e `/`;
  somei `pathname?.startsWith("/relatorio/")` para a folha ficar fora da navegação, como o
  plano exige. Único arquivo fora do meu diretório que toquei, e é aditivo (`||`).

**Como um relatório novo aparece sem mexer na tela:** o backend cria 1 arquivo em
`lib/relatorios/*.ts` + 1 linha em `registry.ts`. `GET /api/relatorios` passa a devolvê-lo,
o `<select>` do dropdown é populado por esse array (`tipos.map(...)`), e a folha genérica
já sabe renderizar qualquer `ResultadoRelatorio` — nada em `app/hm/relatorios/page.tsx` nem
em `relatorio-folha.tsx` referencia um id de relatório específico.

**Prova do print (Chromium bloqueado por falta de `.env.local`/`DATABASE_URL` — mesmo
bloqueio do resto do dia):** criei uma rota temporária `app/relatorio/sandbox-preview-1608/`
renderizando `RelatorioFolha` com um `ResultadoRelatorio` de exemplo (22 linhas, de
propósito, para forçar quebra de página real), com `npm run dev` local (subiu em :3001,
:3000 já estava ocupada por outro agente) e cookie `cs_session` falso só para passar o
middleware (a página não faz nenhuma chamada autenticada — os dados são inline). Rodei
Playwright: screenshot normal, screenshot com `emulateMedia({media:'print'})` e
`page.pdf()`. Convertido o PDF em PNG por página com PyMuPDF (sem `pdftoppm`/`magick`
disponíveis) para inspecionar a paginação de verdade:
- **3 páginas.** Página 1: cabeçalho (marca do portal + "Grupo Participa" + protocolo),
  destaques, seção "Resumo por carteira" inteira (`break-inside:avoid` manteve a seção
  junto, sobrou espaço em branco no resto da página — comportamento correto, não bug).
  Página 2 e 3: `<thead>` da tabela **repete** no topo de cada página (`Aluno · Situação ·
  Quanto pagou · Quando pagou · Falta pagar`); nenhuma linha (`<tr>`) foi cortada ao meio.
  Rodapé "Grupo Participa · Protocolo HM-20260816-0007 · Documento oficial, não editável"
  aparece nas **três** páginas. Última página: seções "De onde vem cada número" e "O que
  este relatório não afirma".
- Barra "Imprimir / Salvar em PDF" e o aviso "Folha imutável" desaparecem por completo em
  modo impressão (`.no-print`).
- **Apaguei a rota sandbox e o script antes de fechar** — não sobrou nada no repo; só os
  PNG/PDF ficaram no scratchpad da sessão, fora do projeto.

**Não validado:** a tela `{base}/relatorios` (a de gerar) em si, autenticada de verdade —
mesmo bloqueio de `.env.local`/`DATABASE_URL` já registrado pelo backend e pela navegação
hoje. `npx tsc --noEmit` está limpo com as duas telas montadas contra o `POST`/`GET` reais
das rotas do backend (tipos batem), mas não abri o formulário num browser logado.

**Verificado:**
- `npm run typecheck` → limpo.
- `npm run test:vocabulario` → limpo.
- Print/PDF da folha validado no Chromium via Playwright (acima) — o único fluxo desta
  entrega que dá para provar sem banco.

---

### Frontend — painel (16/08, F2 + F3)

**F2 — `KpiComparado`** (`app/_components/ui-base.tsx:178-337`, aditivo — nada existente mudou
além de exportar `TEXTO_DO_TOM`, que era privado). Valor grande + variação (seta ▲/▼ + sinal +
absoluto + %, nunca só cor — `invertido` inverte o sentido para KPI onde menos é melhor) +
sparkline em SVG puro (zero dependência nova, path quebra em `null` em vez de interpolar sobre
buraco de medição, `role="img"` com `aria-label` de tendência para leitor de tela). Sem
comparação: "sem comparação ainda", nunca 0% inventado. Cor sempre = `tomDaVariacao()`, tabela
`TOM`.

**F3 — `{base}/painel`** (`app/hm/painel/page.tsx`, novo — sobrescreve o placeholder). Consome
`/api/hm/painel` (B2). Seletor hoje·7d·30d·mês·intervalo livre + granularidade dia/semana/mês
(só afeta a série de fluxo — estado é sempre diária, conforme o contrato). Dois grupos visuais:
"Fluxo no período" (Recebido/Entraram/Quitaram) e "Estado agora — ao vivo, bate com a Carteira"
(A receber/Precisam de ação), com `Callout` fixo dizendo que a série de estado só existe a
partir de 16/08/2026 e por quê (pró-rata usa `CURRENT_DATE`). "A receber" leva `auxiliar`
citando o critério (`cs.vw_hm_carteira`, não "responsável comercial"). `AtividadeDesempenho`
**mudou de casa**: removido de `app/hm/atividade/page.tsx` (import + render, linhas do carro-
chefe) e agora só renderiza no Painel, com `Callout` explicando que o número pode ter mudado em
relação a um print antigo por causa do critério novo (B3), não por erro.
`grep -rn "AtividadeDesempenho" app/` → só a definição (`atividade-desempenho.tsx`), o import
novo em `painel/page.tsx` e um comentário em `top-nav.tsx`. `/aurum/painel` e `/ethb/painel` já
reexportavam esta página (feito por outro agente) — nada a fazer lá.

**Verificado:**
- `npm run typecheck` → limpo (`EXIT:0`).
- `npm run test:vocabulario` → limpo (achou e corrigi 2 ocorrências de "card" no texto visível —
  trocado por "ficha").
- **Chromium, via sandbox temporário fora do repo** (`app/sandboxpainelvalidacao/`, criado,
  capturado e apagado nesta sessão — não ficou no diff). Sem `DATABASE_URL` nesta sessão
  (mesmo bloqueio já registrado por quem fez F0/F1/F4 hoje mais cedo): `getSessao()` em
  `app/hm/layout.tsx` lança antes de renderizar qualquer filho do HM/AURUM/ETHB de verdade,
  então a rota real `/hm/painel` autenticada **não foi validada nesta sessão**. O que validei:
  o primitivo `KpiComparado` e o agrupamento fluxo/estado do Painel, renderizados fora do
  layout do HM com dados de exemplo (via cookie forjado para passar só o middleware de Edge,
  que checa presença de cookie, não validade — a tela em si não bate em nenhuma API que exija
  sessão real). Capturado a 1280px claro/escuro e 390px — sparkline, seta+sinal+cor da
  variação, `Callout` de honestidade da série e o auxiliar do critério de carteira renderizam
  corretos nos três. **Não prova**: dado real da API, `guardProdutoOpcional`, nem o layout
  autenticado do HM.

**Arquivos:**
- `app/_components/ui-base.tsx:78-79,178-337` — `TEXTO_DO_TOM` exportado + `KpiComparado` +
  `Sparkline` (privado).
- `app/hm/painel/page.tsx` — reescrito por completo (era placeholder).
- `app/hm/atividade/page.tsx` — import e render de `AtividadeDesempenho` removidos.

**Não toquei:** `app/hm/carteira/page.tsx` (os 4 `<Kpi>` feitos à mão lá, que o plano do
arquiteto também cita em F2, não estavam no escopo que recebi — ficou pendente, ver Aberto).

---

### Pentester (16/08)

**Escopo auditado:** `lib/protocolo.ts`, `app/api/relatorios/*`, `lib/relatorios/*`, `app/api/hm/painel/route.ts` +
`lib/services/hm-painel.ts`, `app/api/hm/ofertas*` + `lib/services/hm-ofertas.ts`, `app/api/cron/route.ts`,
`db/migrations/0255-0260`, `lib/guard.ts`, `lib/produto-hm.ts`, `lib/papeis.ts`. Sem acesso a banco — nenhum
número medido por mim; achados são leitura de código com `arquivo:linha`.

**Limpo (verificado, sem achado):** `carteiraHm`/`painelHm` aplicam `escopoVisibilidade` de verdade em SQL
(não só no shell do gerador); `guard()`/`guardProduto`/`guardProdutoOpcional` são fail-closed (inclusive o
`guardProdutoOpcional` que "cheira a fail-open" no plano — na prática exige os 3 portais quando `?produto=`
está ausente); `cron/route.ts:autorizado()` é fail-closed (`if (!segredo) return false`); as 4 tabelas novas
de `cs` (`oferta_planilha_staging`, `protocolo_operacao`, `relatorio_emitido`, `hm_fechamento_diario`) têm
`revoke update, delete` da 0177; funções do catálogo/promoção são `security definer` com `search_path` pinado
e `revoke all from public` + `grant execute` só a `disparos_app`; a régua financeira (`pacote_cheio` etc.)
não é atingível por `PATCH`/`promover` (nem no schema zod, nem na função SQL); numeração de protocolo é
segura contra corrida (`pg_advisory_xact_lock` na mesma transação da emissão); SQL 100% parametrizado, zero
`dangerouslySetInnerHTML`/`innerHTML` nas telas novas; `link` do catálogo é bloqueado por CHECK `like
'https://%'` no banco (fecha `javascript:`/`data:` mesmo se a validação de app falhar); `escopoDisparo`/
`escopoAcao` não foram tocados por este diff.

**1 achado ALTO, 3 BAIXO/INFO.** Detalhe completo na resposta ao orquestrador (não duplicado aqui).
Resumo: (1) ALTO — reabertura de relatório com escopo 'equipe' autoriza pela equipe ATUAL do emissor
(`lib/protocolo.ts:163-181`, join live em `cs.usuarios`), não pela equipe que ele tinha ao emitir — troca de
equipe (`app/api/hm/equipes/[id]/membros/route.ts:51-57`) muda quem enxerga relatório histórico de dinheiro/
PII para o time errado. (2) BAIXO — oráculo de existência: `GET /api/relatorios/emitido/[protocolo]` aceita
qualquer sessão autenticada e distingue 404/403, permitindo contar relatórios de um portal que a conta não
tem. (3) BAIXO/INFO — `cs.fn_hm_fechar_dia` (0260) foge do padrão do resto da leva (sem `revoke all from
public`), EXECUTE fica aberto a qualquer role por default do Postgres. (4) BAIXO/INFO — `link` da planilha
de import não valida `https://` no zod (só o PATCH valida); uma linha ruim no lote de promoção estoura o
CHECK do banco e aborta o lote inteiro (`fn_oferta_planilha_promover_lote` é 1 statement SQL), sem try/catch
na rota → 500 não tratado.

**Veredito:** 1 finding ALTO pendente — bloqueia aprovação do Fable até corrigido (fix é pequeno: congelar
`equipe_id` do emissor em `cs.relatorio_emitido` no INSERT, em vez de reconsultar `cs.usuarios` ao ler).

**Correções pós-pentester (16/08, backend):**
- ALTO — `lib/protocolo.ts` (`emitirRelatorio`/`buscarRelatorioEmitido`): `emitido_por_equipe_id`
  agora é coluna CONGELADA em `cs.relatorio_emitido` (migration nova `0261`), gravada a partir de
  `ctx.sessao.equipe_id` no INSERT; a reabertura lê a coluna, não mais um `join cs.usuarios` ao vivo.
- BAIXO — `app/api/relatorios/emitido/[protocolo]/route.ts`: 404/403 colapsados numa resposta
  única (`404 nao_encontrado`) para não virar oráculo de existência sobre protocolo sequencial.
- BAIXO — `db/migrations/0260_hm_fechamento_diario.sql`: acrescentado `revoke all ... from public`
  + `grant execute ... to disparos_app` em `cs.fn_hm_fechar_dia(date)`, no padrão de 0255/0257.
- BAIXO — `lib/services/hm-ofertas.ts:classificarQuarentena` valida `https://` na importação (barra
  cedo, nunca deixa a violação chegar só no CHECK do banco); `app/api/hm/ofertas/promover/route.ts`
  ganhou try/catch com `422 lote_invalido` para `check_violation` (pg code 23514) em vez de 500 cru.
- INFO — `acoes-do-comercial.ts` e `visao-geral.ts` trocaram `nivelDe(...) === "master"` por
  `podeVerTudo(ctx.sessao)` no escopo de atividade — a Kelly (gerente_distribuidor) volta a ver a
  esteira inteira nos dois relatórios.

`npm run typecheck` e `npm run lint`: os dois limpos após as correções (saída colada no retorno ao
Orquestrador).

### Fable — veredito (16/08)

VEREDITO: APROVADO (2 ressalvas, pendências nomeadas abaixo — nenhuma bloqueia o commit; bloqueiam o "pronto" ao João)

Segurança:      APROVADO — 0 crítico; ALTO (equipe congelada: 0261 + protocolo.ts:114,190 com guarda `equipe_id !== null`) e os 3 baixos (404 único, revoke 0260:155-156, https+23514 no promover) confirmados por mim NO CÓDIGO, não no relato; guard fail-closed nas 3 rotas de relatórios.
Escalabilidade: APROVADO — snapshot diário em vez de recomputar histórico; reabertura de relatório = 1 select por PK sobre conteúdo congelado; agregação em SQL; zero polling novo.
Solidificação:  RESSALVA — migrations exemplares (CONTAR ANTES real, `do $$ raise exception` auto-verificante, volta escrita nas 8; 0255b protege o pg_get_viewdef exigindo exatamente 1 ocorrência do padrão e falha alto), MAS nenhuma rodou contra banco: sanity só sintático. Aplicar 0255→0255b→0256→0257→0258→0259→0260→0261 com o CONTAR ANTES re-rodado NA HORA (número muda com venda nova).
UX:             RESSALVA — desenho responde à queixa da "nave" (10 itens planos → 3 grupos; dinheiro sai do log de atividade; fluxo×estado separados com callout honesto; robô rotulado "não soma ao total do time"; folha com "De onde vem cada número" + ressalvas; print provado em Chromium). MAS {base}/{painel,relatorios,ofertas} nunca abriram autenticadas — bloqueio externo (.env.local), e este repo já teve tela em 500 com tudo verde.
Otimização:     APROVADO — a leva paga o próprio peso: SALDO_CHECKOUT cravado morto (erro medido até R$487,67), seletor de link com tolerância, AtividadeDesempenho MUDOU de casa (não duplicou), relatório novo = 1 arquivo + 1 linha sem SQL próprio, folha única para todos, zero dependência nova, view corrigida na fonte em vez de remendo por consumidor.

VERIFICADO (rodado por mim, não herdado)
- npm run typecheck → exit 0 · npm run lint → 0 warnings · npm run test:vocabulario → limpo · npm run build → exit 0 (rotas novas nos 3 portais no manifesto)
- Leitura integral: 0255b, 0261, lib/protocolo.ts, rota emitido/[protocolo]; grep confirmou fixes do pentester, guards, e que AtividadeDesempenho/SALDO_CHECKOUT sumiram do lugar antigo.

PENDENTE (condição do "pronto", não do commit)
- [orquestrador] aplicar as 8 migrations em ordem com CONTAR ANTES fresco; conferir −9 pessoas / −R$111.616,87 no recorte de entrada paga e AURUM false=só estornados.
- [João] colocar .env.local (papel com SELECT em public, não `disparos_app`); depois abrir os 3×{painel,relatorios,ofertas} e emitir 1 relatório real antes do deploy manual na Hostinger.
- [orquestrador] pós-apply: query 2 da 0258 (esperado 0) e smoke da 0260 (bate com /hm/carteira no minuto).

RISCO RESIDUAL
- Telas autenticadas sem prova visual até o João pôr a credencial — deploy é manual, o risco não chega ao ar sozinho.
- `proximoProtocolo` conta por LIKE-prefixo sem índice pattern_ops — irrelevante no volume atual; revisar se emissão virar automática.
- Webhook cego para ETHB/Fire/Transmissão (PRODUCT_CHANNEL) segue fora desta leva — mapeado, não corrigido; PR #32 pendente.

### Frontend — acabamento no browser (17/08)

Bloqueio de browser resolvido (`.env.local` com papel `disparos_ui_ro`, cookie de `.token.tmp`,
dev server em :3005). Validei tudo em Chromium de verdade, dado de produção, nas três larguras
pedidas — não é build verde, é tela vista.

**Defeito confirmado do menu — 3 causas, não 1.** `app/_components/top-nav.tsx`:
1. **Não cabia.** 5 itens Operação + 3 Gestão soltos + "Mais" (8 alvos + separadores) estourava
   1440px; o nav rola (`overflow-x-auto`) mas sem indicar isso, "Mais" saía da viewport — Ofertas/
   Acessos/Equipes ficavam inalcançáveis sem saber que precisava rolar. Fix: Gestão virou dropdown
   igual Ajustes (`NavDropdown` genérico substitui o antigo `MenuMais`, top-nav.tsx:161-296).
2. **Aurum sozinho ainda estourava depois do fix acima.** O logo da Aurum (`aurum.png`, proporção
   3.75:1) rendeiza ~120px de largura contra ~64px do HM — sobrava só 704px de nav em vez de 749px.
   Fix: `top-nav.tsx:257` — `comNome={false} className="max-w-[76px] object-contain"` no
   `MarcaPortal` do cabeçalho (não mexi em `marca.tsx`, só no call site do header).
3. **Dropdown clicava no vazio.** Achado testando o próprio fix: o painel do dropdown vivia
   `absolute` dentro do `<nav overflow-x-auto>` — CSS trata overflow-x diferente de `visible` como
   overflow-y também clipante, então o painel nunca pintava nem recebia clique (confirmado via
   `elementFromPoint` batendo no `<main>` por trás). Fix: portal pro `document.body` com posição
   `fixed` calculada do `getBoundingClientRect()` do botão (`top-nav.tsx:158-306`). Isso quebrou a
   ordem de Tab (painel fica no fim do DOM) — adicionei foco automático no primeiro item ao abrir,
   trap de Tab/Shift+Tab e setas dentro do painel, Escape devolve foco ao botão. Testado via
   Playwright puro (sem confiar em screenshot): clique em item navega, Tab/ArrowDown/Home/End/
   Escape percorrem e fecham corretamente.

**Provado nas 3 larguras** (`nav-*.png` no scratchpad) em HM/Aurum/ETHB: 1280, 1440, 1920 —
`navScrollWidth === navClientWidth` nas três (sem overflow), nenhum item escondido, "Mais"/"Gestão"
sempre visíveis e clicáveis.

**Capturas por rota (1440, dado de produção):**
- `/hm/painel`, `/aurum/painel`, `/ethb/painel` — hierarquia dos KPI boa (valor + delta + seta +
  sparkline), bloco "Desempenho comercial × ativação" bem separado do financeiro com o callout do
  buraco de dono. ETHB sem dado ainda (zeros) renderiza limpo, sem quebra.
- `/hm/relatorios` — tela enxuta, sem problema.
- `/hm/ofertas` — **confirmado o defeito apontado**: 133 linhas sem paginação, página com 19995px
  de altura. Adicionei paginação client-side (`app/hm/ofertas/page.tsx`: `Paginacao` novo
  componente, `ITENS_POR_PAGINA=40`, reseta pra página 1 quando qualquer filtro muda). 4 páginas,
  rodapé "Mostrando 1–40 de 133 ofertas" + Anterior/Próxima/números com janela (1 … atual±1 …
  última). Zero dependência nova, zero toque em `lib/services/hm-ofertas.ts`.
- `/hm/carteira`, `/aurum/carteira` — números batem com os KPI do topo, cards por comercial
  coerentes. HM tem 234 linhas sem paginação (mesmo problema do Ofertas, users não pediu — **não
  mexi**, reporto abaixo). Aurum (33 linhas) não precisa.
- Tema escuro — contraste bom em todas as telas revisadas, sparklines legíveis, sem `!important`.
- 390px — achei e corrigi um problema real: `app/_components/atividade-desempenho.tsx` tinha
  `overflow-x-auto` na tabela mas `table w-full` sem `min-w`, então no mobile o texto ("Acima da
  mediana do time") quebrava em 5-6 linhas por célula em vez de rolar. Fix: `min-w-[640px]`
  (Comercial) e `min-w-[480px]` (Ativação) nas duas tabelas — agora rola horizontal, texto legível
  numa linha.

**Achado, não corrigido (fora do escopo frontend, relato conforme pedido):**
- `lib/services/hm-carteira.ts:139` — `Parou de pagar — último em ${dm(r.ultimo_pagamento_em)}`
  renderiza literalmente **"undefined/undefined"** na tela quando `dm()` recebe uma data que não
  processa (visível em `/hm/carteira`, ex. "Leonel Silveira", "Ilone Maria Ferlin"). Bug de
  formatação no service, não no componente.
- `/hm/carteira` (234 linhas) e provavelmente outras listas grandes do portal têm o mesmo padrão
  sem paginação que Ofertas tinha — não mexi por não estar no pedido explícito, mas fica registrado
  porque é o mesmo defeito de UX.
- Nav em 390px segue "espremido": mesmo com a consolidação de Gestão/Ajustes (9→7 alvos), a soma de
  logo + seletor de portal + 5 ícones de Operação + 2 dropdowns + busca/ajuda/tema/avatar/sino não
  cabe fisicamente num viewport de 390px — o nav vira uma faixa de ~15px de largura, rolável mas
  praticamente invisível sem saber que está ali. Resolver de verdade pede um padrão de nav mobile
  próprio (menu hamburger ou barra inferior) — redesenho maior que "acabamento", não fiz sem pedido
  explícito.

**Verificado:**
- `npm run typecheck` → limpo (sem saída, exit 0).
- `npm run lint` → "✔ No ESLint warnings or errors".
- `node captura.tmp.js` nas 9 rotas → todas 200, zero erro de console.
- Playwright: clique de mouse e teclado completo (Tab/ArrowDown/ArrowUp/Home/End/Escape) nos dois
  dropdowns do nav, testado à parte de screenshot (hit-test real, não só visual).

**Arquivos tocados:** `app/_components/top-nav.tsx`, `app/hm/ofertas/page.tsx`,
`app/_components/atividade-desempenho.tsx`. Nenhum toque em `lib/services/*`, `lib/relatorios/*`,
`db/migrations/*`, `app/api/*`.
- `price_brl` segue nulo nas 96 linhas até alguém promover a planilha pela tela nova.
