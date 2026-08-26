# Acelera Holding — portal comercial

Portal criado em 26/08/2026 para a venda do **Acelera Holding** aos leads do
Curso Nacional. É **só comercial**: não tem ativação e não dispara campanha.

---

## ⏳ O QUE FALTA (leia antes de mexer)

**A sincronização com a planilha do Victor ainda NÃO existe.** Os campos estão no
banco, o board já os lê e desenha tudo certo — mas hoje eles só se preenchem por
carga manual.

O Victor confirmou em 26/08 que a planilha **atualiza sozinha** as colunas de
pré-checkout e de compra: assim que a pessoa preenche ou compra, a linha muda lá.
O que falta é o job que traz isso para cá.

> **Só dá para implementar com a planilha em mãos.** Sem ela não se sabe o ID, os
> nomes das abas, os nomes exatos das colunas nem o formato das datas — e chutar
> qualquer um desses três é garantir sincronização que roda e grava errado.

**Quando a planilha chegar, o trabalho é:**

1. Mapear as colunas dela para `cs.contatos`:
   | planilha (esperado)          | coluna aqui             |
   |------------------------------|-------------------------|
   | data/hora do pré-checkout    | `precheckout_em`        |
   | data/hora da compra          | `comprou_em`            |
   | nível do lead                | `nivel_lead`            |
   | origem do lead               | `origem_lead`           |
   | responsável do comercial     | `responsavel_id`        |
   | profissão                    | `public.compradores.profissao` |
2. Casar cada linha com o contato. **Chave: telefone normalizado (`55DDDNÚMERO`)
   ou e-mail** — nunca só o nome (a Central já mostrou que nome duplica e muda).
3. Rodar de X em X minutos durante o lançamento. A planilha muda sozinha, então
   sincronização única não serve: o "comprou" chegaria tarde e o comercial
   ligaria para quem já comprou.
4. Fuso: a planilha de métricas do CNHF está em **UTC**, e as horas da operação
   são **BRT**. Conferir antes de gravar, senão todo "há X min" nasce 3 h errado.

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
