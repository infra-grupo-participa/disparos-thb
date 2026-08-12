-- 0212 — o card do HM passa a AUTOGRAVAR o histórico por aba (0211) em três
-- momentos: na venda nova (carimbo), na transição entre abas (trânsito) e
-- CONGELA a autoria do comercial depois de gravada.
--
-- ── (a) CARIMBO NA VENDA NOVA ────────────────────────────────────────────────
-- `cs.fn_hm_carimba_equipe_padrao` (0146, estendida em 0161 para o caso da
-- Kelly) já grava `responsavel_id = v_resp` na venda nova sem dono explícito.
-- Ela nasce diretamente na aba COMERCIAL (todo estágio inicial do board é
-- comercial) — então o dono que ela recebe aqui É o dono do comercial. Grava
-- `responsavel_comercial_id` no MESMO update, para o histórico (0211) já
-- nascer preenchido em vez de depender do primeiro trânsito de aba.
--
-- ── (b) TRÂNSITO ENTRE ABAS ──────────────────────────────────────────────────
-- `cs.fn_hm_dono_por_aba`, BEFORE UPDATE OF estagio_id: quando o card ENTRA
-- numa aba pela primeira vez (aba nova ≠ aba antiga), carimba
-- responsavel_{aba}_id com o dono VIGENTE (responsavel_id) — mas só se ainda
-- estiver vazio (`coalesce`). Isso é o que faz o histórico sobreviver a
-- comercial→ativação→comercial: a segunda passagem pelo comercial NÃO
-- reescreve a autoria original da primeira.
-- BEFORE (não AFTER): resolve dentro do mesmo UPDATE que move o card, sem
-- escrita extra — AFTER exigiria um segundo `update` e reabriria a fresta que
-- 0211 evitou (dois UPDATEs = duas oportunidades de o snapshot do undo pegar
-- estado inconsistente).
--
-- Auto-marcação de acessos do aluno antigo (0213) mora NESTA MESMA trigger —
-- ver a migration seguinte — para não ter uma segunda passagem BEFORE UPDATE
-- só para isso.
--
-- ── (c) CONGELAMENTO DO COMERCIAL ────────────────────────────────────────────
-- Decisão do Marcio: uma vez gravado, `responsavel_comercial_id` é IMUTÁVEL —
-- nem o master edita. É quem vendeu; reescrever isso é reescrever histórico.
-- Implementado como trigger BEFORE UPDATE que RECUSA a transação (raise
-- exception) se o valor antigo não era nulo e o novo é diferente. Não existe
-- exceção de papel: se um dia o master precisar corrigir um carimbo errado, é
-- migration pontual (UPDATE direto no banco, fora do caminho da aplicação),
-- não um `if not master then allow`.
--
-- ── ORDEM DAS TRIGGERS: por que os nomes começam com a/b ────────────────────
-- Postgres dispara triggers do MESMO evento (BEFORE UPDATE) em ordem
-- ALFABÉTICA pelo nome do trigger — não pela ordem de CREATE. `trg_hm_a_...`
-- roda antes de `trg_hm_b_...` de propósito: (b) só ESCREVE quando a coluna
-- está NULL (coalesce), e é exatamente essa escrita-quando-nulo que (c)
-- permite (OLD ainda é null no momento em que (b) decide, porque (b) roda
-- primeiro dentro do mesmo BEFORE). Se a ordem invertesse, o congelamento
-- ainda funcionaria igual (a condição de (c) é sobre OLD, que não muda), mas
-- o nome deixa a dependência explícita para quem ler depois.
--
-- ── fn_hm_undo_colunas: as duas colunas ficam DE FORA de propósito ──────────
-- Conferido na definição VIGENTE (0140:220-236, que é a mais recente que
-- redefine a função — 0095 é o rascunho original, superado). A lista de lá
-- NÃO inclui responsavel_comercial_id nem responsavel_ativacao_id. Continua
-- assim: se entrassem, o "Desfazer última edição" (fn_hm_undo_aplicar, 0095)
-- poderia tentar reescrever responsavel_comercial_id para um valor antigo
-- diferente do atual, e o trigger (c) barraria a transação inteira com
-- exceção — o undo de QUALQUER campo (turma, observação, tag) quebraria só
-- porque essas duas colunas de histórico vieram junto no snapshot. Como já
-- estão fora da lista, o undo nunca toca nelas e o congelamento nunca
-- interfere no "desfazer edição". Nenhuma alteração necessária nesta
-- migration — documentado aqui para a checagem ficar rastreável.
-- Idempotente.

-- (a) ────────────────────────────────────────────────────────────────────────
create or replace function cs.fn_hm_carimba_equipe_padrao()
returns trigger language plpgsql
set search_path to 'cs','public','pg_temp'
as $function$
declare
  v_equipe uuid;
  v_resp   uuid;
begin
  if new.equipe_padrao_id is not null or new.responsavel_id is not null then
    return new;  -- já nasceu com equipe/dono explícito: respeita
  end if;

  select equipe_padrao_id, responsavel_padrao_id
    into v_equipe, v_resp
    from cs.hm_config where id = 1;

  if v_equipe is not null then
    update cs.contatos_hm set equipe_padrao_id = v_equipe where id = new.id;
  end if;

  -- Responsável padrão só nos boards com operação definida (0161).
  if v_resp is not null and coalesce(new.produto, 'HM') in ('HM','AURUM') then
    update cs.contatos_hm
       set responsavel_id = v_resp,
           -- 0212: o card nasce na aba comercial — o dono padrão que ele
           -- recebe aqui É o dono do comercial. Grava no MESMO update para
           -- não depender do trânsito de aba (b) preencher depois.
           responsavel_comercial_id = v_resp,
           atualizado_em  = now()
     where id = new.id;

    insert into cs.interacoes (contato_hm_id, tipo, descricao, autor)
    values (new.id, 'sistema',
            'Venda nova atribuída automaticamente ao responsável padrão (0161) — a distribuição para o operador é feita por quem gerencia',
            'sistema');
  end if;

  return new;
end$function$;

comment on function cs.fn_hm_carimba_equipe_padrao() is
  '0212: além de responsavel_id, grava responsavel_comercial_id no mesmo update (a venda nova nasce no comercial). Base: 0161.';

-- (b) + (c) auto-acessos de aluno antigo (0213) entram nesta MESMA função ────
-- ver 0213_auto_acessos_aluno_antigo.sql, que faz CREATE OR REPLACE desta
-- função acrescentando o bloco de auto-marcação — não recriada aqui para não
-- duplicar a definição em duas migrations.
create or replace function cs.fn_hm_dono_por_aba()
returns trigger language plpgsql
set search_path to 'cs','public','pg_temp'
as $function$
declare
  v_aba_nova  text;
  v_aba_antiga text;
begin
  select aba into v_aba_nova from cs.estagios where id = new.estagio_id;
  select aba into v_aba_antiga from cs.estagios where id = old.estagio_id;

  if v_aba_nova = 'ativacao' and v_aba_antiga is distinct from 'ativacao' then
    new.responsavel_ativacao_id := coalesce(new.responsavel_ativacao_id, new.responsavel_id);
  end if;

  if v_aba_nova = 'comercial' and v_aba_antiga is distinct from 'comercial' then
    new.responsavel_comercial_id := coalesce(new.responsavel_comercial_id, new.responsavel_id);
  end if;

  return new;
end$function$;

comment on function cs.fn_hm_dono_por_aba() is
  '0212: ao ENTRAR numa aba (aba nova <> aba antiga), carimba responsavel_{aba}_id com o dono vigente, só se ainda vazio (coalesce) — histórico (0211) sobrevive a comercial->ativacao->comercial sem sobrescrever a autoria original. BEFORE, resolve no mesmo UPDATE. 0213 acrescenta a auto-marcação de acessos do aluno antigo nesta mesma trigger.';

drop trigger if exists trg_hm_a_dono_por_aba on cs.contatos_hm;
create trigger trg_hm_a_dono_por_aba
  before update of estagio_id on cs.contatos_hm
  for each row execute function cs.fn_hm_dono_por_aba();

-- (c) ────────────────────────────────────────────────────────────────────────
create or replace function cs.fn_hm_congela_comercial()
returns trigger language plpgsql
set search_path to 'cs','public','pg_temp'
as $function$
begin
  if old.responsavel_comercial_id is not null
     and new.responsavel_comercial_id is distinct from old.responsavel_comercial_id then
    raise exception 'responsavel_comercial_id é histórico imutável (card %): quem vendeu não se reescreve. Correção é migration pontual, fora do caminho da aplicação.', old.id
      using errcode = 'restrict_violation';
  end if;
  return new;
end$function$;

comment on function cs.fn_hm_congela_comercial() is
  '0212: responsavel_comercial_id, uma vez gravado, é IMUTAVEL (decisão do Marcio) — nem o master edita pela aplicação. BEFORE UPDATE, roda DEPOIS de trg_hm_a_dono_por_aba (ordem alfabética b > a) para permitir a escrita quando ainda está NULL.';

drop trigger if exists trg_hm_b_congela_comercial on cs.contatos_hm;
create trigger trg_hm_b_congela_comercial
  before update on cs.contatos_hm
  for each row execute function cs.fn_hm_congela_comercial();

-- ── Conferência ──────────────────────────────────────────────────────────────
do $$
declare
  v_undo_colunas text[];
begin
  select cs.fn_hm_undo_colunas() into v_undo_colunas;
  if 'responsavel_comercial_id' = any(v_undo_colunas) or 'responsavel_ativacao_id' = any(v_undo_colunas) then
    raise exception '0212: fn_hm_undo_colunas() passou a incluir coluna de histórico imutável — o undo vai colidir com o congelamento (c). Remova a coluna da lista antes de prosseguir.';
  end if;

  raise notice '0212: fn_hm_carimba_equipe_padrao, fn_hm_dono_por_aba e fn_hm_congela_comercial aplicadas. fn_hm_undo_colunas() segue sem as colunas de histórico.';
end $$;
