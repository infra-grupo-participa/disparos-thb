# Spec — Aprimoramentos do Workspace de CS (disparos HT)

_Status: rascunho para aprovação · 2026-06-09 · escopo: Large/Complex_

## Objetivo
Tornar o sistema de disparos pronto para operação diária por um CS, **simples e intuitivo a ponto de qualquer pessoa operar**, com segurança no envio, visão clara das edições HT, métricas hierárquicas e visibilidade das conversas/situação dos disparos — finalizando a migração dos dados HT.

## Frentes e Requisitos (IDs rastreáveis)

### F1 · Finalizar migração de dados HT
- **R1.1** Inserir os 119 compradores HT ausentes em `public.compradores/compras` (legado, `LEGADO-*`, `is_manual=true`). Trigger cria o `cs.contatos`.
- **R1.2** Rodar import `--apply` para preencher o overlay (edição + métricas) dos 119.
- **R1.3** Expor `edicao_ht` e métricas `legado_*` na view `cs.contatos_ht` (hoje não saem nas telas).

### F2 · Identidade visual por edição
- **R2.1** Badge de edição **HT21–HT27** com cor/rótulo distintos, na lista de Contatos e no detalhe. Filtro por edição usando `edicao_ht`.

### F3 · Disparo seguro (pré-envio)
- **R3.1** Pré-visualização **formatada** da mensagem (template renderizado com a variável do lead) — WhatsApp-like.
- **R3.2** **Dupla confirmação** antes de enviar.
- **R3.3** Resumo de **impacto**: quantos e quais contatos, qual edição, qual template.

### F4 · Templates via API Unnichat
- **R4.1 (spike)** Investigar se a Unnichat expõe **listagem de templates** Meta via API.
- **R4.2** Se sim: sincronizar templates Unnichat → `cs.templates` (botão "Sincronizar"). Se não: manter cadastro manual e documentar.

### F5 · Dashboard hierárquico + logs
- **R5.1** Métricas em **hierarquia**: topo = KPIs gerais; ao descer = por edição, por template, por operador, por disparo.
- **R5.2** **Log/timeline** da situação dos disparos (em andamento, concluído, erros, SLA).

### F6 · Conversas/situação via Unnichat (sem consumir o BD)
- **R6.1 (spike)** Investigar API Unnichat de **conversas/mensagens** por contato.
- **R6.2** Se houver: painel que puxa conversa + status **direto da Unnichat** (sem persistir no BD).

### F7 · UX do operador (CS para todos)
- **R7.1 (pesquisa web)** Levantar padrões de UX de sistemas de CS de referência (Intercom, Front, Crisp, Zendesk, etc.) aplicáveis.
- **R7.2** Simplificações guiadas: linguagem clara, affordances óbvias, onboarding mínimo, estados de erro/sucesso, acessibilidade básica.
- **R7.3** Melhorias visuais gerais (consistência, hierarquia visual, responsivo).

### F8 · Go-live
- **R8.1** Smoke de **envio real** ao 21989370272 com template Meta oficial.
- **R8.2** Trocar `APP_PASSWORD`. **R8.3** Desativar cenários Make. **R8.4** Commit dos artefatos.

## Princípios transversais
- **Performance**: server-side enxuto, sem N+1, índices nos filtros, payloads pequenos.
- **Contexto isolado**: cada tarefa executada por um sub-agente com escopo mínimo (ver tasks.md).
- **Não furar segurança**: nada de service_role/anon no app; escrita admin só via migração controlada.

## Gray areas (decidir antes/junto da execução)
1. **Conversas sem BD (R6.2)**: se a Unnichat tiver a API, mostramos ao vivo; se não, cai fora do escopo desta rodada.
2. **Hierarquia do dashboard (R5.1)**: confirmar os eixos de drill-down prioritários (edição → template → disparo → contato?).
3. **Template Meta para o smoke (R8.1)**: qual template usar (depende do que estiver ativo/aprovado).
