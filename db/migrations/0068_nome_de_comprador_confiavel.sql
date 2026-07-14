-- =====================================================================
-- 0068_nome_de_comprador_confiavel
-- O nome do comprador é um fato — não o que sobrou do campo do checkout.
--
-- A Hotmart manda no webhook o que foi DIGITADO no checkout (buyer.name).
-- Quando a compra nasce de automação/GPT, esse campo às vezes chega com o
-- telefone ("+55 (86) 99834-3773") ou com o próprio e-mail. O nome de verdade
-- existe — é o da CONTA Hotmart, que aparece em "Detalhes do comprador" — mas
-- não vem no payload. Resultado: comprador, card do kanban e aviso do Slack
-- todos rotulados com um telefone.
--
-- Três defesas, em camadas, valendo para QUALQUER caminho de escrita (webhook,
-- import de planilha, Make, mão):
--
--   1. fn_nome_suspeito(): o juiz. Nome vazio, "Sem nome", com e-mail dentro,
--      com 8+ dígitos (telefone/CPF) ou sem letra nenhuma → não é nome.
--   2. Trigger em public.compradores: nome suspeito NUNCA sobrescreve um nome
--      bom já gravado, e no insert tenta primeiro achar o nome real na base de
--      alunos (por e-mail, depois pelos 8 últimos dígitos do telefone).
--   3. Trigger em cs.contatos_hm: card que nasce com nome ainda suspeito sobe
--      com `revisar` ligado — o operador vê e corrige, em vez de descobrir na
--      hora da ligação.
--
-- A defesa 1 não INVENTA nome: se não há de onde tirar, o telefone continua
-- ali (é o único dado real que temos) e o card fica marcado. Quem busca o nome
-- verdadeiro na Hotmart é a Edge Function hotmart-events-webhook, que consulta
-- a API de vendas antes de persistir.
--
-- Aditiva e idempotente.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1) O juiz: isto parece um nome de gente?
-- ---------------------------------------------------------------------
create or replace function public.fn_nome_suspeito(p_nome text)
returns boolean
language sql
immutable
as $$
  select
    p_nome is null
    or btrim(p_nome) = ''
    or lower(btrim(p_nome)) = 'sem nome'
    or p_nome like '%@%'                                        -- e-mail no campo nome
    or length(regexp_replace(p_nome, '\D', '', 'g')) >= 8       -- telefone / CPF
    or p_nome !~ '[[:alpha:]]';                                 -- nenhuma letra
$$;

comment on function public.fn_nome_suspeito(text) is
  'True quando o texto não pode ser um nome de pessoa (vazio, e-mail, telefone, só símbolos).';

-- ---------------------------------------------------------------------
-- 2) O nome real, se existir em casa; senão, preserva o que já era bom.
-- ---------------------------------------------------------------------
create or replace function public.trg_comprador_nome_confiavel()
returns trigger
language plpgsql
as $$
declare
  v_nome_base text;
  v_sufixo    text;
begin
  if not public.fn_nome_suspeito(new.nome) then
    return new;
  end if;

  -- Nome bom já gravado não é degradado por uma compra nova com nome sujo.
  if tg_op = 'UPDATE' and not public.fn_nome_suspeito(old.nome) then
    new.nome := old.nome;
    return new;
  end if;

  -- Aluno da base: o nome já é conhecido. Casa por e-mail…
  if new.email is not null then
    select a.nome into v_nome_base
      from public.thb_alunos a
     where lower(a.email) = lower(new.email)
       and not public.fn_nome_suspeito(a.nome)
     limit 1;
  end if;

  -- …e, se não bateu, pelos 8 últimos dígitos do telefone (formatos variam:
  -- +55DDD…, 55DDD…, DDD…).
  if v_nome_base is null and new.telefone is not null then
    v_sufixo := right(regexp_replace(new.telefone, '\D', '', 'g'), 8);
    if length(v_sufixo) = 8 then
      select a.nome into v_nome_base
        from public.thb_alunos a
       where right(regexp_replace(coalesce(a.telefone, ''), '\D', '', 'g'), 8) = v_sufixo
         and not public.fn_nome_suspeito(a.nome)
       limit 1;
    end if;
  end if;

  if v_nome_base is not null then
    new.nome := v_nome_base;
  end if;

  -- Não achou em lugar nenhum: mantém o que veio (telefone é melhor que nada)
  -- e o card sobe marcado para revisão pela trigger abaixo.
  return new;
end;
$$;

drop trigger if exists trg_comprador_nome_confiavel on public.compradores;
create trigger trg_comprador_nome_confiavel
  before insert or update of nome on public.compradores
  for each row execute function public.trg_comprador_nome_confiavel();

-- ---------------------------------------------------------------------
-- 3) Card que nasce sem nome de gente nasce marcado.
-- ---------------------------------------------------------------------
create or replace function cs.trg_hm_revisar_nome_invalido()
returns trigger
language plpgsql
as $$
declare
  v_nome text;
begin
  select co.nome into v_nome
    from public.compradores co
   where co.id = new.comprador_id;

  if public.fn_nome_suspeito(v_nome) then
    new.revisar        := true;
    new.revisar_motivo := coalesce(
      nullif(new.revisar_motivo, ''),
      'Nome inválido na origem (checkout) — confirmar o nome do comprador'
    );
  end if;

  return new;
end;
$$;

drop trigger if exists trg_hm_revisar_nome_invalido on cs.contatos_hm;
create trigger trg_hm_revisar_nome_invalido
  before insert on cs.contatos_hm
  for each row execute function cs.trg_hm_revisar_nome_invalido();

-- ---------------------------------------------------------------------
-- 4) O caso que motivou a migration: Jenisvaldo entrou como o próprio
--    telefone (compra HP2042608956, Sinal R$300 do HM, 13/07/2026). O nome
--    abaixo é o da conta Hotmart dele — dado real, conferido no painel.
--    Idempotente: só escreve se o que está lá ainda for o telefone.
-- ---------------------------------------------------------------------
update public.compradores
   set nome = 'Jenisvaldo Oliveira Rocha',
       atualizado_em = now()
 where email = 'jenisrocha@gmail.com'
   and public.fn_nome_suspeito(nome);
