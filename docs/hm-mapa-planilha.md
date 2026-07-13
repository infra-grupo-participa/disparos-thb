# HM T39 — mapa da planilha de controle → sistema

> **Status (13/07/2026): a estrutura está PRONTA.** Todos os campos abaixo já
> existem no banco e têm input na ficha do card (migrations 0056 e 0057). Falta
> apenas **importar os dados dos CSVs** — nada mais precisa ser construído.
>
> Onde cada coisa ficou:
> - **Acordo do saldo** (meio, previsão, o combinado, link enviado) → bloco "Acordo do saldo" na ficha, com o link escolhido automaticamente pelo valor do saldo.
> - **Checklist de ativação** (Searchie, comunidade, grupo, pesquisa) → bloco próprio, com contador e **trava**: o card não sai de "Acesso Liberado" incompleto.
> - **Travas** ("NÃO ENTRAR EM CONTATO", "REVISAR") → alertas no topo da ficha.
> - **Sócios** → tabela `cs.hm_socios` com checklist próprio; quando o titular quita, o sócio entra na base THB vinculado a ele (mesma turma e validade).
> - **Crédito pró-rata** → insumos na ficha, cálculo em `cs.fn_hm_prorata` (confere com a planilha na casa dos centavos).
> - **Status da reunião** → campo com os mesmos estados da planilha.
> - **"Aguardando Retorno"** → coluna própria no Comercial.

Este documento mapeia cada coluna da planilha "HM - T39 CONTROLE DE ATIVAÇÃO" (5 abas)
para onde o dado vive (ou vai viver) no sistema. Serve para dois fins: guiar a importação
dos CSVs e definir **o que o operador digita** na ficha do card — o resto é derivado ou já
vem da Hotmart / da base de alunos.

Regra que organiza tudo: **o operador só digita o que só ele sabe.** Identidade, endereço,
compra, turma, canal e validade do acesso já entram sozinhos. O que a planilha carrega de
único é o *acordo comercial* e o *checklist de ativação*.

---

## 1. O que JÁ tem casa (não digitar, não importar)

| Coluna da planilha | Onde já vive |
|---|---|
| Data de Venda / Data de Confirmação | `public.compras.data_compra` / `data_aprovacao` |
| Nome, Documento, E-mail, DDD + Telefone | `public.compradores` |
| CEP, Cidade, Estado, Bairro, País, Endereço, Número, Complemento | `public.compradores.endereco_*` (vem da Hotmart) |
| Link do Facebook | `public.thb_alunos.link_facebook` |
| Turma (T38, T17, T29.2…) | tag de turma no card (`cs.fn_tag_hm_origem`) |
| Edição do HT / aba de origem (Live 25/06, HT ATM, Programa de Implementação) | tag de canal no card |
| Pagou o sinal ou o valor cheio? ("Sinal, R$ 300") | `cs.contatos_hm.categoria_entrada` |
| Oferta (produto de entrada) | `cs.contatos_hm.plano` |
| Saldo (14.700) | derivado: `valor_total − valor_pago` |
| Aluno? (é da base ou é lead novo) | derivado: tag `HM` vs `Novo` |
| Tempo de acesso | `thb_alunos.tempo_acesso` / `regra_acesso` |
| Situação (Vigente / Vencido) | `thb_alunos.status_acesso` — **derivado da data de expiração** (migration 0045) |
| Convidou sócio? + aba SÓCIOS T39 | `thb_alunos.eh_socio`, `socio_de_aluno_id`, `num_socios` (já há 462 sócios na base) |
| Responsável (Ana Camila) | `cs.contatos_hm.responsavel` |
| Contato inicial (TRUE) | é a **etapa** "Contato Inicial" do Comercial |
| Pediu reembolso? / "Pediu o cancelamento" | é a **etapa** "Solicitou Cancelamento" |
| Pagou saldo? / Efetuou o pagamento do saldo? | `pagamento_em` + `apto_ativacao` (o card já cai na Ativação) |

## 2. O que FALTA — campos a criar em `cs.contatos_hm`

### 2.1 Acordo comercial (o coração do gargalo do saldo)

| Coluna da planilha | Campo novo | Por quê |
|---|---|---|
| "Como vai pagar o saldo restante?" / "Opção de pagamento" — *"12x no boleto"*, *"12x no cartão recorrente"*, *"1k no pix 12x no cartão"* | `pagamento_meio` (boleto / cartão / cartão recorrente / pix / à vista) + `acordo` (texto livre) | hoje só existe `pagamento_forma` (à vista/parcelado) e `pagamento_parcelas`. O **meio** é o que o comercial combina e o que decide qual link enviar |
| "pagamento agendado 17/07", "só pode pagar 23/07", "vai pagar o boleto na segunda" | `pagamento_previsto_em` (date) + a nota vai para `acordo` | é previsão de caixa. Hoje esse dado está escondido dentro da coluna de data da reunião |
| Link do pagamento (URL da oferta de saldo) | `oferta_saldo_codigo` (text) — **sugerido automaticamente** pelo saldo | ver §3 |
| "Link enviado" (TRUE/FALSE) | `link_saldo_enviado_em` (timestamptz) | booleano perde o "quando"; a data permite cobrar quem recebeu e não pagou |
| Contato Comercial: *"NÃO ENTRAR EM CONTATO NO MOMENTO"*, *"ELE É AURUM"* | `nao_contatar` (bool) + motivo em `observacoes` | é uma trava operacional, não uma observação qualquer — precisa aparecer no card |
| Situação = "REVISAR" | `revisar` (bool) | marca o card que o financeiro ainda não fechou |

### 2.2 Checklist de ativação

Hoje são 4 colunas TRUE/FALSE espalhadas. Juntas, elas **são** a definição de "ativado":

| Coluna da planilha | Campo novo |
|---|---|
| Acesso ao Searchie/Obvio | `ativ_searchie` (bool) |
| Acesso à comunidade THB | `ativ_comunidade` (bool) |
| Grupo de informes (THB #25 / #27) | `ativ_grupo` (bool) |
| Pesquisa | `ativ_pesquisa` (bool) |
| "O que está pendente para conclusão" | `pendencia` (text) |

**Decidido:** o checklist **trava a saída** de "Acesso Liberado". O card só avança para a
entrevista com os 4 itens marcados — ninguém segue com a ativação pela metade. O card
mostra o progresso (ex.: 2/4) e o board explica o que falta ao tentar mover.

### 2.3 Crédito pró-rata (aba "HM - Programa de Implementação")

Esse bloco é sobre a **compra antiga** do aluno (Renovação 2026, Turma 35, Plano Pró…):
o que sobrou do acesso vira crédito e abate do saldo de R$ 14.700.

Confere na planilha: `saldo a pagar = 14.700 − pró-rata`. Ex.: 14.700 − 1.927,32 = 12.772,68.

Guardar só os **insumos** e derivar o resto (a planilha recalcula na mão e por isso envelhece):

| Guardar | Derivar (função no banco) |
|---|---|
| `credito_oferta` (text) — "Renovação 2026" | dias usados = hoje − data do pagamento |
| `credito_compra_em` (date) — 19/11/2025 | valor/dia = valor pago ÷ dias totais |
| `credito_valor_pago` (numeric) — 3.997 | consumido, **pró-rata (crédito)** |
| `credito_dias_totais` (int) — 365 | **saldo a pagar** = 14.700 − pró-rata |

Colunas "Dias totais / Dias usados / Valor/dia / Consumido / Pró-rata / Saldo a pagar"
**não viram campos** — são o resultado da conta.

## 3. Catálogo de links de saldo (aba "Links pagamento saldo")

Cada valor de saldo tem uma oferta Hotmart própria (à vista e recorrente):

| Saldo | À vista | Recorrente |
|---|---|---|
| 14.700 (sem crédito) | `2vibw97m` | `2mxcjw8t` |
| 13.960,27 | `1ayp826g` | `x0waxuab` |
| 13.254,87 | `2jaj1deq` | `8a87ktsr` |
| 12.772,68 | `ikgazdy8` | `o1sxigxl` |
| 11.675,34 | `cx3rwir9` | `nu1t1h67` |
| 11.084,28 | `ntebmlv0` | `5f843knv` |
| 11.042,47 | `5uqyub1h` | `b13te6c0` |
| 4.900 (ATM) | `wkd93am7` | — |
| 6.500 (boleto parcelado) | — | `bgu5i1zd` |

Vira a tabela `cs.hm_ofertas_saldo (codigo, valor, recorrente, link)`. Com ela, **o sistema
escolhe o link sozinho**: sabendo o saldo do aluno e se o acordo é à vista ou recorrente,
o link certo aparece na ficha para o operador copiar — hoje isso é procurado à mão numa aba.

Entrada do funil: sinal de R$ 300 = `z391kxd9`.

## 4. Status da reunião → etapa do kanban

A coluna "STATUS REUNIÃO" é a esteira comercial disfarçada de texto:

| Planilha | Etapa |
|---|---|
| (vazio, só contato inicial) | Contato Inicial |
| Aguardando retorno | **Aguardando Retorno** (coluna nova) |
| Agendada | Reunião Agendada |
| Realizada | Reunião Finalizada |
| Realizada/pago | Pagamento Realizado → cai na Ativação |
| "Pediu o cancelamento" (col. Pediu reembolso?) | Solicitou Cancelamento |

**Decidido:** "Aguardando retorno" ganha **coluna própria** no Comercial — é o estado mais
comum da planilha (dezenas de alunos que não respondem) e, escondido dentro de "Contato
Inicial", o gargalo ficaria invisível no board. A esteira comercial fica com 6 colunas:

> Contato Inicial · Aguardando Retorno · Reunião Agendada · Reunião Finalizada · Pagamento Realizado · Solicitou Cancelamento

**Cuidado na importação:** a coluna de data da reunião mistura data com recado —
*"14/07"*, mas também *"reagendar na segunda"*, *"não agendado por orientação"*,
*"não respondeu aos contatos"*, *"aguardando pagamento"*. Só o que casa com data vai para
`reuniao_em` (hora 00:00 = horário a definir); o resto vira nota do acordo/observação.

## 5. O que o operador passa a preencher na ficha

**Comercial**
1. Responsável · Etapa *(já existe)*
2. Reunião: data + hora *(já existe)* · nota da agenda *(novo)*
3. Acordo do saldo: meio de pagamento + parcelas + previsão de pagamento *(novo)*
4. Link de saldo: sugerido pelo sistema, marcar "enviado" *(novo)*
5. Travas: não contatar · revisar *(novo)*
6. Cancelamento: motivo *(novo)*

**Ativação**
7. Checklist: Searchie · Comunidade THB · Grupo de informes · Pesquisa *(novo)*
8. Entrevista: data + hora + resultado *(já existe)*
9. Pendência para conclusão *(novo)*

## 6. Descartar na importação

Linhas `#REF!` e linhas totalmente vazias; colunas repetidas no fim da aba Imersão POA
("Data da compra", "e-mail", "HT17?", "presente dia 1"); a coluna "Saldo (SIM/NÃO)", que é
só um espelho de "pagou o saldo".
