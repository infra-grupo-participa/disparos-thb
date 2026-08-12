-- 0201 — sócios vindos do formulário do Respondi: identidade por CPF, histórico de
-- mudanças e ZERO duplicidade de card.
--
-- ── O PEDIDO (Marcio, 12/08/2026) ───────────────────────────────────────────────
-- Vai entrar um webhook do Respondi com o formulário de sócios. O titular já
-- matriculado preenche os dados do SÓCIO dele. O problema real a resolver:
--
--   "a mesma pessoa preenche o formulário diversas vezes, às vezes pra fazer
--    alguma correção nos dados"
--
-- Então: reenvio NÃO pode virar sócio novo, NÃO pode duplicar card no Kanban, e
-- toda alteração de dado tem de ficar registrada com data ("tal data ele mudou o
-- dado"). O titular pode estar em qualquer etapa (reunião, ativação) e o reenvio
-- não pode movê-lo nem recriá-lo.
--
-- ── AS 3 DECISÕES DO MARCIO ─────────────────────────────────────────────────────
--   1. IDENTIDADE = CPF do sócio. É o único campo do formulário que identifica a
--      pessoa de verdade: nome e e-mail o titular digita e corrige depois. Mesmo
--      CPF -> UPDATE (mesmo que nome/e-mail tenham mudado). CPF novo -> sócio novo.
--   2. TITULAR NÃO ENCONTRADO -> pendência + alerta (não se perde nada, alguém
--      concilia). Mesmo padrão do alerta de oferta órfã.
--   3. BOARD = só HM. AURUM e ETHB ficam intactos.
--
-- ── POR QUE O CARD NÃO DUPLICA ──────────────────────────────────────────────────
-- Sócio NUNCA foi card: cs.hm_socios é uma tabela pendurada no card do titular
-- (contato_hm_id) e o board a lê num array separado (rota do kanban, `socios`).
-- Esta migration não cria card nenhum e não toca cs.contatos_hm. O que ela impede
-- é a duplicidade DO SÓCIO — que hoje é real: `on conflict do nothing` na rota de
-- sócios não tem índice único em que se apoiar, então nunca conflita e todo POST
-- insere de novo.

-- ── 1) OS CAMPOS QUE O FORMULÁRIO COLETA E A TABELA NÃO TINHA ───────────────────
-- cs.hm_socios só tinha nome/email/telefone. O formulário traz CPF e endereço
-- completo. Sem coluna, esse dado morreria no payload.
alter table cs.hm_socios
  add column if not exists cpf          text,
  add column if not exists cep          text,
  add column if not exists cidade       text,
  add column if not exists estado       text,
  add column if not exists bairro       text,
  add column if not exists pais         text,
  add column if not exists endereco     text,
  add column if not exists numero       text,
  add column if not exists complemento  text,
  add column if not exists observacao   text,
  -- Rastro da origem: qual resposta do Respondi criou/atualizou este sócio.
  add column if not exists respondi_id  text,
  add column if not exists respondido_em timestamptz;

comment on column cs.hm_socios.cpf is
  '0201: identidade do socio (decisao do Marcio 12/08). So digitos — normalizado por cs.fn_so_digitos. E a chave do upsert do formulario: mesmo CPF no mesmo card = UPDATE, nunca insert.';

-- ── 2) NORMALIZAÇÃO ─────────────────────────────────────────────────────────────
-- O CPF chega como o titular digitou: "123.456.789-01", "12345678901", com espaço.
-- Guardar só dígitos é o que faz "mesmo CPF" significar a mesma coisa sempre.
create or replace function cs.fn_so_digitos(p text)
returns text
language sql
immutable
as $function$
  select nullif(regexp_replace(coalesce(p, ''), '[^0-9]', '', 'g'), '');
$function$;

comment on function cs.fn_so_digitos(text) is
  '0201: reduz a string a digitos (CPF, CEP, telefone). IMMUTABLE de proposito: e usada em indice unico.';

-- Normaliza o que já existe antes de criar o índice (hoje: 13 sócios, nenhum com
-- CPF — mas a migration tem de ser correta se rodar de novo num banco já populado).
update cs.hm_socios set cpf = cs.fn_so_digitos(cpf) where cpf is distinct from cs.fn_so_digitos(cpf);

-- ── 3) A CHAVE QUE IMPEDE A DUPLICIDADE ─────────────────────────────────────────
-- Um CPF só pode aparecer UMA vez por card de titular. Índice PARCIAL: sócio sem
-- CPF (cadastro manual pela ficha, que não exige CPF) não entra na regra e segue
-- funcionando como sempre.
create unique index if not exists hm_socios_card_cpf_uniq
  on cs.hm_socios (contato_hm_id, cpf)
  where cpf is not null;

-- Rede de segurança para o cadastro manual (sem CPF): mesmo card + mesmo e-mail
-- também não duplica. Sem isto, o `on conflict do nothing` da rota de sócios
-- continua sem nada em que se apoiar.
create unique index if not exists hm_socios_card_email_uniq
  on cs.hm_socios (contato_hm_id, lower(email))
  where cpf is null and email is not null;

-- ── 4) O LOG DE MUDANÇAS ────────────────────────────────────────────────────────
-- "houver a mudança dos dados, a gente precisa ter log disso ... pra gente poder
--  saber: ó tal data ele mudou o dado."
-- Uma linha por CAMPO alterado, com valor antigo, valor novo e data.
create table if not exists cs.hm_socios_historico (
  id           bigserial primary key,
  socio_id     uuid not null references cs.hm_socios(id) on delete cascade,
  campo        text not null,
  valor_antigo text,
  valor_novo   text,
  origem       text,
  alterado_em  timestamptz not null default now()
);

create index if not exists hm_socios_historico_socio_ix
  on cs.hm_socios_historico (socio_id, alterado_em desc);

comment on table cs.hm_socios_historico is
  '0201: uma linha por CAMPO alterado de um socio, com valor antigo/novo e data. Alimentado por trigger — pega alteracao de QUALQUER origem (webhook do Respondi, ficha, script), nao so do formulario.';

-- Trigger, não código de aplicação: assim o histórico pega alteração de qualquer
-- caminho de escrita. Registrar no service só cobriria quem lembrasse de chamar.
create or replace function cs.fn_hm_socios_log_mudanca()
returns trigger
language plpgsql
security definer
set search_path = cs, public, pg_temp
as $function$
declare
  v_campo text;
  v_ant   text;
  v_novo  text;
begin
  foreach v_campo in array array[
    'nome','email','telefone','cpf','cep','cidade','estado','bairro','pais',
    'endereco','numero','complemento','observacao','link_facebook'
  ] loop
    execute format('select ($1).%I::text, ($2).%I::text', v_campo, v_campo)
       into v_ant, v_novo using old, new;

    if v_ant is distinct from v_novo then
      insert into cs.hm_socios_historico (socio_id, campo, valor_antigo, valor_novo, origem)
      values (new.id, v_campo, v_ant, v_novo, coalesce(new.origem, 'desconhecida'));
    end if;
  end loop;
  return new;
end$function$;

drop trigger if exists trg_hm_socios_log on cs.hm_socios;
create trigger trg_hm_socios_log
  after update on cs.hm_socios
  for each row execute function cs.fn_hm_socios_log_mudanca();

-- ── 5) A FILA DE PENDÊNCIAS ─────────────────────────────────────────────────────
-- Resposta cujo titular não foi encontrado na esteira HM. Guarda o payload inteiro
-- para dar para reprocessar depois que o card existir — nada se perde.
create table if not exists cs.hm_socios_pendentes (
  id             bigserial primary key,
  titular_nome   text,
  titular_email  text,
  socio_nome     text,
  socio_cpf      text,
  payload        jsonb not null,
  motivo         text not null,
  recebido_em    timestamptz not null default now(),
  resolvido_em   timestamptz,
  resolvido_nota text
);

create index if not exists hm_socios_pendentes_aberto_ix
  on cs.hm_socios_pendentes (recebido_em desc) where resolvido_em is null;

comment on table cs.hm_socios_pendentes is
  '0201: resposta do formulario de socios cujo titular nao casou com card do HM. Guarda o payload inteiro para reprocessar quando o card existir. Alimenta o alerta socio_sem_titular.';

-- ── 6) O UPSERT ─────────────────────────────────────────────────────────────────
-- O coração da regra. Recebe os dados já normalizados e decide sozinho entre
-- INSERT e UPDATE pela chave (card + CPF).
--
-- Devolve a ação tomada ('inserido' | 'atualizado' | 'sem_mudanca') para o webhook
-- poder escrever na timeline só quando algo realmente mudou — reenvio idêntico não
-- polui a ficha do titular.
--
-- ⚠️ NÃO toca em cs.contatos_hm, estágio, responsável ou qualquer coisa do card do
-- titular. É essa omissão que garante o pedido do Marcio: "não pode afetar no
-- Kanban". Um titular em Reunião ou Ativação segue exatamente onde está.
create or replace function cs.fn_hm_socio_upsert(
  p_contato_hm_id uuid,
  p_nome          text,
  p_cpf           text,
  p_email         text,
  p_telefone      text,
  p_cep           text  default null,
  p_cidade        text  default null,
  p_estado        text  default null,
  p_bairro        text  default null,
  p_pais          text  default null,
  p_endereco      text  default null,
  p_numero        text  default null,
  p_complemento   text  default null,
  p_observacao    text  default null,
  p_respondi_id   text  default null,
  p_origem        text  default 'respondi'
)
returns table (socio_id uuid, acao text)
language plpgsql
security definer
set search_path = cs, public, pg_temp
as $function$
declare
  v_cpf   text := cs.fn_so_digitos(p_cpf);
  v_email text := nullif(lower(trim(p_email)), '');
  v_id     uuid;
  v_antes  cs.hm_socios%rowtype;
  v_depois cs.hm_socios%rowtype;
begin
  if p_contato_hm_id is null or nullif(trim(coalesce(p_nome,'')), '') is null then
    raise exception 'contato_hm_id e nome sao obrigatorios';
  end if;

  -- Acha o sócio existente: por CPF (a identidade) ou, sem CPF, por e-mail.
  if v_cpf is not null then
    select * into v_antes from cs.hm_socios
     where contato_hm_id = p_contato_hm_id and cpf = v_cpf;
  elsif v_email is not null then
    select * into v_antes from cs.hm_socios
     where contato_hm_id = p_contato_hm_id and lower(email) = v_email
     order by (cpf is null) desc, criado_em limit 1;
  end if;

  if v_antes.id is null then
    insert into cs.hm_socios (
      contato_hm_id, nome, cpf, email, telefone, cep, cidade, estado, bairro,
      pais, endereco, numero, complemento, observacao, respondi_id,
      respondido_em, origem
    ) values (
      p_contato_hm_id, trim(p_nome), v_cpf, v_email,
      cs.fn_so_digitos(p_telefone), cs.fn_so_digitos(p_cep),
      nullif(trim(p_cidade),''), nullif(trim(p_estado),''), nullif(trim(p_bairro),''),
      nullif(trim(p_pais),''), nullif(trim(p_endereco),''), nullif(trim(p_numero),''),
      nullif(trim(p_complemento),''), nullif(trim(p_observacao),''), p_respondi_id,
      now(), p_origem
    )
    returning id into v_id;
    return query select v_id, 'inserido'::text;
    return;
  end if;

  -- Já existe: ATUALIZA (nunca insere). O trigger de histórico registra campo a
  -- campo o que mudou. `coalesce(novo, atual)` de propósito: campo que vem vazio
  -- no reenvio NÃO apaga dado bom que já estava lá.
  update cs.hm_socios s set
    nome          = coalesce(nullif(trim(p_nome), ''), s.nome),
    cpf           = coalesce(v_cpf, s.cpf),
    email         = coalesce(v_email, s.email),
    telefone      = coalesce(cs.fn_so_digitos(p_telefone), s.telefone),
    cep           = coalesce(cs.fn_so_digitos(p_cep), s.cep),
    cidade        = coalesce(nullif(trim(p_cidade), ''), s.cidade),
    estado        = coalesce(nullif(trim(p_estado), ''), s.estado),
    bairro        = coalesce(nullif(trim(p_bairro), ''), s.bairro),
    pais          = coalesce(nullif(trim(p_pais), ''), s.pais),
    endereco      = coalesce(nullif(trim(p_endereco), ''), s.endereco),
    numero        = coalesce(nullif(trim(p_numero), ''), s.numero),
    complemento   = coalesce(nullif(trim(p_complemento), ''), s.complemento),
    observacao    = coalesce(nullif(trim(p_observacao), ''), s.observacao),
    respondi_id   = coalesce(p_respondi_id, s.respondi_id),
    respondido_em = now(),
    origem        = coalesce(p_origem, s.origem),
    atualizado_em = now()
  where s.id = v_antes.id;

  -- 'sem_mudanca' = reenvio idêntico. O webhook usa isso para não escrever na
  -- timeline do titular a cada reenvio sem alteração real.
  --
  -- ⚠️ Compara o ESTADO (antes x depois), não uma janela de tempo. A 1ª versão
  -- perguntava "houve log nos últimos 2 segundos?" e dava falso 'atualizado'
  -- quando dois envios caíam no mesmo instante — que é exatamente o caso de um
  -- reenvio rápido, o cenário que esta função existe para tratar.
  select * into v_depois from cs.hm_socios where id = v_antes.id;

  return query
    select v_antes.id,
           case when (
                  v_antes.nome, v_antes.email, v_antes.telefone, v_antes.cpf,
                  v_antes.cep, v_antes.cidade, v_antes.estado, v_antes.bairro,
                  v_antes.pais, v_antes.endereco, v_antes.numero,
                  v_antes.complemento, v_antes.observacao
                ) is distinct from (
                  v_depois.nome, v_depois.email, v_depois.telefone, v_depois.cpf,
                  v_depois.cep, v_depois.cidade, v_depois.estado, v_depois.bairro,
                  v_depois.pais, v_depois.endereco, v_depois.numero,
                  v_depois.complemento, v_depois.observacao
                )
                then 'atualizado' else 'sem_mudanca' end;
end$function$;

comment on function cs.fn_hm_socio_upsert is
  '0201: insere ou ATUALIZA o socio pela chave (card + CPF), nunca duplicando. Campo vazio no reenvio nao apaga dado existente. NAO toca no card do titular (estagio/responsavel) — reenvio do formulario nao pode mexer no Kanban. Devolve inserido|atualizado|sem_mudanca.';

-- ── 7) PERMISSÕES ───────────────────────────────────────────────────────────────
-- Mesmo padrão da 0199/0200: a role do app lê e executa; escrita nas tabelas de
-- controle é das funções (donas postgres).
grant select on cs.hm_socios_historico to disparos_app;
grant select on cs.hm_socios_pendentes to disparos_app;
grant insert on cs.hm_socios_pendentes to disparos_app;
grant usage, select on sequence cs.hm_socios_pendentes_id_seq to disparos_app;
grant execute on function cs.fn_hm_socio_upsert(uuid,text,text,text,text,text,text,text,text,text,text,text,text,text,text,text) to disparos_app;
grant execute on function cs.fn_so_digitos(text) to disparos_app;
