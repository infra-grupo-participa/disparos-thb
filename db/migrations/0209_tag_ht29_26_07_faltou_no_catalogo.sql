-- 0209 — a tag "HT29 - 26-07" ficou fora do catálogo da 0206.
--
-- A 0206 tinha DOIS trechos mirando o HT29 e os dois acabaram no nome errado:
--   · um UPDATE com a descrição da live de 26/07 ... where nome = 'HT29 - 26-07'
--     (não achou linha: essa tag nunca esteve em cs.tags, então o UPDATE foi no-op)
--   · um INSERT de 'HT29' (rótulo curto) — esse entrou
--
-- Resultado medido depois de aplicar a 0206: 'HT29' catalogada com 0 card em uso,
-- e 'HT29 - 26-07' — que está em 28 CARDS REAIS — seguindo órfã. O bloco de
-- conferência da própria 0206 pegou isso e avisou (raise notice, 1 órfã), mas
-- como é notice e não exception, a migration passou mesmo assim.
--
-- 🔑 O catálogo tem de cobrir o nome que os CARDS carregam, não o nome que a
-- gente supõe que eles carregam. A checagem certa é sempre contra
-- `select distinct unnest(tags) from cs.contatos_hm`, nunca contra a memória.
--
-- 🔑 E conferência que só avisa não trava nada. A 0206 detectou o próprio erro e
-- deixou passar porque era `raise notice`. Aqui o mesmo bloco vira `raise
-- exception` — se sobrar tag em uso fora do catálogo, a migration falha.
--
-- 'HT29' fica: é rótulo curto legítimo e o comentário dele já diz que precede a
-- versão com data. Só não é o que está em uso hoje.

insert into cs.tags (evento, nome, tipo, categoria, descricao) values
  ('HM', 'HT29 - 26-07', 'sistema', 'canal',
   'Live do HT de 26/07/2026 — captação da turma T40 (vale até a janela seguinte de venda de entrada).')
on conflict (evento, nome) do nothing;

do $$
declare v_orfas int;
begin
  select count(*) into v_orfas
    from (select distinct unnest(tags) t from cs.contatos_hm) x
   where t not in (select nome from cs.tags where evento = 'HM');
  -- Agora é EXCEPTION, não notice: catálogo incompleto tem de travar a migration.
  if v_orfas > 0 then
    raise exception '0209: ainda restam % tag(s) em uso fora do catalogo', v_orfas;
  end if;
  raise notice '0209: catalogo cobre 100%% das tags em uso nos cards.';
end $$;
