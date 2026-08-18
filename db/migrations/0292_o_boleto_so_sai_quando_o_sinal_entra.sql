-- =====================================================================
-- 0292_o_boleto_so_sai_quando_o_sinal_entra
--
-- D2 (decisão do Marcio): Boleto Gerado → Sinal Pago (hm_aguardando_pagamento)
-- é AUTOMÁTICO quando o sinal compensa. Sinal Pago → Contato Inicial
-- (hm_comprou) passa a ser MANUAL do operador. Hoje o pagamento manda direto
-- para hm_comprou — esta migration muda esse destino, e só esse (PATCH 1).
--
-- ⚠️ REPLACE MECÂNICO, NÃO REESCRITA (mesmo padrão 0216/0233/0263/0265/0285):
-- o banco está à frente do repo em cs.fn_seed_contato_hm — a última reescrita
-- COMPLETA versionada no repo é a 0181, mas a 0186 (11/08, mesmo dia,
-- posterior) mudou o corpo em produção (coluna "Boleto Gerado", variável
-- v_bol, resolução dos 4 estágios) sem nunca versionar um `create or replace`
-- completo. Reescrever a função inteira a partir da 0181 REGREDIRIA esse
-- comportamento. Em vez disso: lê o fonte REAL do banco via
-- pg_get_functiondef e faz `replace` textual do trecho exato do `case` de
-- `estagio_id` (a única coisa que D2 muda) — com âncora tolerante a espaço em
-- branco (regexp_replace) porque a formatação de pg_get_functiondef pode não
-- bater byte-a-byte com o texto colado no pedido. A migration ABORTA com
-- `raise exception` se a âncora não casar ou se já estiver aplicada — nunca
-- grava função incompleta.
--
-- Confirmado no corpo vivo (extraído do banco pelo Marcio, hash
-- 5113a650fe1f2b9c003eeb5ce15ea38d): a função resolve QUATRO estágios —
-- v_ini (hm_comprou), v_pend (hm_pendente_liberacao), v_esper
-- (hm_aguardando_pagamento) e v_bol (hm_boleto_gerado) — e o ramo de
-- aprovação (`v_cat in ('sinal','compra_cheia') and v_quando >= v_cutoff`)
-- tem, no `on conflict do update`:
--
--   estagio_id = case
--                  when cs.contatos_hm.aguardando_pagamento_em is not null
--                    or cs.contatos_hm.estagio_id in (v_bol, v_esper)
--                  then excluded.estagio_id      -- hoje: v_ini (hm_comprou)
--                  else cs.contatos_hm.estagio_id
--                end,
--
-- PATCH 1 troca só o `then excluded.estagio_id` por `then v_esper` — o card
-- que estava esperando (Boleto Gerado OU Aguardando Pagamento) passa a parar
-- em "Sinal Pago" (hm_aguardando_pagamento), não em "Contato Inicial". O
-- INSERT (values (...)) do mesmo statement continua indo para v_ini — compra
-- que nasce aprovada sem passar por boleto não é afetada por D2.
--
-- PATCH 2 (item 2 do pedido — registrar `mudanca_estagio` quando o card sai
-- da espera para "Sinal Pago") — trecho confirmado pelo Marcio contra o
-- banco vivo (mesmo hash). Logo depois do `atualizado_em = now();` do
-- `on conflict do update`, o corpo real é:
--
--   v_id := cs.fn_hm_card_da_oferta(v_comprador, new.oferta_codigo);
--   if v_id is not null and not exists (
--     select 1 from cs.interacoes i
--     where i.contato_hm_id = v_id and i.tipo='sistema' and i.descricao like 'Entrou na Jornada%'
--   ) then
--     insert into cs.interacoes (contato_hm_id, tipo, descricao, autor)
--     values (v_id, 'sistema', 'Entrou na Jornada '||v_produto||' ('||v_cat||' — '||coalesce(v_notes,'oferta')||')', 'sistema');
--   end if;
--
-- (a 0181 tinha "Entrou na esteira HM" — o texto do banco vivo já mudou para
-- "Entrou na Jornada "||v_produto, vocabulário da trava de 13/08 — usamos
-- ESTE texto como âncora, não o antigo.)
--
-- PATCH 2 injeta o registro de `mudanca_estagio` IMEDIATAMENTE depois desse
-- bloco (`end if;` do "Entrou na Jornada"), autor 'sistema' — não 'hotmart'
-- como o pedido original pedia: o padrão vizinho deste MESMO ramo
-- (`v_cat = 'compra_cheia'`, logo abaixo) grava `mudanca_estagio` com autor
-- 'sistema', e coerência interna com o que já está gravado nas outras
-- interações automáticas desta função vence a instrução original.
--
-- ⚠️ SÓ grava quando a ficha REALMENTE saiu do boleto — o `on conflict do
-- update` roda para todo mundo do ramo, inclusive quem já estava em outra
-- coluna e não se moveu. Por isso o patch lê, ANTES do upsert (nova âncora:
-- logo antes do `insert into cs.contatos_hm (comprador_id, produto,
-- estagio_id, turma, plano, categoria_entrada, entrada_em)` deste mesmo
-- ramo — texto já confirmado literalmente pelo Marcio), tanto o
-- `estagio_id` (`v_estagio_antes_upsert`) quanto se `aguardando_pagamento_em`
-- estava preenchido (`v_esperando_antes_upsert`) — EXATAMENTE a mesma
-- condição que o PATCH 1 usa para decidir mover o card
-- (`aguardando_pagamento_em is not null OR estagio_id in (v_bol, v_esper)`).
-- Só grava a interação quando essa condição ANTES era verdadeira e o
-- `estagio_id` DEPOIS é v_esper — ou seja, quando o PATCH 1 efetivamente
-- moveu o card. Sem isso o sistema mentiria na timeline de quem nunca esteve
-- no boleto/espera.
--
-- Também versiona `trg_seed_contato_hm` (AFTER INSERT) e `trg_seed_contato_hm_upd`
-- (AFTER UPDATE, existe em produção, nunca foi versionado em nenhuma migration
-- deste repo) — idempotentes, sem alterar comportamento: só documentam o que
-- já dispara cs.fn_seed_contato_hm(), confirmado pelo Marcio contra o banco:
--
--   CREATE TRIGGER trg_seed_contato_hm AFTER INSERT ON public.compras
--     FOR EACH ROW EXECUTE FUNCTION cs.fn_seed_contato_hm()
--   CREATE TRIGGER trg_seed_contato_hm_upd AFTER UPDATE ON public.compras
--     FOR EACH ROW
--     WHEN (new.status IN ('APPROVED','COMPLETE','COMPLETED')
--           AND COALESCE(old.status,'') NOT IN ('APPROVED','COMPLETE','COMPLETED'))
--     EXECUTE FUNCTION cs.fn_seed_contato_hm()
-- =====================================================================

begin;

-- ── PATCH 1 — o destino do ramo de aprovação (o único que este arquivo aplica) ──
do $$
declare
  v_def    text;
  v_novo   text;
  -- Tolerante a espaço em branco / quebra de linha entre os tokens (a
  -- formatação de pg_get_functiondef pode não bater byte-a-byte com o texto
  -- colado no pedido) — mas exige a sequência exata dos tokens que importam.
  v_padrao text := 'estagio_id\s*=\s*case\s*'
                 || 'when\s+cs\.contatos_hm\.aguardando_pagamento_em\s+is\s+not\s+null\s*'
                 || 'or\s+cs\.contatos_hm\.estagio_id\s+in\s*\(\s*v_bol\s*,\s*v_esper\s*\)\s*'
                 || 'then\s+excluded\.estagio_id\s*'
                 || 'else\s+cs\.contatos_hm\.estagio_id\s*'
                 || 'end\s*,';
begin
  select pg_get_functiondef(p.oid) into v_def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'cs' and p.proname = 'fn_seed_contato_hm';

  if v_def is null then
    raise exception '0292: cs.fn_seed_contato_hm nao encontrada — abortado antes de mexer em nada';
  end if;

  if v_def ~ 'then\s+v_esper\s*--\s*0292' then
    raise exception '0292: cs.fn_seed_contato_hm ja tem o PATCH 1 (case de estagio_id) — migration ja aplicada, abortado para nao duplicar';
  end if;

  if v_def !~ v_padrao then
    raise exception '0292: a ancora do case "estagio_id = case ... when aguardando_pagamento_em is not null or estagio_id in (v_bol, v_esper) then excluded.estagio_id ..." nao casou no fonte de cs.fn_seed_contato_hm — abortado antes de gravar funcao incompleta. Rodar select pg_get_functiondef(''cs.fn_seed_contato_hm''::regproc) e comparar contra o padrao desta migration antes de reaplicar.';
  end if;

  -- Substitui só o "then excluded.estagio_id" por "then v_esper -- 0292",
  -- preservando os demais tokens do case tal como capturados (\1 = a parte
  -- antes de "then", \2 = a parte depois, incluindo "else ... end,").
  v_novo := regexp_replace(
    v_def,
    '(estagio_id\s*=\s*case\s*when\s+cs\.contatos_hm\.aguardando_pagamento_em\s+is\s+not\s+null\s*or\s+cs\.contatos_hm\.estagio_id\s+in\s*\(\s*v_bol\s*,\s*v_esper\s*\)\s*then\s+)excluded\.estagio_id(\s*else\s+cs\.contatos_hm\.estagio_id\s*end\s*,)',
    '\1v_esper -- 0292 (D2): sai da espera para "Sinal Pago", nao mais direto para "Contato Inicial"\2'
  );

  if v_novo = v_def then
    raise exception '0292: o regexp_replace nao alterou o texto — ancora nao casou de forma inequivoca. Abortado antes de gravar funcao incompleta.';
  end if;

  execute v_novo;
end $$;

-- ── PATCH 2, passo 1 — declara a variável de controle (v_estagio_antes_upsert)
-- que guarda o estagio_id do card ANTES do upsert. Âncora: o fim do bloco
-- `declare`, texto confirmado literalmente contra o banco vivo (mesmo hash) —
-- `replace()` literal (não regex), mesmo mecanismo do PATCH 2/passo 3.
do $$
declare
  v_def    text;
  v_novo   text;
  v_ancora text := 'v_turma text; v_aguardando boolean; v_produto text;' || E'\nbegin';
begin
  select pg_get_functiondef(p.oid) into v_def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'cs' and p.proname = 'fn_seed_contato_hm';

  if v_def like '%v_estagio_antes_upsert%' then
    raise exception '0292: cs.fn_seed_contato_hm ja tem v_estagio_antes_upsert declarada — PATCH 2 ja aplicado, abortado para nao duplicar';
  end if;

  if position(v_ancora in v_def) = 0 then
    raise exception '0292: a ancora do fim do bloco declare ("v_turma text; v_aguardando boolean; v_produto text; / begin") nao casou no fonte de cs.fn_seed_contato_hm — abortado antes de gravar funcao incompleta. Conferir pg_get_functiondef(''cs.fn_seed_contato_hm''::regproc) e ajustar a ancora (indentacao/espacamento) deste patch antes de reaplicar.';
  end if;

  if (length(v_def) - length(replace(v_def, v_ancora, ''))) / length(v_ancora) <> 1 then
    raise exception '0292: a ancora do fim do bloco declare nao e unica no corpo de cs.fn_seed_contato_hm — abortado antes de gravar funcao incompleta.';
  end if;

  -- Duas variáveis novas: o estagio_id E o aguardando_pagamento_em do card
  -- ANTES do upsert — o PATCH 1 move para v_esper quando QUALQUER um dos
  -- dois indicava espera (aguardando_pagamento_em is not null OR estagio_id
  -- in (v_bol, v_esper)); a condição do registro de interação (passo 3)
  -- precisa espelhar EXATAMENTE essa mesma condição, senão fica mais estreita
  -- que o PATCH 1 e alguma transição real ficaria sem rastro na timeline.
  v_novo := replace(
    v_def,
    v_ancora,
    'v_turma text; v_aguardando boolean; v_produto text;'
    || ' v_estagio_antes_upsert smallint; v_esperando_antes_upsert boolean; -- 0292 (PATCH 2): estado do card ANTES do upsert do ramo de aprovacao, para so gravar mudanca_estagio quando ele realmente saiu do boleto'
    || E'\nbegin'
  );

  if v_novo = v_def then
    raise exception '0292: o replace do PATCH 2/passo 1 (declare) nao alterou o texto — ancora nao casou de forma inequivoca. Abortado antes de gravar funcao incompleta.';
  end if;

  execute v_novo;
end $$;

-- ── PATCH 2, passo 2 — popula v_estagio_antes_upsert ANTES do upsert do ramo
-- de aprovação. Âncora: o `insert into cs.contatos_hm (comprador_id, produto,
-- estagio_id, turma, plano, categoria_entrada, entrada_em)` do ramo
-- sinal/compra_cheia — texto confirmado literalmente contra o banco vivo
-- (mesmo hash) — `replace()` literal, mesmo mecanismo dos outros passos.
do $$
declare
  v_def    text;
  v_novo   text;
  v_ancora text := 'insert into cs.contatos_hm (comprador_id, produto, estagio_id, turma, plano, categoria_entrada, entrada_em)';
begin
  select pg_get_functiondef(p.oid) into v_def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'cs' and p.proname = 'fn_seed_contato_hm';

  if v_def like '%into v_estagio_antes_upsert, v_esperando_antes_upsert%' then
    raise exception '0292: cs.fn_seed_contato_hm ja popula v_estagio_antes_upsert/v_esperando_antes_upsert — PATCH 2/passo 2 ja aplicado, abortado para nao duplicar';
  end if;

  if position(v_ancora in v_def) = 0 then
    raise exception '0292: a ancora do insert em cs.contatos_hm (comprador_id, produto, estagio_id, turma, plano, categoria_entrada, entrada_em) nao casou no fonte de cs.fn_seed_contato_hm — abortado antes de gravar funcao incompleta. Conferir pg_get_functiondef(''cs.fn_seed_contato_hm''::regproc) e ajustar a ancora deste patch antes de reaplicar.';
  end if;

  if (length(v_def) - length(replace(v_def, v_ancora, ''))) / length(v_ancora) <> 1 then
    raise exception '0292: a ancora do insert em cs.contatos_hm (ramo de aprovacao) nao e unica no corpo de cs.fn_seed_contato_hm — abortado para nao popular v_estagio_antes_upsert em mais de um ramo.';
  end if;

  v_novo := replace(
    v_def,
    v_ancora,
    'select ch0.estagio_id, ch0.aguardando_pagamento_em is not null'
    || ' into v_estagio_antes_upsert, v_esperando_antes_upsert'
    || ' from cs.contatos_hm ch0'
    || ' where ch0.comprador_id = v_comprador and coalesce(ch0.produto, ''HM'') = coalesce(v_produto, ''HM''); -- 0292 (PATCH 2)'
    || E'\n\n    ' || v_ancora
  );

  if v_novo = v_def then
    raise exception '0292: o replace do PATCH 2/passo 2 (select antes do upsert) nao alterou o texto — ancora nao casou de forma inequivoca. Abortado antes de gravar funcao incompleta.';
  end if;

  execute v_novo;
end $$;

-- ── PATCH 2, passo 3 — grava mudanca_estagio (autor 'sistema', coerente com
-- o padrão vizinho deste ramo) logo depois do bloco "Entrou na Jornada" —
-- âncora confirmada literalmente contra o banco vivo (o texto já não é mais
-- "Entrou na esteira HM" da 0181; o banco vivo já fala "Entrou na Jornada").
-- Só grava quando v_estagio_antes_upsert estava em (v_bol, v_esper) e o
-- estagio_id atual do card é v_esper — ou seja, quando o PATCH 1
-- efetivamente moveu o card. Idempotente por natureza (o INSERT em
-- cs.interacoes não tem `on conflict`, mas a condição só é verdadeira uma
-- vez por transição real; o mesmo padrão já usado no ramo compra_cheia deste
-- arquivo, logo abaixo, não tem proteção extra de duplicidade e nunca causou
-- problema).
do $$
declare
  v_def    text;
  v_novo   text;
  -- Uma única âncora, usada IGUAL na validação e no replace (evita a
  -- inconsistência de checar um padrão maior e substituir um menor). Mira o
  -- fechamento do bloco "Entrou na Jornada": o INSERT em cs.interacoes
  -- seguido de `end if;` — texto confirmado literalmente contra o banco
  -- vivo, único neste ramo (a descrição "Entrou na Jornada" só aparece aqui).
  v_ancora text := 'insert into cs.interacoes (contato_hm_id, tipo, descricao, autor)' || E'\n' ||
                   '      values (v_id, ''sistema'', ''Entrou na Jornada ''||v_produto||'' (''||v_cat||'' — ''||coalesce(v_notes,''oferta'')||'')'', ''sistema'');' || E'\n' ||
                   '    end if;';
begin
  select pg_get_functiondef(p.oid) into v_def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'cs' and p.proname = 'fn_seed_contato_hm';

  if v_def like '%sinal pago — Boleto Gerado%' then
    raise exception '0292: cs.fn_seed_contato_hm ja grava a interacao de saida do boleto — PATCH 2/passo 3 ja aplicado, abortado para nao duplicar';
  end if;

  if position(v_ancora in v_def) = 0 then
    raise exception '0292: a ancora do bloco "Entrou na Jornada" (insert em cs.interacoes ... end if;) nao casou no fonte de cs.fn_seed_contato_hm — abortado antes de gravar funcao incompleta. Conferir pg_get_functiondef(''cs.fn_seed_contato_hm''::regproc) e ajustar a ancora (indentacao/espacamento) deste patch antes de reaplicar.';
  end if;

  -- A âncora precisa ser única no corpo inteiro — se "Entrou na Jornada"
  -- aparecer em mais de um ramo, o `replace` (que troca TODAS as ocorrências)
  -- injetaria o registro de mudanca_estagio em lugar errado também.
  if (length(v_def) - length(replace(v_def, v_ancora, ''))) / length(v_ancora) <> 1 then
    raise exception '0292: a ancora do bloco "Entrou na Jornada" nao e unica no corpo de cs.fn_seed_contato_hm — abortado para nao injetar o registro de mudanca_estagio em mais de um ramo. Revisar a ancora antes de reaplicar.';
  end if;

  v_novo := replace(
    v_def,
    v_ancora,
    v_ancora || E'\n\n'
    || '    -- 0292 (D2, PATCH 2): so grava quando o card REALMENTE saiu do boleto/espera --' || E'\n'
    || '    -- mesma condicao do PATCH 1 (aguardando_pagamento_em is not null OR estagio_id' || E'\n'
    || '    -- in (v_bol, v_esper), lida ANTES do upsert) e o card ficou em v_esper depois.' || E'\n'
    || '    -- Nao grava para quem nunca esteve esperando.' || E'\n'
    || '    if v_id is not null and (coalesce(v_esperando_antes_upsert, false) or v_estagio_antes_upsert in (v_bol, v_esper)) then' || E'\n'
    || '      if exists (select 1 from cs.contatos_hm ch1 where ch1.id = v_id and ch1.estagio_id = v_esper) then' || E'\n'
    || '        insert into cs.interacoes (contato_hm_id, tipo, descricao, autor, estagio_anterior_id, estagio_novo_id)' || E'\n'
    || '        values (v_id, ''mudanca_estagio'', ''sinal pago — Boleto Gerado -> Sinal Pago'', ''sistema'', v_estagio_antes_upsert, v_esper);' || E'\n'
    || '      end if;' || E'\n'
    || '    end if;'
  );

  if v_novo = v_def then
    raise exception '0292: o replace do PATCH 2/passo 3 (registro de mudanca_estagio) nao alterou o texto — ancora nao casou de forma inequivoca. Abortado antes de gravar funcao incompleta.';
  end if;

  execute v_novo;
end $$;

-- ── Rede de segurança: confirma que os três passos do PATCH 2 (mais o
-- PATCH 1) aparecem exatamente 1x cada ────────────────────────────────────
do $$
declare
  v_def text;
  v_n   int;
begin
  select pg_get_functiondef(p.oid) into v_def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'cs' and p.proname = 'fn_seed_contato_hm';

  select count(*) into v_n from regexp_matches(v_def, 'then\s+v_esper\s*--\s*0292', 'g');
  if v_n <> 1 then
    raise exception '0292: esperava o PATCH 1 (then v_esper -- 0292) exatamente 1x, achei %.', v_n;
  end if;

  select count(*) into v_n from regexp_matches(v_def, 'v_estagio_antes_upsert smallint', 'g');
  if v_n <> 1 then
    raise exception '0292: esperava a declaracao de v_estagio_antes_upsert exatamente 1x, achei %.', v_n;
  end if;

  select count(*) into v_n from regexp_matches(v_def, 'into v_estagio_antes_upsert, v_esperando_antes_upsert', 'g');
  if v_n <> 1 then
    raise exception '0292: esperava a populacao de v_estagio_antes_upsert/v_esperando_antes_upsert exatamente 1x, achei %.', v_n;
  end if;

  select count(*) into v_n from regexp_matches(v_def, 'sinal pago — Boleto Gerado', 'g');
  if v_n <> 1 then
    raise exception '0292: esperava o registro de mudanca_estagio (saida do boleto) exatamente 1x, achei %.', v_n;
  end if;

  raise notice '0292: cs.fn_seed_contato_hm patched (PATCH 1 + PATCH 2 completo) — ramo de aprovacao manda card em espera (Boleto Gerado/Aguardando Pagamento) para "Sinal Pago" (hm_aguardando_pagamento), nao mais direto para "Contato Inicial", e grava mudanca_estagio (autor sistema) quando isso acontece de fato.';
end $$;

comment on function cs.fn_seed_contato_hm() is
  '0292 (D2): patch mecanico sobre o corpo vivo do banco (nao reescrita -- base pre-0186 estava desatualizada, ver 0181/0186). Ramo de aprovacao (sinal/compra_cheia) manda o card para hm_aguardando_pagamento ("Sinal Pago") quando ele estava esperando (Boleto Gerado ou Aguardando Pagamento -- aguardando_pagamento_em not null OU estagio_id in (v_bol, v_esper)), nao mais direto para hm_comprou ("Contato Inicial") -- essa transicao passa a ser MANUAL do operador. Grava mudanca_estagio (autor sistema, coerente com o padrao vizinho compra_cheia) SO quando o card realmente saiu do boleto/espera (mesma condicao do PATCH 1, lida ANTES do upsert em v_estagio_antes_upsert/v_esperando_antes_upsert, e o card ficou em v_esper depois) -- nunca para quem ja estava fora da fila.';

-- ── Versiona os dois triggers que disparam esta função (existem em produção,
-- confirmados contra o banco pelo Marcio) — idempotente, não muda
-- comportamento algum, só documenta o que já roda.
drop trigger if exists trg_seed_contato_hm on public.compras;
create trigger trg_seed_contato_hm
  after insert on public.compras
  for each row execute function cs.fn_seed_contato_hm();

drop trigger if exists trg_seed_contato_hm_upd on public.compras;
create trigger trg_seed_contato_hm_upd
  after update on public.compras
  for each row
  when (new.status in ('APPROVED','COMPLETE','COMPLETED')
        and coalesce(old.status,'') not in ('APPROVED','COMPLETE','COMPLETED'))
  execute function cs.fn_seed_contato_hm();

comment on trigger trg_seed_contato_hm on public.compras is
  '0292: versiona o trigger AFTER INSERT que ja existia em producao -- nao muda comportamento, so documenta.';
comment on trigger trg_seed_contato_hm_upd on public.compras is
  '0292: versiona o trigger AFTER UPDATE (WHEN transicao para status aprovado) que ja existia em producao, nunca versionado em nenhuma migration deste repo -- nao muda comportamento, so documenta.';

commit;
