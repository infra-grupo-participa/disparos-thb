# Separação de contatos por portal — plano de migração

**Data:** 28/07/2026 · **Base:** `main` em `f18bb9f` · **Status:** PLANO — nada foi implementado.
**Decisor:** Marcio · **Escopo:** `cs.contatos` deixa de ter uma linha por pessoa no sistema inteiro e passa a ter uma linha por **(pessoa, portal)**. HT, SEM e CNHF ficam isolados. HM não muda (tem overlay próprio, `cs.contatos_hm`).

---

## 1. Resumo executivo

Hoje `cs.contatos.comprador_id` é UNIQUE **global** (`db/migrations/0001_cs_workspace_init.sql:36`). Quem virou lead do CNHF e depois comprou o HT tem **uma única linha**, presa ao CNHF: o portal HT mostra a pessoa (a view `cs.contatos_ht` sai das compras da Hotmart) mas **sem estágio, sem dono, sem tags** — tudo isso vive na linha do CNHF. E o inverso também: quem já tinha linha no HT e virou lead do CNHF **nunca ganhou card no CNHF** (a função `cs.fn_lead_upsert` devolve `colidiu:HT` e desiste — `0133:77`).

**Boa notícia que muda o tamanho do problema:** o comentário da migration 0133 ("~30 gatilhos dependem de `on conflict (comprador_id)`, não dá para trocar sem reescrever tudo") está **superdimensionado**. Auditei as 31 ocorrências uma a uma (seção 2): **24 são sobre `cs.contatos_hm`**, que tem a própria constraint e **não é tocada**; 2 são sobre `cs.hm_comprador_alias`; 1 sobre `cs.email_contato`; 1 é o próprio comentário. Sobram **3 pontos vivos de banco** (`fn_seed_contato`, `fn_lead_upsert`, view `cs.contatos_ht`) e **~8 pontos de TypeScript** sem filtro de evento. O grosso do app já lê/escreve escopado por `(comprador_id, evento)` — os comentários no código ("isolamento de portais, 27/07") mostram que essa direção já vinha sendo pavimentada.

**Proposta:** uma migration (`0147`) que troca a unique global por `unique (comprador_id, evento)`, atualiza as 2 funções e a view na mesma transação, e faz o backfill nos dois sentidos (HT ganha linha própria; CNHF recupera os leads que colidiram). Antes dela, um deploy de código compatível com os dois mundos. Esforço mecânico: ~1 dia. Decisões de produto: 3 (seção 4).

---

## 2. Diagnóstico em números

### 2.1 As 31 ocorrências de `on conflict (comprador_id)` (22 arquivos)

Classificadas pelo alvo real do INSERT — é isso que decide se a mudança afeta ou não:

**GRUPO A — alvo `cs.contatos` (afetadas pela troca da constraint):**

| Arquivo:linha | O que é | Situação |
|---|---|---|
| `db/migrations/0001_cs_workspace_init.sql:151` | `fn_seed_contato` v1 | **Superseded** pela 0028 — sem ação |
| `db/migrations/0001_cs_workspace_init.sql:174` | backfill inicial HT | One-off já aplicado — sem ação |
| `db/migrations/0028_cs_hm_ativacao.sql:60` | `fn_seed_contato` v2 (**versão viva**, trigger em `public.compras`) | **REESCREVER na 0147** |

**GRUPO B — alvo `cs.contatos_hm` (constraint própria, NÃO afetadas):** 24 ocorrências:
`0028:161`, `0028:216`, `0030:60`, `0031:48`, `0035:62`, `0036:134`, `0036:193`, `0037:73`, `0038:65`, `0039:243`, `0042:94`, `0046:118`, `0050:134`, `0059:35`, `0092:92`, `0119:65`, `0119:132`, `0120:71`, `0120:137`, `0121:103`, `0121:167`, `0127:257`, `0127:284`, `0127:348`.
Todas inserem em `cs.contatos_hm`, cuja unique `(comprador_id)` continua existindo. **Zero mudança no HM.**

**GRUPO C — outros alvos (NÃO afetadas):**
- `db/migrations/0082:121` e `0105:38` → `cs.hm_comprador_alias` (constraint própria).
- `lib/services/email.ts:505` → `cs.email_contato` (engajamento de e-mail por **pessoa** — correto continuar global).
- `db/migrations/0133:12` → é o comentário que documenta a dívida.

### 2.2 Objetos de banco vivos que precisam mudar (na própria 0147)

| Objeto | Onde está a versão viva | Problema |
|---|---|---|
| `cs.fn_seed_contato()` | `0028_cs_hm_ativacao.sql:46-72` | `on conflict (comprador_id)` → **quebra duro** após a troca (erro "no unique constraint matching ON CONFLICT"); como é trigger de `public.compras` **sem exception handler**, derrubaria a gravação de compras da Hotmart. Também tem `select id into ... where comprador_id = ...` sem evento (`0028:62`) — com 2 linhas, pegaria uma arbitrária. |
| `cs.fn_lead_upsert()` | `0133_cs_lead_upsert_e_sync_cnhf.sql:21-83` | Toda a lógica do `colidiu:` (`0133:66-78`) existe **por causa** da unique global. Reescrever para upsert por `(comprador, evento)`. Chamada só por triggers de banco (`0133:101`, `0134:77`, `0135:27`, `0136:25`) — nenhum caller TypeScript; assinatura e tipo de retorno preservados, `colidiu:` simplesmente deixa de acontecer. |
| View `cs.contatos_ht` | versão viva em `0146:118-159` | `left join cs.contatos ct on ct.comprador_id = cmp.id` **sem `and ct.evento = 'HT'`** (`0146:156`). **É a causa direta do sintoma do Marcio**: o overlay que aparece no portal HT é a linha de qualquer evento. |
| View `cs.contatos_evento` | versão viva em `0146:167-214` | Braço HT herda da `cs.contatos_ht` (conserta junto); braços SEM/CNHF **já filtram** `ct.evento` (`0146:196` e `:214`). Sem mudança própria. |
| `public.vw_aluno_360` | `0071:515-545` | Agrega `cs.contatos_evento` por comprador com `array_agg(... order by ord desc)[1]` — **tolera N linhas** (já tolera hoje, a view unificada já pode ter a mesma pessoa em 2 braços). Semântica "estágio mais recente entre portais" fica um pouco mais misturada; aceitável para uma visão 360. Sem mudança obrigatória. |
| Triggers `workbook.fn_sync_pesquisa_cnhf` (`0135:64-68`) e mql-promote | **Já escopados** (`where comprador_id = ... and evento = 'CNHF'`). Sem mudança. |

`cs.interacoes` referencia `cs.contatos(id)` (`0001:54`), não `comprador_id` — a troca da unique **não** tem dependência de FK. O schema Drizzle (`db/schema.ts:23`) não declara a unique — sem mudança lá.

### 2.3 TypeScript que opera `cs.contatos` por `comprador_id` sem evento

Hoje inócuo (1 linha por pessoa); depois da troca passa a atingir N linhas. Em ordem de gravidade:

| Arquivo:linha | O que faz | Gravidade pós-troca |
|---|---|---|
| `lib/services/disparo.ts:125` | join `cs.contatos_evento v on v.comprador_id = dc.comprador_id` **sem evento** ao montar a fila de envio | **ALTA — fan-out: a mesma pessoa em 2 portais duplicaria a linha na fila → mensagem WhatsApp em dobro.** Corrigir para `and v.evento = <evento do disparo>` ANTES da migration. |
| `lib/services/disparo.ts:194-203` | `update cs.contatos set ultimo_contato_em... where comprador_id = $1` + interação | Média — carimba/loga nos 2 portais. Escopar pelo evento do template. |
| `lib/services/inbox-sync.ts:74-101` | resposta e opt-out: `update cs.contatos ... where comprador_id = $1` (o `Alvo` **tem** `evento` em `:112`, só não usa) | Média — resposta/estágio vazam pro outro portal. **Atenção: este arquivo está sendo editado agora pelos agentes do inbox — coordenar.** Exceção proposital: opt-out (ver decisão P2). |
| `lib/services/email.ts:321-326` | interação "E-mail disparado" via `from cs.contatos where comprador_id = $1` | Baixa — nota duplicada na timeline dos 2 portais. `d.evento` está disponível. |
| `lib/services/email.ts:442-450` | descadastro de lista AC marca opt-out em **todas** as linhas da pessoa | Depende da decisão P2 (se opt-out for global, esse código fica **correto como está**). |
| `app/api/contato/[id]/route.ts:45-53` | timeline junta `cs.contatos c ... where c.comprador_id = $1` sem evento | Baixa — mistura timeline dos portais (decisão P3). |
| `app/api/send/route.ts:98,102` e `app/api/send-email/route.ts:96` | contadores de pulados por opt-out sem evento | Cosmética — segue a decisão P2. |
| `app/api/disparos/[id]/route.ts:26` | relatório de disparo, join na view sem evento | Baixa — linha duplicada no relatório. |
| `scripts/import-ht-legado.mjs:180` | update legado sem evento | Só se o script for reusado — adicionar `and evento='HT'`. |

Já escopados (sem ação — só cito como evidência de que o app está pronto): `lib/services/contato.ts` inteiro (contrato explícito na linha 19), `app/api/contato/[id]` GET/PATCH, `app/api/kanban/*`, `app/api/inbox/*` (rotas), `app/api/meu-dia`, dashboards, `app/api/eventos` (fixado em HT com comentários), `lib/services/email.ts:164/262`, `sincronizarTagsEdicao` (`contato.ts:272-284`).

### 2.4 Tabelas satélites que continuam POR PESSOA (decisão de arquitetura, não bug)

`cs.formularios` (unique `comprador_id, tipo`), `cs.lead_scores`, `cs.email_contato`, `cs.ligacoes`, `cs.disparo_contatos` — são dados da **pessoa** (a resposta de pesquisa e o engajamento de e-mail não mudam conforme o portal). Ficam como estão; as telas já os cruzam por `comprador_id` dentro do recorte do portal.

---

## 3. A migration proposta (`db/migrations/0147_cs_contato_por_portal.sql`)

SQL de referência para revisão — **não é arquivo executável ainda**. Tudo em **uma transação**: ou entra inteiro, ou nada muda.

```sql
-- =====================================================================
-- 0147_cs_contato_por_portal
-- cs.contatos passa de "uma linha por pessoa" para "uma linha por
-- (pessoa, evento)". HT/SEM/CNHF isolados. HM intocado (overlay próprio).
-- Uma transação: constraint + funções + view + backfill juntos, porque a
-- fn_seed_contato quebraria com a constraint nova e vice-versa.
-- =====================================================================
begin;

-- 0) Snapshot de segurança (tabela pequena; é o caminho real de rollback)
create table cs._bak_contatos_pre_0147 as select * from cs.contatos;

-- 1) Troca da unicidade -----------------------------------------------------
-- Nome da constraint procurado dinamicamente (criada inline na 0001; o nome
-- default seria contatos_comprador_id_key, mas não confirmei no banco).
do $$
declare v_con text;
begin
  select conname into v_con
    from pg_constraint
   where conrelid = 'cs.contatos'::regclass and contype = 'u'
     and conkey = (select array_agg(attnum) from pg_attribute
                    where attrelid = 'cs.contatos'::regclass
                      and attname = 'comprador_id');
  if v_con is null then
    raise exception 'unique global de comprador_id nao encontrada — abortando';
  end if;
  execute format('alter table cs.contatos drop constraint %I', v_con);
end$$;

alter table cs.contatos
  add constraint contatos_comprador_evento_key unique (comprador_id, evento);
-- (o composto começa por comprador_id — cobre os lookups existentes por pessoa)

-- 2) fn_seed_contato (HT): chave nova + leituras escopadas -------------------
create or replace function cs.fn_seed_contato()
returns trigger language plpgsql security definer set search_path = cs, public
as $fn$
declare
  v_estagio_inicial smallint;
  v_contato_id uuid;
begin
  if new.produto_id in ('1560865','2414291')
     and new.status in ('APPROVED','COMPLETE','COMPLETED') then
    select id into v_estagio_inicial
      from cs.estagios where is_inicial and evento = 'HT' order by ordem limit 1;

    insert into cs.contatos (comprador_id, estagio_id, evento)
    values (new.comprador_id, v_estagio_inicial, 'HT')
    on conflict (comprador_id, evento) do nothing;

    select id into v_contato_id
      from cs.contatos where comprador_id = new.comprador_id and evento = 'HT';

    if v_contato_id is not null and not exists (
      select 1 from cs.interacoes i
      where i.contato_id = v_contato_id and i.tipo = 'sistema'
        and i.descricao like 'Entrou na esteira%'
    ) then
      insert into cs.interacoes (contato_id, tipo, descricao, autor)
      values (v_contato_id, 'sistema', 'Entrou na esteira (compra HT aprovada)', 'sistema');
    end if;
  end if;
  return new;
end$fn$;

-- 3) fn_lead_upsert: fim do 'colidiu' — upsert por (comprador, evento) -------
-- Mesma assinatura e mesmos retornos, MENOS 'colidiu:<evento>' (não existe
-- mais colisão entre portais). Callers (0133/0134/0135/0136) só fazem
-- PERFORM e continuam válidos.
create or replace function cs.fn_lead_upsert(
  p_evento        text,
  p_nome          text,
  p_email         text,
  p_telefone      text default null,
  p_estagio_chave text default null,
  p_observacoes   text default null,
  p_tags          text[] default '{}'
) returns text
language plpgsql security definer set search_path = cs, public as $$
declare
  v_email  text := lower(btrim(p_email));
  v_nome   text := coalesce(nullif(btrim(p_nome), ''),
                            nullif(split_part(lower(btrim(p_email)),'@',1),''), 'Lead');
  v_tel    text := nullif(regexp_replace(coalesce(p_telefone,''), '\D', '', 'g'), '');
  v_comprador uuid;
  v_estagio   smallint;
begin
  if v_email is null or v_email = '' or position('@' in v_email) = 0 then
    return 'ignorado:email';
  end if;

  select id into v_comprador from public.compradores
   where lower(btrim(email)) = v_email limit 1;
  if v_comprador is null then
    insert into public.compradores (nome, email, telefone, is_manual)
    values (v_nome, v_email, v_tel, true)
    returning id into v_comprador;
  else
    update public.compradores
       set telefone = coalesce(telefone, v_tel), atualizado_em = now()
     where id = v_comprador;
  end if;

  if p_estagio_chave is not null then
    select id into v_estagio from cs.estagios
     where evento = p_evento and chave = p_estagio_chave limit 1;
  end if;
  if v_estagio is null then
    select id into v_estagio from cs.estagios
     where evento = p_evento and is_inicial and ativo order by ordem limit 1;
  end if;
  if v_estagio is null then
    return 'ignorado:estagio';
  end if;

  -- Já tem card NESTE portal? Completa buracos e sai (nunca mexe no estágio
  -- de card existente — respeita o trabalho do operador, igual à 0133).
  update cs.contatos
     set observacoes  = coalesce(observacoes, p_observacoes),
         tags          = (select array(select distinct unnest(tags || p_tags))),
         atualizado_em = now()
   where comprador_id = v_comprador and evento = p_evento;
  if found then
    return 'existe';
  end if;

  insert into cs.contatos (comprador_id, estagio_id, evento, observacoes, tags,
                           primeiro_contato_em, opt_out, opt_out_em)
  select v_comprador, v_estagio, p_evento, p_observacoes, coalesce(p_tags,'{}'),
         now(),
         -- Opt-out é da PESSOA (decisão P2): nasce herdando o pedido feito
         -- em qualquer outro portal.
         coalesce((select bool_or(x.opt_out) from cs.contatos x
                    where x.comprador_id = v_comprador), false),
         (select min(x.opt_out_em) from cs.contatos x
           where x.comprador_id = v_comprador)
  on conflict (comprador_id, evento) do nothing;
  return 'inserido';
end $$;

grant execute on function cs.fn_lead_upsert(text,text,text,text,text,text,text[])
  to disparos_app;

-- 4) View cs.contatos_ht: o overlay do HT é SÓ a linha do HT ------------------
-- Corpo idêntico ao da 0146 (mesmas colunas, mesma ordem — CREATE OR REPLACE
-- preserva cs.contatos_evento e public.vw_aluno_360), com UMA mudança:
--   ANTES: left join cs.contatos ct on ct.comprador_id = cmp.id
--   DEPOIS: left join cs.contatos ct on ct.comprador_id = cmp.id
--                                   and ct.evento = 'HT'
create or replace view cs.contatos_ht with (security_invoker = false) as
  ... (reproduzir 0146:118-159 na íntegra, com o and ct.evento = 'HT') ...;

-- (cs.contatos_evento NÃO precisa de replace: o braço HT herda da view acima;
--  SEM/CNHF já filtram ct.evento — 0146:196 e 0146:214.)

-- 5) BACKFILL sentido 1: comprador HT com a linha presa em outro portal ------
-- Cria a linha do HT (decisão P1, opção A: nasce no estágio inicial do HT,
-- sem dono e sem tags de outro portal; herda apenas opt-out).
with novos as (
  insert into cs.contatos (comprador_id, evento, estagio_id, opt_out, opt_out_em)
  select c.comprador_id, 'HT',
         (select id from cs.estagios
           where evento = 'HT' and is_inicial and ativo order by ordem limit 1),
         coalesce(bool_or(ct.opt_out), false),
         min(ct.opt_out_em)
    from public.compras c
    left join cs.contatos ct on ct.comprador_id = c.comprador_id
   where c.produto_id in ('1560865','2414291')
     and c.status in ('APPROVED','COMPLETE','COMPLETED')
     and not exists (select 1 from cs.contatos x
                      where x.comprador_id = c.comprador_id and x.evento = 'HT')
   group by c.comprador_id
  on conflict (comprador_id, evento) do nothing
  returning id
)
insert into cs.interacoes (contato_id, tipo, descricao, autor)
select id, 'sistema',
       'Card do HT criado na separação de portais (0147) — a pessoa já era contato de outro portal',
       'sistema'
  from novos;

-- 6) BACKFILL sentido 2: leads do dashboard CNHF que colidiram ---------------
-- Reproduz o espelhamento da 0133 para quem a fn_lead_upsert descartou com
-- 'colidiu:*'. Fonte-verdade: controle.lead do evento ago/2026.
with alvo as (
  select distinct on (cmp.id)
         cmp.id as comprador_id, l.is_mql, l.criado_em
    from controle.lead l
    join controle.evento e on e.id = l.evento_id
                          and e.slug = 'lancamento-parceria-ago-2026'
    join public.compradores cmp
      on lower(btrim(cmp.email)) = lower(btrim(l.external_id))
   where not exists (select 1 from cs.contatos x
                      where x.comprador_id = cmp.id and x.evento = 'CNHF')
   order by cmp.id, l.is_mql desc, l.criado_em asc
), novos as (
  insert into cs.contatos (comprador_id, evento, estagio_id, observacoes, tags,
                           primeiro_contato_em, opt_out, opt_out_em)
  select a.comprador_id, 'CNHF',
         (select id from cs.estagios where evento = 'CNHF'
           and chave = case when a.is_mql then 'cnhf_mql' else 'cnhf_lead' end),
         'Curso Nacional de Formação em Holding Familiar (backfill 0147)',
         array['CNHF'],
         coalesce(a.criado_em, now()),
         coalesce((select bool_or(x.opt_out) from cs.contatos x
                    where x.comprador_id = a.comprador_id), false),
         (select min(x.opt_out_em) from cs.contatos x
           where x.comprador_id = a.comprador_id)
    from alvo a
  on conflict (comprador_id, evento) do nothing
  returning id
)
insert into cs.interacoes (contato_id, tipo, descricao, autor)
select id, 'sistema', 'Card recuperado na separação de portais (0147) — colidia com outro portal', 'sistema'
  from novos;

-- 7) SEM: sem backfill automático. O SEM não tem fonte-verdade externa como o
-- controle.lead — os leads entraram por importação manual. A query V4 (seção 7)
-- dimensiona se existe colisão relevante; se houver, o backfill é uma
-- reimportação pontual, decidida com a lista na mão.

commit;
```

Notas sobre o SQL:
- O bloco 4 está abreviado de propósito (o corpo integral são as 41 linhas de `0146:118-159` com uma condição a mais) — na implementação vai completo.
- As observações do backfill CNHF (bloco 6) são mais pobres que as da 0133 (profissão/origem/grupo). Dá para enriquecer juntando os campos de `controle.lead`, ao custo de mais SQL — proponho enriquecer na implementação real, é mecânico.
- `cs.estagios.chave` é unique global (`0001:14`) e as jornadas usam prefixo por evento (`cnhf_*`, `sem_*`) — nenhuma mudança necessária lá.

---

## 4. Decisões de produto (não decido sozinho — recomendo)

### P1 — O que a linha nova do HT herda de quem estava no CNHF/SEM?

| Opção | O que faz | Trade-off |
|---|---|---|
| **A (recomendada)** | Nasce limpa no estágio inicial do HT, sem responsável, sem tags; herda **só o opt-out** | O operador do HT "começa do zero" com essas pessoas — mas hoje esse trabalho **não existe no HT** (o estágio que a pessoa tem é `cnhf_*`, inválido no kanban HT; é por isso que o card aparece sem etapa). Nada real se perde. É também o único estágio tecnicamente honesto: **estágios não são mapeáveis entre jornadas** (chaves e semânticas diferentes por evento). |
| B | Copia também tags, responsável e observações da linha do outro portal | Traz ruído (tag `CNHF` poluindo a segmentação do HT — exatamente o vazamento que `contato.ts:275-280` já combate) e atribui ao card do HT um dono que trabalha o CNHF, escondendo o card do pool da equipe errada (modelo 0146). Não recomendo. |
| C | **Move** a linha para o HT (`update evento`) em vez de criar | Resolve o HT criando o mesmo buraco no CNHF — é o problema atual com o sinal trocado. Rejeitar. |

### P2 — Opt-out: global (por pessoa) ou por portal?

**Recomendo: global.** Quem pediu para parar de receber, pediu como pessoa — continuar disparando por outro portal é risco real de denúncia/banimento do número na Meta e desrespeita a manifestação (LGPD). Na prática: o backfill herda o opt-out (blocos 5/6 acima), a `fn_lead_upsert` nasce herdando, e no runtime o opt-out marca **todas** as linhas do comprador — o que significa que `lib/services/inbox-sync.ts:93-97` e `lib/services/email.ts:442-450` ficam **corretos como estão** (sem filtro de evento), só ganhando um comentário de que a abrangência é proposital.
Alternativa (por portal): mais granular, mas alguém que pediu "para" no CNHF continuaria recebendo do HT. Não recomendo; se o Marcio quiser, a mudança é só escopar esses dois updates.

### P3 — Timeline do contato: unificada ou por portal?

Hoje `app/api/contato/[id]/route.ts:45-53` junta as interações de todas as linhas da pessoa. Depois da separação isso mistura a história dos dois portais na ficha.
**Recomendo: por portal** (adicionar `and c.evento = $2` — 1 linha), coerente com o isolamento que o resto da ficha já pratica. Alternativa defensável: manter unificada como "visão da pessoa" — barato de reverter depois; é escolha de UX, não técnica.

---

## 5. Ordem de aplicação (deploy automático no push; sistema em uso)

Importante: pelo padrão do repo, **migrations são aplicadas manualmente via MCP/psql** (cabeçalho da 0001), não pelo deploy — o push automático publica só o app. Isso dá controle fino da janela.

**FASE 0 — código compatível com os dois mundos (push primeiro, sem risco):**
Todos os ajustes de TS da seção 2.3 funcionam igual no schema atual (o filtro de evento casa com a única linha existente):
1. `lib/services/disparo.ts:125` — `and v.evento = <evento do disparo>` (**o crítico**: sem isso, migration + pessoa em 2 portais = WhatsApp em dobro);
2. `lib/services/disparo.ts:194-203`, `lib/services/email.ts:321-326`, `app/api/disparos/[id]/route.ts:26`, contadores de `send`/`send-email` — escopar;
3. `lib/services/inbox-sync.ts:74-90` — escopar resposta/estágio pelo `evento` do `Alvo` (já disponível em `:112`); opt-out fica global por P2. **Coordenar: arquivo em edição pelos agentes do inbox agora**;
4. `app/api/contato/[id]/route.ts:45-53` conforme P3.
Deploy, smoke test nos 3 portais. O sistema segue 100% no comportamento atual.

**FASE 1 — a migration 0147 (uma transação, via MCP/psql):**
Rodar as queries "ANTES" (seção 7), aplicar, rodar as "DEPOIS". Janela de segundos — a tabela é pequena (milhares de linhas). Não há estado intermediário visível: constraint, funções, view e backfill entram juntos.

**FASE 2 — pós:**
Commitar o arquivo `0147` no repo (registro), monitorar o webhook de compra Hotmart (o trigger `fn_seed_contato` é o ponto mais sensível) e o espelhamento do dashboard CNHF por 24-48h. Depois de estável, dropar `cs._bak_contatos_pre_0147` (ou manter 30 dias).

**O que quebra se a ordem for invertida:**
- *Migration antes da fase 0:* nenhum erro de SQL no app (não há `on conflict (comprador_id)` sobre `cs.contatos` no TS), mas: fila de disparo pode duplicar envio (fan-out do `disparo.ts:125`), interações/carimbos vazam entre portais. **Não aplicar fora de ordem.**
- *Fase 0 sem a migration (estado que fica entre os passos):* inofensivo — filtros de evento casam com a linha única atual.
- *Migration pela metade:* impossível por construção — transação única, e a `fn_seed_contato` antiga com a constraint nova (ou vice-versa) erraria dentro da mesma transação e reverteria tudo.

---

## 6. Rollback honesto

- **Durante a aplicação:** qualquer erro → `rollback` automático da transação. Nada muda. Risco zero.
- **Depois do commit, antes de qualquer trabalho novo:** reversível por script — apagar as linhas criadas pelo backfill (identificáveis pela interação de sistema "…(0147)…" e por não existirem em `cs._bak_contatos_pre_0147`), recriar a unique global, restaurar as versões 0028/0133/0146 das funções e da view (os corpos estão nos arquivos de migration). Janela realista: minutos a poucas horas.
- **Ponto de não-retorno prático:** a **primeira escrita de produção numa linha nova** — um operador move um card do HT recém-criado, atribui dono, escreve nota; ou a `fn_lead_upsert` insere a segunda linha de alguém num fluxo novo. A partir daí, voltar à unique global obriga a escolher **qual das linhas da pessoa sobrevive** — qualquer escolha joga fora trabalho de operador. Como não dá para prever quando essa primeira escrita acontece (o sistema está em uso), **tratem o commit da 0147 como decisão definitiva** para fins de autorização. O snapshot `_bak` continua sendo o último recurso: restaura o estado pré-migration inteiro, perdendo tudo que veio depois.

---

## 7. Verificação — queries para o Marcio

### ANTES (dimensionar; todas read-only)

```sql
-- V1. Nome e definição da constraint atual (confere o alvo do drop)
select conname, pg_get_constraintdef(oid)
  from pg_constraint
 where conrelid = 'cs.contatos'::regclass and contype in ('u','p');

-- V2. Foto atual: linhas por evento
select evento, count(*) from cs.contatos group by evento order by evento;

-- V3. O SINTOMA: compradores HT cuja linha vive em outro portal
--     (= quantas linhas novas o backfill sentido 1 vai criar, por origem)
select ct.evento as portal_onde_a_linha_vive, count(distinct c.comprador_id)
  from public.compras c
  join cs.contatos ct on ct.comprador_id = c.comprador_id and ct.evento <> 'HT'
 where c.produto_id in ('1560865','2414291')
   and c.status in ('APPROVED','COMPLETE','COMPLETED')
   and not exists (select 1 from cs.contatos x
                    where x.comprador_id = c.comprador_id and x.evento = 'HT')
 group by ct.evento;

-- V4. Colisões reversas: leads do dashboard CNHF sem card CNHF
--     (= quantas linhas o backfill sentido 2 vai criar)
select count(distinct cmp.id)
  from controle.lead l
  join controle.evento e on e.id = l.evento_id
                        and e.slug = 'lancamento-parceria-ago-2026'
  join public.compradores cmp
    on lower(btrim(cmp.email)) = lower(btrim(l.external_id))
 where not exists (select 1 from cs.contatos x
                    where x.comprador_id = cmp.id and x.evento = 'CNHF');

-- V5. Opt-outs que serão herdados pelas linhas novas do HT (impacto P2)
select count(distinct ct.comprador_id)
  from cs.contatos ct
 where ct.opt_out and ct.evento <> 'HT'
   and exists (select 1 from public.compras c
                where c.comprador_id = ct.comprador_id
                  and c.produto_id in ('1560865','2414291')
                  and c.status in ('APPROVED','COMPLETE','COMPLETED'));

-- V6. Sanidade: cards do portal HT hoje SEM estágio (deve bater ~com V3)
select count(*) from cs.contatos_ht where estagio_id is null;
```

### DEPOIS (confirmar que ninguém sumiu nem duplicou)

```sql
-- D1. Duplicata indevida DENTRO do mesmo portal: deve retornar 0 linhas
select comprador_id, evento, count(*)
  from cs.contatos group by 1, 2 having count(*) > 1;

-- D2. Ninguém sumiu: toda linha do snapshot continua, com o MESMO id e evento
--     (deve retornar 0)
select count(*) from cs._bak_contatos_pre_0147 b
 where not exists (select 1 from cs.contatos c
                    where c.id = b.id and c.evento = b.evento);

-- D3. Todo comprador HT tem linha HT (deve retornar 0)
select count(distinct c.comprador_id)
  from public.compras c
 where c.produto_id in ('1560865','2414291')
   and c.status in ('APPROVED','COMPLETE','COMPLETED')
   and not exists (select 1 from cs.contatos x
                    where x.comprador_id = c.comprador_id and x.evento = 'HT');

-- D4. O sintoma sumiu: cards do HT sem estágio (deve ser 0; comparar com V6)
select count(*) from cs.contatos_ht where estagio_id is null;

-- D5. Dashboard CNHF coberto: V4 reexecutada deve retornar 0
-- D6. Balanço por evento: V2 reexecutada;
--     HT deve ter crescido exatamente o total de V3, CNHF exatamente V4,
--     SEM inalterado (se não houve backfill do SEM).
-- D7. Compra nova da Hotmart entra sem erro (monitorar cs.webhook_log e Sentry
--     na primeira compra após a migration — o trigger fn_seed_contato é o
--     ponto que quebraria mais feio se algo tivesse escapado).
```

---

## 8. Risco e esforço

**Mecânico (sem decisão, só execução — ~1 dia de trabalho):**
- Migration 0147 (constraint + 2 funções + 1 view + 2 backfills): meio dia, incluindo revisão linha a linha dos corpos vivos (0028/0133/0146).
- Fase 0 de TS: ~8 pontos pequenos, 2-4h, cada um é adicionar um filtro/parâmetro de evento.
- Verificação antes/depois: 1h com as queries prontas acima.

**Decisão de produto (bloqueia a autorização):** P1 (herança do backfill — recomendo A), P2 (opt-out global — recomendo sim), P3 (timeline por portal — recomendo sim, reversível).

**Riscos principais:**
1. **Trigger de compra** (`fn_seed_contato`): é o único ponto onde um erro derruba fluxo de dinheiro (gravação de compra Hotmart). Mitigado por: troca atômica na mesma transação + D7. Risco residual baixo.
2. **Disparo duplicado** se a migration rodar antes da fase 0 (`disparo.ts:125`). Mitigado pela ordem de aplicação. Não aplicar fora de ordem.
3. **Colisão com o trabalho concorrente no inbox** (`lib/services/inbox-sync.ts` em edição agora): a fase 0 toca esse arquivo. Sequenciar: fechar o trabalho do inbox primeiro, depois a fase 0.
4. **Views agregadoras** (`vw_aluno_360`, relatório 0081): toleram N linhas mas a semântica "pega o mais recente entre portais" fica mais visível. Não bloqueante; revisar com calma depois.
5. Reexecução de migrations antigas em banco novo: sem problema — a ordem numérica aplica a unique global antes da 0147 trocá-la.

**Classificação geral: risco MÉDIO, bem delimitado.** O medo registrado na 0133 ("reescrever tudo") não se confirma: 24 dos 31 pontos de `on conflict` são do HM e não são tocados.

---

## 9. O que eu NÃO consegui confirmar (sem acesso ao banco nesta máquina)

1. **O nome real da constraint** unique — a 0147 procura dinamicamente e a V1 confirma antes.
2. **Os volumes** (V2-V6) — o plano assume que são centenas/poucos milhares de linhas; se V3/V4 vierem zerados, o problema é menor do que o relatado e vale re-conferir o sintoma antes de migrar.
3. **Se o schema em produção bate com as migrations do repo** — todo o diagnóstico é estático, a partir dos arquivos; um hotfix aplicado direto no banco (fora do repo) não seria visto aqui. A V1 e um `\d cs.contatos` antes da aplicação fecham essa lacuna.
4. **Onde os `colidiu:*` foram logados** (o comentário da 0133 diz que "o chamador registra") — se houver registro em `cs.webhook_log`, dá para cruzar com o backfill V4 e conferir que nada ficou de fora. Não localizei o registro no código; o backfill via `controle.lead` cobre a fonte primária de qualquer forma.
5. **O estado final do inbox** — os agentes estão editando `lib/services/inbox-sync.ts` e rotas de inbox agora; a lista da seção 2.3 para esses arquivos deve ser revalidada quando eles fecharem.
6. Os testes `tests/e2e` não foram executados (sem `.env.local`).
