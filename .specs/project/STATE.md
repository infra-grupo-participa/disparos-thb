# STATE — Memória do projeto (sistema-disparos-participa)

_Atualizado: 2026-06-09_

## Decisões já tomadas
- **Arquitetura**: Next.js 14 + Postgres (Supabase, schema `cs`, role scoped `disparos_app`, server-only). Sem anon/service_role no app.
- **Contatos** vêm da base canônica `public.compradores/compras` via view `cs.contatos_ht`. O schema `cs` é overlay de CS.
- **Dashboard** usa **polling** (não Realtime) — Realtime exigiria anon key no client, contra o modelo server-only.
- **Import HT legado**: enriquecer overlay (casar por e-mail/telefone), **não** criar compras para quem já existe. Métricas legadas em **colunas dedicadas** (`legado_*`) — migration 0002 aplicada.
- **119 ausentes** (buraco 11/05–07/06): decidido **inserir como compradores** em `public` com `hotmart_transaction` sintético `LEGADO-*` e `is_manual=true`.
- **Edição do comprador recorrente**: fica a **mais recente**.

## Decisões da rodada de aprimoramentos (2026-06-09)
- **Conversas (F6)**: timeline a partir de `cs.interacoes` (já gravada pelo webhook) + status dos disparos. Não usar SSE por ora.
- **Dashboard (G2)**: hierarquia **Edição → Template → Disparo** (→ contato).
- **Template do smoke (G3)**: `unnichat_id = 931554972956171` (URL `https://unnichat.com.br/meta/templates/edit/931554972956171`). Falta saber nº de variáveis — confirmar antes do smoke.

## Regra de edições HT (2026-06-09)
- Cada edição HT = janela de **2 semanas, segunda 00:00 → domingo 23:59:59** (fuso SP). `public.ht_editions` populada HT26..HT40. Âncora: **HT27 = 08/06–21/06**; HT28 = 22/06–05/07. (Usuário disse 23/06 p/ HT28, mas 23/06 é terça — corrigido p/ 22/06; bate com o histórico HT26=25/05–07/06.)
- `status` em ht_editions calculado pela data: encerrado/ativo/agendado.
- View `cs.contatos_ht` deriva edição como `'HT'||edition_number` (formato do badge); `edicao_ht` do overlay tem prioridade. Novas compras (via webhook) caem na janela e são rotuladas automaticamente.
- **Miguel Ferreira Lima** (caiu do webhook) associado a HT27 via overlay (comprador_id 9bc8b463-78ff-483e-b592-1508930dd7a4).

## Progresso de implementação (Onda 2, 2026-06-09)
- ✅ Badge de edição (lista + detalhe), filtro por edição.
- ✅ Detalhe do contato com card de métricas legadas (cs.interacoes intacta).
- ✅ Tela Disparar: preview WhatsApp-like + à-prova-de-variáveis + dupla confirmação (modal "Enviar para N").
- ✅ Dashboard hierárquico Edição→Template→Disparo + seção Atividade.
## Onda 3 concluída (2026-06-09)
- ✅ UX contatos: barra de ação em massa fixa, empty states diferenciados (carregando/sem-filtro/vazio).
- ✅ UX dashboard: cartão "Próxima ação" (next-best-action), empty states.
- ✅ Tela Templates didática: formulário guiado com microcopy, preview WhatsApp ao vivo, toggle ativar/desativar (novo PATCH /api/templates), validação amigável.
- ✅ Robustez do disparo: retry com backoff [1s,3s,8s] p/ erros transitórios (rede/429/5xx), pausa maior pós-429, idempotência no webhook (UPDATE ... where respondeu=false returning, não reconta), fallback de variável vazia. Sem schema novo.
- **Smoke pronto**: template `teste_disparo3` (id 931554972956171, 0 vars) ativo + conta de teste "João Pedro Alves Assunção" (HT27, 5521989370272). Falta só disparar.
- Pendente go-live: smoke real (disparar), trocar APP_PASSWORD, desativar Make 4773166/4686692.

## Webhook de resposta / SLA + criação de contatos (2026-06-09)
- **Unnichat enviava a resposta pro Make** (hook.us1.make.com), não pro nosso webhook. Solução: na automação "Cliente interagir", apontar pra `.../api/webhook?secret=...` e **DESLIGAR o body customizável** (o nativo é que funciona).
- **Payload nativo da Unnichat** (gatilho Cliente interagir): dados aninhados em `contact` → `contact.phoneNumber`, `contact.lastMessage`, `contact.name`, `contact.email`, `contact.id`. As variáveis `{{contact.phone}}` do body customizado vinham VAZIAS (sintaxe errada).
- Webhook ajustado (commit b4abefb) pra ler o formato nativo. `cs.webhook_log` (migration 0004) registra toda chamada — usar pra diagnosticar (`select ... from cs.webhook_log order by recebido_em desc`).
- **SLA validado**: Luis respondeu, SLA calculado = 23 min (recuperei manual do log enquanto o deploy não entrava).
- **Criar contato na Unnichat antes de disparar** (commit 66c74c6): `POST /contact {name, phone}` é **idempotente** (upsert por telefone). Disparo agora tem 2 fases (criar contatos → enviar), migration 0005 (cs.disparos.fase/total_contatos_criados, disparo_contatos.contato_criado/erro_contato).
- **Contas de teste** (em public, hotmart_event=TESTE_QA, edição HT27): João Pedro (5521989370272), Victor Hugo (5521984147640), Luis Fernando (5521965384714). ⚠️ O número de teste pode estar no "experiment" da Meta (bloqueia entrega) — não afeta compradores reais.
- ⚠️ **Hostinger NÃO auto-deploya com build**: o `git push` não basta — precisa build+restart no painel. Commits b4abefb e 66c74c6 dependem de redeploy manual pra entrar no ar.

## Dados úteis
- Produção (Hostinger): https://purple-guanaco-521727.hostingersite.com — login OK, banco OK.
- Supabase project ref: `mbvybujpkwuorhtdzcde`.
- Unnichat API: `POST {BASE}/meta/templates` (envio). BASE=`https://unnichat.com.br/api`. Listar templates / conversas = **a investigar**.
- **Número de teste do operador**: 21989370272 (smoke de envio real).
- E-mail do dono: marcio@advmais.com.

## Achados dos spikes (2026-06-09)
- **Unnichat NÃO expõe GET de templates** — `/meta/templates` é POST-only (Allow: POST); sem doc pública. → F4 (sync templates) **inviável**; manter cadastro manual.
- **Unnichat NÃO tem API de conversas/mensagens** — rotas reais: `GET /contact?id=`, `GET /tags`, `POST /meta/templates`, `POST /meta/messages`, `POST /customFields`. Entrada de mensagens só via **webhook**. → F6 "puxar conversa sem BD" **inviável por pull**; só dá conversa **ao vivo** (webhook→SSE) ou ler `cs.interacoes` (já gravado pelo webhook = consome BD).
- **Disparo (T-S0)** riscos: `void processar()` morre em restart; sem retry de falha Unnichat; webhook com race p/ mesmo telefone; SLA reflete chegada do webhook; sem validação `variaveis`↔`bodyParameters`; pool=5.
- **UX (T-S3)**: prioridade = segurança de ação em massa (confirmação proporcional + botão descritivo "Enviar para N" + cancelar/undo + preview à prova de variáveis), depois wizard/next-best-action/percent-done/empty states/erros humanos.
- `public.compradores`: 312 registros; RLS a confirmar (método de inserção dos 119).

## Pendências de go-live
- Trocar `APP_PASSWORD` (hoje `participa2026`, temporária).
- Desativar cenários Make `4773166` e `4686692`.
- Commitar suíte E2E + import + specs.
