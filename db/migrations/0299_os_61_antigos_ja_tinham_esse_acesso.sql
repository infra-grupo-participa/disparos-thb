-- =====================================================================
-- 0299_os_61_antigos_ja_tinham_esse_acesso
--
-- D3 (decisão do Marcio, 17/08): os alunos que já estão na Ativação sem o
-- checklist marcado (entraram antes da regra da 0213/0298) recebem a MESMA
-- marcação retroativa: ativ_searchie/comunidade/grupo := true, quando são
-- aluno antigo (TAGS_ALUNO_ANTIGO) OU renovação (mesmo critério da 0298) e
-- têm algum dos 3 em false. NÃO toca ativ_gps nem ativ_pesquisa.
--
-- O levantamento original (só por tag) tinha achado 61 — daí o nome deste
-- arquivo. Medido de novo no banco vivo já COM renovação: são 65 (61 por
-- tag + 4 que só entram pela renovação, sem nenhuma tag de aluno antigo —
-- exatamente os que ficavam de fora da regra antiga e são o motivo do
-- pedido do Marcio). Ver TRAVA DE SANIDADE abaixo.
--
-- Registra uma interação 'sistema' por card tocado (não em massa/silenciosa)
-- e termina com `raise notice` da contagem + trava de sanidade (não corrige
-- mais gente do que o levantamento previu, nem menos).
--
-- Migration de DADOS, não de schema — mas é gesto único e documentado, não
-- um UPDATE em massa recorrente: mesma régua de "operação destrutiva exige
-- confirmação" não se aplica aqui porque é estritamente ADITIVO (só liga
-- flags que hoje são false para quem já tem o direito), mas ainda assim é
-- UPDATE em lote — cada card tocado grava para quê.
--
-- O critério de "é renovação" é o MESMO exists da 0298 (que por sua vez
-- espelha `cs.contatos_hm_kanban.renovacao` — ver o cabeçalho da 0298 para a
-- leitura completa extraída de pg_get_viewdef). Fonte única: não reescrito
-- aqui, copiado.
--
-- TRAVA DE SANIDADE — números medidos no banco vivo COM o critério de
-- renovação já incluído (17/08):
--   por_tag_de_aluno .......... 61   (o levantamento original, só por tag)
--   por_renovacao ..............6   (2 destes já tinham tag — não somam 2x)
--   SO por renovacao (sem tag)..4   (os que ficavam de fora da regra antiga —
--                                    é justamente o motivo do pedido do Marcio)
--   total_a_marcar ............65
--
--   = 0    → `raise exception`  (critério não pegou ninguém — algo errado)
--   1..80  → `raise notice` com a contagem real (65 esperado; 80 dá folga
--            para oscilação natural da esteira entre a medição e a aplicação)
--   > 80   → `raise exception`  (critério largo demais, pegando gente que
--            não devia)
-- =====================================================================

do $$
declare
  v_marcados int := 0;
  v_teto_exception int := 80; -- acima disso, aborta — critério largo demais (esperado real: 65)
  r record;
begin
  for r in
    select ch.id, ch.comprador_id
      from cs.contatos_hm ch
      join cs.estagios est on est.id = ch.estagio_id
     where est.aba = 'ativacao'
       and (
         ch.tags && array['Aluno THB','Aluno Aurum']
         or exists (
              select 1
                from cs.hm_pagamentos p
                join public.hm_product_catalog cat on cat.offer_code = p.oferta_codigo
               where p.comprador_id = ch.comprador_id
                 and cat.papel = 'renovacao'
                 and cs.fn_hm_pagamento_do_produto(p.oferta_codigo, ch.produto)
            )
       )
       and (
         coalesce(ch.ativ_searchie, false) = false
         or coalesce(ch.ativ_comunidade, false) = false
         or coalesce(ch.ativ_grupo, false) = false
       )
  loop
    update cs.contatos_hm
       set ativ_searchie = true,
           ativ_comunidade = true,
           ativ_grupo = true,
           atualizado_em = now()
     where id = r.id;

    insert into cs.interacoes (contato_hm_id, tipo, descricao, autor)
    values (r.id, 'sistema',
            '0299: aluno antigo/renovação já em Ativação — acessos Searchie/comunidade/grupo marcados retroativamente (GPS segue pendente)',
            'sistema');

    v_marcados := v_marcados + 1;
  end loop;

  if v_marcados = 0 then
    raise exception '0299: o criterio nao marcou NENHUM card — esperado ~65 (61 por tag + 4 so por renovacao). Abortando: algo esta errado (join quebrado, tabela vazia, criterio nao casou), nao e um resultado plausivel. Conferir antes de reaplicar.';
  end if;

  if v_marcados > v_teto_exception then
    raise exception '0299: marcou % cards, mais que o teto de seguranca (%) — esperado ~65 (61 por tag + 4 so por renovacao), medido no banco vivo em 17/08. Abortando para nao aplicar em escala maior que a prevista. Revisar o criterio de renovacao antes de reaplicar.', v_marcados, v_teto_exception;
  end if;

  raise notice '0299: % cards de aluno antigo/renovacao ja em Ativacao marcados retroativamente (Searchie/comunidade/grupo) — esperado ~65 (61 por tag + 4 so por renovacao, medido em 17/08). ativ_gps e ativ_pesquisa NAO tocados — seguem pendentes como para qualquer outro aluno.', v_marcados;
end $$;
