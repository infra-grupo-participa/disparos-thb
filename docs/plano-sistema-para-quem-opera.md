# Plano: o sistema na língua de quem opera

_13/08/2026 — pedido do Marcio: "quem tá operando não entende de código nem um pouco. A gente tem que deixar o sistema mastigadinho pra elas. Redondinho, fácil, intuitivo, didático."_

Este plano não é sobre features novas. É sobre a **mesma informação, dita de um jeito que a Ana Camila, o Thomas, a Jusy e o Jonathan entendam sem perguntar a ninguém.**

---

## O diagnóstico, medido (13/08)

Varri o texto visível das 53 telas. A boa notícia: o jargão técnico duro **não** vaza — zero ocorrência de "webhook", "migration", "trigger", "payload", "endpoint", "razão", "pró-rata" (como palavra solta), "lastro", "provisionar" na tela.

O que vaza é pior, porque parece português:

| Palavra | Ocorrências | Problema |
|---|---|---|
| `card` | 69 | é o nome do retângulo na tela, não da **pessoa** |
| `lead` | 32 | o Marcio já mandou tirar ("não faz sentido ser lead") e continua no cabeçalho do board e na busca |
| `pool` | 12 | jargão puro — ninguém fora de TI sabe o que é |
| `esteira` | 10 | palavra nossa, nunca explicada na tela |
| `board` | 10 | idem, e convive com "Kanban" e "Jornada" para a MESMA tela |

**A mesma pessoa é chamada de quatro coisas** dependendo de onde você está: lead, card, contato e aluno. **A mesma tela tem três nomes**: Kanban, Jornada e board.

E a tela de ajuda (633 linhas, 8 seções) ensina justamente esse vocabulário — a seção se chama *"Pool: assumir um lead para você"*. Ela documenta o sistema em vez de ensinar o trabalho.

---

## Os cinco princípios

Toda decisão daqui em diante se resolve com um destes. Quem for executar: se a resposta não estiver aqui, pergunte — não invente.

### 1. Uma palavra por coisa, para sempre
Um glossário fechado, e nada fora dele na tela. A proposta:

| Falar assim | Nunca mais |
|---|---|
| **aluno** (quem comprou) | lead, card, contato |
| **ficha** (o detalhe da pessoa) | card, drawer, detalhe |
| **etapa** (a coluna) | estágio, stage |
| **Jornada** (a tela de colunas) | kanban, board, esteira |
| **sem dono** (ninguém pegou) | pool |
| **Comercial** / **Ativação** (as duas fases) | aba, esteira comercial |

"Aluno" vale porque **todo mundo no board já pagou** — foi a decisão do Marcio em 12/08.

### 2. A tela responde a pergunta, não mostra o campo
Ninguém abre o sistema para "ver o campo `pagamento_previsto_em`". Abre para saber **cobro ou não cobro**. Cada bloco de tela tem de ter uma pergunta escrita atrás dele; se não tiver, é candidato a sair.

Já aplicado no selo de adimplência do card (13/08): virou *Atrasado · deve R$ X* / *Sem data · deve R$ X* / *Em dia* / *Quitado*.

### 3. Todo erro diz o que fazer
"Você não tem permissão" faz o operador abrir chamado. "Esta parte do card é da Ativação — só quem tem essa função mexe aqui; o seu trabalho no Comercial segue liberado" resolve sozinho.

Já existe `msgErroPermissao` com esse padrão. Falta **cobrir todos os erros**, não só os de permissão.

### 4. A ajuda mora onde a dúvida acontece
Uma página de ajuda separada só é lida por quem já desistiu. O certo é a explicação estar **no lugar** — no `title` do selo, num "?" ao lado do rótulo, numa linha abaixo do número.

### 5. O sistema nunca afirma o que não sabe
Já é regra e vale manter: saldo desconhecido é "não calculado", nunca R$ 0,00. Base pequena é "sem dado suficiente", nunca 0%.

---

## O plano, em ordem de impacto

### Fase 1 — O vocabulário (a base de tudo)
Sem isto, todo o resto é remendo.

1. Fechar o glossário acima com o Marcio (é decisão dele, não técnica).
2. Trocar as 32 ocorrências de "lead" → "aluno". Começa pelo mais visível: cabeçalho do board (*"362 lead(s)"* → *"362 alunos"*) e a busca (*"Buscar lead…"* → *"Buscar aluno…"*).
3. "pool" → **"sem dono"** nas 12 ocorrências, incluindo o selo do card e a seção da ajuda.
4. "esteira"/"board" → **"Jornada"**, o nome que já está no menu.
5. Um teste que **falha o build** se uma palavra banida voltar à tela — igual ao `test:papeis`. Sem isso, volta em duas semanas.

**Pronto quando:** buscar as palavras banidas no texto visível devolve zero.

### Fase 2 — Cada tela responde uma pergunta
Para cada uma das 53 telas, escrever **uma frase** de subtítulo dizendo para que ela serve, na língua do operador. As que não tiverem resposta são candidatas a sumir ou virar aba de outra.

Prioridade pelas telas do dia a dia: Jornada, Tabela, Ficha do aluno, Meu dia, Inbox, Atividade.

**Pronto quando:** um operador novo abre a tela e diz o que ela faz sem perguntar.

### Fase 3 — Erros e avisos que ensinam
1. Levantar todos os `reason` que a API devolve e garantir que cada um tem texto humano (hoje só os de permissão têm).
2. Todo estado vazio explica **por que** está vazio e **o que fazer** ("Nenhum aluno aqui ainda — os que compraram hoje aparecem em Contato Inicial").
3. Todo número tem, ao lado, de onde ele saiu. Já feito no crédito pró-rata ("Conferido com a planilha do Victor"); estender ao resto do financeiro.

### Fase 4 — A ajuda vira treinamento
1. Reescrever as 8 seções em torno do **trabalho**, não do sistema: "Como cobrar quem está atrasado", "Como liberar o acesso de um aluno novo", "O que fazer quando o aluno pede reembolso".
2. Um roteiro de primeiro dia: as cinco coisas que a pessoa precisa saber para trabalhar sozinha.
3. Ajuda contextual: um "?" ao lado dos termos que sobrarem.

### Fase 5 — Provar com gente de verdade
Sentar 20 minutos com a Ana Camila e com um operador do comercial, dar três tarefas reais e **anotar onde travam**. Nenhuma métrica substitui isso. Foi assim que apareceram os defeitos que nenhum teste pegou (o botão cortado no celular, o "Aluno novo" repetido).

---

## O que já foi feito nessa direção (12-13/08)

Para quem pegar este plano depois, o caminho já começou:

- Selo de adimplência responde "cobro ou não cobro" em vez de "saldo pago".
- Um card, um estado dominante — cancelado silencia o resto.
- Cor com significado único: rose = cobrar, âmbar = falta combinar, índigo = em dia, verde = quitado.
- "Ações da automação" → **"O que mudou sozinho"**; "Movimentações" → **"Moveu de etapa"**; autor virou frase que nomeia a fonte ("pela Hotmart", "por Kelly").
- "Aluno antigo" e "Aluno novo" diretos, sem explicação pendurada.
- Crédito pró-rata explica a conta sozinho, e diz se veio da planilha do Victor.

---

## Como medir se deu certo

Não é opinião. Três números:

1. **Zero** palavra banida no texto visível (teste automático).
2. **Zero** erro sem texto humano.
3. Um operador que nunca viu o sistema executa três tarefas reais **sem perguntar**.
