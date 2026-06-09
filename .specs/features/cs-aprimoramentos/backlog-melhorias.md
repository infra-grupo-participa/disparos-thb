# Backlog de Melhorias — inspirado em sistemas tradicionais

_2026-06-09 · prioridade (P0 crítico → P2 nice-to-have), esforço (S/M/L)_

Referências: CRMs (HubSpot, Pipedrive), CS/atendimento (Intercom, Front, Zendesk),
disparo/marketing (Mailchimp, SendGrid, Twilio), plataformas WhatsApp (Take Blip, Zenvia).

## A. Entrega & Confiabilidade  ← maior dor hoje
- **A1 [✅ FEITO] Status de entrega real** (sent/delivered/read/failed). Implementado via GET /meta/messages/{id} (pull, botão "Atualizar status de entrega"); erro 130472 = experiment tratado.
- **A2 [P0·S] Reenvio em 1 clique** dos contatos que falharam num disparo.
- **A3 [P1·M] Retomar disparo interrompido** se o processo Node cair no meio (hoje o `void processar()` não retoma).

## B. Automação & Sequências
- **B1 [P1·M] Agendar disparo** para data/hora futura (não só "agora").
- **B2 [P1·L] Régua de ativação** (drip): mensagens automáticas em D+1/D+3/D+7 após a compra ou após "sem resposta". É o que escala o CS.
- **B3 [P2·M] Gatilhos por evento**: entrou na esteira → boas-vindas automáticas.

## C. Inbox / atendimento bidirecional
- **C1 [✅ FEITO] Caixa de entrada (Inbox)**: tela /inbox com fila de conversas + chat (GET /contact/{id}/messages) + resposta livre (POST /meta/messages).
- **C2 [P2·M] Carteira**: atribuir conversas/contatos a operadores específicos.
- **C3 [P2·S] Notas internas** e marcadores na conversa.

## D. Segmentação & Listas
- **D1 [P1·M] Segmentos salvos** (filtros reutilizáveis: "HT27 sem resposta", "ativados há +7d").
- **D2 [P2·M] Importar lista (CSV)** para um disparo pontual.

## E. Qualidade & Compliance
- **E1 [P0·M] Opt-out / lista de bloqueio** ("PARAR" → nunca mais dispara). Protege contra bloqueio da Meta e é exigência de boa prática/LGPD.
- **E2 [P1·S] Guardrail anti-throttling**: limite diário e intervalo mínimo entre disparos (já existia no Apps Script legado — evita o bloqueio "ecosystem engagement" da Meta).
- **E3 [P2·S] Registro de consentimento** (LGPD).

## F. Métricas & Relatórios
- **F1 [P1·M] Funil de conversão**: enviado → entregue → respondido → ativado → vendeu.
- **F2 [P2·S] Exportação CSV/PDF** de relatórios por edição/período.
- **F3 [P2·M] Comparativos**: edição vs edição, template vs template, operador vs operador.

## G. Gestão & Segurança
- **G1 [P1·M] Multi-usuário** com login próprio + papéis (hoje é senha única compartilhada).
- **G2 [P2·S] Audit log**: quem disparou o quê e quando.
- **G3 [P2·M] Notificações in-app**: "fulano respondeu", "SLA estourado".

## H. Templates ricos
- **H1 [P2·M] Templates com mídia** (imagem/documento) e **botões** (CTA / quick reply).
- **H2 [P2·S] Mais variáveis** nos templates (edição, primeiro nome, etc).

---

## Top 5 recomendadas para o contexto (ativação HT)
1. **A1 — Status de entrega real** → acaba com o ponto cego do "enviado mas não chegou".
2. **E1 — Opt-out** → qualidade do número, evita bloqueio da Meta, compliance.
3. **A2 — Reenvio de falhas** → fecha o loop operacional do disparo.
4. **C1 — Inbox de respostas** → o CS responde sem sair do sistema (fecha o ciclo de atendimento).
5. **B2 — Régua de ativação** → automatiza o follow-up e multiplica o alcance do CS.
