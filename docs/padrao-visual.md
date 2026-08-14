# Padrão visual do sistema

_13/08/2026 — "quero um redesign completo, organizado, padronizado. Mas seja **criterioso**: o pessoal já está habituado a mexer no sistema."_

Este documento existe para o próximo a mexer não inventar de novo. Ele é curto de propósito.

---

## O diagnóstico, medido

O sistema não estava feio. Estava **sem peça para reusar**: `app/_components/ui.tsx` tinha **8 primitivos para 53 telas**. Tudo que faltava, cada tela improvisou:

| | |
|---|---|
| 12 telas | com o próprio selo (`span` + `rounded` + `text-[10px]`, cada uma a sua medida) |
| 15 telas | com o próprio `<thead>` |
| 13 telas | com a própria caixa de aviso |

Daí o "parece remendado". A correção é dar a peça, não repintar as telas.

---

## A regra que manda em tudo: seja criterioso

**Mudança que o operador não pediu e não resolve problema dele é regressão.** Ele já sabe onde as coisas estão. Só se mexe no que:

1. **atrapalha a visualização** — informação escondida, competindo ou repetida;
2. **atrapalha a identificação** — a mesma coisa com dois nomes, ou duas coisas com a mesma cor;
3. **atrapalha a operação** — o que obriga a pensar antes de decidir.

Fora disso: **não mexa**. Botão que está num canto há seis semanas fica onde está.

---

## Densidade não é defeito

Referência de 2026 para dashboards **operacionais**: densidade é virtude. Quem trabalha o dia todo prefere ver mais por tela a rolar. Dashboard executivo pede respiro; **este sistema não é executivo**.

Consequência prática: **nada de "arejar" o board**. O que se padroniza é o **significado** (cor, peso, ordem), não o espaçamento.

---

## A cor tem um significado só

`TOM`, em `app/_components/ui-base.tsx`. Vale em **toda** tela — board, tabela, ficha, admin, notificação.

| Tom | Quer dizer | Exemplos |
|---|---|---|
| `bloqueio` (rose) | não dá para seguir | cancelado, sem acesso, atrasado |
| `atencao` (âmbar) | pare e confira | sem data combinada, saldo a conferir, crédito sem explicação |
| `positivo` (esmeralda) | não há o que cobrar | quitado, acesso liberado |
| `contexto` (índigo) | informa, não pede ação | em dia, aluno antigo, outro portal |
| `acao` (teal) | pode pegar | sem dono |
| `neutro` (slate) | sem carga | contagem, rótulo |

**Antes desta tabela**, rose era cancelado *e* recompra *e* não-contatar; âmbar era conferir-saldo *e* crédito-sem-explicação *e* parcela atrasada. Ninguém consegue decorar isso.

---

## Os primitivos

Em `app/_components/ui-base.tsx`. Aditivos — nada em `ui.tsx` mudou.

- **`Selo`** — badge. Use no lugar de qualquer `span` de status feito à mão.
- **`Stat`** — número + rótulo (+ auxiliar). `valor` aceita `"—"` ou `"não calculado"`.
- **`SectionTitle`** — rótulo de bloco, com ação opcional à direita.
- **`Callout`** — aviso *sobre* o conteúdo (o `EmptyState` é ausência de conteúdo). Sempre título curto + explicação.
- **`theadClass` / `thClass` / `thNumClass` / `tdClass` / `tdNumClass`** — cabeçalho e célula de tabela. Coluna de dinheiro é **sempre** `thNumClass`/`tdNumClass`: alinhada à direita e tabular.
- **`Atualizado`** — carimbo de quando o dado foi buscado.

---

## As cinco leis do conteúdo

Valem para tela, planilha, alerta e notificação.

1. **Uma palavra por coisa.** Aluno, ficha, etapa, Jornada, "sem dono". Ver `docs/plano-sistema-para-quem-opera.md` e a trava `npm run test:vocabulario`.
2. **A tela responde a pergunta, não mostra o campo.** "Cobro ou não cobro?" — não "`pagamento_previsto_em`".
3. **Todo aviso tem título curto + o que fazer.** Sem isso o operador abre chamado.
4. **O sistema nunca afirma o que não sabe.** Saldo desconhecido é "não calculado", nunca R$ 0,00. Base pequena é "sem dado suficiente", nunca 0%.
5. **Nome de tabela, função, uuid e caminho de arquivo não aparecem para o operador.** Se o suporte precisa, vai atrás de um "detalhes técnicos".

---

## Como adotar sem quebrar hábito

1. Abra a tela e **olhe** (`docs/` + o runbook do Chromium no `disparos-brain`). Métrica verde não é tela boa — isso já custou caro aqui duas vezes.
2. Troque o improviso pelo primitivo **sem mudar posição nem tamanho**.
3. Aplique `TOM` onde a cor hoje mente.
4. Rode `npm run test:vocabulario` e `npx tsc --noEmit`.
5. Capture antes e depois e compare. Se a diferença não resolve um dos três problemas da regra do topo, **desfaça**.

---

## Fontes consultadas

- [Dashboard Design Best Practices: The Complete 2026 Guide](https://5of10.com/articles/dashboard-design-best-practices/)
- [SaaS Dashboard Design Best Practices: 2026 UX Frameworks](https://flowmazeux.com/saas-dashboard-design-best-practices/)
- [Dashboard Design in 2026: Do's and Don'ts](https://think.design/blog/dashboard-design-in-2026-dos-and-donts/)
- [Top CRM Dashboard Design — navegação como diferencial](https://excited.agency/blog/crm-dashboard-design-agencies)
