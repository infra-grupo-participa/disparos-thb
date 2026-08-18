-- 0298_aluno_antigo_e_renovacao_ja_entram_com_acesso
--
-- APLICADA EM PRODUÇÃO EM 18/08/2026. Este arquivo é o registro do que roda —
-- escrito a partir do que foi efetivamente executado, não o contrário.
--
-- ── A regra ──────────────────────────────────────────────────────────────────
-- Quem JÁ ERA ALUNO ou está RENOVANDO entra na Ativação com os acessos que já
-- possui marcados: Searchie, comunidade e grupo de informes. A empresa não
-- precisa liberar de novo o que a pessoa já tem — e deixar desmarcado faz o
-- time trabalhar duas vezes no mesmo acesso.
--
-- ── Por que reescrita completa (e não patch mecânico) ───────────────────────
-- A regra de ouro deste repo é partir do corpo vivo. Aqui isso foi feito: a
-- função tem 1.313 bytes e foi lida INTEIRA de pg_get_functiondef antes de
-- aplicar (md5 af3a4643213f5087d93972a762b27f32). Reescrever é seguro quando
-- se leu tudo; o perigo é reescrever a partir de um arquivo antigo do repo,
-- que foi o que causou incidente aqui antes (0181/0186).
--
-- ── O critério de renovação NÃO foi inventado ───────────────────────────────
-- É o mesmo do LATERAL `rn` de cs.contatos_hm_kanban:
--     JOIN LATERAL (SELECT p.oferta_codigo FROM cs.hm_pagamentos p
--                     JOIN hm_product_catalog cat ON cat.offer_code = p.oferta_codigo
--                    WHERE p.comprador_id = ch.comprador_id
--                      AND cat.papel = 'renovacao'
--                      AND cs.fn_hm_pagamento_do_produto(p.oferta_codigo, ch.produto)
--                    ORDER BY p.pago_em DESC ... LIMIT 1) rn
--     ... rn.oferta_codigo IS NOT NULL AS renovacao
-- traduzido para `exists` sobre new.*. Uma definição só de "é renovação" no
-- sistema inteiro — duas definições divergentes é o defeito que esta squad
-- reprova.
--
-- Antes desta migration a auto-marcação só olhava as tags Aluno THB/Aurum, e
-- por isso 4 fichas de renovação sem tag de aluno ficavam de fora.
--
-- ⚠️ ativ_gps fica de FORA de propósito: é o único item que sobra para o
-- operador fazer (decisão do Marcio, 18/08). Auto-marcá-lo seria o sistema
-- afirmar que alguém liberou um acesso que ninguém liberou.

create or replace function cs.fn_hm_dono_por_aba()
 returns trigger
 language plpgsql
 set search_path to 'cs', 'public', 'pg_temp'
as $function$
declare
  v_aba_nova    text;
  v_aba_antiga  text;
  v_e_antigo    boolean;
  v_e_renovacao boolean;
begin
  select aba into v_aba_nova from cs.estagios where id = new.estagio_id;
  select aba into v_aba_antiga from cs.estagios where id = old.estagio_id;

  if v_aba_nova = 'ativacao' and v_aba_antiga is distinct from 'ativacao' then
    new.responsavel_ativacao_id := coalesce(new.responsavel_ativacao_id, new.responsavel_id);

    v_e_antigo := new.tags && array['Aluno THB','Aluno Aurum'];

    -- 0298: mesmo criterio do LATERAL rn de cs.contatos_hm_kanban.
    v_e_renovacao := exists (
      select 1
        from cs.hm_pagamentos p
        join public.hm_product_catalog cat on cat.offer_code = p.oferta_codigo
       where p.comprador_id = new.comprador_id
         and cat.papel = 'renovacao'
         and cs.fn_hm_pagamento_do_produto(p.oferta_codigo, new.produto)
    );

    -- A guarda dos tres em `false` e deliberada: nunca DESMARCA o que ja foi
    -- marcado a mao. Se um operador ja conferiu um dos acessos, o sistema nao
    -- passa por cima do trabalho dele.
    if (v_e_antigo or v_e_renovacao)
       and coalesce(new.ativ_searchie, false) = false
       and coalesce(new.ativ_comunidade, false) = false
       and coalesce(new.ativ_grupo, false) = false
    then
      new.ativ_searchie   := true;
      new.ativ_comunidade := true;
      new.ativ_grupo      := true;

      insert into cs.interacoes (contato_hm_id, tipo, descricao, autor)
      values (new.id, 'sistema',
              case when v_e_renovacao and not v_e_antigo
                   then 'Renovacao — acessos Searchie/comunidade/grupo marcados automaticamente (ja era aluno). Falta o GPS.'
                   else 'Aluno antigo — acessos Searchie/comunidade/grupo marcados automaticamente. Falta o GPS.'
              end,
              'sistema');
    end if;
  end if;

  if v_aba_nova = 'comercial' and v_aba_antiga is distinct from 'comercial' then
    new.responsavel_comercial_id := coalesce(new.responsavel_comercial_id, new.responsavel_id);
  end if;

  return new;
end$function$;

comment on function cs.fn_hm_dono_por_aba() is
  '0212/0213 + 0298: carimba o dono da aba na entrada e, para quem JA ERA ALUNO (tag Aluno THB/Aurum) ou esta RENOVANDO (pagamento em oferta papel=renovacao, mesmo criterio da view contatos_hm_kanban), marca Searchie/comunidade/grupo — acessos que a pessoa comprovadamente ja tem. NAO marca ativ_gps: e o unico item que fica pendente, sempre por gesto humano (0297).';

-- ── Rede de segurança ───────────────────────────────────────────────────────
-- A função sem o trigger que a aciona é código morto silencioso.
do $$
declare v_n int;
begin
  select count(*) into v_n from pg_trigger
   where tgname = 'trg_hm_a_dono_por_aba' and tgrelid = 'cs.contatos_hm'::regclass and not tgisinternal;
  if v_n <> 1 then
    raise exception '0298: trg_hm_a_dono_por_aba nao encontrada — a funcao existe sem o trigger que a aciona. Abortado.';
  end if;
  raise notice '0298: fn_hm_dono_por_aba estendida com renovacao. ativ_gps preservado fora do escopo.';
end $$;

-- ── Verificação (rodar à mão) ───────────────────────────────────────────────
-- Quem entrar na Ativação daqui pra frente sendo aluno antigo OU renovação
-- deve nascer com os 3 marcados e o GPS pendente:
--
-- select ch.ativ_searchie, ch.ativ_comunidade, ch.ativ_grupo, ch.ativ_gps
--   from cs.contatos_hm ch join cs.estagios e on e.id = ch.estagio_id
--  where e.aba = 'ativacao' and ch.tags && array['Aluno THB','Aluno Aurum']
--  order by ch.atualizado_em desc limit 5;
