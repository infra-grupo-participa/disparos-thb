# Acelera Holding — portal comercial

Portal criado em 26/08/2026 para a venda do **Acelera Holding** aos leads do
Curso Nacional. É **só comercial**: não tem ativação e não dispara campanha.

---

## A sincronização com a planilha (pronta em 26/08)

O pré-checkout e a compra chegam **sozinhos**, de 2 em 2 minutos, direto da
planilha do SCORE. A pessoa preenche o checkout ou compra, a planilha atualiza, e
em até 2 minutos o card mostra. Quem compra vai para **Vendido** sem intervenção.

**As peças:**

| onde | o quê |
|------|-------|
| planilha | `1kas7NFLahAxIthHM55CVYjU02Dh3b0FTKIsfiT9A9fU`, aba `SCORE` |
| colunas lidas | `email`, `Data checkout`, `Data compra`, `Checkout?`, `Comprou?` |
| n8n | `[Acelera] Sync do funil — checkout e compra` (`wufUhw1xPAI3cn0v`), a cada 2 min |
| banco | `public.fn_acelera_sync_funil(jsonb)` (migrations 0315 e 0316) |

**Por que uma função e não escrita direta:** o schema `cs` não é exposto no
PostgREST, de propósito. Expor `cs` para o n8n escrever abriria a operação
inteira por causa de duas colunas. A função `SECURITY DEFINER` faz o contrário:
o n8n só alcança essa porta, que casa por e-mail e escreve exclusivamente
`precheckout_em` e `comprou_em`, exclusivamente no evento `ACELERA`.

**Três decisões que estão dentro dela:**

- **Só escreve quando o valor muda.** Sem isso cada rodada tocaria as 299 linhas
  e o `atualizado_em` viraria "agora" para todo mundo, embaralhando a ordem do
  board a cada 2 minutos.
- **Aceita os dois formatos de data.** O Sheets manda serial (`46260.63…`) quando
  a célula é data de verdade e texto `dd/mm/aaaa hh:mm:ss` quando foi colada. Os
  dois convivem no mesmo arquivo.
- **Data fora da janela do lançamento vira a tag `Data a conferir`**, em vez de
  ser corrigida no chute. Foi o que pegou uma compra datada de 2017 no teste.

**Ela só grava, nunca apaga.** Limpar a célula na planilha não limpa o card, para
que uma venda real não suma por causa de uma célula mexida sem querer. Para
limpar, é update na mão.

### ⚠️ Fuso: a armadilha que já mordeu uma vez

A planilha está em **America/Sao_Paulo**, então tanto o serial quanto o texto são
**horário de Brasília**. O n8n traduz isso para `'2026-08-26 15:09:36'` — sem
fuso, porque é tudo o que a célula sabe.

A versão 0315 fazia `::timestamptz` nessa string, e **texto sem fuso é
interpretado no TimeZone da sessão, que no PostgREST é UTC**. As 15:09 viravam
15:09 UTC, ou seja, 12:09 aqui. O card, que conta a partir de agora, anunciava
**4 horas** de espera para quem tinha preenchido fazia 48 minutos. Nenhum erro,
nenhuma linha rejeitada: só o dado 3 horas no passado.

Isso destrói justamente o que o card serve para fazer, que é o vendedor ligar
para quem acabou de abrir o checkout e não concluiu. Com 3 horas de atraso o lead
quente já parece frio e sai da fila.

A 0316 concentrou a tradução em `public.fn_acelera_data_brt(text)`: texto **sem**
fuso é lido como Brasília; texto que **já traz** fuso (terminado em `Z` ou
`±hh:mm`) é respeitado como veio, para nunca somar o deslocamento duas vezes.
A janela do lançamento também passou a ser comparada em Brasília (`'2026-08-20'`
solto era meia-noite UTC, isto é, 21h do dia 19 aqui).

> **Quem for mexer no Code node do n8n:** ele manda hora de Brasília **sem** sufixo
> de fuso, e a função conta com isso. Não carimbe `Z` numa hora de Brasília — é
> exatamente o bug acima, de volta.

---

## O que já está pronto

### Estrutura (migrations 0307 a 0310)
- Evento `ACELERA`, funil comercial de 8 etapas:
  `Lead → Contato Inicial → Aguardando Retorno → Reunião Agendada → Reunião
  Finalizada → Proposta Enviada → Vendido / Sem Interesse`
- Roda no **portal genérico** (`cs.contatos`), como HT e Seminário — a base vem
  do Curso Nacional, que já vive lá.
- **Sem aba de ativação de propósito**: o evento não tem estágio em `'ativacao'`,
  então `abasDaEsteira` devolve `[]` e a superfície não existe. Fail-closed por
  ausência, não por `if` espalhado nas telas.

### Campos (0309)
`nivel_lead` (CHECK: Quente/Morno/Frio) · `origem_lead` · `precheckout_em` ·
`comprou_em`. A profissão vem de `public.compradores.profissao`.

Datas em vez de booleanos: *quando* comprou responde tudo o que *comprou*
responderia, e ainda diz há quanto tempo — que é o que o comercial pergunta.

### Compra → Vendido, automático
Trigger `cs.fn_acelera_comprou_vai_para_vendido`. Dispara na **virada** de
`comprou_em` (nulo → data), nunca em update qualquer: mexer numa tag de quem já
comprou não arrasta o card, e mover à mão para trás não é desfeito.

### O board
**Card:** nível do lead (chip colorido) e o selo do funil, em três estados:

| estado | selo |
|---|---|
| preencheu há < 10 min | âmbar · "Preencheu há 2 min · deixe concluir" |
| preencheu há ≥ 10 min sem comprar | vermelho · "Preencheu há 35 min · não comprou" |
| comprou | verde · "Comprou · há 5 min" |

A carência (`ACELERA_CARENCIA_MIN`, 10 min) existe porque ligar para quem acabou
de preencher **atrapalha a compra**. Sem ela, quem preencheu há 1 min e quem
preencheu há 40 apareceriam iguais.

**Ficha:** e-mail e telefone copiáveis num clique, profissão, origem, nível, as
datas cruas de pré-checkout e compra, QR do lead (WhatsApp ou discador) e os
atalhos diretos.

**Board que anda sozinho** (só no Acelera): relógio de 30 s para o "há X min" não
congelar, e recarga de 60 s porque a compra move o card **no banco**, por trigger,
e a tela não ficaria sabendo. Os dois pausam com ficha aberta, seleção ou menu.

### O que foi tirado, e por quê
Edição, score 0/100, opt-out, "já respondeu a disparo", disparos, taxa e SLA. É
vocabulário de campanha; aqui o trabalho é ligar. O disparo é barrado no ponto
único `podeDisparar` — não com um `ehAcelera &&` por botão.

---

## Pendências além da planilha

- **Logo**: `public/marcas/acelera.svg`. Até chegar, cai no monograma "AH".
- **Equipe**: quem entra no comercial, para liberar portal + função.
- **`poolRestrito`**: hoje ligado só no HM. Quando a equipe existir, ligar aqui
  para cada vendedor ver estritamente a carteira dele.
