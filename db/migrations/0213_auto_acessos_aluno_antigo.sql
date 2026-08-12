-- 0213 — aluno antigo que reentra pela Ativação já teve os 3 acessos
-- operacionais (Searchie, comunidade, grupo) alguma vez; marcar os 3 sozinho
-- poupa o operador de reconferir o óbvio. `ativ_pesquisa` FICA DE FORA de
-- propósito: é o item que guarda o gate de `hm_ativacao_realizada`
-- (lib/services/hm.ts:91-96,213-216) — auto-marcar ele também destravaria a
-- saída da coluna sem ninguém ter, de fato, aplicado a pesquisa.
--
-- ── ONDE: dentro de `cs.fn_hm_dono_por_aba` (0212), não uma trigger nova ────
-- A mesma condição de entrada ("aba nova = ativacao, aba antiga <> ativacao")
-- já existe ali para o carimbo do responsável. Uma segunda trigger BEFORE
-- UPDATE OF estagio_id repetiria a mesma leitura de aba e adicionaria uma
-- segunda passagem sobre `new` — sem necessidade, e mais uma trigger para
-- lembrar de nomear na ordem certa.
--
-- ── A CONDIÇÃO: só se os 3 campos estiverem TODOS false ──────────────────────
-- Protege o card que VOLTA do comercial já com acesso parcial concedido por um
-- humano (ex.: Searchie liberado manualmente antes de reentrar na Ativação) —
-- se qualquer um dos três já é true, a auto-marcação não mexe em nada; quem
-- fez a marcação parcial decide o resto. Só dispara no caso "zero feito".
--
-- ── TAGS: espelha TAGS_ALUNO_ANTIGO (lib/papeis.ts) ──────────────────────────
-- 'Aluno THB' e 'Aluno Aurum' — os dois públicos que já passaram por uma
-- ativação anterior. Lista literal aqui porque SQL não importa TS; se um dia
-- mudar, muda nos dois lados (o comentário existe para quem mexer num achar o
-- outro).
--
-- ── ZERO retroatividade ───────────────────────────────────────────────────────
-- Só passa a valer para TRANSIÇÕES futuras (o UPDATE que muda estagio_id).
-- Os 98 cards já hoje na Ativação não são tocados — nenhum UPDATE em massa
-- nesta migration, de propósito (decisão do Marcio).
--
-- Registra em cs.interacoes (tipo 'sistema', autor 'sistema') para o operador
-- não estranhar 3 checks marcados que ele não mexeu.
-- Idempotente (CREATE OR REPLACE function).

create or replace function cs.fn_hm_dono_por_aba()
returns trigger language plpgsql
set search_path to 'cs','public','pg_temp'
as $function$
declare
  v_aba_nova   text;
  v_aba_antiga text;
begin
  select aba into v_aba_nova from cs.estagios where id = new.estagio_id;
  select aba into v_aba_antiga from cs.estagios where id = old.estagio_id;

  if v_aba_nova = 'ativacao' and v_aba_antiga is distinct from 'ativacao' then
    new.responsavel_ativacao_id := coalesce(new.responsavel_ativacao_id, new.responsavel_id);

    -- 0213: aluno antigo (THB/Aurum) que entra na Ativação com os 3 acessos
    -- ainda zerados ganha a marcação automática — ver comentário acima.
    if new.tags && array['Aluno THB','Aluno Aurum']
       and coalesce(new.ativ_searchie, false) = false
       and coalesce(new.ativ_comunidade, false) = false
       and coalesce(new.ativ_grupo, false) = false
    then
      new.ativ_searchie  := true;
      new.ativ_comunidade := true;
      new.ativ_grupo      := true;

      insert into cs.interacoes (contato_hm_id, tipo, descricao, autor)
      values (new.id, 'sistema',
              'Aluno antigo — acessos Searchie/comunidade/grupo marcados automaticamente',
              'sistema');
    end if;
  end if;

  if v_aba_nova = 'comercial' and v_aba_antiga is distinct from 'comercial' then
    new.responsavel_comercial_id := coalesce(new.responsavel_comercial_id, new.responsavel_id);
  end if;

  return new;
end$function$;

comment on function cs.fn_hm_dono_por_aba() is
  '0212+0213: ao ENTRAR numa aba, carimba responsavel_{aba}_id (se vazio) e, na entrada em ativacao com tag de aluno antigo (THB/Aurum) e os 3 acessos ainda zerados, auto-marca ativ_searchie/comunidade/grupo (NUNCA ativ_pesquisa, que guarda o gate de hm_ativacao_realizada). Tags espelham TAGS_ALUNO_ANTIGO em lib/papeis.ts. Zero retroatividade — só transições futuras.';

-- ── Conferência ──────────────────────────────────────────────────────────────
do $$
declare
  v_trigger_existe int;
begin
  select count(*) into v_trigger_existe
    from pg_trigger
   where tgname = 'trg_hm_a_dono_por_aba' and tgrelid = 'cs.contatos_hm'::regclass and not tgisinternal;
  if v_trigger_existe <> 1 then
    raise exception '0213: trg_hm_a_dono_por_aba (0212) não encontrada — a função foi substituída sem o trigger que a aciona.';
  end if;

  raise notice '0213: fn_hm_dono_por_aba estendida com auto-acessos de aluno antigo (ativ_pesquisa preservado fora do escopo). Zero UPDATE retroativo.';
end $$;
