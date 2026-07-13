# HM — a visão em tabela (a terceira leitura da mesma esteira)

> Especificação de produto e de implementação. O kanban responde **"onde cada um
> está"**. A ficha responde **"tudo sobre esta pessoa"**. Falta a leitura que a
> planilha fazia e que nenhuma das duas faz: **"o que está acontecendo com as 129
> pessoas ao mesmo tempo"** — em linhas, ordenável, somável, editável em massa.
>
> Esta é a tela que aposenta de vez a "HM - T39 CONTROLE DE ATIVAÇÃO" (ver
> `docs/hm-mapa-planilha.md`, migração já concluída). Sem ela, o time tem os dados
> no sistema mas continua exportando o XLSX para trabalhar — o que é a planilha de
> volta, só que desatualizada.

---

## 1. O que a tabela é — e o que ela não é

**É** a mesma esteira, lida por linha em vez de por coluna. Mesmos dados, mesmos
filtros, mesmos serviços, mesma verdade. Ela existe porque três perguntas do dia a
dia não cabem num board:

| Pergunta da operação | O kanban responde? | A tabela responde |
|---|---|---|
| "Quem recebeu o link do saldo e não pagou?" | não — é um estado, não uma etapa | lente **Cobrança** |
| "Quanto dinheiro está represado, por responsável?" | não — o card não soma | rodapé: **saldo a receber** |
| "Atribui esses 20 leads sem dono para a Ana Camila" | não — 20 arrastos | seleção + **ação em lote** |

**Não é** um segundo modelo de dados, nem uma segunda verdade. Toda escrita passa
pelos serviços que o board já usa (`lib/services/hm.ts`). Toda leitura sai de
`relatorioHm()` — a mesma função que gera o XLSX. Se a tabela e a planilha
contarem histórias diferentes, é bug.

**Não é** uma esteira. Por isso ela **não** vira uma terceira aba ao lado de
"Comercial" e "Ativação": essas duas são as esteiras do produto. A tabela é outro
**modo de ver as duas** — mora em `/hm/tabela`, com um alternador `Kanban ⇄ Tabela`
que preserva os filtros na URL.

---

## 2. A linha: a pessoa e seus sete estados

Uma pessoa no HM não tem "um estado". Tem sete, e a planilha antiga existia porque
o card só mostrava dois deles. A tabela mostra os sete — agrupados, porque 38
colunas soltas afogam quem lê.

| Bloco | Campos | Origem |
|---|---|---|
| **1. Quem é** | nome, telefone, e-mail, canal (tag), público (Aluno THB / Aurum / Lead novo), turma de origem, turma atual, sócios, Facebook | Hotmart + base THB + `fn_tag_hm_origem` — **fato, não se digita** |
| **2. Onde está** | esteira (Comercial/Ativação), etapa, dias parados na etapa, responsável | `cs.estagios` + última `mudanca_estagio` da timeline |
| **3. O que foi combinado** | acordo (texto), meio de pagamento, previsão, oferta de saldo, link enviado em | `cs.contatos_hm` — **é o que o operador só ele sabe** |
| **4. Quanto** | entrada (sinal/compra cheia), crédito pró-rata, saldo a pagar, valor total, valor pago, pagamento em, forma/parcelas | insumos digitados + `cs.fn_hm_prorata` (conta, não campo) |
| **5. Compromissos** | reunião + resultado, entrevista + resultado, remarcações, não comparecimentos | `cs.hm_agendamentos` + `cs.hm_reagendamentos` |
| **6. Ativação** | checklist 4 itens (Searchie, comunidade, grupo, pesquisa), grupo de informes, pendência, apto à ativação, na base THB | `cs.contatos_hm` + `thb_alunos` |
| **7. Travas** | NÃO CONTATAR (+motivo), REVISAR (+motivo), cancelamento (+motivo) | `cs.contatos_hm` — **o operador precisa ver antes de ligar** |

### Visões (presets de colunas)

Ninguém trabalha com os sete blocos ao mesmo tempo. O seletor de visão troca o
conjunto de colunas — e é o que faz a tela caber na tela:

| Visão | Colunas | Para quem |
|---|---|---|
| **Comercial** (padrão) | Nome · Telefone · Etapa · Dias · Responsável · Entrada · Acordo · Meio · Previsão · Link enviado · **Saldo** | quem cobra o saldo |
| **Ativação** | Nome · Etapa · Dias · Responsável · **Checklist (n/4)** · Grupo · Pendência · Entrevista · Na base THB · Sócios | quem libera acesso |
| **Agenda** | Nome · Responsável · Reunião · Resultado · Remarcadas · Entrevista · Resultado · Remarcadas · No-shows | quem marca e cobra presença |
| **Financeiro** | Nome · Entrada · Turma de origem · Crédito · **Saldo** · Total · Pago · Pagamento em · Forma · Meio | quem fecha o caixa |
| **Tudo** | as 38 colunas do XLSX | auditoria |

---

## 3. As lentes — os estados que o kanban não consegue mostrar

Uma etapa é onde a pessoa está. Uma **lente** é o que está errado com ela. O board
não tem como expressar isso (não existe coluna "recebeu o link e sumiu"), e é
exatamente aí que mora o trabalho do dia. As lentes são chips que somam filtros
sobre as linhas já carregadas — cada uma mostra a contagem, e contagem zero é
informação (ninguém está travado ali).

**Cobrança do saldo** — o gargalo do produto, o dinheiro parado
- `Link enviado e não pagou` — `link_saldo_enviado_em` preenchido, `pagamento_em` nulo
- `Previsão vencida` — `pagamento_previsto_em < hoje` e sem pagamento
- `Sem acordo` — está no Comercial, passou da reunião e `acordo` está vazio

**Ativação incompleta** — quem pagou e não chegou na linha de chegada
- `Checklist pela metade` — na aba Ativação, com 1 a 3 dos 4 itens
- `Sem grupo de informes` — `ativ_grupo` falso ou `grupo_informes` vazio
- `Com pendência escrita` — `pendencia` preenchida

**Abandono / enrolação** — o sinal que a planilha apagava a cada remarcação
- `Parado há +7 dias` — `dias_na_etapa >= 7`
- `Remarcou 2+ vezes` — `reunioes_remarcadas + entrevistas_remarcadas >= 2`
- `Não compareceu` — `nao_comparecimentos > 0`

**Higiene da operação** — o que corrói a base por dentro
- `Sem responsável` — `responsavel` nulo
- `REVISAR` / `NÃO CONTATAR` — as travas
- `Pagou e não está na base THB` — `apto_ativacao` verdadeiro e `aluno_id` nulo. **Esta é a lente mais importante da lista**: significa que o aluno pagou e o GPS nunca vai criar o acesso dele.

---

## 4. O contrato de cada coluna: derivado, editável ou ação

A regra que organiza a tabela inteira é a mesma da ficha: **o operador só digita o
que só ele sabe.** Toda célula cai em uma das três categorias — e essa
classificação é o coração da harmonização com o produto.

### 4.1 Derivado — nunca editável (é fato ou é conta)

`nome` · `telefone` · `email` · `canal`/`tags` · `turma_origem` · `categoria_entrada`
· `saldo_a_pagar` · `credito` · `valor_total` · `valor_pago` · `pagamento_em` ·
`dias_na_etapa` · `reunioes_remarcadas` · `entrevistas_remarcadas` ·
`nao_comparecimentos` · `socios` · `aluno_id` (na base THB) · `apto_ativacao`

O canal vem do **fato** (o ingresso comprado + a janela do evento), nunca do texto.
O saldo é `14.700 − pró-rata`, calculado no banco. Editar qualquer um deles seria
inventar dado — e dado inventado é o motivo de a planilha ter envelhecido.

### 4.2 Editável na célula — passa pelo `PATCH /api/hm/contato/[id]`

Todos estes campos **já existem** em `HmContatoPatchSchema`. A tabela não precisa
de campo novo, nem de migration: ela é uma tela para o que o banco já sabe.

| Célula | Controle | Observação |
|---|---|---|
| Responsável | select | passa por `setResponsavelHm` → registra na timeline |
| Etapa | select | **passa por `moverEstagioHm`** — ver invariante nº 1 |
| Acordo, Pendência, Grupo de informes, Observações | texto | |
| Meio de pagamento | select (boleto/cartão/recorrente/pix/à vista) | |
| Previsão de pagamento | data | |
| Link enviado | checkbox | carimba a **hora** (`link_saldo_enviado_em`), não um booleano |
| Checklist (4 itens) | 4 checkboxes na mesma célula | mostra `n/4` |
| NÃO CONTATAR / REVISAR | checkbox + motivo | linha ganha destaque visual |
| Resultado da reunião / entrevista | select | |
| Reunião / Entrevista (data) | data **com popover** | ver invariante nº 4 — remarcar pede o motivo |
| Turma | select | trocar a turma troca a tag junto (o PATCH já faz) |

### 4.3 Ação, não célula — tem consequência fora do kanban

- **Registrar pagamento do saldo** → cria/atualiza o aluno em `public.thb_alunos` (e os sócios dele). É o insumo do GPS. Um clique errado numa grade não pode criar matrícula na base mestre: a linha tem um botão que **abre a ficha**, onde a confirmação já existe.
- **Cancelamento** → preserva o pagamento (o dinheiro entrou; apagar reescreveria o histórico) e exige motivo. Idem: ficha.
- **Disparo de WhatsApp** → seleção + `DisparoModal` (o mesmo do board), só para quem tem `podeDisparar` (admin/disparador).

---

## 5. Os sete invariantes — o que a tabela não pode quebrar

Esta seção é a razão de o documento existir. Cada item abaixo é uma regra do
produto que um `UPDATE` ingênuo numa grade destruiria em silêncio.

**1. A etapa é um lugar, não um campo.** Trocar a etapa pela tabela **tem** que
chamar `moverEstagioHm` (via `PATCH` com `estagio_chave`). Um update direto em
`estagio_id` perderia, de uma só vez: o `apto_ativacao`, o `pagamento_em`, o
**provisionamento do aluno na base THB** (e dos sócios), o registro em
`hm_liberacoes`, a timeline, a posição na coluna e a trava do checklist. Foi
exatamente esse buraco que a migration 0051 fechou.

**2. A trava do checklist vale igual na tabela.** "Ativação Realizada" é a linha de
chegada e só entra quem cumpriu os 4 itens. O PATCH devolve `400` com a lista
`faltando` — a tabela mostra *o que falta*, com as mesmas palavras do board, e não
um erro genérico.

**3. Na tabela não existe espelho.** No kanban, quem pagou aparece **duas vezes**
(na Ativação, de verdade; no Comercial, como registro do pagamento). Na tabela a
pessoa é **uma linha** — a coluna "Esteira" diz onde ela está. Duplicar a linha
para imitar o board quebraria toda soma de dinheiro e toda contagem. A tabela é,
justamente, o lugar onde o espelho não confunde ninguém.

**4. Remarcar não é trocar a data.** Escrever `reuniao_em`/`entrevista_em` quando
já havia data é um **fato da operação** (a pessoa se comprometeu e não veio, ou
adiou). A célula de data abre um popover que pede o motivo e avisa que é a *n*-ésima
remarcação. O `PATCH` já roteia para `agendarHm`, que guarda a marcação anterior em
`cs.hm_agendamentos` — sobrescrever apagaria o sinal que separa o lead morno do
lead que está enrolando.

**5. Ordenar a tabela não reordena o kanban.** `cs.contatos_hm.ordem` é o gesto
manual do board (a fila da coluna). O sort da tabela é da tela, e nunca escreve
`ordem`. Quem arrasta um card ordena a fila; quem clica no cabeçalho "Dias" só está
olhando.

**6. Filtros vão ao servidor; lentes e busca ficam no cliente.** `responsavel`,
`canal` e `turma` são os mesmos parâmetros do board e da exportação — a mesma query,
a mesma verdade, e o XLSX sai com o que está na tela. As lentes operam sobre as
linhas já carregadas (são ~130). Acima de ~1.000 linhas, virtualizar a lista.

**7. Não se inventa dado.** Nenhuma célula "sugere" valor. O saldo que aparece é o
que a `fn_hm_prorata` calcula; o aluno que aparece como "na base THB" é o que tem
`aluno_id`. Quando o sistema não sabe, a célula mostra `—`.

---

## 6. Ações em lote

O que a planilha fazia melhor que o kanban: mexer em muita gente de uma vez. A
seleção é por checkbox (a mesma da barra de disparo que já existe no board).

| Ação em lote | Como se comporta |
|---|---|
| Atribuir responsável | `setResponsavelHm` por linha — cada um registra na timeline |
| Mover etapa | `moverEstagioHm` por linha — **respeita a trava**; devolve quem não passou e por quê |
| Marcar item do checklist | os 4 itens, individualmente |
| Marcar link do saldo enviado | carimba a hora em cada um |
| Disparar WhatsApp | `DisparoModal`, restrito a `podeDisparar` |

O endpoint (`POST /api/hm/lote`) **itera chamando os serviços** — nunca um
`UPDATE ... WHERE id = ANY(...)`. É mais lento e é o certo: um lote que pula a
timeline e o provisionamento é um lote que corrompe a base em escala. A resposta é
`{ aplicados, falhas: [{ nome, motivo, faltando }] }`, e a tela mostra as falhas
nominalmente — "3 de 20 não entraram em Ativação Realizada: falta a pesquisa".

---

## 7. O rodapé: onde o dinheiro aparece somado

Fixo no fim da grade, recalculado a cada filtro/lente:

`129 alunos · saldo a receber R$ 1.482.900,00 · 12 sem responsável · 38 com link enviado · média de 9 dias parados`

É a leitura que o board nunca deu: o card sabe o saldo de **um**; só a tabela sabe
o de **todos**.

---

## 8. O que muda no código

Nenhuma migration. Nenhum campo novo. A tabela é uma tela para o modelo que já
existe — se ela precisasse de coluna nova, seria sinal de que o modelo estava errado.

| Arquivo | O que fazer |
|---|---|
| `lib/services/hm-relatorio.ts` | **tipar** `LinhaEsteira` de verdade (hoje é `Record<string, unknown>`); o front precisa dos campos. O XLSX passa a se beneficiar do mesmo tipo. |
| `app/api/hm/tabela/route.ts` | **novo** — `GET`: devolve `{ linhas, estagios, responsaveis, canais, turmas }` reusando `relatorioHm()`. A tabela e o XLSX saem da mesma função, por construção. |
| `app/api/hm/lote/route.ts` | **novo** — `POST`: ações em lote iterando os serviços (espelha `app/api/kanban/lote/route.ts`, que já existe para o HT). |
| `lib/validators.ts` | **novo schema** `HmLoteSchema`. Nada mais: `HmContatoPatchSchema` já cobre toda a edição inline. |
| `app/hm/tabela/page.tsx` | **novo** — a grade: visões, lentes, sort, seleção, edição inline, rodapé, export. |
| `app/hm/_components/hm-visao.tsx` | **novo** — o alternador `Kanban ⇄ Tabela`, usado nas duas páginas, carregando os filtros na URL. |
| `app/hm/kanban/page.tsx` | ler os filtros iniciais da URL e escrevê-los lá (para o alternador preservar o contexto) + montar o alternador no cabeçalho. |

### Fora do escopo da v1

- Colunas configuráveis pelo usuário (as visões já resolvem 95% dos casos).
- Exportar "só as colunas visíveis" — o XLSX continua sendo o arquivo canônico, com todas as colunas.
- Edição de pagamento/cancelamento na célula (ver §4.3).
- Paginação no servidor (só faz sentido acima de ~1.000 linhas).
