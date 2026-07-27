-- =====================================================================
-- 0140_hm_equipes_e_visibilidade
--
-- Equipes + níveis de visibilidade no board HM (Fase 1). Cada equipe é dona
-- de canais de aquisição; o Grupo Participa (equipe PRINCIPAL) enxerga tudo,
-- as equipes COMUNS só veem o pool ("Contato Inicial" sem dono) + os cards
-- que elas assumiram. Decisões do Marcio (27/07).
--
-- Estratégia p/ NÃO quebrar: cs.contatos_hm.responsavel (texto=nome) tem 6
-- consumidores (view, filtro por nome, união do seletor, setResponsavelHm,
-- drawer, fn_hm_undo_colunas). Em vez de migrar direto p/ id, adiciona
-- responsavel_id AO LADO do texto; o texto passa a ser DERIVADO do id por
-- trigger. Tudo que lê o texto continua funcionando; a equipe do card vem de
-- responsavel_id -> cs.usuarios.equipe_id.
--
-- Roteamento canal->equipe: casa a TAG do card contra cs.equipe_canais.canal
-- (NÃO via canal_aquisicao da view, que ignora canais de janela como
-- 'HT29 - 26-07'). Canal roteado "pula o pool": mesmo sem dono, o card já tem
-- equipe -> some do pool para as outras equipes.
--   POOL (visível a todas) = responsavel_id IS NULL AND equipe_id IS NULL.
-- Ver [[HM - Feature de equipes e niveis de acesso]].
-- =====================================================================

-- 1) Equipes -----------------------------------------------------------------
create table if not exists cs.equipes (
  id            uuid primary key default gen_random_uuid(),
  nome          text not null,
  tipo          text not null default 'comum' check (tipo in ('principal','comum')),
  cor           text not null default '#64748b',   -- borda/selo do card (slate-500)
  ativo         boolean not null default true,
  criado_em     timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);
comment on table cs.equipes is
  'Equipes do board HM. tipo=principal (Grupo Participa) vê tudo; comum vê pool + próprios.';

-- Só UMA equipe principal (GP) — a visão global.
create unique index if not exists cs_equipes_uma_principal
  on cs.equipes ((tipo)) where tipo = 'principal';

-- 2) Usuário pertence a UMA equipe -------------------------------------------
alter table cs.usuarios
  add column if not exists equipe_id uuid references cs.equipes(id);
create index if not exists cs_usuarios_equipe_idx on cs.usuarios (equipe_id);

-- 3) Dono do card por id (ao lado do texto responsavel) ----------------------
alter table cs.contatos_hm
  add column if not exists responsavel_id uuid references cs.usuarios(id);
create index if not exists cs_contatos_hm_responsavel_id_idx
  on cs.contatos_hm (responsavel_id);

-- 4) Mapa canal -> equipe (roteamento) ---------------------------------------
create table if not exists cs.equipe_canais (
  canal     text primary key,          -- casa com a TAG de canal do card
  equipe_id uuid not null references cs.equipes(id) on delete cascade,
  criado_em timestamptz not null default now()
);
comment on table cs.equipe_canais is
  'Roteia um canal de aquisição (tag) para uma equipe. Canal roteado pula o pool.';

-- 5) Seed idempotente: GP (principal) + Equipe 2 (comum) + rota HT29 ----------
insert into cs.equipes (nome, tipo, cor)
  select 'Grupo Participa (Pro Max)', 'principal', '#4f46e5'   -- indigo
  where not exists (select 1 from cs.equipes where tipo = 'principal');
insert into cs.equipes (nome, tipo, cor)
  select 'Equipe 2', 'comum', '#0d9488'                        -- teal
  where not exists (select 1 from cs.equipes where nome = 'Equipe 2');

-- Rota HARDCODED de seed HT29 -> Equipe 2 REMOVIDA (decisão do Marcio 27/07): o
-- roteamento automático fazia todo comprador da live cair na Equipe 2 sozinho e
-- SUMIR da visão das outras equipes. Cards de compra caem no POOL (abertos),
-- associação a equipe/pessoa é MANUAL. Ver migration 0144 (que também limpa
-- cs.equipe_canais). NÃO reintroduzir este seed.
-- insert into cs.equipe_canais (canal, equipe_id)
--   select 'HT29 - 26-07', e.id from cs.equipes e where e.nome = 'Equipe 2'
-- on conflict (canal) do nothing;

-- 6) Backfill responsavel(texto) -> responsavel_id (casa por nome) ------------
--    Legado sem match em usuarios fica com id null MAS mantém o texto (a view
--    continua expondo o texto; nada some).
update cs.contatos_hm ch
   set responsavel_id = u.id
  from cs.usuarios u
 where ch.responsavel_id is null
   and ch.responsavel is not null and ch.responsavel <> ''
   and lower(trim(u.nome)) = lower(trim(ch.responsavel));

-- 7) Trigger: quando escrevem responsavel_id, o texto deriva do nome do user --
create or replace function cs.fn_hm_sync_responsavel_texto()
returns trigger language plpgsql
set search_path to 'cs','public','pg_temp'
as $function$
begin
  -- id vence: mexeu no responsavel_id -> o texto espelha o nome (ou NULL se
  -- devolveu ao pool). Escrever só o texto (fluxo legado) segue funcionando.
  if new.responsavel_id is distinct from old.responsavel_id then
    new.responsavel := (select nome from cs.usuarios where id = new.responsavel_id);
  end if;
  return new;
end$function$;

drop trigger if exists trg_hm_sync_responsavel on cs.contatos_hm;
create trigger trg_hm_sync_responsavel
  before update on cs.contatos_hm
  for each row execute function cs.fn_hm_sync_responsavel_texto();

-- 8) View do kanban: acrescenta responsavel_id + equipe (dono OU canal roteado)
--    Corpo idêntico ao atual (pg_get_viewdef), colunas novas ao FINAL
--    (create or replace view não reordena). A equipe vem do dono; se o card
--    não tem dono mas o canal está roteado, vem da rota (equipe_roteada).
create or replace view cs.contatos_hm_kanban as
 SELECT ch.id AS contato_hm_id,
    ch.comprador_id,
    cmp.nome,
    cmp.email,
    cmp.telefone,
    ch.turma,
    ch.plano,
    ch.categoria_entrada,
    ch.estagio_id,
    est.chave AS estagio_chave,
    est.nome AS estagio_nome,
    est.aba AS estagio_aba,
    ch.responsavel,
    ch.reuniao_em,
    ch.reuniao_resultado,
    ch.entrevista_em,
    ch.entrevista_resultado,
    ch.pagamento_forma,
    ch.pagamento_parcelas,
    ch.pagamento_em,
    ch.apto_ativacao,
    ch.tags,
    ch.observacoes,
    ch.criado_em,
    ch.atualizado_em,
    ch.ordem,
    ch.turma_origem,
    ch.pagamento_meio,
    ch.pagamento_previsto_em,
    ch.acordo,
    ch.oferta_saldo_codigo,
    ch.link_saldo_enviado_em,
    ch.nao_contatar,
    ch.nao_contatar_motivo,
    ch.revisar,
    ch.revisar_motivo,
    ch.ativ_searchie,
    ch.ativ_comunidade,
    ch.ativ_grupo,
    ch.ativ_pesquisa,
    ch.grupo_informes,
    ch.pendencia,
    ch.cancelamento_em,
    ch.cancelamento_motivo,
    ch.link_facebook,
    s.pago_em AS sinal_pago_em,
    s.valor AS sinal_valor,
    ch.cancelamento_efetivado_em,
    ch.cancelamento_origem,
    ch.rev_searchie,
    ch.rev_comunidade,
    ch.rev_grupo,
    ch.rev_pesquisa,
    ch.acessos_revogados_em,
    ch.acessos_revogados_por,
    ch.aluno_id,
    ch.cancelamento_efetivado_em IS NOT NULL AND ch.acessos_revogados_em IS NULL AS acessos_a_remover,
    ch.hotmart_cancelado_em,
    ch.hotmart_cancelamento_evento,
    ch.hotmart_cancelamento_transacao,
    ch.hotmart_cancelado_em IS NOT NULL AS cancelado_na_hotmart,
    ch.cancelamento_efetivado_em IS NOT NULL AND ch.hotmart_cancelado_em IS NULL AS cancelado_sem_confirmacao_hotmart,
    hs.status AS hotmart_status,
    hs.em AS hotmart_status_em,
    COALESCE(( SELECT t.t
           FROM unnest(ch.tags) t(t)
          WHERE t.t ~ '^HT[0-9]+$'::text
         LIMIT 1), ( SELECT t.t
           FROM unnest(ch.tags) t(t)
          WHERE t.t = ANY (ARRAY['HT ATM'::text, 'Live Direto ao Ponto'::text, 'Imersão POA'::text, 'Ex aluno Direto ao Ponto'::text, 'HM - Programa de Implementação'::text, 'Venda direta'::text])
          ORDER BY (array_position(ARRAY['HT ATM'::text, 'Live Direto ao Ponto'::text, 'Imersão POA'::text, 'Ex aluno Direto ao Ponto'::text, 'HM - Programa de Implementação'::text, 'Venda direta'::text], t.t))
         LIMIT 1)) AS canal_aquisicao,
    ch.reuniao_gravacao_url,
    ch.entrevista_gravacao_url,
    -- === Equipes (0140) ===
    ch.responsavel_id,
    -- equipe do card = equipe do dono OU (sem dono) a equipe roteada pelo canal
    COALESCE(ru.equipe_id, rota.equipe_id) AS equipe_id,
    COALESCE(deq.nome, req.nome)           AS equipe_nome,
    COALESCE(deq.cor,  req.cor)            AS equipe_cor,
    COALESCE(deq.tipo, req.tipo)           AS equipe_tipo
   FROM cs.contatos_hm ch
     JOIN compradores cmp ON cmp.id = ch.comprador_id
     LEFT JOIN cs.estagios est ON est.id = ch.estagio_id
     LEFT JOIN cs.usuarios ru ON ru.id = ch.responsavel_id
     LEFT JOIN cs.equipes deq ON deq.id = ru.equipe_id
     LEFT JOIN LATERAL ( SELECT ec.equipe_id
           FROM cs.equipe_canais ec
          WHERE ec.canal = ANY (ch.tags)
         LIMIT 1) rota ON true
     LEFT JOIN cs.equipes req ON req.id = rota.equipe_id
     LEFT JOIN LATERAL ( SELECT COALESCE(c.data_compra, c.data_aprovacao) AS pago_em,
            c.preco AS valor
           FROM compras c
             JOIN hm_product_catalog cat ON cat.offer_code = c.oferta_codigo::text
          WHERE c.comprador_id = ch.comprador_id AND cat.categoria = 'sinal'::text AND (c.status::text = ANY (ARRAY['APPROVED'::text, 'COMPLETE'::text, 'COMPLETED'::text]))
          ORDER BY (COALESCE(c.data_compra, c.data_aprovacao))
         LIMIT 1) s ON true
     LEFT JOIN LATERAL ( SELECT c.status,
            COALESCE(c.data_compra, c.data_aprovacao) AS em
           FROM compras c
             JOIN hm_product_catalog cat ON cat.offer_code = c.oferta_codigo::text
          WHERE c.comprador_id = ch.comprador_id
          ORDER BY (COALESCE(c.data_compra, c.data_aprovacao)) DESC NULLS LAST
         LIMIT 1) hs ON true;

-- 9) fn_hm_undo_colunas: o "desfazer edição" passa a cobrir responsavel_id ----
--    (mantém 'responsavel' texto também, para o par id/texto voltar junto).
create or replace function cs.fn_hm_undo_colunas()
 returns text[]
 language sql
 immutable
as $function$
  select array[
    'responsavel','responsavel_id','turma','turma_origem','plano','observacoes',
    'reuniao_resultado','entrevista_resultado','reuniao_gravacao_url','entrevista_gravacao_url',
    'pagamento_meio','pagamento_previsto_em','acordo','oferta_saldo_codigo','link_saldo_enviado_em',
    'nao_contatar','nao_contatar_motivo','revisar','revisar_motivo',
    'ativ_searchie','ativ_comunidade','ativ_grupo','ativ_pesquisa','grupo_informes','pendencia',
    'cancelamento_motivo','link_facebook',
    'rev_searchie','rev_comunidade','rev_grupo','rev_pesquisa',
    'credito_oferta','credito_valor_pago','credito_dias_totais','credito_compra_em',
    'valor_total','valor_pago','pagamento_em','cancelamento_em','tags'
  ]::text[];
$function$;
