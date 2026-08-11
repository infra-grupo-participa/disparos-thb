# Planilha personalizada — plano (aguardando aprovação)

> Status: **desenhado, não implementado**. Marcio pediu em 11/08/2026 e optou por
> desenhar agora e implementar depois, separando das correções urgentes.

## O pedido

Hoje existem 3 exports XLSX **fixos** (esteira, financeiro, ficha), cada um com as
colunas cravadas em código. O pedido é **um botão só** — "Gerar planilha" — que abra um
construtor onde a pessoa escolhe a fonte (portal/produto), as colunas e os filtros, e
possa salvar esse formato para reusar.

## Como fica (fluxo)

Um botão abre um painel lateral com 3 passos, navegáveis (não wizard travado):

1. **Fonte** — Esteira (1 linha por aluno) · Pagamentos (1 linha por pagamento) · Sócios.
   O produto (HM/AURUM/ETHB) vem pré-selecionado do board.
2. **Colunas** — lista agrupada (Identificação · Esteira · Financeiro · Ativação ·
   Cancelamento), com busca e "selecionar grupo". Campos de dado pessoal levam selo e
   vêm **desmarcados** por padrão.
3. **Filtros** — os mesmos do board (responsável, canal, turma, etapa, período,
   situação), com contador vivo: "≈ 184 linhas" antes de gerar.

Rodapé com o resumo em uma frase — *"Esteira do HM · 12 colunas · responsável: Ana ·
≈184 linhas"* — para ninguém gerar 40 colunas por engano. No fim, "Salvar como modelo"
(pessoal ou da equipe).

**Os 3 exports atuais viram modelos pré-definidos** desse mesmo mecanismo, já
selecionados — quem só quer o de sempre continua a 1 clique.

## Fases

| # | Entrega | Quem |
|---|---|---|
| 0 | *(já feito nesta leva)* export passa a respeitar o produto | — |
| 1 | **Catálogo de campos** (`lib/export/catalogo.ts`): chave, rótulo, tipo, grupo, se é PII | backend |
| 2 | **Writer genérico** (`lib/export/planilha.ts`): um só, em vez de dois quase iguais | backend |
| 3 | Os 3 exports viram modelos fixos — **rotas atuais não mudam de contrato** | backend |
| 4 | Tabela `cs.export_modelos` + serviço | backend |
| 5 | Rotas: `catalogo`, `modelos` (CRUD), `gerar` | backend |
| 6 | UI do construtor | frontend |
| 7 | Auditoria (PII + endpoint que aceita lista de colunas) | pentester |

## Modelo de dados

```sql
create table cs.export_modelos (
  id uuid primary key default gen_random_uuid(),
  nome text not null,
  fonte text not null check (fonte in ('hm_esteira','hm_pagamentos','hm_socios')),
  produto text not null check (produto in ('HM','AURUM','ETHB')),
  campos text[] not null check (cardinality(campos) between 1 and 80),
  filtros jsonb not null default '{}'::jsonb,
  dono_id uuid not null references cs.usuarios(id) on delete cascade,
  visibilidade text not null default 'pessoal' check (visibilidade in ('pessoal','equipe')),
  equipe_id uuid references cs.equipes(id) on delete set null,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);
```

Decisões que o DDL carrega:

- **`campos` guarda só CHAVES**, não rótulo/largura. O catálogo (código) é a fonte da
  verdade; renomear "Saldo a pagar" não exige UPDATE em N modelos. Chave que sumiu é
  **ignorada na leitura** — modelo antigo nunca quebra, a UI só avisa.
- **Sem RLS**, de propósito: o app conecta como role fixa (`disparos_app`), então RLS
  não seria avaliada por usuário — seria teatro. A cerca é `dono_id`/`equipe_id` no
  WHERE, igual ao resto do sistema.
- **`filtros` é jsonb validado por Zod**, com whitelist de chaves. **Nenhum fragmento
  de SQL vem do cliente.**
- O modelo **não guarda escopo**: escopo é sempre recalculado de quem executa. Modelo
  salvo por um master e rodado por operador devolve só o que o operador vê.

## Segurança — as duas cercas

1. **Linhas**: `gerar` aplica `sqlEscopo` exatamente como as rotas atuais. Os filtros do
   usuário entram em placeholders separados e são `AND` no mesmo WHERE — filtro só
   consegue **estreitar**, nunca alargar.
2. **Colunas**: o catálogo é recortado por papel **na resposta** e **de novo** na
   geração. Sem isso, o construtor viraria o vazamento: a tela esconde campos de
   cancelamento do não-master, mas nada impediria pedir a chave por `curl`.

`gerar` é **POST**, não GET: o payload não cabe em querystring e não deve ficar no
histórico do navegador nem em log de acesso com PII nos filtros.

**v1 é XLSX apenas.** CSV exigiria sanitizar `=`/`+`/`-`/`@` — os campos `acordo`,
`observacoes`, `pendencia` são texto livre digitado por operador, ou seja, vetor real de
fórmula maliciosa. Se quiser CSV, desenhar junto, não depois.

## Performance / egress

⚠️ É o risco real. `relatorioHm` chama **duas funções por linha**
(`fn_hm_prorata`, `fn_hm_pode_finalizar`) mais 3 laterais, e **não tem LIMIT**. Hoje
passa porque o board tem ~250 cards. O construtor muda o padrão de uso: convida a pedir
tudo, repetidamente — e o histórico desta operação registra que o vilão do egress foi
exatamente "varredura full-table repetida", não volume de dado.

- **Teto de 5.000 linhas**, com erro que **diz qual filtro aplicar**
- **Rate limit** por usuário (1 geração / 20 s) — duplo-clique hoje dispara duas
  varreduras completas
- **Sem streaming na v1**: ExcelJS materializa o workbook em memória. Com o teto acima,
  o buffer fica em poucos MB. Streaming entra se o teto incomodar.

## O que isto limpa

- −4 tabelas de colunas paralelas → 1 catálogo
- −2 writers quase idênticos → 1
- −3 cópias de `n()`/`d()`/`txt()`/`sn()` → 1 conversor por tipo
- −5 dicionários de rótulo duplicados entre export e tela
- Elimina o `SUBTOTAL` casado por **string de header** (renomear rótulo hoje mata a
  linha TOTAL em silêncio)
- Transforma "dinheiro nunca é `—`" de convenção em **invariante do writer** — o teste
  passa a cobrir o mecanismo, não uma lista de 21 headers

## Fora da v1 (cortes propostos)

- **Portais HT/SEM/CNHF**: são outra tabela (`cs.contatos`), outro formato de linha e
  hoje **não têm export nenhum** — dobraria o escopo. v1 cobre HM/AURUM/ETHB, que
  compartilham a mesma esteira.
- Ordem das colunas arrastável
- Modelo global editável pela tela (os 3 padrões ficam como constantes em código)
- Aba "Resumo" em planilha personalizada — Resumo depende de colunas conhecidas;
  fica só nos modelos fixos

## Decisões que preciso do Marcio

1. **HT/SEM/CNHF já na v1?** (Ele falou "portal" e "canais"; no repo "portal" tem dois
   significados. Minha proposta: v1 = HM/AURUM/ETHB; o resto na v2.)
2. **Campo restrito pedido por quem não pode**: silenciar a coluna ou recusar com erro?
   (Proponho silenciar + informar quais foram omitidas.)
3. **Registrar quem exportou o quê?** Permite responder "quem baixou a base com telefone
   em outubro". Custa uma tabela e política de retenção — que é dado de auditoria com
   PII, decisão dele.
4. **Teto de 5.000 linhas serve?** Se precisar exportar mais de uma vez, o desenho muda
   (job assíncrono + link) e a feature dobra de tamanho.
5. **Os 2 botões atuais somem** e viram um só? (Manter os dois + o novo = três caminhos
   para a mesma coisa.)
