-- =====================================================================
-- 0146_contatos_equipes_e_visibilidade
--
-- Espelha para os portais GENÉRICOS (HT / SEM / CNHF — cs.contatos) o modelo
-- de equipes + visibilidade que a 0140 entregou para o HM (cs.contatos_hm).
-- Fecha o "furo 7" do spec de níveis de acesso: hoje cs.contatos só tem
-- `responsavel` TEXTO livre — sem id, sem equipe, zero isolamento.
--
-- Estratégia idêntica à 0140 (p/ NÃO quebrar os consumidores do texto):
-- adiciona `responsavel_id` AO LADO do texto; o texto passa a ser DERIVADO
-- do id por trigger (id vence). Tudo que lê `responsavel` (kanban, meu-dia,
-- inbox, filtros, vw_aluno_360) continua funcionando; a EQUIPE do card não é
-- coluna nova — deriva de responsavel_id -> cs.usuarios.equipe_id, exposta
-- pelas views curadas cs.contatos_ht e cs.contatos_evento (colunas novas ao
-- FINAL, create or replace não reordena).
--
-- SEM roteamento canal->equipe aqui: a 0140 tem esse seed COMENTADO de
-- propósito (reintroduziu a rota HT29->Equipe 2 por acidente DUAS vezes,
-- ver 0144). Nos genéricos nem criamos o gancho — associação é manual.
--
-- PREDICADO DE VISIBILIDADE (contrato p/ as rotas — mesmo do HM/0140):
--   verTudo (nível master)
--   OR (responsavel_id is null AND equipe_id is null)   -- POOL: visível a todos
--   OR equipe_id = $minhaEquipe                          -- cards da minha equipe
--   OR responsavel_id = $eu                              -- meus cards
-- onde equipe_id/responsavel_id saem de cs.contatos_evento (ou cs.contatos_ht).
--
-- Reusa cs.equipes / cs.usuarios.equipe_id criados na 0140.
-- Idempotente e re-executável sem efeito colateral.
-- =====================================================================

-- 1) Dono do card por id (ao lado do texto responsavel) ----------------------
alter table cs.contatos
  add column if not exists responsavel_id uuid references cs.usuarios(id);
create index if not exists cs_contatos_responsavel_id_idx
  on cs.contatos (responsavel_id);

-- 2) Backfill responsavel(texto) -> responsavel_id (casa por nome) ------------
--    Mesma estratégia do bloco 6 da 0140, com duas guardas a mais:
--    (a) só casa com usuário ATIVO (nome de ex-operador fica como legado);
--    (b) nome AMBÍGUO entre ativos (2+ usuários com o mesmo nome) NÃO casa —
--        atribuir ao usuário errado vazaria o card para a equipe errada.
--    Sem match => responsavel_id fica null MAS o texto permanece (nada some
--    da UI); o card SÓ entra no pool se o texto também estiver vazio — cards
--    com texto órfão continuam visíveis a master até alguém reatribuir por id.
do $backfill$
declare
  v_casados   int;
  v_sem_match int;
begin
  with unicos as (
    -- nomes normalizados que apontam para EXATAMENTE UM usuário ativo
    select lower(trim(u.nome)) as nome_norm,
           (array_agg(u.id))[1] as usuario_id
      from cs.usuarios u
     where u.ativo
     group by lower(trim(u.nome))
    having count(*) = 1
  )
  update cs.contatos ct
     set responsavel_id = un.usuario_id
    from unicos un
   where ct.responsavel_id is null
     and ct.responsavel is not null and ct.responsavel <> ''
     and un.nome_norm = lower(trim(ct.responsavel));

  get diagnostics v_casados = row_count;

  select count(*) into v_sem_match
    from cs.contatos
   where responsavel_id is null
     and responsavel is not null and responsavel <> '';

  raise notice
    '0146 backfill: % contato(s) casaram responsavel_id nesta execucao; % com texto sem match (ambiguo, inativo ou legado) ficaram com responsavel_id null',
    v_casados, v_sem_match;
end$backfill$;

-- 3) Trigger: quando escrevem responsavel_id, o texto deriva do nome do user --
--    Mesma semântica do bloco 7 da 0140: ID VENCE. Mexeu no responsavel_id ->
--    o texto espelha o nome (ou NULL se devolveu ao pool). Escrever só o texto
--    (fluxo legado setResponsavel) segue funcionando e não é tocado.
--    Verificado: cs.contatos NÃO tem nenhuma trigger própria hoje (0001–0145
--    só criam triggers em public.compras/compradores, cs.contatos_hm e
--    controle.*) — mesmo assim, função e trigger têm nomes PRÓPRIOS
--    (fn_contatos_* / trg_contatos_*) para nunca colidir com o par do HM
--    (fn_hm_sync_responsavel_texto / trg_hm_sync_responsavel).
--    Cobre INSERT também (diferença p/ 0140): os upserts de lead (0133/0136)
--    inserem sem responsavel_id, mas se alguma rota passar a inserir já com
--    dono, o texto nasce coerente em vez de ficar null.
create or replace function cs.fn_contatos_sync_responsavel_texto()
returns trigger language plpgsql
set search_path to 'cs','public','pg_temp'
as $function$
begin
  if tg_op = 'INSERT' then
    if new.responsavel_id is not null then
      new.responsavel := (select nome from cs.usuarios where id = new.responsavel_id);
    end if;
  elsif new.responsavel_id is distinct from old.responsavel_id then
    new.responsavel := (select nome from cs.usuarios where id = new.responsavel_id);
  end if;
  return new;
end$function$;

drop trigger if exists trg_contatos_sync_responsavel on cs.contatos;
create trigger trg_contatos_sync_responsavel
  before insert or update on cs.contatos
  for each row execute function cs.fn_contatos_sync_responsavel_texto();

-- 4) View cs.contatos_ht: acrescenta responsavel_id + equipe do dono ----------
--    Corpo idêntico ao vigente (0003), colunas novas ao FINAL (create or
--    replace view não reordena — mesma solução do bloco 8 da 0140). É view
--    comum (não materializada) e cs.contatos_evento depende dela por NOME de
--    coluna, então REPLACE preserva a dependente; um drop aqui falharia.
--    Equipe SEM fallback de rota (não existe cs.equipe_canais p/ genéricos):
--    POOL = responsavel_id IS NULL AND equipe_id IS NULL.
create or replace view cs.contatos_ht with (security_invoker = false) as
with ht_compras as (
  select c.comprador_id,
         max(c.data_aprovacao) as ultima_compra_ht,
         (array_agg(c.produto_nome order by c.data_aprovacao desc nulls last))[1] as ultimo_produto
  from public.compras c
  where c.produto_id in ('1560865','2414291')
    and c.status in ('APPROVED','COMPLETE','COMPLETED')
  group by c.comprador_id
)
select
  cmp.id as comprador_id, cmp.nome, cmp.email, cmp.telefone,
  hc.ultima_compra_ht, hc.ultimo_produto,
  ed.edition_number,
  coalesce(ct.edicao_ht,
           case when ed.edition_number is not null then 'HT'||ed.edition_number end) as edicao,
  ct.estagio_id, est.chave as estagio_chave, est.nome as estagio_nome,
  ct.responsavel, ct.proxima_acao_em, ct.proxima_acao_nota,
  ct.ultimo_contato_em, ct.ultima_resposta_em, ct.observacoes,
  ct.edicao_ht,
  ct.primeiro_contato_em,
  ct.legado_ativado, ct.legado_ativacao_em, ct.legado_sla_h,
  ct.legado_no_grupo, ct.legado_pesquisa, ct.legado_ja_ht, ct.legado_qtd_ht,
  ct.legado_ja_hm, ct.legado_e_aluno, ct.legado_instrucao,
  ct.legado_t_primeiro_contato_h, ct.legado_t_ativacao_h,
  -- === Equipes (0146) ===
  ct.responsavel_id,
  ru.equipe_id,
  eq.nome as equipe_nome,
  eq.cor  as equipe_cor,
  eq.tipo as equipe_tipo
from ht_compras hc
join public.compradores cmp on cmp.id = hc.comprador_id
left join lateral (
  select e.* from public.ht_editions e
  where hc.ultima_compra_ht between e.sale_start_at and e.sale_end_at
  order by e.edition_number desc limit 1
) ed on true
left join cs.contatos ct on ct.comprador_id = cmp.id
left join cs.estagios est on est.id = ct.estagio_id
left join cs.usuarios ru on ru.id = ct.responsavel_id
left join cs.equipes  eq on eq.id = ru.equipe_id;

-- 5) View cs.contatos_evento: as 5 colunas de equipe ao FINAL de cada braço ---
--    Corpo idêntico ao vigente (0132: HT + SEM + CNHF). CREATE OR REPLACE
--    (mesma assinatura + colunas novas ao final) preserva as dependentes
--    (public.vw_aluno_360 da 0071 e a 0081 leem esta view por nome de coluna);
--    um DROP CASCADE as derrubaria. O braço HT herda as colunas da
--    cs.contatos_ht (bloco 4); SEM/CNHF derivam direto de cs.contatos.
create or replace view cs.contatos_evento as
  select 'HT'::text as evento, h.comprador_id, h.nome, h.email, h.telefone,
         h.ultima_compra_ht, h.ultimo_produto, h.edition_number, h.edicao,
         h.estagio_id, h.estagio_chave, h.estagio_nome, h.responsavel,
         h.proxima_acao_em, h.proxima_acao_nota, h.ultimo_contato_em, h.ultima_resposta_em,
         h.observacoes, h.edicao_ht, h.primeiro_contato_em,
         h.legado_ativado, h.legado_ativacao_em, h.legado_sla_h, h.legado_no_grupo,
         h.legado_pesquisa, h.legado_ja_ht, h.legado_qtd_ht, h.legado_ja_hm,
         h.legado_e_aluno, h.legado_instrucao, h.legado_t_primeiro_contato_h, h.legado_t_ativacao_h,
         -- === Equipes (0146) ===
         h.responsavel_id, h.equipe_id, h.equipe_nome, h.equipe_cor, h.equipe_tipo
    from cs.contatos_ht h
  union all
  select 'SEM'::text as evento, cmp.id as comprador_id, cmp.nome, cmp.email, cmp.telefone,
         null::timestamptz as ultima_compra_ht, null::varchar as ultimo_produto,
         null::integer as edition_number, coalesce(ct.edicao_ht, 'SEM')::text as edicao,
         ct.estagio_id, est.chave as estagio_chave, est.nome as estagio_nome, ct.responsavel,
         ct.proxima_acao_em, ct.proxima_acao_nota, ct.ultimo_contato_em, ct.ultima_resposta_em,
         ct.observacoes, ct.edicao_ht, ct.primeiro_contato_em,
         ct.legado_ativado, ct.legado_ativacao_em, ct.legado_sla_h, ct.legado_no_grupo,
         ct.legado_pesquisa, ct.legado_ja_ht, ct.legado_qtd_ht, ct.legado_ja_hm,
         ct.legado_e_aluno, ct.legado_instrucao, ct.legado_t_primeiro_contato_h, ct.legado_t_ativacao_h,
         -- === Equipes (0146) ===
         ct.responsavel_id, ru.equipe_id, eq.nome as equipe_nome, eq.cor as equipe_cor, eq.tipo as equipe_tipo
    from cs.contatos ct
    join public.compradores cmp on cmp.id = ct.comprador_id
    left join cs.estagios est on est.id = ct.estagio_id
    left join cs.usuarios ru on ru.id = ct.responsavel_id
    left join cs.equipes  eq on eq.id = ru.equipe_id
   where ct.evento = 'SEM'
  union all
  select 'CNHF'::text as evento, cmp.id as comprador_id, cmp.nome, cmp.email, cmp.telefone,
         null::timestamptz as ultima_compra_ht, null::varchar as ultimo_produto,
         null::integer as edition_number, coalesce(ct.edicao_ht, 'CNHF')::text as edicao,
         ct.estagio_id, est.chave as estagio_chave, est.nome as estagio_nome, ct.responsavel,
         ct.proxima_acao_em, ct.proxima_acao_nota, ct.ultimo_contato_em, ct.ultima_resposta_em,
         ct.observacoes, ct.edicao_ht, ct.primeiro_contato_em,
         ct.legado_ativado, ct.legado_ativacao_em, ct.legado_sla_h, ct.legado_no_grupo,
         ct.legado_pesquisa, ct.legado_ja_ht, ct.legado_qtd_ht, ct.legado_ja_hm,
         ct.legado_e_aluno, ct.legado_instrucao, ct.legado_t_primeiro_contato_h, ct.legado_t_ativacao_h,
         -- === Equipes (0146) ===
         ct.responsavel_id, ru.equipe_id, eq.nome as equipe_nome, eq.cor as equipe_cor, eq.tipo as equipe_tipo
    from cs.contatos ct
    join public.compradores cmp on cmp.id = ct.comprador_id
    left join cs.estagios est on est.id = ct.estagio_id
    left join cs.usuarios ru on ru.id = ct.responsavel_id
    left join cs.equipes  eq on eq.id = ru.equipe_id
   where ct.evento = 'CNHF';

-- 6) Grants (idempotentes — replace preserva, mas garante em base recriada) ---
grant select on cs.contatos_ht      to disparos_app;
grant select on cs.contatos_evento  to disparos_app;

-- =====================================================================
-- VERIFICAÇÃO PÓS-APLICAÇÃO (rodar à mão e conferir contra a realidade
-- antes de confiar no backfill — não faz parte da migration):
--
-- -- a) Panorama do backfill por evento: total, casados, texto órfão, pool
-- select evento,
--        count(*)                                                            as total,
--        count(*) filter (where responsavel_id is not null)                  as com_id,
--        count(*) filter (where responsavel_id is null
--                           and responsavel is not null and responsavel<>'') as texto_sem_match,
--        count(*) filter (where responsavel_id is null
--                           and (responsavel is null or responsavel=''))     as sem_dono
--   from cs.contatos
--  group by evento order by evento;
--
-- -- b) Quem ficou de fora e por quê (nomes órfãos, p/ decidir reatribuição)
-- select responsavel, evento, count(*)
--   from cs.contatos
--  where responsavel_id is null and responsavel is not null and responsavel <> ''
--  group by responsavel, evento order by count(*) desc;
--
-- -- c) Nomes ambíguos entre usuários ativos (a razão de (b) quando houver)
-- select lower(trim(nome)) as nome_norm, count(*)
--   from cs.usuarios where ativo
--  group by lower(trim(nome)) having count(*) > 1;
--
-- -- d) Distribuição por equipe na view (o que as rotas vão enxergar)
-- select evento, equipe_nome, count(*)
--   from cs.contatos_evento
--  group by evento, equipe_nome order by evento, count(*) desc;
--
-- -- e) POOL efetivo (visível a todos) por evento
-- select evento, count(*)
--   from cs.contatos_evento
--  where responsavel_id is null and equipe_id is null
--  group by evento order by evento;
--
-- -- f) Sanidade id<->texto (deve retornar 0 linhas): id apontando p/ um nome
-- --    diferente do texto — só aparece se algum fluxo legado escrever texto
-- --    por fora depois do backfill
-- select ct.id, ct.responsavel, u.nome
--   from cs.contatos ct join cs.usuarios u on u.id = ct.responsavel_id
--  where lower(trim(ct.responsavel)) is distinct from lower(trim(u.nome));
-- =====================================================================
