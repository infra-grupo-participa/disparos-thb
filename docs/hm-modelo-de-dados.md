# HM T39 — modelo de dados e regras

Mapa consolidado do módulo Holding Masters: **onde cada informação vive, quem manda
nela e que regras a governam**. Estado em 13/07/2026, com 132 cards.

A pergunta que resolve 90% das dúvidas aqui: **quem é a fonte da verdade deste dado?**
Quando duas fontes discordam, vence a ordem abaixo — e o sistema nunca inventa a
diferença: ele marca para conferência humana.

| Camada | Fonte da verdade | O que ela decide |
|---|---|---|
| **Hotmart** (`public.compras`) | dinheiro | quem pagou, quanto, quando, por qual oferta |
| **Base de alunos** (`public.thb_alunos`) | matrícula | quem é aluno, de que turma, até quando tem acesso |
| **Overlay do HM** (`cs.contatos_hm`) | operação | etapa, acordo, agenda, checklist, travas |
| **Planilha** | — | **aposentada.** Foi importada; não manda em nada |

---

## 1. As duas populações

Toda regra do HM depende de qual delas a pessoa é:

| | **Lead novo** | **Aluno da base** (THB ou Aurum) |
|---|---|---|
| Quem é | não existe em `thb_alunos` | já é aluno (turma T6, T29, T34…) |
| Preço | 300 + **14.700** cheios | 300 + saldo **com desconto do pró-rata** |
| Ao quitar | **nasce** na turma atual (T39) | **mantém a turma dele**, acesso renovado +1 ano |
| Acesso | precisa ser **criado** → passa por "Pendente de Liberação" | **já existe** → vai direto para "Acesso Liberado" |
| Tag | `Lead novo` | `Aluno THB` / `Aluno Aurum` + `Origem T29` |

**Pegadinha central:** a base é reescrita pelo próprio funil. No instante em que o
lead novo quita, ele vira linha em `thb_alunos` — e uma classificação ingênua passaria
a chamá-lo de "aluno da base". Por isso:
- `cs.contatos_hm.turma_origem` **congela** a turma na entrada;
- a classificação **ignora** cadastros criados pelo próprio funil (`fonte = 'sip_ativacao_hm'`);
- `acesso_preexistente` é decidido pela **origem do cadastro**, nunca por data (datas
  erram por segundos: o cadastro nasce no mesmo minuto do card).

---

## 2. Quem vira aluno (e quando)

**O sinal não faz ninguém aluno.** Ele filtra curiosos. Vira aluno quem **quita ou
parcela** — e só então entra em `thb_alunos`, que é o insumo do GPS para criar o acesso.

`cs.fn_hm_tem_lastro` responde "esta pessoa pagou de verdade?" e é a trava contra
matrícula inventada. Lastro é:
- uma compra de **`diferenca`** (o saldo do sinal), ou
- uma **`compra_cheia` POSTERIOR ao sinal** que abriu o card.

> O "posterior" não é preciosismo: a Naiara comprou o HM cheio em 15/06 e só em 07/07
> pagou o sinal do Programa de Implementação. A compra de junho é a matrícula dela —
> o saldo do programa segue em aberto. Sem esse recorte, o sistema a daria como quitada.

Arrastar o card no kanban **não cria matrícula**. Pagamento fora da Hotmart existe, mas
entra pela ficha ("Registrar pagamento"), onde uma pessoa assume os valores.

---

## 3. O dinheiro

**O pacote é `300 + o valor da oferta de saldo que a pessoa pagou`** — nunca 15.000 fixo.

Cada valor de saldo tem sua **própria oferta na Hotmart** (`cs.hm_ofertas_saldo`, 16
links), porque o crédito pró-rata **já vem descontado dentro da oferta**. Quem paga
`ikgazdy8` (12.772,68) está quitando, não devendo 1.927,32.

**Crédito pró-rata** (`cs.fn_hm_prorata`) — o que o aluno já pagou e ainda não usou:

```
crédito = valor pago × (dias restantes ÷ dias totais)
saldo   = 14.700 − crédito
```

Confere com a planilha na casa dos centavos. **O crédito encolhe a cada dia** — o saldo
de hoje não é o de amanhã, e o valor congela quando a oferta é enviada.

**Cuidado permanente:** em oferta recorrente e boleto parcelado, `compras.preco` guarda
o valor da **parcela**, não do total. Nesses casos o aluno nasce com `tratamento_manual`
preenchido — o sistema admite a dúvida em vez de afirmar um número errado.

---

## 4. Origem: quem é × por onde entrou

São **eixos independentes**, e nenhum deles vem do texto da oferta (a oferta do sinal,
`z391kxd9`, é a mesma em todos os canais — usá-la como origem foi o erro que fez a Laura
aparecer como "HT ATM" quando veio do ingresso da HT28).

**Público** — da base de alunos: `Aluno THB` (85) · `Aluno Aurum` (9) · `Lead novo` (38)

**Canal** — do fato, nesta ordem:
1. comprou o sinal de **R$2.000** (`nz3ob9r2`) → `Imersão POA` (8) — ali o produto **é** o canal
2. está na base → `HM - Programa de Implementação` (86) — a oferta foi feita para ela
3. comprou **ingresso do HT** (produto `1560865`) → a edição da janela de vendas: `HT28` (1), `HT27` (4), `HT26` (2)
4. janela da **venda** do sinal → `Live Direto ao Ponto` (12, 25–26/06) · `HT ATM` (17, 06–07/07)
5. nada disso → `Venda direta` (2) — link avulso, fora de evento

> A janela usa a data da **VENDA**, não da aprovação: quem comprou no HT ATM às 20h de
> 06/07 teve a compra aprovada às 03h de 08/07 e ficava fora do próprio evento por seis
> minutos. Quatro pessoas estavam sem canal por causa disso.

**Turma** — `Origem T29` (de onde veio) · `Turma T39` (a atual, ganha ao pagar) · `Aurum A5`

A turma atual é **configurável** (`cs.config → hm_turma_atual`), não está cravada no código.

---

## 5. As duas esteiras

**Comercial** — Contato Inicial · Aguardando Retorno · Reunião Agendada · Reunião
Finalizada · Pagamento Realizado · Solicitou Cancelamento

**Ativação** — Pendente de Liberação · Acesso Liberado · Contato Inicial · Entrevista
Agendada · Entrevista Finalizada

Regras que a esteira carrega:
- **"Pagamento Realizado" é uma porta, não um lugar**: quem passa por ela é empurrado
  para a Ativação. Um card parado ali é estado inválido.
- Quem quita **continua visível no Comercial** (espelho), parado em "Pagamento Realizado" —
  o mesmo card, mostrado nas duas esteiras. Não há estado duplicado no banco.
- **"Solicitou Cancelamento" não apaga o financeiro**: se a pessoa pagou e pediu reembolso,
  o dinheiro entrou. Apagar reescreveria o histórico.
- **Pedir cancelamento não é cancelar** (0071). Arrastar o card para "Solicitou Cancelamento"
  grava `cancelamento_em` e **não toca na base** — o reembolso pode ser negado e gente desiste
  de cancelar. O **fato** é `cancelamento_efetivado_em`, e vem de duas portas: o webhook da
  Hotmart (`PURCHASE_REFUNDED`, `CHARGEBACK`, `PROTEST`, `SUBSCRIPTION_CANCELLATION`) ou o botão
  "Confirmar cancelamento" na ficha, para acordos fechados fora da Hotmart.
- **Cancelar marca, nunca apaga.** O aluno cancelado ganha `thb_alunos.cancelado_em`, sai de
  `vw_aluno_360` (o GPS não o vê) e continua inteiro no banco: turma, validade, sócios,
  depoimentos. Se voltar a pagar, o provisionamento reencontra o **mesmo cadastro** — limpa a
  marca, carimba `retornou_em` e mantém a turma. `vw_alunos_cancelados` é onde se consultam os
  que saíram.
- **O acesso não cai com o dinheiro**: cancelado continua dentro do Searchie, da comunidade e do
  grupo até alguém tirá-lo. Por isso o cancelamento abre o **checklist de revogação** (`rev_*`),
  espelho do checklist de ativação, com quem removeu e quando (`acessos_revogados_em/_por`).
  A lente "Cancelou e ainda tem acesso" na visão em tabela é essa fila.
- O **checklist de ativação trava a saída** de "Acesso Liberado" (Searchie, comunidade THB,
  grupo de informes, pesquisa). O board recusa o avanço e diz o que falta.

---

## 6. Pendências que exigem decisão humana

O sistema **não resolve estas sozinho** — são contradições entre o que a operação afirma
e o que a Hotmart registra. Todas estão marcadas no card (`revisar` / `nao_contatar`).

| Caso | Quem | O que fazer |
|---|---|---|
| **Pago sem registro na Hotmart** (4) — *mantidos como pagos por decisão da operação* | Décio Rodrigues, Dilcele Assis Guerra, João Borges, Renato Nicolodi | Já viraram alunos e têm acesso. Falta **confirmar os valores**: o sistema só conhece o sinal (300), então o saldo devedor deles está estimado |
| **Comprador duplicado** (1) | Renato Nicolodi | Sinal num e-mail, saldo em outro (sem CPF). Unificar os dois compradores na Hotmart/base — os valores dele saem da oferta `o1sxigxl` (recorrente, em andamento) |
| **"Realizada/pago" sem pagamento** (12) | vindos da planilha | Já marcados para conferência; confirmar caso a caso |
| **Crédito pró-rata faltando** (2) | alunos da base sem insumos | Preencher oferta anterior + data + valor na ficha (o saldo sai errado sem isso) |
| **Sem responsável** (111) | maioria dos cards | A planilha só tinha 21 responsáveis preenchidos |

---

## 7. Onde está cada coisa

| Tema | Objeto |
|---|---|
| Card do funil | `cs.contatos_hm` (+ view `cs.contatos_hm_kanban`) |
| Sócios | `cs.hm_socios` (checklist próprio; viram alunos quando o titular quita) |
| Links de saldo | `cs.hm_ofertas_saldo` (16 ofertas, com valor nominal) |
| Turma atual | `cs.config → hm_turma_atual` |
| Quem pagou de verdade | `cs.fn_hm_tem_lastro` |
| Vira aluno | `cs.fn_hm_provisionar_aluno` · `cs.fn_hm_provisionar_derivado` (exige lastro) |
| Valores | `cs.fn_hm_valores_derivados` · `cs.fn_hm_prorata` |
| Origem/tags | `cs.fn_tag_hm_origem` · `cs.fn_hm_edicao_ht` · `cs.fn_hm_canal_imersao` |
| Destino pós-pagamento | `cs.fn_hm_etapa_pos_pagamento` (acesso pré-existente pula a fila) |
| Gatilho de venda | `cs.fn_seed_contato_hm` (roda no webhook da Hotmart) |
| Importador da planilha | `scripts/import-hm-planilha.mjs` (dry-run por padrão) |
| Mapa coluna-a-coluna | `docs/hm-mapa-planilha.md` |
