-- 0299_os_antigos_ja_tinham_esse_acesso
--
-- APLICADA EM PRODUÇÃO EM 18/08/2026. Registro do que rodou.
--
-- Quem JÁ ESTÁ na Ativação e já era aluno (ou está renovando) entrou antes da
-- regra da 0298 existir — e por isso aparece com pendência de acesso que na
-- verdade já tem. Cada uma dessas fichas é trabalho fantasma na fila de quem
-- opera a ativação.
--
-- Medido antes de aplicar: **65 fichas** — 61 por tag de aluno + **4 que só
-- entram pelo critério de renovação**. Esses 4 são exatamente o buraco que o
-- pedido do Marcio aponta: renovação não estava coberta pela regra antiga.
--
-- NÃO toca `ativ_gps` (o item que sobra, sempre humano — 0297) nem
-- `ativ_pesquisa` (a pesquisa é resposta da pessoa, não acesso que a empresa
-- concede: marcar seria afirmar que alguém respondeu).

do $$
declare
  v_alvo record;
  v_n int := 0;
begin
  for v_alvo in
    select ch.id, ch.comprador_id,
           (ch.tags && array['Aluno THB','Aluno Aurum']) as e_antigo,
           exists (
             select 1 from cs.hm_pagamentos p
               join public.hm_product_catalog cat on cat.offer_code = p.oferta_codigo
              where p.comprador_id = ch.comprador_id
                and cat.papel = 'renovacao'
                and cs.fn_hm_pagamento_do_produto(p.oferta_codigo, ch.produto)
           ) as e_renovacao
      from cs.contatos_hm ch
      join cs.estagios e on e.id = ch.estagio_id
     where e.aba = 'ativacao'
       and not (coalesce(ch.ativ_searchie, false)
                and coalesce(ch.ativ_comunidade, false)
                and coalesce(ch.ativ_grupo, false))
  loop
    if not (v_alvo.e_antigo or v_alvo.e_renovacao) then
      continue;
    end if;

    update cs.contatos_hm
       set ativ_searchie   = true,
           ativ_comunidade = true,
           ativ_grupo      = true,
           atualizado_em   = now()
     where id = v_alvo.id;

    insert into cs.interacoes (contato_hm_id, tipo, descricao, autor)
    values (v_alvo.id, 'sistema',
            case when v_alvo.e_renovacao and not v_alvo.e_antigo
                 then '0299: renovacao — Searchie/comunidade/grupo marcados retroativamente (a pessoa ja era aluna antes desta regra existir). Falta o GPS.'
                 else '0299: aluno antigo — Searchie/comunidade/grupo marcados retroativamente (entrou na Ativacao antes desta regra existir). Falta o GPS.'
            end,
            'sistema');
    v_n := v_n + 1;
  end loop;

  raise notice '0299: % ficha(s) marcada(s) retroativamente.', v_n;

  -- Trava dos DOIS lados: não fazer nada e fazer demais são ambos erro.
  -- Zero = o critério não pegou ninguém (algo quebrou).
  -- Acima de 80 = critério largo demais, está marcando quem não devia.
  -- O esperado medido era 65 — a faixa dá folga sem abrir a porteira.
  if v_n = 0 then
    raise exception '0299: nenhuma ficha foi marcada — o criterio nao pegou ninguem. Abortado para revisao.';
  end if;
  if v_n > 80 then
    raise exception '0299: % fichas marcadas, acima do teto de 80 — criterio largo demais, abortado.', v_n;
  end if;
end $$;

-- ── Conferência pós-aplicação ───────────────────────────────────────────────
do $$
declare v_restam int; v_gps int;
begin
  select count(*) into v_restam
    from cs.contatos_hm ch join cs.estagios e on e.id = ch.estagio_id
   where e.aba = 'ativacao'
     and (ch.tags && array['Aluno THB','Aluno Aurum'])
     and not (coalesce(ch.ativ_searchie,false) and coalesce(ch.ativ_comunidade,false) and coalesce(ch.ativ_grupo,false));

  select count(*) into v_gps from cs.contatos_hm where ativ_gps;

  if v_restam <> 0 then
    raise exception '0299: ainda restam % alunos antigos na Ativacao sem os 3 acessos — abortado.', v_restam;
  end if;
  -- O GPS tem que continuar zerado: se esta migration marcou algum, ela
  -- passou por cima da decisao de que o GPS e sempre gesto humano.
  if v_gps <> 0 then
    raise exception '0299: ativ_gps foi marcado em % ficha(s) — esta migration NAO deveria tocar o GPS. Abortado.', v_gps;
  end if;

  raise notice '0299: conferido — nenhum aluno antigo na Ativacao sem os 3 acessos, e ativ_gps intocado.';
end $$;

-- ── Resultado real da aplicação (18/08) ─────────────────────────────────────
-- 65 fichas marcadas · ativ_gps em 0 · 0 alunos antigos sem os 3 acessos
-- 113 fichas seguem pendentes de GPS na Ativação — essa é a fila de trabalho
-- que sobra, e é trabalho real, não fantasma.
