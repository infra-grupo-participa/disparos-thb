-- =====================================================================
-- 0291_o_banco_tambem_recusa_o_gesto
--
-- D1/D3 (decisão do Marcio) — defesa em profundidade: a trava de aplicação
-- (0290/B2, moverEstagioHm) é a que decide "quem pode" e monta a mensagem
-- para o operador. Esta migration é o CINTO DE SEGURANÇA no banco: se algum
-- caminho novo esquecer de checar `origem_movimento` em TS (SQL editor, um
-- script futuro, um bug de regressão), a coluna continua protegida.
--
-- ── A PERGUNTA QUE TRAVOU ESTA MIGRATION ─────────────────────────────────────
-- A aplicação inteira conecta como a MESMA role, `disparos_app` (lib/db.ts) —
-- não existe distinção de usuário do Postgres entre master e operador; quem
-- distingue é a SESSÃO da aplicação (papel/equipe na tabela cs.usuarios),
-- nunca o `current_user` da conexão. Uma trigger que recusa incondicionalmente
-- `current_user = 'disparos_app'` bloquearia o MASTER também — e D3 é
-- explícito: "Master PODE forçar o movimento".
--
-- `set local` (variável de sessão) foi DESCARTADO: o pool do app usa o
-- Supavisor em TRANSACTION MODE (lib/db.ts) — cada chamada de `query()` pode
-- pegar uma conexão física diferente do pool, então uma flag setada numa
-- chamada não sobrevive até a próxima. Só funcionaria dentro de
-- `withTransaction` (mesmo client do BEGIN ao COMMIT), e envolver
-- `moverEstagioHm` inteiro numa transação é refatoração grande demais (a
-- função tem ~10 pontos de `query()`/`queryOne()` soltos, cada um podendo
-- pegar conexão diferente) para o escopo desta entrega.
--
-- ── A ESCOLHA (documentada aqui, como o plano pediu) ─────────────────────────
-- O furo do master NÃO é uma exceção de papel dentro do trigger (o trigger
-- não sabe, e não pode saber, se quem chamou é master) — é uma FUNÇÃO
-- SECURITY DEFINER dedicada, dona `postgres`, que faz *só* o UPDATE de
-- estagio_id (nenhuma regra de negócio nova: checklist/saldo/timeline
-- continuam em lib/services/hm.ts, como já eram). `SECURITY DEFINER` roda com
-- o privilégio do DONO — dentro do corpo da função (e dentro do trigger que
-- ela dispara), `current_user` passa a ser `postgres`, não `disparos_app`
-- (mesmo mecanismo já documentado e comprovado na 0199 para
-- cs.fn_hm_produto_da_oferta, e o motivo de cs.fn_seed_contato_hm/RPCs de
-- cancelamento — ambos SECURITY DEFINER dono postgres — passarem por
-- construção, sem precisar de exceção nenhuma no trigger).
--
-- `moverEstagioHm` (B2) chama esta função em vez do `UPDATE ... SET
-- estagio_id = ...` cru SOMENTE quando (a) `souMaster` é true E (b) a coluna
-- de origem ou destino está travada — nos demais casos o UPDATE direto
-- continua, e o trigger abaixo o deixa passar normalmente (não é coluna
-- travada) ou recusa (operador tentando).
--
-- ── POR QUE NÃO É UMA TRAVA "TIPO 0212" (fn_hm_congela_comercial) ───────────
-- A 0212 é dura de propósito — nem o master reescreve
-- responsavel_comercial_id pela aplicação (correção ali é migration pontual).
-- Esta é diferente porque D3, para ESTE pedido, é explícito: o master PODE
-- mover. A dureza da 0212 seria a escolha errada aqui — implementaria o
-- pedido oposto ao que o Marcio decidiu.
--
-- Aditiva e idempotente (create or replace function + drop/create trigger).
-- =====================================================================

begin;

-- Função dedicada — o ÚNICO caminho legítimo para escrever estagio_id numa
-- coluna travada vindo da conexão disparos_app. SECURITY DEFINER (dono
-- postgres): dentro dela current_user deixa de ser disparos_app, então o
-- trigger de baixo (que só olha current_user) deixa passar.
create or replace function cs.fn_hm_forcar_estagio_master(p_contato_hm_id uuid, p_estagio_id smallint)
returns boolean
language plpgsql
security definer
set search_path to 'cs', 'public', 'pg_temp'
as $fn$
begin
  update cs.contatos_hm
     set estagio_id = p_estagio_id, atualizado_em = now()
   where id = p_contato_hm_id;
  return found;
end$fn$;

comment on function cs.fn_hm_forcar_estagio_master(uuid, smallint) is
  '0291 (D1/D3): único caminho para o MASTER escrever estagio_id numa coluna travada (origem_movimento hotmart/derivada) — SECURITY DEFINER dono postgres, current_user deixa de ser disparos_app dentro dela, e o trigger trg_hm_c_trava_coluna_hotmart deixa passar. Chamada por lib/services/hm.ts::moverEstagioHm SÓ quando souMaster=true e a coluna de origem/destino está travada; nos demais casos o UPDATE direto segue igual. Não decide regra de negócio (checklist/saldo/timeline) — isso continua em TS, como sempre foi.';

grant execute on function cs.fn_hm_forcar_estagio_master(uuid, smallint) to disparos_app;

-- Trigger — cinto de segurança. Só olha origem_movimento (0290) das duas
-- pontas (OLD e NEW) e o current_user da conexão que fez o UPDATE.
create or replace function cs.fn_hm_trava_coluna_hotmart()
returns trigger
language plpgsql
set search_path to 'cs', 'public', 'pg_temp'
as $fn$
declare
  v_origem_antiga cs.estagios.origem_movimento%type;
  v_origem_nova   cs.estagios.origem_movimento%type;
begin
  -- Só a conexão nua do app (disparos_app) é checada. Uma função SECURITY
  -- DEFINER dona postgres (fn_hm_forcar_estagio_master, o trigger legítimo
  -- cs.fn_seed_contato_hm, os RPCs de cancelamento) roda com current_user =
  -- postgres dentro do seu próprio corpo — passa por construção, sem
  -- exceção explícita aqui.
  if current_user <> 'disparos_app' then
    return new;
  end if;

  if new.estagio_id is not distinct from old.estagio_id then
    return new;
  end if;

  select origem_movimento into v_origem_antiga from cs.estagios where id = old.estagio_id;
  select origem_movimento into v_origem_nova   from cs.estagios where id = new.estagio_id;

  if coalesce(v_origem_nova, 'operador') in ('hotmart', 'derivada') then
    raise exception 'coluna_da_hotmart: esta etapa e preenchida pela Hotmart (ou e espelho de outra etapa) e nao aceita movimento manual. So o master move.'
      using errcode = 'restrict_violation';
  end if;

  if coalesce(v_origem_antiga, 'operador') in ('hotmart', 'derivada') then
    raise exception 'coluna_da_hotmart: o card esta numa etapa que e fato da Hotmart (ou espelho de outra etapa) e nao pode sair por gesto manual. So o master move.'
      using errcode = 'restrict_violation';
  end if;

  return new;
end$fn$;

comment on function cs.fn_hm_trava_coluna_hotmart() is
  '0291 (D1): cinto de seguranca no banco para a trava de aplicacao (0290/B2). Recusa UPDATE de estagio_id de/para coluna origem_movimento hotmart|derivada QUANDO current_user=disparos_app (a role unica que a aplicacao usa, master e operador). O furo do master NAO é excecao aqui dentro — é cs.fn_hm_forcar_estagio_master (SECURITY DEFINER dono postgres), que muda current_user para postgres e passa por construcao. Defesa-em-profundidade: a decisao de QUEM pode continua 100% em lib/services/hm.ts.';

drop trigger if exists trg_hm_c_trava_coluna_hotmart on cs.contatos_hm;
create trigger trg_hm_c_trava_coluna_hotmart
  before update of estagio_id on cs.contatos_hm
  for each row execute function cs.fn_hm_trava_coluna_hotmart();

-- ── Conferência ──────────────────────────────────────────────────────────────
-- Roda DEPOIS de trg_hm_a_dono_por_aba (0212) e trg_hm_b_congela_comercial
-- (0212) na ordem alfabética (a < b < c) — não interfere em nenhuma das duas:
-- (a) só ESCREVE responsavel_{aba}_id quando NULL, (b) só olha
-- responsavel_comercial_id. Esta trigger (c) só olha estagio_id/origem_movimento
-- e RECUSA (não reescreve NEW), então a ordem entre elas não muda o resultado.
do $$
begin
  raise notice '0291: cs.fn_hm_trava_coluna_hotmart + cs.fn_hm_forcar_estagio_master aplicadas. Trigger trg_hm_c_trava_coluna_hotmart criada em cs.contatos_hm (before update of estagio_id).';
end $$;

commit;
