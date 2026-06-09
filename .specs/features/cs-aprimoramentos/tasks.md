# Tasks — Aprimoramentos do Workspace de CS

`[P]` = paralelizável (um sub-agente em contexto isolado). `spike` = investigação que destrava outras.
Orquestrador (eu) faz as que envolvem MCP admin / PII / produção; sub-agentes fazem blocos de implementação.

## Onda 0 — Dados (orquestrador, não delegar: MCP admin + PII)
- **T01** Inserir os 119 ausentes em `public` (`LEGADO-*`, `is_manual=true`). → R1.1. Done: 119 compradores+compras criados; trigger gerou `cs.contatos`.
- **T02** Rodar `import-ht-legado.mjs --apply` de novo. ← T01. → R1.2. Done: overlay dos 119 preenchido (edição+métricas).

## Onda 1 — Spikes + base (todos [P], independentes)
- **T-S0** `[P][spike]` Confirmar lógica de disparo Unnichat: revisar `send/route.ts` + `webhook/route.ts` + contrato `sendTemplate`. → C1. Done: relatório do fluxo + riscos.
- **T-S1** `[P][spike]` Investigar API Unnichat: **listar templates** Meta (web + docs + teste de endpoint). → R4.1. Done: existe? endpoint + payload, ou "não há".
- **T-S2** `[P][spike]` Investigar API Unnichat: **conversas/mensagens** por contato. → R6.1. Done: existe? endpoint, ou "não há".
- **T-S3** `[P][spike]` Pesquisa web: padrões de UX de sistemas de CS (Intercom/Front/Crisp/Zendesk) aplicáveis ao operador. → R7.1. Done: lista priorizada de melhorias.
- **T03** `[P]` Atualizar view `cs.contatos_ht` para expor `edicao_ht` + `legado_*` (migration 0003). → R1.3. Done: view retorna os campos; tipos batem na UI.
- **T06** `[P]` Tela Disparar: **preview formatado** (WhatsApp-like) + **dupla confirmação** + **resumo de impacto**. → R3.1–3.3. Done: E2E cobre; não envia de verdade.

## Onda 2 — Implementação (depende da Onda 1)
- **T04** `[P]` Badge de edição **HT21–HT27** (cor por edição) + filtro por `edicao_ht` na lista Contatos. ← T03. → R2.1.
- **T05** `[P]` Detalhe do contato: badge + bloco de **métricas legadas** (ativado, SLA, 1º contato). ← T03.
- ~~**T07** Sincronizar templates Unnichat→`cs.templates`.~~ **CANCELADO** — Unnichat não tem GET de templates (T-S1). Fica cadastro manual; melhorar a tela de Templates.
- **T08** `[P]` Dashboard **hierárquico** (drill-down KPIs → edição → template → disparo) + **log/timeline** de disparos. ← T02. → R5.1–5.2.
- **T09** **AJUSTADO** — pull de conversa via Unnichat é inviável (T-S2). Opções p/ decisão G1: (a) painel ao vivo via webhook→SSE (só msgs novas), (b) timeline a partir de `cs.interacoes` (já gravada), (c) desescopar. → R6.2.
- **T10** Aplicar **simplificações UX** + melhorias visuais. ← T-S3. → R7.2–7.3.

## Onda 3 — Go-live (orquestrador + usuário)
- **T11** Smoke de **envio real** ao 21989370272 com template Meta. ← C1 + template ativo.
- **T12** `[P]` Trocar `APP_PASSWORD` (com você, no painel Hostinger).
- **T13** `[P]` Desativar cenários Make `4773166` e `4686692` (com você).
- **T14** Commit dos artefatos (E2E + import + specs + migrations).

## Gates de decisão (precisam de você)
- **G1** Conversas sem BD (T09) só avança se T-S2 achar a API.
- **G2** Eixos de drill-down do dashboard (T08): confirmar ordem (edição→template→disparo→contato?).
- **G3** Qual template Meta usar no smoke (T11).
