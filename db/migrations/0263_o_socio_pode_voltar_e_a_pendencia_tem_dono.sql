-- 0263 — O sócio pode voltar, e a pendência de titular tem dono
--
-- ── O PEDIDO (Marcio, 16-17/08/2026) ────────────────────────────────────────────
-- O webhook do Respondi vai passar a receber também o formulário de SÓCIOS (hoje
-- só recebe entrevista/reunião). Antes de ligar esse ramo, quatro furos que a
-- auditoria encontrou tinham de ser fechados — dois deles bloqueiam a própria
-- feature (índice legado e provisionamento duplicado), os outros dois já mordiam
-- a operação hoje (alerta prometido em 0201 que nunca nasceu; baixa manual de
-- alerta que sempre dá 400).
--
-- ── AS DECISÕES DE NEGÓCIO (já travadas, não re-perguntar) ─────────────────────
--   1. O webhook NÃO provisiona na base THB. Só cadastra o sócio no board — dar
--      acesso continua ato de operação (botão "Enviar à base THB").
--   2. Titular ambíguo (2+ cards HM) ou titular não encontrado → pendência +
--      alerta, sem escolher. Mesmo padrão do cancelamento_ambiguo (0218): nunca
--      chutar quando o dado não decide sozinho.
--   3. Sócio substituído MANTÉM o acesso na base THB, só sai do board — mesma
--      regra do DELETE atual ("quem desfaz isso é a base mestre, não o kanban").
--   4. Dono do alerta socio_sem_titular = Equipe de Ativação (Ana Camila/Thomas).
--   5. O ramo de sócios TAMBÉM grava em cs.formularios, como os demais.
--   6. CPF vai MASCARADO no payload bruto de cs.webhook_log (só os 3 últimos
--      dígitos); o CPF ÍNTEGRO fica em cs.hm_socios.cpf, que é o lugar dele.
--
-- ── OS 4 FUROS, NA ORDEM EM QUE ESTA MIGRATION OS FECHA ─────────────────────────
--
-- [1.1] Índice legado da 0201 (hm_socios_contato_email_uidx) sobreviveu à 0203
--   sem o recorte `where substituido_em is null`. Provado em produção: titular
--   troca sócio A→B e, ao tentar VOLTAR para A, o upsert por e-mail bate no sócio
--   A ARQUIVADO e morre em "duplicate key value violates unique constraint". Isso
--   derruba webhook E rota manual. Nome NOVO de propósito — um `create ... if not
--   exists` com o nome velho seria no-op silencioso.
--
-- [1.2] cs.fn_hm_alerta_socio_sem_titular() — a 0201 prometeu "mesmo padrão do
--   alerta de oferta órfã" e nunca chegou a existir. cs.hm_socios_pendentes
--   acumula pendência desde a 0201 sem NINGUÉM ser avisado.
--
-- [3.1] cs.fn_hm_provisionar_socios — dois furos ativos, medidos nesta migration:
--   Furo A) o loop não filtra `substituido_em is null` → sócio ARQUIVADO seria
--     re-provisionado (ganha Searchie/Comunidade, conta em num_socios).
--   Furo B) filtra só por comprador_id, sem produto — listado na 0221 como bug
--     real não corrigido: sócio de quem tem card em dois boards (HM+AURUM) podia
--     ser provisionado pelo titular errado.
--
-- [3.2] O DELETE da rota manual de sócios (app/api/hm/contato/[id]/socios) é
--   físico. cs.hm_socios_historico tem `on delete cascade` (0201) — apagaria o
--   histórico da pessoa. Vira arquivamento (substituido_em), como a troca.
--
-- [3.3] O PATCH da mesma rota atualiza nome/email/telefone direto na tabela,
--   sem passar pelo juiz de identidade (fn_hm_socio_upsert) — abre uma segunda
--   porta para o mesmo dado que a 0201/0203 mandaram entrar só por um caminho.
--
-- [3.4] app/api/hm/alertas valida `id` como UUID (`$1::uuid`) mas
--   cs.hm_alertas.id É BIGINT — toda baixa manual de alerta dá 400 hoje. Corrigido
--   no TypeScript (fora desta migration, ver app/api/hm/alertas/route.ts e
--   lib/services/hm-alertas.ts).
--
-- ── MEDIÇÃO ANTES DE CORRIGIR (pedido explícito do Marcio) ──────────────────────
-- cs.hm_socios hoje: 15 vigentes / 15 total / 0 arquivados (nunca houve
-- substituição real). Logo, thb_alunos.eh_socio apontando para sócio ARQUIVADO é
-- necessariamente 0 — não há o que revogar. A trava do bloco [3.1] abaixo prova
-- isso no banco, não só na medição manual.
--
-- Envolvida em transação: qualquer raise exception desfaz tudo.
-- =====================================================================

begin;

-- ── [1.1] O ÍNDICE COM RECORTE DE VIGÊNCIA ───────────────────────────────────────
-- Nome novo de propósito: `create unique index if not exists` com o nome velho
-- seria no-op silencioso se este banco (ou outro) ainda tivesse a versão sem
-- recorte. DROP explícito + nome novo é a única forma de garantir a troca.
drop index if exists cs.hm_socios_contato_email_uidx;

create unique index if not exists hm_socios_contato_email_vigente_uidx
  on cs.hm_socios (contato_hm_id, lower(trim(email)))
  where substituido_em is null and email is not null and email <> '';

comment on index cs.hm_socios_contato_email_vigente_uidx is
  '0263: sucessor do hm_socios_contato_email_uidx (0201), agora com o recorte de vigencia que faltava. Sem "where substituido_em is null" o titular nao conseguia VOLTAR a um socio ja arquivado — o upsert por email batia no arquivado e morria em unique violation. NAO cria indice (contato_hm_id, cpf): seria redundante com hm_socios_um_vigente_uniq (0203) e, sem recorte, reintroduziria o mesmo furo.';

-- ── [1.2] O ALERTA socio_sem_titular ─────────────────────────────────────────────
-- Mesmo mecanismo de cs.fn_hm_alerta_oferta_orfa (0122/0233): função solta,
-- `on conflict do nothing` sobre o único parcial (tipo,chave) de cs.hm_alertas,
-- idempotente. Dono = Equipe de Ativação (decisão do Marcio) — dito no `acao` do
-- catálogo (lib/alertas-catalogo.ts), não aqui: `detalhe` é só o que aconteceu.
create or replace function cs.fn_hm_alerta_socio_sem_titular()
returns integer
language plpgsql
security definer
set search_path to 'cs', 'public', 'pg_temp'
as $function$
declare v_n integer := 0;
begin
  insert into cs.hm_alertas (tipo, chave, severidade, detalhe)
  select 'socio_sem_titular', p.id::text, 'critico',
         format('%s (%s) preencheu o formulário de sócio para %s, em %s, mas o sistema não achou o titular dele na esteira do HM. %s',
                coalesce(p.socio_nome, '(sem nome)'),
                coalesce(p.titular_email, '(sem e-mail do titular)'),
                coalesce(p.titular_nome, '(titular não informado)'),
                to_char(p.recebido_em, 'DD/MM/YYYY HH24:MI'),
                case p.motivo
                  when 'titular_ambiguo' then 'Esse titular tem mais de um cadastro aberto no board — o sistema não escolhe sozinho qual é o certo.'
                  else 'Conferir se o titular já é aluno e, se for, achar o e-mail/telefone certo dele.'
                end)
    from cs.hm_socios_pendentes p
   where p.resolvido_em is null
     and not exists (
       select 1 from cs.hm_alertas a
        where a.tipo = 'socio_sem_titular' and a.chave = p.id::text and a.resolvido_em is null)
   on conflict do nothing;
  get diagnostics v_n = row_count;

  -- Auto-resolução: a pendência já foi conciliada na mão (resolvido_em setado
  -- fora daqui) — o alerta que ela abriu fecha sozinho.
  update cs.hm_alertas a set resolvido_em = now()
   where a.resolvido_em is null and a.tipo = 'socio_sem_titular'
     and exists (
       select 1 from cs.hm_socios_pendentes p
        where p.id::text = a.chave and p.resolvido_em is not null);

  return v_n;
end$function$;

comment on function cs.fn_hm_alerta_socio_sem_titular() is
  '0263: um alerta critico por pendencia aberta em cs.hm_socios_pendentes (titular_nao_encontrado ou titular_ambiguo). Dono = Equipe de Ativacao (ver lib/alertas-catalogo.ts). Chamada pelo webhook do Respondi na hora e pelo cron diario (cs.fn_hm_health_check) como rede de seguranca.';

grant execute on function cs.fn_hm_alerta_socio_sem_titular() to disparos_app;

-- Acrescenta a chamada ao corpo de cs.fn_hm_health_check por REPLACE MECÂNICO do
-- fonte (padrão 0216/0233): o banco está à frente do repo nessa função (0128,
-- 0131, 0139, 0208, 0233 já a alteraram) — reescrevê-la à mão a partir da 0122
-- apagaria o que essas migrations acumularam. Âncora: o `return query` final, que
-- hoje aparece UMA vez só (conferido em produção antes de escrever esta
-- migration). Se não achar, aborta — nunca grava função incompleta.
do $$
declare v_def text; v_novo text;
begin
  select pg_get_functiondef(p.oid) into v_def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'cs' and p.proname = 'fn_hm_health_check';

  if v_def is null then
    raise exception '0263: cs.fn_hm_health_check nao encontrada — abortado antes de mexer em nada';
  end if;

  v_novo := replace(v_def,
    E'\n  return query',
    E'\n  perform cs.fn_hm_alerta_socio_sem_titular();\n\n  return query');

  if v_novo = v_def then
    raise exception '0263: a ancora "return query" nao casou no fonte de cs.fn_hm_health_check — abortado antes de gravar funcao incompleta';
  end if;

  execute v_novo;
end $$;

-- ── [3.1] fn_hm_provisionar_socios — vigência + produto ──────────────────────────
-- `create or replace` NÃO troca lista de argumentos (armadilha da 0215) — precisa
-- dropar a assinatura antiga antes de recriar com o parâmetro novo.
drop function if exists cs.fn_hm_provisionar_socios(uuid);

create or replace function cs.fn_hm_provisionar_socios(p_comprador_id uuid, p_produto text default 'HM')
returns integer
language plpgsql
security definer
set search_path to 'cs', 'public', 'pg_temp'
as $function$
declare
  v_titular   record;
  s           record;
  v_socio_id  uuid;
  n           integer := 0;
begin
  -- Furo B (0221): sem filtrar produto, o sócio de um titular com card em dois
  -- boards (HM+AURUM) podia ser provisionado pelo comprador_id errado. Filtra
  -- explicitamente o board pedido — coalesce porque contatos_hm legados podem
  -- não ter `produto` cravado (default histórico = HM).
  select ch.id as card_id, ch.aluno_id, a.turma_id, a.plano, a.data_expiracao, a.data_compra
    into v_titular
    from cs.contatos_hm ch
    join public.thb_alunos a on a.id = ch.aluno_id
   where ch.comprador_id = p_comprador_id
     and coalesce(ch.produto, 'HM') = p_produto;
  if not found then return 0; end if;

  -- Furo A: sem `substituido_em is null`, o sócio ARQUIVADO (substituído por
  -- outro) era re-provisionado — ganhava acesso ao Searchie/Comunidade e contava
  -- em num_socios, contradizendo a 0203 ("arquivar, não apagar" não significa
  -- "arquivar e mesmo assim dar acesso").
  for s in select * from cs.hm_socios hs where hs.contato_hm_id = v_titular.card_id and hs.substituido_em is null loop
    v_socio_id := s.aluno_id;

    if v_socio_id is null and coalesce(trim(s.email), '') <> '' then
      select id into v_socio_id from public.thb_alunos
       where lower(trim(email)) = lower(trim(s.email)) limit 1;
    end if;

    if v_socio_id is null then
      insert into public.thb_alunos (
        nome, email, telefone, plano, turma_id, eh_socio, socio_de_aluno_id,
        data_compra, data_expiracao, origem_acesso, regra_acesso, tempo_acesso,
        situacao_financeira, link_facebook, fonte
      ) values (
        s.nome, nullif(trim(s.email), ''), s.telefone, coalesce(v_titular.plano, 'aluno'), v_titular.turma_id, true, v_titular.aluno_id,
        v_titular.data_compra, v_titular.data_expiracao, 'Sócio (HM)', 'Acompanha o titular', '1 ano',
        'acompanha_titular', s.link_facebook, 'sip_ativacao_hm'
      )
      returning id into v_socio_id;
    else
      update public.thb_alunos set
        eh_socio          = true,
        socio_de_aluno_id = v_titular.aluno_id,
        turma_id          = v_titular.turma_id,
        data_expiracao    = v_titular.data_expiracao,
        link_facebook     = coalesce(link_facebook, s.link_facebook),
        atualizado_em     = now()
      where id = v_socio_id;
    end if;

    update cs.hm_socios set aluno_id = v_socio_id, atualizado_em = now() where id = s.id;
    n := n + 1;
  end loop;

  update public.thb_alunos set num_socios = n, atualizado_em = now()
   where id = v_titular.aluno_id and coalesce(num_socios, 0) is distinct from n;

  return n;
end$function$;

comment on function cs.fn_hm_provisionar_socios(uuid, text) is
  '0263: fecha 2 furos da versao original (so p_comprador_id). (A) filtra substituido_em is null no loop — socio arquivado nao e re-provisionado, nao ganha acesso, nao conta em num_socios (0203: arquivar nao e dar acesso). (B) filtra ch.produto = p_produto (default HM) — sem isso, titular com card em dois boards podia provisionar o socio pelo comprador_id errado (bug real listado na 0221). Chamadores: lib/services/hm.ts provisionarSociosHm() e app/api/hm/contato/[id]/socios/provisionar/route.ts, ambos passando o produto que ja tem em mao.';

grant execute on function cs.fn_hm_provisionar_socios(uuid, text) to disparos_app;

-- Recontagem: com o filtro de vigência novo, quem já tinha num_socios contando
-- um sócio arquivado (hoje: ninguém, ver medição abaixo) fica correto.
update public.thb_alunos a set num_socios = sub.n, atualizado_em = now()
  from (
    select ch.aluno_id, count(*) as n
      from cs.hm_socios s
      join cs.contatos_hm ch on ch.id = s.contato_hm_id
     where s.substituido_em is null and ch.aluno_id is not null
     group by ch.aluno_id
  ) sub
 where a.id = sub.aluno_id and coalesce(a.num_socios, 0) is distinct from sub.n;

-- Trava de assinatura única (lição da 0215/0218): duas sobrecargas de
-- fn_hm_provisionar_socios é o mesmo bug que quebrou login de quem pagou 15 mil.
do $$
declare v_assinaturas int;
begin
  select count(*) into v_assinaturas
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'cs' and p.proname = 'fn_hm_provisionar_socios';
  if v_assinaturas <> 1 then
    raise exception '0263: esperava 1 assinatura de cs.fn_hm_provisionar_socios no catalogo, achei %. Sobrecarga ambigua (0215) — DROP a versao velha antes de seguir.', v_assinaturas;
  end if;
end $$;

-- Medição pedida pelo Marcio, provada no banco: sócio arquivado com titular já
-- provisionado (eh_socio apontando para vigência que não é mais a atual). Se
-- desse >0, esta migration NÃO revogaria nada (decisão 3: mantém acesso) — só
-- reportaria. Hoje é 0 porque nunca houve substituição real (0 arquivados).
do $$
declare v_arquivado_provisionado int;
begin
  select count(*) into v_arquivado_provisionado
    from public.thb_alunos a
    join cs.hm_socios s on s.aluno_id = a.id
   where a.eh_socio = true and s.substituido_em is not null;
  if v_arquivado_provisionado <> 0 then
    raise notice '0263: ATENCAO — % thb_alunos.eh_socio apontam para socio ARQUIVADO. NAO revogado (decisao 3 do Marcio: quem desfaz isso e a base mestre). Reportar ao Marcio.', v_arquivado_provisionado;
  end if;
end $$;

-- ── [3.2] O DELETE vira arquivamento ─────────────────────────────────────────────
-- Nenhuma alteração de schema aqui — a query já muda no TypeScript (ver
-- app/api/hm/contato/[id]/socios/route.ts). Registrado no comentário da tabela
-- para quem ler o schema direto sem ver o código de aplicação.
comment on column cs.hm_socios.substituido_em is
  '0203/0263: quando este socio deixou de ser o vigente do titular — por reenvio do formulario com outra pessoa (substituido_por preenchido) OU por remocao manual pela ficha (substituido_por NULL). NULL = e o socio atual. Arquivado, nao apagado: o DELETE fisico da rota manual foi trocado por este arquivamento (0263) porque cs.hm_socios_historico tem on delete cascade e apagaria o log de mudancas da pessoa.';

-- ── TRAVA FINAL: nenhum índice único em cs.hm_socios (exceto a PK) pode ignorar
-- a vigência. É o mesmo furo do [1.1] podendo voltar por qualquer outro caminho.
do $$
declare v_sem_recorte int;
begin
  select count(*) into v_sem_recorte
    from pg_indexes
   where schemaname = 'cs' and tablename = 'hm_socios'
     and indexname <> 'hm_socios_pkey'
     and indexdef ilike '%UNIQUE%'
     and indexdef not ilike '%substituido_em IS NULL%';
  if v_sem_recorte > 0 then
    raise exception '0263: sobrou % indice unico em cs.hm_socios sem recorte de vigencia (substituido_em is null) — o furo do titular-que-nao-consegue-voltar pode ter reaberto por outro caminho', v_sem_recorte;
  end if;
end $$;

commit;
