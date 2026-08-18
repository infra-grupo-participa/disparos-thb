-- 0295_quem_ja_era_aluno_nao_muda_de_turma
--
-- ── O problema (relatado pelo Marcio em 18/08) ───────────────────────────────
-- Quem já era aluno e compra o programa novo estava sendo remanejado para a
-- turma da DATA DA COMPRA. Um aluno da T20 virava T40 "com origem T20" —
-- quando ele deveria continuar T20. A turma é de onde a pessoa veio; o que
-- mudou foi o PROGRAMA dela, não a turma.
--
-- Medido antes de mexer: 82 fichas com turma <> turma_origem, 28 turmas de
-- origem afetadas. Padrão: T17->T39, T35->T40, T29->T40, T30->T39, T10->T40...
--
-- ── A causa ──────────────────────────────────────────────────────────────────
-- cs.fn_seed_contato_hm carimba, na posição ~1963 do corpo:
--     v_turma := cs.fn_hm_turma_por_data(coalesce(new.data_compra, ...));
-- ou seja, a turma sai da DATA DA VENDA, sempre — e esse valor entra no insert
-- do card.
--
-- ⚠️ Corrigir ali NÃO resolve: naquele ponto o sistema ainda não sabe se a
-- pessoa já era aluno. Quem descobre isso é cs.fn_tag_hm_origem, que roda
-- DEPOIS (posição ~4204, via `perform`), consulta a base de alunos e grava
-- turma_origem. Conferido com position() no corpo vivo: 1963 < 4204.
--
-- Por isso a correção é em fn_tag_hm_origem — o único ponto do fluxo que já
-- tem as duas informações na mão: a turma que o seed carimbou (errada, da data
-- da venda) e a turma real da pessoa (recém-descoberta na base).
--
-- ── A regra ──────────────────────────────────────────────────────────────────
-- Se a pessoa JÁ ERA ALUNA (tem turma na base THB), a turma do card passa a ser
-- a turma dela — não a turma do calendário. Quem é aluno novo continua caindo
-- na turma da data da venda, como sempre foi (nada muda para venda nova).
--
-- Patch mecânico sobre o corpo VIVO (pg_get_functiondef + replace), padrão das
-- 0285/0292: o repo não tem o corpo canônico desta função, e reescrevê-la a
-- partir de um arquivo antigo apagaria o que foi aplicado direto no banco.

do $$
declare
  v_def   text;
  v_novo  text;
  -- Âncora: o bloco que hoje grava turma_origem quando ela está vazia.
  -- Extraído literalmente de pg_get_functiondef em 18/08.
  v_ancora text := 'if v_card.turma_origem is null and v_turma_thb is not null then'
                || E'\n      update cs.contatos_hm set turma_origem = v_turma_thb where id = v_card.id;'
                || E'\n    end if;';
begin
  select pg_get_functiondef(p.oid) into v_def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'cs' and p.proname = 'fn_tag_hm_origem';

  if v_def is null then
    raise exception '0295: cs.fn_tag_hm_origem nao encontrada — abortado antes de mexer em nada';
  end if;

  if v_def like '%0295%' then
    raise exception '0295: cs.fn_tag_hm_origem ja tem o patch — abortado para nao duplicar';
  end if;

  if position(v_ancora in v_def) = 0 then
    raise exception '0295: a ancora (update de turma_origem) nao casou no corpo de cs.fn_tag_hm_origem — abortado antes de gravar funcao incompleta. Rodar select pg_get_functiondef(''cs.fn_tag_hm_origem''::regproc) e reajustar a ancora.';
  end if;

  if (length(v_def) - length(replace(v_def, v_ancora, ''))) / length(v_ancora) <> 1 then
    raise exception '0295: a ancora nao e unica no corpo de cs.fn_tag_hm_origem — abortado.';
  end if;

  v_novo := replace(
    v_def,
    v_ancora,
    'if v_card.turma_origem is null and v_turma_thb is not null then'
    || E'\n      update cs.contatos_hm set turma_origem = v_turma_thb where id = v_card.id;'
    || E'\n    end if;'
    -- 0295: quem JÁ ERA ALUNO não muda de turma — muda de programa.
    -- v_turma_thb é a turma real da pessoa na base THB (resolvida logo acima,
    -- a partir de al.turma_codigo/turma_origem). O seed carimbou a turma da
    -- DATA DA VENDA sem saber que ela já era aluna; aqui isso se desfaz.
    -- Só toca o card quando as duas coisas são conhecidas e divergem, e só
    -- para quem está na base (v_na_base) — aluno novo segue na turma do
    -- calendário, como sempre.
    || E'\n\n    if v_turma_thb is not null then\n'
    || E'      update cs.contatos_hm ch\n'
    || E'         set turma = v_turma_thb, atualizado_em = now()\n'
    || E'       where ch.id = v_card.id\n'
    || E'         and ch.turma is distinct from v_turma_thb;   -- 0295\n'
    || E'    end if;'
  );

  if v_novo = v_def then
    raise exception '0295: o replace nao alterou o texto — abortado antes de gravar funcao incompleta.';
  end if;

  execute v_novo;
end $$;

-- ── Rede de segurança ───────────────────────────────────────────────────────
do $$
declare v_n int;
begin
  select (length(pg_get_functiondef(p.oid)) - length(replace(pg_get_functiondef(p.oid), '-- 0295', '')))
         / length('-- 0295')
    into v_n
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'cs' and p.proname = 'fn_tag_hm_origem';

  if v_n <> 1 then
    raise exception '0295: esperava a marcacao -- 0295 exatamente 1x no corpo de fn_tag_hm_origem, achei %.', v_n;
  end if;
end $$;

-- ── Reconciliação das 82 fichas históricas ──────────────────────────────────
-- Devolve a turma real de quem foi remanejado. Critério de FATO: só mexe em
-- quem TEM turma_origem gravada (ou seja, o sistema já sabe de onde a pessoa
-- veio) e cuja turma do card diverge dela. Não inventa origem para quem não
-- tem — essas ficam como estão.
do $$
declare
  v_alvo record;
  v_n int := 0;
begin
  for v_alvo in
    select ch.id, ch.turma as turma_errada, ch.turma_origem
      from cs.contatos_hm ch
     where ch.turma_origem is not null
       and ch.turma is distinct from ch.turma_origem
  loop
    update cs.contatos_hm
       set turma = v_alvo.turma_origem, atualizado_em = now()
     where id = v_alvo.id;

    insert into cs.interacoes (contato_hm_id, tipo, descricao, autor)
    values (v_alvo.id, 'sistema',
            '0295: turma corrigida de ' || v_alvo.turma_errada || ' para ' || v_alvo.turma_origem ||
            ' — quem ja era aluno nao muda de turma ao comprar o programa novo; o que muda e o programa. '
            'A turma anterior vinha da data da venda (cs.fn_hm_turma_por_data), nao da origem da pessoa.',
            'sistema');
    v_n := v_n + 1;
  end loop;

  raise notice '0295: % ficha(s) devolvida(s) a turma de origem.', v_n;

  if exists (select 1 from cs.contatos_hm
              where turma_origem is not null and turma is distinct from turma_origem) then
    raise exception '0295: ainda restam fichas com turma <> turma_origem depois da reconciliacao — abortado para revisao.';
  end if;
end $$;

-- ── Verificação (rodar à mão) ───────────────────────────────────────────────
-- select count(*) filter (where turma is distinct from turma_origem) as divergentes,
--        count(*) filter (where turma_origem is null) as sem_origem
--   from cs.contatos_hm;
--
-- `divergentes` tem que ser 0. `sem_origem` continua alto e está certo: é
-- gente que nunca foi aluna antes (venda nova), para quem a turma da data da
-- venda É a turma correta.
