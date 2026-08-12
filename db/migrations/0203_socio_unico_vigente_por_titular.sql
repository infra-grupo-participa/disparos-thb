-- 0203 — UM sócio vigente por titular. Reenvio com pessoa diferente SUBSTITUI.
--
-- ── A REGRA (Marcio, 12/08/2026) ────────────────────────────────────────────────
--   "sócio só tem um, tá? Não tem como ter mais um sócio só. Então se tiver algum
--    com nome diferente ele não vai entrar, na verdade vai substituir o atual."
--   "pode ser que envie mais um formulário com um sócio que colocou errado. Ele
--    reenvia o formulário com o novo sócio e esse sócio seja o novo vigente dele.
--    Então o outro vai acabar deixando de existir."
--
-- Isso CORRIGE a 0201, que assumiu o oposto: lá, CPF diferente criava um SEGUNDO
-- sócio. A premissa estava errada.
--
-- ── AS DUAS SITUAÇÕES, E COMO SE DISTINGUEM ─────────────────────────────────────
--   CPF IGUAL      -> é CORREÇÃO. Atualiza o vigente (o caso do e-mail digitado
--                     errado e reenviado certo). Nada é substituído.
--   CPF DIFERENTE  -> é PESSOA NOVA. Vira o vigente; o anterior é ARQUIVADO.
--
-- O CPF decide porque é o único campo estável do formulário: nome e e-mail o
-- titular digita e corrige depois; CPF não muda.
--
-- ── ARQUIVAR, NÃO APAGAR (decisão do Marcio) ────────────────────────────────────
-- O sócio substituído sai do card e do board, mas a LINHA fica, marcada com
-- `substituido_em` e `substituido_por`. É o que permite responder depois "quem era
-- o sócio antes e quando trocou". Apagar levaria junto o histórico de mudanças
-- (`hm_socios_historico` tem on delete cascade).
--
-- ⚠️ Se o sócio arquivado já tinha sido provisionado na base mestre THB
-- (`aluno_id` preenchido), o cadastro LÁ não é tocado — mesma regra do DELETE da
-- rota de sócios: "não apaga o aluno na base; quem desfaz isso é a base mestre,
-- não o kanban".
--
-- ESTADO HOJE: 14 sócios / 14 titulares, nenhum titular com 2+. A realidade já
-- respeita a regra — esta migration a TRAVA para que continue assim.

alter table cs.hm_socios
  add column if not exists substituido_em  timestamptz,
  add column if not exists substituido_por uuid references cs.hm_socios(id) on delete set null;

comment on column cs.hm_socios.substituido_em is
  '0203: quando este socio deixou de ser o vigente do titular (reenvio do formulario com outra pessoa). NULL = e o socio atual. Arquivado, nao apagado: o historico de quem era antes se perde no DELETE.';
comment on column cs.hm_socios.substituido_por is
  '0203: o socio que tomou o lugar deste. Permite reconstruir a cadeia de trocas.';

-- ── A TRAVA ─────────────────────────────────────────────────────────────────────
-- UM vigente por titular, garantido pelo banco. Os índices da 0201 (card+CPF,
-- card+email) passam a valer só entre os ARQUIVADOS — o vigente é único por
-- definição, e sem o recorte eles impediriam o titular de voltar a um sócio que
-- já foi dele antes.
drop index if exists cs.hm_socios_card_cpf_uniq;
drop index if exists cs.hm_socios_card_email_uniq;

create unique index if not exists hm_socios_um_vigente_uniq
  on cs.hm_socios (contato_hm_id) where substituido_em is null;

comment on index cs.hm_socios_um_vigente_uniq is
  '0203: UM socio vigente por titular (regra do Marcio 12/08). O segundo insert sem arquivar o primeiro falha aqui — a regra nao depende de a aplicacao lembrar.';

-- ── A VIEW SÓ ENXERGA O VIGENTE ─────────────────────────────────────────────────
-- Definição idêntica à anterior; muda só o `where`. É por ela que o board, o XLSX
-- e a ficha leem — filtrar aqui é o que faz o sócio antigo sumir da tela sem
-- precisar tocar em nenhuma das telas.
create or replace view cs.vw_hm_socios as
 SELECT s.id AS socio_id, s.contato_hm_id, s.nome, s.email, s.telefone,
    s.link_facebook, s.ativ_searchie, s.ativ_comunidade, s.ativ_grupo, s.aluno_id,
    s.criado_em,
    ch.comprador_id AS titular_comprador_id,
    cp.nome AS titular_nome,
    ch.turma AS titular_turma,
    ch.turma_origem AS titular_origem,
    e.chave AS titular_estagio_chave,
    ch.cancelamento_efetivado_em IS NOT NULL OR e.chave = 'hm_reembolsado'::text AS titular_cancelado,
    s.ativ_searchie::integer + s.ativ_comunidade::integer + s.ativ_grupo::integer AS checks_feitos,
        CASE
            WHEN ch.cancelamento_efetivado_em IS NOT NULL OR e.chave = 'hm_reembolsado'::text THEN 'sem_acesso'::text
            WHEN s.ativ_searchie AND s.ativ_comunidade AND s.ativ_grupo THEN 'ativado'::text
            WHEN s.ativ_searchie OR s.ativ_comunidade OR s.ativ_grupo THEN 'em_ativacao'::text
            ELSE 'nao_iniciado'::text
        END AS status,
    ch.aluno_id AS titular_aluno_id,
    s.origem, s.estagio_id, se.chave AS estagio_chave
   FROM cs.hm_socios s
     JOIN cs.contatos_hm ch ON ch.id = s.contato_hm_id
     JOIN compradores cp ON cp.id = ch.comprador_id
     LEFT JOIN cs.estagios e ON e.id = ch.estagio_id
     LEFT JOIN cs.estagios se ON se.id = s.estagio_id
  WHERE s.substituido_em IS NULL;   -- 0203: só o vigente

-- Quem era o sócio antes: a linha do tempo da troca, para a ficha e para auditoria.
create or replace view cs.vw_hm_socios_historico_titular as
  SELECT s.contato_hm_id, ch.comprador_id AS titular_comprador_id,
         s.id AS socio_id, s.nome, s.cpf, s.email, s.telefone,
         s.criado_em, s.substituido_em, s.substituido_por,
         (s.substituido_em IS NULL) AS vigente
    FROM cs.hm_socios s
    JOIN cs.contatos_hm ch ON ch.id = s.contato_hm_id
   ORDER BY s.contato_hm_id, s.criado_em;

comment on view cs.vw_hm_socios_historico_titular is
  '0203: TODOS os socios que um titular ja teve, vigente e arquivados, na ordem. Responde "quem era o socio antes e quando trocou".';

grant select on cs.vw_hm_socios_historico_titular to disparos_app;

-- ── O UPSERT COM SUBSTITUIÇÃO ───────────────────────────────────────────────────
-- Substitui a versão da 0201. Agora devolve também `substituiu` (o nome de quem
-- saiu), para o webhook escrever na timeline do titular a troca — que é um evento
-- que o comercial precisa ver, diferente de uma correção de telefone.
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
returns table (socio_id uuid, acao text, substituiu text)
language plpgsql
security definer
set search_path = cs, public, pg_temp
as $function$
declare
  v_cpf    text := cs.fn_so_digitos(p_cpf);
  v_email  text := nullif(lower(trim(p_email)), '');
  v_id     uuid;
  v_antes  cs.hm_socios%rowtype;
  v_depois cs.hm_socios%rowtype;
  v_vig    cs.hm_socios%rowtype;
begin
  if p_contato_hm_id is null or nullif(trim(coalesce(p_nome,'')), '') is null then
    raise exception 'contato_hm_id e nome sao obrigatorios';
  end if;

  -- O sócio VIGENTE deste titular (no máximo um, garantido pelo índice).
  select * into v_vig from cs.hm_socios
   where contato_hm_id = p_contato_hm_id and substituido_em is null;

  -- É o MESMO sócio? Só o CPF decide. Sem CPF dos dois lados, cai no e-mail —
  -- último recurso para formulário incompleto.
  if v_vig.id is not null then
    if v_cpf is not null and v_vig.cpf is not null then
      if v_cpf = v_vig.cpf then v_antes := v_vig; end if;
    elsif v_email is not null and v_vig.email is not null and lower(v_vig.email) = v_email then
      v_antes := v_vig;
    elsif v_cpf is null and v_email is null then
      -- Reenvio sem CPF e sem e-mail: não dá para afirmar que é outra pessoa.
      -- Trata como correção do vigente — trocar por engano é pior que atualizar.
      v_antes := v_vig;
    end if;
  end if;

  -- ── PESSOA NOVA: arquiva o vigente e entra no lugar ──────────────────────────
  if v_antes.id is null then
    -- ⚠️ ORDEM IMPORTA: arquiva ANTES de inserir. O índice `hm_socios_um_vigente_uniq`
    -- cobre `where substituido_em is null` e NÃO é deferrable — inserir primeiro
    -- faria dois vigentes coexistirem por um instante dentro da transação, e o
    -- insert falharia com violação de unicidade. Arquivando antes, nunca há dois.
    if v_vig.id is not null then
      update cs.hm_socios
         set substituido_em = now(), atualizado_em = now()
       where id = v_vig.id;
    end if;

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

    -- Só agora dá para apontar o sucessor: o id do novo não existia antes.
    if v_vig.id is not null then
      update cs.hm_socios set substituido_por = v_id where id = v_vig.id;
      return query select v_id, 'substituido'::text, v_vig.nome;
      return;
    end if;

    return query select v_id, 'inserido'::text, null::text;
    return;
  end if;

  -- ── MESMA PESSOA: corrige os dados ───────────────────────────────────────────
  -- `coalesce(novo, atual)`: campo vazio no reenvio NÃO apaga dado bom.
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

  select * into v_depois from cs.hm_socios where id = v_antes.id;

  -- Compara ESTADO, não janela de tempo (lição da 0201b: dois envios no mesmo
  -- instante davam falso 'atualizado').
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
                then 'atualizado' else 'sem_mudanca' end,
           null::text;
end$function$;

comment on function cs.fn_hm_socio_upsert is
  '0203: UM socio vigente por titular. Mesmo CPF = corrige o vigente; CPF diferente = pessoa nova, ARQUIVA o anterior (substituido_em/substituido_por) e assume o lugar. Devolve inserido|substituido|atualizado|sem_mudanca + o nome de quem saiu. NAO toca no card do titular.';
