# HM — 2 ajustes no repositório `sistema-grupo-participa-v2`

Contexto: a parte de banco (detecção + cron) já está pronta e valendo em produção
(migrations `0122`/`0123` no repo `sistema-disparos-participa`, banco compartilhado
`mbvybujpkwuorhtdzcde`). Faltam **2 ajustes nas edge functions do outro repo**.
Cada um é uma chamada; nenhuma lógica nova de detecção.

---

## Item 5 — Alertas de saúde do HM no Slack

**O que já existe no banco:** `cs.fn_hm_health_check()` roda todo dia às 07h (cron
`hm-health-check-diario`) e grava em `cs.hm_alertas` os problemas detectados
(oferta fora do catálogo, comprador pago sem card, card sem canal, CPF duplicado).

**O que fazer:** na edge function **`report-slack`**, adicionar uma seção que lê os
alertas abertos e posta no canal. Query:

```sql
select tipo, severidade, detalhe, detectado_em
from cs.hm_alertas
where resolvido_em is null
order by (severidade = 'critico') desc, detectado_em desc;
```

Sugestão de formato no Slack (só se houver linhas):

```
🩺 Saúde HM — 2 alertas abertos
🔴 oferta_orfa — Oferta xxxx fora do catálogo (3 compras; pagamento evapora)
🟡 sem_canal — Card fulano@... sem canal de aquisição
```

Observações:
- `cs` não é exposto no PostgREST → ler via service role (a mesma credencial que
  o `report-slack` já usa para as outras seções) ou criar uma RPC `public`
  `SECURITY DEFINER` que faça o `select` acima.
- Idempotente por natureza: o banco só mantém 1 alerta aberto por (tipo, chave).
- Para testar: `select * from cs.fn_hm_health_check();` popula/atualiza, depois
  rode o `report-slack` manualmente.

---

## Item 6 — Religar o log bruto do webhook (`cs.hotmart_eventos`)

**Sintoma:** `cs.hotmart_eventos` parou de receber em **17/07/2026**. É o log do
payload cru de cada evento da Hotmart — foi ele que permitiu provar "o webhook
não caiu" em segundos. Sem ele, a próxima auditoria fica cega.

**Causa provável:** um deploy da edge `hotmart-events-webhook` (~17/07) removeu/
comentou a chamada que gravava o log.

**O que fazer:** no handler da edge **`hotmart-events-webhook`**, logo após receber
o payload (antes ou em paralelo ao processamento normal), voltar a chamar a RPC
que já existe no banco:

```
public.fn_log_hotmart_evento(
  p_evento    text,    -- ex.: 'PURCHASE_APPROVED'
  p_transacao text,    -- ex.: 'HP1234567890'
  p_email     text,    -- e-mail do comprador
  p_payload   jsonb    -- o corpo cru recebido da Hotmart
)
```

Exemplo (supabase-js):

```ts
await supabase.rpc('fn_log_hotmart_evento', {
  p_evento:    body?.event ?? body?.data?.purchase?.status ?? 'desconhecido',
  p_transacao: body?.data?.purchase?.transaction ?? null,
  p_email:     body?.data?.buyer?.email ?? null,
  p_payload:   body,
});
```

Observações:
- É só log — deve rodar em `try/catch` e **nunca** derrubar o processamento da
  venda se falhar (o registro da compra é crítico; o log é secundário).
- Para testar: reenviar um webhook de teste e conferir
  `select recebido_em, evento, transacao from cs.hotmart_eventos order by recebido_em desc limit 5;`

---

## Item 7 — 🔴 CRÍTICO: webhook ignora `PURCHASE_COMPLETE` (boleto/pix compensado)

**Sintoma (achado na reconciliação de 23/07):** boleto que COMPENSA não vira "pago"
no banco — fica preso em `PRINTED_BILLET`. Caso concreto: Rafael Bayard
(`HP1699412937`) pagou o sinal, a Hotmart marcou "Completo", mas o sistema achava
que ele não tinha pago (sinal fora do razão, esteira errada, canal forçado por
override "sem sinal aprovado").

**Causa-raiz (provada pelo log cru 15–17/07):** a Hotmart manda `PURCHASE_COMPLETE`
(89×), `PURCHASE_BILLET_PRINTED` (9×) e `PURCHASE_EXPIRED` (8×) — mas o handler só
age em `PURCHASE_APPROVED` + cancelamentos. O guard descarta os outros:

```ts
const statusCancelamento = EVENTOS_CANCELAMENTO[event];
if (event !== "PURCHASE_APPROVED" && !statusCancelamento) { return event_ignored; }
```

`PURCHASE_COMPLETE` é o "pagamento liberado/compensado" — tratá-lo IGUAL ao
`PURCHASE_APPROVED` (persistir/atualizar status). **Patch mínimo:**

```ts
// trata COMPLETE junto com APPROVED (ambos = pagamento confirmado)
const EVENTOS_COMPRA = ["PURCHASE_APPROVED", "PURCHASE_COMPLETE"];
if (!EVENTOS_COMPRA.includes(event) && !statusCancelamento) { return event_ignored; }
```

E em `persistPurchase`, parar de cravar `hotmart_event: "PURCHASE_APPROVED"` —
usar o `event` real (senão um COMPLETE grava rótulo de APPROVED). O `status` já
vem de `purchase.status` (virá `COMPLETE`), o upsert é por `hotmart_transaction`
(idempotente) e o gatilho `trg_seed_contato_hm_upd` reconcilia o card. Seguro:
não cria duplicado, não regride estágio, não re-lança razão (on-conflict).

**Bônus (higiene, opcional):** tratar `PURCHASE_BILLET_PRINTED` (gravar boleto) e
`PURCHASE_EXPIRED` (baixar status) para o boleto não ficar preso — o vigia diário
(`boleto_preso`, migration 0131) hoje cobre isso apontando, mas na origem é melhor.

**Enquanto não sobe:** o vigia diário `boleto_preso` (0131) segura, apontando todo
boleto parado >10 dias para conferência manual na Hotmart.

## Também vale conferir (fora do banco)

Config **duplicada** na Hotmart apontando para URL errada (`/hotmart-webhook` e
`/hotmart-hm-webhook` → 404). A URL correta e única é
`https://mbvybujpkwuorhtdzcde.supabase.co/functions/v1/hotmart-events-webhook`.
Remover/corrigir as configs erradas no painel da Hotmart (hoje não perde venda
porque o evento também chega na URL certa, mas é armadilha para o futuro).
