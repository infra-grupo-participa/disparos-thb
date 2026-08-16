# Arquiteto — Central de ativação (16/08 11:20)

> Anexo de `tmp/squad/central-ativacao-2026-08-16.md`. O scratchpad principal aponta para cá.

> **Aviso de método.** Não existe `.env.local` nesta máquina e o MCP do Supabase não está
> disponível nesta sessão. **Nenhum número novo foi medido por mim.** Todo número citado aqui
> vem do vault (medições de 16/08 já registradas) ou de leitura de código com `arquivo:linha`.
> Onde o desenho depende de uma contagem, ela está escrita como **CONTAR ANTES** dentro do
> bloco do backend — e é condição de aceite, não sugestão.
>
> A seção do `analista-de-dados` ainda não estava no arquivo quando fechei. O bloco **D0**
> depende dela; os demais não.

---

## 1. MAPA ATUAL — a Central de ativação hoje

A "Central de ativação" é a esteira `HM · AURUM · ETHB`. Os três portais compartilham a mesma
navegação (`app/_components/top-nav.tsx:113-114`: `ehEsteiraHm` → `LINKS_HM`).

**Menu do topo — `LINKS_HM` (`top-nav.tsx:39-73`), 10 itens numa lista plana:**

| # | rótulo no menu | rota | h1 da tela | tamanho | o que é |
|---|---|---|---|---|---|
| 1 | Jornada | `{base}/kanban` | **"Ativação · {portal}"** (`app/hm/kanban/page.tsx:708`) | 1.917 l | board por etapa |
| 2 | Agendamentos | `{base}/agendamentos` | **"Agenda · {portal}"** (`:265`) | 821 l | calendário |
| 3 | Reuniões | `{base}/reunioes` | "Reuniões · {portal}" (`:136`) | 233 l | lista; lê `/api/hm/tabela` (`:66`) |
| 4 | Atividade | `{base}/atividade` | "Atividade · {portal}" (`:40`) | 199 l | **três painéis de eixos diferentes** |
| 5 | Carteira | `{base}/carteira` | (composto, `:135`) | 390 l | carteira do comercial |
| 6 | Inbox | `{base}/inbox` | — | 5 l | reexporta a tela genérica |
| 7 | Disparos | `{base}/disparos` | — | 5 l | idem |
| 8 | Templates | `{base}/templates` | — | 4 l | idem |
| 9 | Equipes (gestor+) | `{base}/equipes` | — | 421 l | |
| 10 | Acessos (master) | `{base}/acessos` | "Acessos do GPS" | 225 l | |

**Fora do menu:**

| rota | como se chega | situação |
|---|---|---|
| `{base}/tabela` | só pela tira "Ver como" (`app/hm/_components/hm-visao.tsx:38-41`) | ok por desenho |
| `{base}/tags` | **um único link, dentro do seletor de tags** (`app/hm/_components/tag-picker.tsx:135`) | **órfã de navegação** |
| `/hm/contatos/[id]` | drawer (`hm-drawer.tsx:1902`) e agenda (`agendamentos/page.tsx:799`) | ficha do aluno |
| `{base}/ajuda` | botão "?" do cabeçalho | ok |

### 1.1 O que está duplicado, órfão ou quebrado — com arquivo:linha

**(a) Duas rotas com o MESMO h1.** `/kanban` e `/tabela` dizem os dois **"Ativação · {portal}"**
(`app/hm/kanban/page.tsx:708` e `app/hm/tabela/page.tsx:1614`). O menu chama a primeira de
"Jornada" e a tira chama a segunda de "Tabela". São **quatro rótulos para duas leituras da
mesma lista**. É o defeito nº 2 do `docs/padrao-visual.md` ("a mesma coisa com dois nomes")
dentro da tela que o operador mais usa.

**(b) Menu e tela discordam em Agendamentos.** Menu: "Agendamentos". h1: "Agenda"
(`app/hm/agendamentos/page.tsx:265`).

**(c) `Carteira` no menu dos três portais, página só no HM.**
`app/aurum/` e `app/ethb/` **não têm** `carteira/` (verificado por `ls`). O link é montado como
`${base}/carteira` (`top-nav.tsx:57` + `:152`), e `LINKS_HM` serve `hm|aurum|ethb`
(`top-nav.tsx:113-114`). **Do AURUM e do ETHB o item "Carteira" do menu leva a 404.**
Regressão introduzida em 16/08 junto com a própria feature.

**(d) Link que atravessa portal e expulsa a pessoa.** Três lugares linkam rota `/hm/*` literal:
`app/hm/_components/tag-picker.tsx:135` (`/hm/tags`), `app/hm/_components/hm-drawer.tsx:1902`
e `app/hm/agendamentos/page.tsx:799` (`/hm/contatos/${id}`). Do AURUM/ETHB o clique joga a
pessoa no portal HM; sem `HM` na whitelist, `app/hm/layout.tsx` redireciona para
`/?sem_acesso=hm`. É exatamente a classe de bug que `hm-visao.tsx:12-16` documenta ter
corrigido na tira — e que voltou por outros três caminhos. `app/aurum/contatos/` e
`app/ethb/contatos/` **não existem**.

**(e) `/atividade` empilha três eixos diferentes numa tela só** — **este é o "misturado com
atividades do sistema" do João**, medido em código (`app/hm/atividade/page.tsx:53-63`):

| painel | pergunta | eixo | período |
|---|---|---|---|
| `AtividadeDesempenho` (`_components/atividade-desempenho.tsx`, 263 l) | quanto cada comercial **fechou em R$** | gestão / dinheiro | 30 d, seletor próprio |
| `PainelDesempenho` (inline, `atividade/page.tsx:95-135`) | quem está **ativo** essa semana | operação | 7 d, fixo |
| `AtividadeColaboradores` (`_components/`, 495 l) | **quantas ações** cada um registrou | operação / log | seletor próprio |

Três períodos independentes na mesma rolagem. O de cima é dinheiro por pessoa (é **carteira**),
os de baixo são registro de atividade. É literalmente "a carteira do comercial misturada com
atividade do sistema".

**(f) E o painel de cima credita pelo campo errado.** `lib/services/hm-atividade.ts:771`
(`desempenhoComercialDinheiroNucleo`) agrupa por `ch.responsavel_comercial_id`. O vault já
mediu que esse campo **não é quem vendeu**: a 0161 carimba toda venda nova na distribuidora
(Kelly) e a ativação sobrescreve o dono quando o card avança — **131 de 264 cards HM ficam sem
`responsavel_comercial_id`** e **32 cards com sinal têm "Kelly" sem que ela tenha vendido**
(`disparos-brain/Carteira do card se perde na ativação`). A `/carteira`, ao lado, lê
`cs.vw_hm_carteira`, que **reconstrói o dono pela linha do tempo**.
→ **Duas telas vizinhas do mesmo sistema respondem "de quem é a carteira" com números
diferentes.** É a divergência de dados que o João mandou eliminar.

**(g) Reuniões e Agenda falam do mesmo assunto em dois destinos de topo.** `/reunioes` é
declaradamente um relatório (`hm-visao.tsx:42-46`) e lê `/api/hm/tabela` (`reunioes/page.tsx:66`).

**(h) Não existe nenhuma leitura de série temporal na esteira.** `LINKS_HM` não tem dashboard
(o comentário `top-nav.tsx:38` — "módulo mais simples, sem inbox/dashboard" — está vencido:
inbox e disparos entraram). `cs.hm_financeiro_marco` (0174:116 / 0177) é retrato **por evento
de mudança de régua**, não série diária. **Não há nada no sistema que responda "como estava mês
passado".**

**(i) Três jeitos de mostrar um número.** `app/_components/kpi.tsx` (36 l, portais genéricos),
o primitivo `Stat` (`ui-base.tsx`) e os 4 KPI feitos à mão na carteira
(`app/hm/carteira/page.tsx`). **Nenhum dos três mostra comparação com o período anterior** —
que é justamente o que o João pede ("valor + comparação + auxílio visual").

---

## 2. DESENHO ALVO DA NAVEGAÇÃO

O princípio, e ele responde à frase do João ("a nave está muito confusa"): **uma lista plana de
10 itens não tem hierarquia — ela obriga a ler os 10 para achar 1.** O menu passa a ter três
grupos com separador visual, e cada grupo responde a uma pergunta diferente do dia.

```
{base} = /hm | /aurum | /ethb

+- OPERAÇÃO — o que eu faço agora ----------------------------------------+
|  Jornada        {base}/kanban        Ver como: Jornada <-> Tabela       |
|                 {base}/tabela                                           |
|  Agenda         {base}/agendamentos  Ver como: Calendário <-> Lista     |
|                 {base}/reunioes      <- sai do menu de topo             |
|  Atividade      {base}/atividade     <- perde o painel de dinheiro      |
|  Inbox          {base}/inbox                                            |
|  Disparos       {base}/disparos                                         |
+- GESTÃO — como estamos no período --------------------------------------+
|  Painel         {base}/painel        * NOVO                             |
|  Carteira       {base}/carteira      + criar em /aurum e /ethb          |
|  Relatórios     {base}/relatorios    * NOVO                             |
+- AJUSTES — dropdown "Mais", gestor+ ------------------------------------+
|  Equipes        {base}/equipes       (gestor+)                          |
|  Tags           {base}/tags          <- deixa de ser órfã               |
|  Ofertas        {base}/ofertas       * NOVO (master) — catálogo         |
|  Templates      {base}/templates                                        |
|  Acessos        {base}/acessos       (master)                           |
+-------------------------------------------------------------------------+

FORA DA NAVEGAÇÃO (destino de leitura, não de navegação)
   /relatorio/{protocolo}   folha imprimível de um relatório já emitido
   {base}/contatos/[id]     ficha do aluno (criar em /aurum e /ethb)
```

**Itens no topo: 8 (5 operação + 3 gestão) contra 10 hoje**, e os 5 de configuração saem da
linha principal. O menu do topo deixa de rolar horizontalmente em 1440px — a queixa de 11/08
registrada em `top-nav.tsx:146-149` some por consequência, não por remendo.

### 2.1 Cada movimento, e o que do João ele responde

| movimento | por quê |
|---|---|
| **Grupos com separador no menu** | "não dá pra navegar com tranquilidade" · lista plana não tem onde a leitura descansar |
| **`AtividadeDesempenho` sai de `/atividade` e vai para `/painel`** | "a carteira ficou boa **mas está misturada com atividades do sistema**". É o movimento central do pedido. **O lugar antigo some** — o componente é removido de `atividade/page.tsx:53`, não duplicado |
| **`/painel` nasce** | "não dá para analisar no longo prazo" · hoje não existe série temporal nenhuma (1-h) |
| **h1 de `/kanban` e `/tabela` viram "Jornada · {portal}"** | duas rotas com o mesmo h1 (1-a). "Jornada" é a palavra travada por `scripts/test-vocabulario.ts` (`board`/`esteira` são banidas e mandam usar "Jornada"); "Ativação" passa a nomear o **módulo**, no cabeçalho, não duas telas |
| **Menu "Agendamentos" → "Agenda"** | menu e h1 discordavam (1-b) |
| **`/reunioes` vira a leitura "Lista" da Agenda** | dois destinos de topo para o mesmo assunto (1-g). **A rota continua existindo** — link antigo e favorito não quebram; ela só deixa a linha principal |
| **`/tags` entra em Ajustes** | órfã de navegação (1-d) |
| **`/carteira` criada em `/aurum` e `/ethb`** | link do menu levando a 404 (1-c) |
| **`/relatorios` e `/ofertas` nascem** | frentes B e D |
| **Nada morre. Nada redireciona.** | regra do `docs/padrao-visual.md`: "mudança que o operador não pediu e não resolve problema dele é regressão". Todo movimento acima cai num dos três motivos permitidos lá (visualização, identificação, operação) |

### 2.2 `{base}/painel` — o conteúdo, na ordem de leitura

1. **Faixa de KPI, primitivo novo `KpiComparado`** — valor grande, **comparação com o período
   anterior de mesma duração** (seta + Δ absoluto **e** relativo) e **sparkline** da série.
   Cinco: `Recebido no período` · `A receber` · `Entraram` · `Quitaram` · `Precisam de ação`.
   Regra herdada de `feedback_dashboard_hierarquia_e_leitura`: KPI = valor + comparação +
   auxílio visual. Sem comparação, é só um número.
2. **Evolução no tempo** — barras/linha por dia · semana · mês (reusa `Granularidade` de
   `lib/validators.ts`, já existente). **O que não existe antes do primeiro fechamento aparece
   como "sem dado antes de DD/MM", nunca como zero** (regra `feedback_campo_novo_nasce_vazio`).
3. **Desempenho comercial × ativação** — o painel movido, **agora creditando por
   `cs.vw_hm_carteira.carteira_usuario_id`** com a coluna de lastro visível (corrige 1-f).
4. Nenhuma lista nominal. Quem quer nome clica e cai na Carteira. Painel é leitura; Carteira é
   fila de trabalho.

---

## 3. MODELO DE DADOS

Próxima migration livre: **0255**. Toda migration abaixo é idempotente, tem bloco de
verificação nominal dentro dela (padrão da 0247) e caminho de volta descrito.

### Decisão de desenho que vem antes das migrations

**A maior parte da série de longo prazo NÃO precisa de tabela nova.** `cs.hm_pagamentos.pago_em`
dá "recebido por dia" exato; `cs.contatos_hm.entrada_em` / `quitado_em` dão entradas e
quitações. Reconstruir isso todo dia num snapshot seria duplicar o razão — e duplicar o razão é
como se cria divergência de dados, que é o inverso do pedido.

**O que genuinamente não se reconstrói são duas coisas, e só elas:**

1. **"quanto se tinha a receber no dia X".** `cs.fn_hm_prorata` calcula o crédito com
   `CURRENT_DATE`: o crédito encolhe e o saldo sobe todo dia. Medido em 16/08:
   **73 pessoas · R$ 642.049,25 · ≈ R$ 1.110,94/dia** (`O saldo de quem tem crédito muda todo
   dia`). Perguntar hoje "quanto faltava em 01/08" devolve um número que **nunca existiu**.
2. **"de quem era a carteira no dia X".** `cs.vw_hm_carteira` reconstrói pela linha do tempo
   atual; e a régua já mudou uma vez (0242 moveu **Jusy 154 → 118, Jonathan 9 → 45**).

Por isso o fechamento diário existe, e por isso ele carrega `regra_versao`.

---

### 0255 — `cs.hm_fechamento_diario`: o retrato que não se reconstrói

```sql
-- RASCUNHO PARA O BACKEND TRANSFORMAR EM ARQUIVO. Não é o arquivo final.
--
-- POR QUE ESTA TABELA EXISTE, e por que ela é pequena de propósito:
-- recebido/entradas/quitações saem do razão a qualquer momento e NÃO entram aqui —
-- duplicar o razão é fabricar divergência. Só entra o que o amanhã não sabe
-- reconstruir: o saldo a receber (crédito pró-rata anda com CURRENT_DATE, ~R$1.111/dia
-- sobre R$642.049,25 em 73 pessoas) e a atribuição de carteira vigente naquele dia
-- (a régua já mudou uma vez, na 0242: Jusy 154->118, Jonathan 9->45).
create table if not exists cs.hm_fechamento_diario (
  dia                  date not null,
  produto              text not null,
  carteira_usuario_id  uuid null,          -- null = "sem dono identificado" naquele dia
  carteira_nome        text,               -- congelado: se a pessoa mudar de nome, a série não se desliga
  regra_versao         text not null,      -- 'vw_hm_carteira@0253'; muda quando a régua muda
  alunos               int  not null,
  quitados             int  not null,
  pagando              int  not null,
  so_entrada           int  not null,
  cancelados           int  not null,
  recebido_no_ciclo    numeric(14,2) not null,
  a_receber            numeric(14,2) not null,
  saldo_movel_pessoas  int  not null,      -- quantos ainda têm crédito móvel nesse dia
  saldo_movel_valor    numeric(14,2) not null,
  sem_data             int  not null,
  parou_de_pagar       int  not null,
  conferir             int  not null,
  tirado_em            timestamptz not null default now(),
  primary key (dia, produto, coalesce(carteira_usuario_id, '00000000-0000-0000-0000-000000000000'::uuid))
);
-- ^ o backend confere se esta versão do Postgres aceita expressão na PK; se não,
--   usar coluna gerada `carteira_key uuid generated always as (coalesce(...)) stored`.

create index if not exists ix_hm_fechamento_dia on cs.hm_fechamento_diario (produto, dia desc);

-- APPEND-ONLY. Lição literal da 0177 (achado do pentester): o `alter default privileges`
-- da 0001 dá insert/update/delete a disparos_app em TODA tabela nova do schema cs.
-- Sem estas duas linhas a prova é reescrevível e não prova nada.
revoke update, delete on cs.hm_fechamento_diario from disparos_app;
grant  select, insert on cs.hm_fechamento_diario to disparos_app;

create or replace function cs.fn_hm_fechar_dia(p_dia date default current_date) ...
-- on conflict do nothing: um dia fecha UMA vez. Refazer um dia é criar regra_versao
-- nova, nunca UPDATE — senão a série mente sobre o próprio passado.
```

- **Backfill: NENHUM, e isso é decisão, não preguiça.** Não existe insumo para reconstruir
  `a_receber` de ontem. Semear **só `current_date`**. `comment on table` registra que a série
  começa em 16/08/2026.
- **CONTAR ANTES de aplicar** (condição de aceite do bloco):
  ```sql
  select produto, count(*) alunos, sum(falta_pagar) a_receber
    from cs.vw_hm_carteira where pagou_entrada_do_programa group by produto;
  ```
  O resultado tem que bater **linha a linha** com o topo de `/hm/carteira` no mesmo minuto.
  **Se não bater, não fecha o dia** — fechar um dia errado carimba o erro para sempre.
- **Quem muda de valor: ninguém.** Tabela nova, nenhuma view existente é tocada.
- **Volta:** `drop function cs.fn_hm_fechar_dia; drop table cs.hm_fechamento_diario;` — só
  depois do bloco F3 alguma tela lê dela.
- **Quem chama:** `app/api/cron/route.ts` (já existe, autorizado por `CRON_SECRET`,
  `maxDuration=300`, idempotente por desenho). Uma chamada por execução; o `on conflict do
  nothing` cobre o cron rodando 20 vezes por dia.

---

### 0256 — o catálogo de ofertas ganha a face comercial (sem tocar a régua do dinheiro)

`public.hm_product_catalog` já existe e **já manda no dinheiro** por quatro colunas:
`pacote_cheio` e `entrada_condicao_fechada` (0174:60-73), `entrada_do_programa` (0240:57),
`concede_trilha` (0114:30). **As colunas novas são descritivas — vitrine, não régua.**

```sql
alter table public.hm_product_catalog
  add column if not exists nome_comercial  text,
  add column if not exists valor_tabela    numeric(12,2),
  add column if not exists explicacao      text,
  add column if not exists link_pagamento  text,
  add column if not exists vale_de         date,
  add column if not exists vale_ate        date,
  add column if not exists ativo           boolean not null default true,
  add column if not exists origem          text not null default 'sistema',
  add column if not exists atualizado_por  text,
  add column if not exists atualizado_em   timestamptz;

comment on column public.hm_product_catalog.valor_tabela is
  'PRECO DE VITRINE, para a operacao citar ao aluno. NAO E REGUA DE COBRANCA: quem decide o
   que a pessoa deve e pacote_cheio (0174). Mudar valor_tabela nao recobra ninguem.';

-- solidificação
check (valor_tabela is null or valor_tabela > 0)
check (vale_ate is null or vale_de is null or vale_ate >= vale_de)
check (origem in ('sistema','planilha','hotmart'))
check (link_pagamento is null or link_pagamento like 'https://%')
```

- **`ativo` nasce `true` para todo mundo. E isto é a decisão mais importante da migration.**
  O João disse que reuniu "muitas, não todas". **Ausência da planilha NÃO é sinal de oferta
  morta** — um backfill `ativo = false where offer_code not in (planilha)` desligaria oferta
  viva em silêncio. `ativo` só muda por ato humano na tela, e o ato fica protocolado (0258).
- **CONTAR ANTES:** `select count(*) from public.hm_product_catalog;` e quantos `offer_code`
  já têm `pacote_cheio` / `entrada_do_programa` / `concede_trilha=false` — para provar depois
  que nenhum deles mudou.
- **Quem muda de valor:** ninguém (colunas novas, nulas).
- **Volta:** `drop column` das dez. Nenhuma view financeira as lê.

---

### 0257 — `cs.oferta_planilha_import`: a planilha entra em quarentena, não no catálogo

**Motivo, lido na própria planilha** (`ofertas-planilha.csv`, linhas 2-3): ela **não é só um
catálogo**. Tem linha de pessoa física com instrução de operação —
`Nome = "Renata Farias Bassi;renatafbassi@gmail.com"`, `Explicação = "REALIZAR CANCELAMENTO.
Aluna informou que…"`, **sem `Código` e sem `Link`**. E tem linha com `Nome = "5 alunos"`.
Escrever isso direto em `hm_product_catalog` corromperia a tabela que decide o que 242 pessoas
devem.

```sql
create table if not exists cs.oferta_planilha_import (
  id            bigserial primary key,
  lote          uuid not null,             -- uma importação = um lote
  arquivo       text not null,
  linha_num     int  not null,
  produto_txt text, nome_txt text, valor_txt text, explicacao_txt text,
  nome_hotmart_txt text, offer_code text, link text,
  situacao      text not null check (situacao in
                  ('casou','codigo_novo','sem_codigo','conflito_valor','conflito_produto')),
  conflito      text,                      -- em português, para a tela mostrar
  importado_em  timestamptz not null default now(),
  importado_por text not null
);
revoke update, delete on cs.oferta_planilha_import from disparos_app;  -- ver 0177
grant  select, insert on cs.oferta_planilha_import to disparos_app;
```

- Promoção staging → catálogo é **ato humano na tela `{base}/ofertas`**, uma linha por vez ou
  em lote com confirmação; nunca automática. É o "com inteligência e verificação de nossa
  parte" que o João pediu.
- ⚠️ **Não existe coluna `resolvido_*`, de propósito.** Marcar resolvido exigiria `update`, que
  a linha de `revoke` proíbe. A resolução vira **linha nova em `cs.protocolo_operacao`** (0258)
  apontando para o `id`, e a tela lê o último protocolo da linha. **O backend não pode "só
  liberar o update"** — foi exatamente esse atalho que a 0177 fechou.
- **Backfill:** nenhum. A importação é uma operação, não uma migration.
- **Volta:** `drop table`.

---

### 0258 — `cs.protocolo_operacao`: burocratizar o que não toca ficha

**Antes de criar, o que já existe e serve** (a regra é não inventar tabela se a existente
serve):

| já existe | cobre |
|---|---|
| `cs.interacoes` (0001:52, + `contato_hm_id` na 0028:108) | ação **sobre uma pessoa**, assinada em `autor`, tipos `disparo/resposta/nota/mudanca_estagio/sistema` |
| `cs.hm_versoes` (0097:19) | snapshot **antes** de cada edição + resumo + autor |
| `cs.hm_financeiro_marco` (0174:116, append-only pela 0177) | retrato de pacote/saldo antes de mudar a régua |
| `cs.hm_agendamentos` · `cs.hm_alertas` · `cs.webhook_log` | compromisso · alerta · chamada externa |

**O buraco é preciso:** `cs.interacoes` tem
`check (num_nonnulls(contato_id, contato_hm_id) = 1)` (0028:114) — **é proibido registrar ação
que não tem uma pessoa como alvo.** Gerar relatório, importar planilha, ativar/desativar
oferta, mudar equipe, exportar XLSX: nada disso tem alvo-pessoa e **nada disso é registrado
hoje**.

```sql
create table if not exists cs.protocolo_operacao (
  id          bigserial primary key,
  acao        text not null,        -- 'relatorio.emitir','oferta.importar','oferta.ativar',...
  alvo_tipo   text,                 -- 'oferta','import','equipe','relatorio'
  alvo_id     text,
  detalhe     jsonb not null default '{}'::jsonb,
  autor       text not null,
  autor_id    uuid,
  portal      text,
  criado_em   timestamptz not null default now()
);
create index if not exists ix_protocolo_acao on cs.protocolo_operacao (acao, criado_em desc);
revoke update, delete on cs.protocolo_operacao from disparos_app;
grant  select, insert on cs.protocolo_operacao to disparos_app;
```

Escrita por **um helper único** `lib/protocolo.ts` — se cada rota escrever à mão, em duas
semanas metade das ações não registra.

**Além disso, `cs.interacoes` ganha `autor_id uuid null`.** Hoje o relatório de ações casa o
autor **por nome** (`lib/services/hm-atividade.ts`, recorte por `i.autor` textual). Quem mudar
de nome em `cs.usuarios` desliga o próprio histórico.

> **CONTAR ANTES — e esta contagem pode virar bloqueio:**
> ```sql
> select i.autor, count(*) n,
>        (select count(*) from cs.usuarios u where u.nome = i.autor) casa
>   from cs.interacoes i group by i.autor order by n desc;
> ```
> **Se algum `autor` casar com 2+ usuários (homônimo), PARE e escale.** Preencher `autor_id`
> por nome nesse caso credita ações de uma pessoa a outra — em cima do relatório que o próprio
> João classificou como "papo de demissional" (diário 16/08 02:40). Com 0 homônimos, o backfill
> é seguro; com ≥1, `autor_id` fica NULL para os ambíguos e a tela mostra "autor a confirmar".
> Volta: `alter table cs.interacoes drop column autor_id;`.

---

### 0259 — `cs.relatorio_emitido`: todo PDF que sai da máquina tem número

```sql
create table if not exists cs.relatorio_emitido (
  id            bigserial primary key,
  protocolo     text not null unique,      -- 'HM-20260816-0001' — é o que vai impresso
  tipo          text not null,
  produto       text,
  de            date, ate date,
  params        jsonb not null default '{}'::jsonb,
  escopo        text not null,             -- 'tudo' | 'equipe' | 'operador' — o recorte de quem gerou
  emitido_por   text not null,
  emitido_por_id uuid,
  linhas        int  not null,
  conteudo      jsonb not null,            -- o ResultadoRelatorio INTEIRO
  emitido_em    timestamptz not null default now()
);
create index if not exists ix_relatorio_tipo on cs.relatorio_emitido (tipo, emitido_em desc);
revoke update, delete on cs.relatorio_emitido from disparos_app;
grant  select, insert on cs.relatorio_emitido to disparos_app;
```

**Por que `conteudo` guarda o relatório inteiro, e não só os parâmetros.** Se guardasse só os
params, reabrir o protocolo de ontem **regeraria** os números — e o saldo de 73 pessoas se move
≈ R$ 1.111/dia. O PDF apresentado ao Marcio e o mesmo protocolo reaberto na semana seguinte
mostrariam valores diferentes, e alguém ia concluir que o sistema erra. É o incidente registrado
em `Auditoria da carteira contra a Hotmart` ("export tem data de validade"), resolvido na
origem: **relatório emitido é imutável.**

Tamanho: ~250 linhas × ~15 campos ≈ 60-120 KB por emissão, comprimido pelo TOAST. A 10
emissões/dia são ~250 MB/ano — cabe. Reabrir é 1 select por PK (contra 0,81 s da view).
Sem poda automática: é prova.

- **Backfill:** nenhum. **Volta:** `drop table`.

---

## 4. ARQUITETURA DO MÓDULO DE RELATÓRIOS

### 4.1 A lei que faz a feature reduzir complexidade em vez de somar

> **Nenhum relatório escreve SQL próprio.** Todo relatório monta a saída a partir de um serviço
> que já existe (`carteiraHm`, `atividadeHm`, `painelHm`). Se um número não existe em serviço
> nenhum, **o serviço ganha o campo** — o relatório não faz a conta.

Consequência direta, e é o que o João pediu com "não haver divergência de dados": tela, XLSX e
PDF passam a sair da mesma função. Divergir vira **impossível por construção**, não por
disciplina.

### 4.2 Arquivos

```
lib/relatorios/tipos.ts             <- O CONTRATO. Escrito primeiro, congelado. (backend)
lib/relatorios/registry.ts          <- o índice; único arquivo que lista os relatórios
lib/relatorios/carteira-comercial.ts
lib/relatorios/acoes-do-comercial.ts
lib/relatorios/visao-geral.ts
lib/relatorios/protocolo.ts         <- gera 'HM-20260816-0001' e grava cs.relatorio_emitido
app/api/relatorios/route.ts                     <- GET: tipos disponíveis PARA QUEM PERGUNTA
app/api/relatorios/[tipo]/route.ts              <- POST: gera, protocola, devolve { protocolo }
app/api/relatorios/emitido/[protocolo]/route.ts <- GET: devolve o conteudo congelado

app/{hm,aurum,ethb}/relatorios/page.tsx   <- dropdown + período + Gerar   (frontend)
app/relatorio/[protocolo]/page.tsx        <- a folha imprimível           (frontend)
app/_components/relatorio-folha.tsx       <- o render ÚNICO de ResultadoRelatorio
```

### 4.3 O contrato (`lib/relatorios/tipos.ts`)

```ts
export type Coluna = {
  chave: string; rotulo: string;
  tipo: "texto" | "dinheiro" | "data" | "numero" | "selo";
  /** De onde este número sai. Vai IMPRESSO na folha de fontes. Obrigatório. */
  fonte: string;
};
export type Secao = {
  titulo: string;
  /** Uma frase em português antes da tabela. Tabela sem chamada é proibida. */
  chamada: string;
  colunas: Coluna[];
  linhas: Record<string, unknown>[];
  totais?: Record<string, unknown>;
};
export type ResultadoRelatorio = {
  titulo: string; subtitulo: string;
  destaques: { rotulo: string; valor: string; auxiliar?: string }[];
  secoes: Secao[];
  /** O que este relatório NÃO afirma. Array vazio é REPROVADO pelo teste. */
  ressalvas: string[];
  /** Uma linha por objeto de banco que alimentou a folha. */
  fontes: string[];
};
export type ContextoRelatorio = {
  de: string | null; ate: string | null; produto: string | null;
  /** O escopo sai DAQUI. Nunca de query string, nunca de body. */
  sessao: Ator;
  protocolo: string;
};
export type DefinicaoRelatorio = {
  id: string; nome: string; descricao: string;
  params: ("periodo" | "produto")[];
  nivel?: "gestor" | "master";
  portais: ("HM" | "AURUM" | "ETHB")[];
  gerar(ctx: ContextoRelatorio): Promise<ResultadoRelatorio>;
};
```

**Plugar um relatório novo = 1 arquivo + 1 linha em `registry.ts`.** A tela não muda: ela lê
`GET /api/relatorios` e monta o dropdown com o que voltar. Nenhum `if (tipo === ...)` em lugar
nenhum — nem no front, nem na rota.

### 4.4 O caminho da folha

```
tela  -> POST /api/relatorios/{tipo}?de&ate&produto
         guard(portal) -> escopoVisibilidade(sessao) -> registry.gerar(ctx)
         -> grava cs.relatorio_emitido (conteudo inteiro) + cs.protocolo_operacao
         -> { ok:true, protocolo:'HM-20260816-0001' }
tela  -> abre /relatorio/HM-20260816-0001 em aba nova
folha -> server component: GET do conteudo congelado -> <RelatorioFolha/>
         botão "Imprimir" -> window.print()
```

### 4.5 Identidade visual e impressão — sem dependência nova

- **Nenhuma biblioteca de PDF.** `@media print` + `window.print()`. `package.json` não muda.
- CSS em `app/globals.css`, uma seção `@media print` e uma classe `.folha`:
  `@page { size: A4; margin: 14mm }` · `header, .nao-imprime { display:none }` ·
  `main { max-width:none; padding:0 }` · `thead { display: table-header-group }` (repete o
  cabeçalho a cada página — o detalhe que sempre falta e faz a página 3 virar números soltos) ·
  `tr, .bloco { break-inside: avoid }` · `-webkit-print-color-adjust: exact` (senão o
  significado de cor do `TOM` some no papel).
- **Sem route group.** `TopNav` já se esconde sozinho em rotas específicas (`top-nav.tsx:108`);
  basta somar `/relatorio/`, e o `<main>` do layout raiz é neutralizado pelo `@media print`.
  Um route group não escaparia do layout raiz de qualquer forma.
- **Identidade:** cabeçalho lê `lib/marcas.ts` (fonte única da marca) — logo do portal +
  "Grupo Participa" + título + recorte de datas + **protocolo** + quem gerou e quando. Rodapé
  fixo em toda folha: protocolo · página · "emitido em".
  **Última folha, sempre:** *"De onde vem cada número"* (`fontes`) e *"O que este relatório não
  afirma"* (`ressalvas`).
  ⚠️ Ver **BLOQUEIO 1**: não existe arquivo de marca do Grupo Participa no repo.
  `lib/marcas.ts:6-8` proíbe redesenhar ou imitar marca. Até o arquivo chegar, o cabeçalho usa
  a marca do portal (que existe) + o nome em texto. **Trocar depois é soltar um SVG em
  `public/marcas/` — zero linha de código.**

### 4.6 Os três relatórios do dia 1

| id | reusa | ressalva **obrigatória** na folha |
|---|---|---|
| `carteira-comercial` | `carteiraHm()` (`lib/services/hm-carteira.ts:203`) | *"É um retrato de acompanhamento e de dinheiro por carteira. Não é apuração de comissionamento: atendimento por WhatsApp, ligação e reunião não passa pela ficha."* (frase já validada com o João em 03:00 de 16/08) + *"O saldo de N pessoas se move ~R$ X/dia; este número vale para DD/MM."* |
| `acoes-do-comercial` | `atividadeHm()` (`lib/services/hm-atividade.ts`) | *"Mede o que foi registrado no sistema, não o resultado comercial."* |
| `visao-geral` | o serviço do `/painel` (bloco B2) | *"Série começa em 16/08/2026; período anterior a isso aparece vazio, não zero."* |

Colunas de `carteira-comercial` na **ordem do pedido da Kelly** (diário 08:10): *Aluno ·
Situação · Pagou o restante? · Quanto pagou · Quando pagou · Valor que ele paga · Por que não é
R$ 15.000 · Falta pagar · Quando ele paga*.

---

## 5. DIVISÃO DE TAREFAS

**Fronteira de arquivos (back e front não se encostam):**
`BACKEND` = `db/migrations/**`, `lib/**`, `app/api/**`, `scripts/**`.
`FRONTEND` = `app/**/page.tsx`, `app/_components/**`, `app/globals.css`, `app/{aurum,ethb}/**`.
**Única costura:** `lib/relatorios/tipos.ts` — backend escreve no bloco **B0** e **congela**;
o frontend importa só o `type`.

### [BACKEND]

**B0 · o contrato dos relatórios** — *sem dependências. FAZER PRIMEIRO, o front está esperando.*
Cria `lib/relatorios/tipos.ts` exatamente como em 4.3.
✅ *aceite:* `npx tsc --noEmit` limpo; o arquivo não importa nada de `app/`; anunciar
"tipos.ts congelado" no scratchpad antes de seguir.

**B1 · migrations 0255–0259** — *dep: B0 (só ordem, não código).*
As cinco da seção 3, uma por arquivo. Cada uma com o cabeçalho narrativo do projeto e bloco
`do $$ ... raise notice` de conferência nominal (padrão 0247).
✅ *aceite:* as **contagens CONTAR ANTES** rodadas e coladas no scratchpad **antes** de aplicar;
`revoke update, delete` presente nas quatro tabelas novas de `cs`; **zero linha de
`hm_product_catalog` com `pacote_cheio` / `entrada_do_programa` / `concede_trilha` alterado**
(provar com contagem antes×depois); rollback de cada uma escrito no rodapé do arquivo.
🛑 *pare e escale:* se a contagem de homônimos de `cs.interacoes.autor` (0258) devolver ≥1.

**B2 · serviço do painel + série temporal** — *dep: B1.*
`lib/services/hm-painel.ts` novo: KPI do período **com o período anterior de mesma duração**
(a comparação é do servidor, não do front — senão duas telas comparam diferente) e série por
`dia|semana|mes` reusando `Granularidade` de `lib/validators.ts`.
Rota `app/api/hm/painel/route.ts`, `guard({portal})` + `escopoVisibilidade`, `?produto=`
**sempre explícito** (a armadilha documentada em `app/hm/atividade/page.tsx:26-31`: sem ele o
dinheiro do AURUM entra no placar do HM).
Série lê `cs.hm_pagamentos` / `cs.contatos_hm` para o que é reconstruível e
`cs.hm_fechamento_diario` para `a_receber`; **devolve explicitamente `serie_comeca_em`** para o
front saber onde começa o "sem dado".
✅ *aceite:* o KPI "Recebido" do painel **bate ao centavo** com a soma de `cs.hm_pagamentos` no
mesmo recorte; período sem fechamento devolve `null`, **nunca `0`**.

**B3 · o desempenho passa a creditar pela carteira reconstruída** — *dep: B1.*
`desempenhoComercialDinheiroNucleo` (`lib/services/hm-atividade.ts:766-795`) troca
`ch.responsavel_comercial_id` por `cs.vw_hm_carteira.carteira_usuario_id`, e devolve
`carteira_origem` / `carteira_lastro` por pessoa.
✅ *aceite:* colar no scratchpad o **antes × depois por pessoa** (a Kelly muda; o vault prevê que
ela caia de ~69 para ~66, com só 18 documentais); a linha "Sem responsável comercial" que hoje
sai do ranking continua saindo, com o texto atualizado para o critério novo.
⚠️ *não fazer:* backfill de `responsavel_comercial_id`. 67 dos 94 cards em ativação têm a Ana
Camila como dona vigente — copiar o dono atual creditaria a ela 67 vendas que não fez
(`atividade-desempenho.tsx:99-111`).

**B4 · registry + rotas de relatório** — *dep: B0, B1.*
`registry.ts`, os três geradores de 4.6, `protocolo.ts` (numeração `PORTAL-AAAAMMDD-NNNN`,
sequencial por dia, sob advisory lock para não colidir), as três rotas de 4.2.
**`GET /api/relatorios` filtra por nível e portal de quem pergunta** — não oferecer porta que a
pessoa não abre.
✅ *aceite:* `grep -rn "select \|from cs\." lib/relatorios/` devolve **zero** (a lei 4.1);
`ressalvas.length === 0` derruba a geração com erro claro; dois `POST` do mesmo tipo geram
protocolos diferentes e o conteúdo do primeiro **não muda**.

**B5 · `lib/protocolo.ts` + o gancho no cron** — *dep: B1.*
Helper único de escrita em `cs.protocolo_operacao`; chamada de `cs.fn_hm_fechar_dia` dentro de
`executar()` em `app/api/cron/route.ts` (já autorizado por `CRON_SECRET`).
✅ *aceite:* rodar o cron 3× seguidas cria **1** linha de fechamento por dia/produto/pessoa;
emitir relatório grava 1 linha em `protocolo_operacao`; tentar `update` na tabela como
`disparos_app` **falha** (é o teste do append-only, não a leitura do GRANT).

**B6 · API do catálogo de ofertas** — *dep: B1, D0.*
`GET/PATCH /api/hm/ofertas` (master), `POST /api/hm/ofertas/importar` (staging, nunca direto no
catálogo), `GET /api/hm/ofertas/importacao/{lote}`. Toda escrita passa por `lib/protocolo.ts`.
✅ *aceite:* import de 67 linhas grava 67 em `oferta_planilha_import` e **0** em
`hm_product_catalog`; promover 1 linha muda 1 linha e grava 1 protocolo; `PATCH` de
`valor_tabela` **não** altera `pacote_cheio` (provar por consulta).

### [FRONTEND]

**F0 · navegação em três grupos** — *sem dependências.*
`app/_components/top-nav.tsx`: `LINKS_HM` vira `GRUPOS_HM` (operação · gestão · ajustes, com
separador visual e `role="group"` + `aria-label`); "Agendamentos"→"Agenda"; `Reuniões` sai do
topo; `Tags`/`Ofertas` entram no dropdown "Mais"; `/relatorio/` some do cabeçalho
(`top-nav.tsx:108`).
✅ *aceite:* Chromium a **390px e 1440px**, captura dos dois; `scrollWidth` da página = largura
da viewport nos dois (o defeito de `top-nav.tsx:146-149`); navegar por teclado alcança os 3
grupos; **nenhuma rota existente ficou inalcançável** — listar as 14 rotas e o caminho de cada
uma no scratchpad.

**F1 · os três links que atravessam portal** — *sem dependências.*
`tag-picker.tsx:135` (`/hm/tags` → `${base}/tags`), `hm-drawer.tsx:1902` e
`agendamentos/page.tsx:799` (`/hm/contatos/${id}` → `${base}/contatos/${id}`); criar
`app/{aurum,ethb}/contatos/[id]/page.tsx` e `app/{aurum,ethb}/carteira/page.tsx` reexportando a
tela do HM (padrão já usado em `app/hm/inbox/page.tsx`, 5 linhas).
✅ *aceite:* logado **só com AURUM**, clicar em Carteira, em Tags e no nome de um aluno **não
cai em `/?sem_acesso=hm`** — verificado no Chromium, com captura.

**F2 · `KpiComparado`, o primitivo que faltava** — *sem dependências.*
Novo em `app/_components/ui-base.tsx` (aditivo — `ui.tsx` e `kpi.tsx` **não mudam**): valor +
comparação com o período anterior (Δ absoluto e %) + sparkline. Sem base: **"sem comparação
ainda"**, nunca `0%` (lei 4 do `padrao-visual.md`). Cor **sempre função do valor**, tabela `TOM`.
Migra os 4 KPI feitos à mão de `app/hm/carteira/page.tsx`.
✅ *aceite:* `npm run test:vocabulario` verde; captura clara/escura; período sem dado mostra
texto, não zero.

**F3 · `{base}/painel`** — *dep: B2, F2.*
A tela da seção 2.2, nos três portais. **O painel `AtividadeDesempenho` é REMOVIDO de
`app/hm/atividade/page.tsx:53`** — move, não copia.
✅ *aceite:* `grep -rn "AtividadeDesempenho" app/` devolve **só** o painel; a série mostra "sem
dado antes de 16/08" no trecho vazio; **o KPI "A receber" do painel bate com o topo de
`/carteira` no mesmo minuto** (é a prova de que as duas telas não divergem).

**F4 · h1 e rótulos** — *sem dependências.*
h1 de `/kanban` e `/tabela` → "Jornada · {portal}" (hoje os dois dizem "Ativação · {portal}",
`kanban:708` e `tabela:1614`); "Ativação" passa a nomear o módulo no cabeçalho; `HmVisao` ganha
o par Calendário ⇄ Lista para Agenda/Reuniões.
✅ *aceite:* `npm run test:vocabulario` verde; captura das 4 telas; **nenhuma outra mudança de
posição ou tamanho** (regra do "seja criterioso").

**F5 · `{base}/relatorios` + `/relatorio/[protocolo]` + CSS de impressão** — *dep: B0, B4.*
Dropdown alimentado por `GET /api/relatorios` (**sem lista de tipos no front**), seletor de
período com atalhos (hoje · 7 · 30 · mês passado · personalizado), botão Gerar → abre a folha em
aba nova. `RelatorioFolha` é **um render só** para qualquer `ResultadoRelatorio`. `@media print`
em `app/globals.css` conforme 4.5.
✅ *aceite:* imprimir em PDF no Chromium e **anexar o arquivo**; cabeçalho da tabela repete na
página 2; protocolo legível no rodapé de **todas** as páginas; a última folha traz fontes e
ressalvas; reabrir o mesmo protocolo no dia seguinte mostra **exatamente** os mesmos números.

**F6 · `{base}/ofertas`** — *dep: B6, D0.*
Lista do catálogo (busca por nome/código/produto, filtro ativo/inativo), edição das colunas
descritivas, importação da planilha com **tela de conferência antes de promover**: quatro grupos
— *casou · código novo · sem código (não é oferta) · conflito de valor* — e nada entra no
catálogo sem clique.
✅ *aceite:* as 67 linhas aparecem classificadas; a linha "Renata Farias Bassi… REALIZAR
CANCELAMENTO" cai em **"não é oferta"** e a tela pergunta o que fazer com ela, sem chutar;
ativar/desativar pede confirmação e mostra quem fez por último.

### [DADOS]

**D0 · conciliação planilha × catálogo** — *`analista-de-dados`. BLOQUEIA B6 e F6.*
Das 67 linhas: quantas têm `Código`; quantas casam com `offer_code` existente; quantas são
código novo; quantas **não são oferta** (pessoa física / instrução de operação); quantas têm
`Valor` divergente de `pacote_cheio`; quantas têm `Produto` divergente de
`cs.hm_produto_por_oferta`.
✅ *aceite:* as seis contagens no scratchpad + a lista nominal dos conflitos.

**D1 · as contagens CONTAR ANTES da B1** — *pode ser o próprio backend.*
As consultas da seção 3, coladas no scratchpad antes de qualquer `apply`.

**D2 · antes × depois da B3** — *dep: B3.*
Placar por pessoa nos dois critérios, lado a lado. **Vai anexado ao PR** — o número da Kelly
muda, e mudar número de gente sem mostrar a conta é como se perde a confiança no relatório
inteiro (`A tela não pode inventar a conta que explica o desconto`).

### [SECURITY-PENTESTER] — obrigatório

**S1 · superfície nova de PII e de dinheiro.** `/api/relatorios/*` (três rotas),
`/api/hm/painel`, `/api/hm/ofertas*`, e `/relatorio/[protocolo]` — **uma página que serve dado
financeiro nominal por URL adivinhável**. Checar em especial:
(a) `escopoVisibilidade` aplicado **dentro** de cada gerador, e não só na listagem de tipos;
(b) **reabrir protocolo alheio** — a folha tem que recusar quem não podia gerar aquele recorte,
e o `escopo` gravado na linha é o que decide, não a sessão de agora;
(c) `escopoDisparo()` **não** ampliado por tabela (a lição de `Ampliar escopo compartilhado
amplia todo consumidor`: `escopoAcao` também recorta destinatário de `/api/send`);
(d) o `revoke update, delete` das quatro tabelas novas de `cs` — a 0001 dá
`alter default privileges` e **toda tabela nova nasce apagável**;
(e) `link_pagamento` do catálogo: campo de texto livre que vira `<a href>` na tela →
`javascript:` e `data:`;
(f) importação de planilha: quem pode, e o que acontece com CSV de 50 MB.
✅ *aceite:* relatório no formato do system prompt dele, severidade por achado e agente
responsável pela correção; nada de crítico/alto pendente antes do Fable.

### Ordem de execução

```
B0 -+- B1 -+- B2 --- F3        F0, F1, F2, F4 correm desde o minuto zero
    |      +- B3 --- D2        (não dependem de backend nenhum)
    |      +- B5
    |      +- B4 --- F5
    +- D0 --- B6 --- F6
                          -> S1 (sobre o diff inteiro) -> Fable
```

---

## 6. CONFLITO

1. **Duas telas do sistema já respondem "de quem é a carteira" com números diferentes.**
   `/atividade` credita por `responsavel_comercial_id` (`lib/services/hm-atividade.ts:771`);
   `/carteira` reconstrói pela linha do tempo (`cs.vw_hm_carteira`). O pedido de "repaginar para
   não haver divergência" **exige escolher uma**, e a escolha muda o número de pessoas reais — o
   vault mediu Kelly 69 → 66, com só 18 documentais. Resolvido em **B3 + D2**: uma fonte só, e o
   antes×depois anexado ao PR. **Não é bloqueio** porque a direção já está decidida no vault
   (`Carteira do card se perde na ativação`) e escrita no diário de 04:10.
2. **"Tela nova substitui, não empilha" × "seja criterioso, o pessoal já está habituado"**
   (`docs/padrao-visual.md`). As duas regras são do próprio João e apontam para lados opostos.
   Arbitragem deste plano: **substituir onde a coisa está no lugar errado** (o painel de dinheiro
   sai da Atividade — o lugar antigo some) e **preservar rota onde só o caminho muda**
   (`/reunioes` e `/tags` continuam existindo; mudam de posição no menu). **Nenhuma rota é
   apagada. Nenhum redirect é criado.**
3. **"Leitura de longo prazo" × pró-rata com `CURRENT_DATE`.** Uma série histórica de "a receber"
   é aritmeticamente impossível para trás: o saldo de 73 pessoas se move ≈ R$ 1.110,94 por dia.
   **O gráfico começa vazio em 16/08/2026 e enche a partir de agora.** O João precisa saber disso
   antes de abrir a tela, ou vai achar que quebrou.
4. **A planilha de ofertas não é só um catálogo.** Linhas 2-3 do CSV são pessoa física com
   instrução de operação ("REALIZAR CANCELAMENTO"), sem código e sem link. Vão para quarentena
   (0257) e para a aba "não é oferta" — **não entram na tabela que decide o que 242 pessoas
   devem.**
5. **`cs.oferta_planilha_import` é append-only e mesmo assim precisa marcar "resolvido".**
   Resolvido por **linha nova em `cs.protocolo_operacao`**, nunca por `UPDATE`. O backend não
   pode "só liberar o update" — foi o atalho que a 0177 fechou depois de achado do pentester.

## 7. BLOQUEIO

1. **Não existe arquivo de marca do Grupo Participa no repositório.** `public/marcas/` tem
   `ht.png`, `seminario.svg`, `hm`, `aurum`, `ethb` — marcas de **portal**. O relatório foi
   pedido "com a identidade do Grupo Participa", e `lib/marcas.ts:6-8` proíbe redesenhar ou
   imitar marca ("ou é o arquivo oficial, ou é a sigla").
   **O trabalho NÃO para:** o cabeçalho usa a marca do portal + "Grupo Participa" em texto, e
   `lib/marcas.ts` é a fonte única — trocar depois é soltar o SVG em `public/marcas/` e apontar
   uma linha. **Do João:** o arquivo oficial (SVG preferido) e, se houver, a cor institucional.
2. **Homônimo em `cs.interacoes.autor`** (contagem da 0258). Se um mesmo texto de autor casar
   com 2+ usuários, o `autor_id` credita ações de uma pessoa a outra — dentro do relatório que o
   próprio João classificou como "papo de demissional". **Se a contagem der ≥ 1, o backend para e
   escala; não escolhe critério.** Com 0 homônimos, segue sem consulta.

---

## 8. OS 5 CRITÉRIOS DO FABLE

| critério | o que este plano garante |
|---|---|
| **Segurança** | Toda rota nova passa por `guard({portal})` e recorta por `escopoVisibilidade` **dentro do gerador**, nunca só na listagem; o `escopo` fica gravado em `cs.relatorio_emitido` e é ele que autoriza reabrir o protocolo; as 4 tabelas novas de `cs` levam `revoke update, delete` (a 0001 dá `alter default privileges`, e sem o revoke a prova nasce apagável); `escopoDisparo()` **não** é tocado — ampliar escopo compartilhado amplia todo consumidor; S1 é obrigatório e cobre PII nominal servida por URL. |
| **Escalabilidade** | Reabrir relatório vira 1 select por PK (contra 0,81 s da Central); a série lê `cs.hm_fechamento_diario` (~1.500 linhas/ano) em vez de recalcular a view; índices `(produto, dia desc)`, `(tipo, emitido_em desc)`, `(acao, criado_em desc)`. A 10× das linhas atuais (2.500 alunos) o painel continua lendo agregado, não detalhe. |
| **Solidificação** | O banco passa a garantir sozinho: `hm_fechamento_diario` **append-only** com PK por dia×produto×pessoa (um dia não fecha duas vezes); `relatorio_emitido.protocolo` **unique**; `oferta_planilha_import.situacao` e `catalog.origem` em `check`; `valor_tabela > 0`; `vale_ate >= vale_de`; `link_pagamento like 'https://%'`; `interacoes.autor_id` desliga o histórico do texto do nome. |
| **UX** | Menu de 10 itens planos → 8 em 3 grupos nomeados, com "o dia" separado de "o período" — a queixa literal do João; KPI ganha comparação e sparkline (`KpiComparado`), que hoje não existe em lugar nenhum; menu e h1 passam a dizer a mesma palavra; três links que expulsavam o operador do AURUM/ETHB corrigidos; nada é apagado e nenhum atalho antigo quebra. Toda tela validada em Chromium a 390 e 1440 px, com captura — build verde não prova tela boa. |
| **Otimização** | **A feature reduz.** A lei 4.1 (relatório não escreve SQL) faz tela, XLSX e PDF saírem do mesmo serviço — a classe de bug "duas telas discordam" deixa de existir por construção. B3 apaga a segunda fonte de verdade da carteira. `KpiComparado` unifica os três jeitos de mostrar um número. O fechamento diário guarda **só** o que não se reconstrói, em vez de duplicar o razão. Relatório novo = 1 arquivo + 1 linha; a tela nunca muda. **Zero dependência nova no `package.json`** (impressão é `@media print` + `window.print()`). |
