-- 0265 — A venda nova nasce SEM operador. A Kelly distribui; ninguém "acha
-- que já está tratado" mais.
--
-- ── O PEDIDO (Marcio, 17/08/2026) ────────────────────────────────────────────
-- Caso real: a Kelly pediu link de cobrança de um cliente que a JUSY estava
-- tratando. Causa raiz: `cs.fn_hm_carimba_equipe_padrao()` (0146 → 0161 → 0212)
-- carimba `responsavel_id` E `responsavel_comercial_id` = Kelly em TODA venda
-- nova de HM/AURUM, na hora em que o card nasce — e grava uma interação de
-- sistema dizendo que já foi "atribuída automaticamente". O card não fica sem
-- dono um segundo sequer: nasce com a Kelly como dona, então nada na tela
-- sinaliza "isto ainda não foi distribuído" — a Kelly vê o card como qualquer
-- outro dela e não sabe que precisa repassar.
--
-- Nas palavras do Marcio: "Ela [Kelly] é quem vai mover pro pessoal, mas tem
-- que ter esse aviso gritando na tela dela, e os demais operadores não podem
-- ver o cliente, enquanto ela não associar, como ela com uma associação de
-- gestor... aí os operadores vão ter seu responsável no comercial e na
-- ativação."
--
-- ── CONTRADIZ EXPLICITAMENTE A 0161 E A 0212 ────────────────────────────────
-- A 0161 introduziu `cs.hm_config.responsavel_padrao_id` e o carimbo
-- automático de `responsavel_id` na venda nova — dizia, no próprio comentário,
-- "efeito colateral CONHECIDO e aceito: (...) o card sai do pool". A 0212
-- estendeu o MESMO carimbo para `responsavel_comercial_id`, no mesmo update.
-- Esta migration REVERTE só essa parte das duas: quem ler só a 0212 e achar
-- que o carimbo de responsável ainda existe está lendo código morto — a versão
-- vigente da função é esta. O carimbo de EQUIPE (`equipe_padrao_id`, 0146)
-- CONTINUA — é escopo de visibilidade (que fila alcança o card), não dono.
--
-- ── O QUE NÃO MUDA (decisão do Marcio, não é regressão) ──────────────────────
-- `gerente_distribuidor` (0161) já É o conceito de "gestor de distribuição":
-- vê a esteira inteira (`podeVerTudo`) e atribui para QUALQUER equipe
-- (`podeAtribuirPara`), lib/papeis.ts. A Kelly já tem a flag (conferido em
-- produção antes desta migration: `gerente_distribuidor = true`). Não criamos
-- nível/papel novo — reusamos o que a 0161 já resolveu. O que faltava era só
-- (a) a venda não nascer mais com dono e (b) card sem dono deixar de ser
-- "pool visível a todo mundo" e virar "fila de entrada visível só a quem
-- gerencia" — isso é ajuste em `lib/services/visibilidade.ts`
-- (`ehCardLivre`/`sqlCardLivre`), TypeScript, não em SQL: o predicado de
-- visibilidade do HM não mora em view nem em função — mora ali, e nos dois
-- módulos espelhados (SQL das listagens e JS das rotas unitárias). Ver o
-- commit que acompanha esta migration.
--
-- ── O QUE ESTA MIGRATION FAZ ─────────────────────────────────────────────────
--   1. `cs.fn_hm_carimba_equipe_padrao()` (4ª reescrita: 0146 → 0161 → 0212 →
--      AQUI) para de gravar `responsavel_id`/`responsavel_comercial_id` e de
--      inserir a interação "atribuída automaticamente". Mantém o carimbo de
--      `equipe_padrao_id`, idêntico ao de sempre.
--   2. `cs.hm_config.responsavel_padrao_id` NÃO é dropada (reversibilidade —
--      se o Marcio quiser voltar atrás, é um UPDATE, não uma migration nova).
--      Só é ZERADA (`update ... set responsavel_padrao_id = null`) para o
--      dado parar de mentir: a coluna ficaria apontando para a Kelly enquanto
--      a função que a lia deixa de ler.
--   3. Alerta `venda_sem_operador` (mesmo padrão de
--      `cs.fn_hm_alerta_socio_sem_titular`, 0263): security definer, um
--      alerta POR CARD, severidade crítico, auto-resolve quando o card ganha
--      operador, só para card ATIVO (não cancelado). Janela de 4 horas sem
--      operador antes de acender — número não travado pelo Marcio, ajustável
--      com um UPDATE no `interval` do WHERE (documentado no corpo da função).
--      Entra em `cs.fn_hm_health_check` por replace mecânico do fonte, padrão
--      0216/0233/0263.
--   4. Backfill: 6 cards que já nasceram carimbados para a Kelly (0161/0212) e
--      NUNCA foram remanejados — nenhuma interação humana, só os eventos de
--      sistema (criação, pagamento, a atribuição automática). Medido nesta
--      migration por "nenhuma interação com tipo <> 'sistema'" — os outros 61
--      cards da Kelly têm mudança de estágio, nota ou atendimento registrado
--      e continuam intocados (estão em uso, remanejá-los agora seria a
--      migration decidindo por cima de trabalho já em andamento).
--      `responsavel_comercial_id` NÃO é tocado no backfill: `fn_hm_congela_
--      comercial` (0212) recusa a transação inteira se um `responsavel_
--      comercial_id` não-nulo mudar de valor — e os 6 já têm essa coluna
--      congelada (quem vendeu é histórico imutável, mesmo estando errado por
--      força do carimbo automático que esta migration está desligando).
--      Só `responsavel_id` é limpo, com interação `tipo='sistema'` explicando
--      o reset.
--   5. `cs.usuario_funcoes`: insert idempotente de HM/comercial para a Kelly.
--      Pedido explícito do Marcio ("na ativação a ana camila e o thomas" — no
--      comercial, "a jusy, kelly e jonathan"): o dropdown de responsável
--      comercial do board (app/api/hm/kanban, app/api/hm/tabela) passou a
--      filtrar por esta função (lib/services/visibilidade.ts,
--      listaResponsaveis), e a Kelly media 0 linhas em cs.usuario_funcoes —
--      sem este insert ela sumiria do próprio dropdown que ela é dona de
--      distribuir. Ela já tem o portal HM (cs.usuario_portais, conferido em
--      produção) — o insert não precisa provisionar portal, só a função.
--
-- Envolvida em transação: qualquer raise exception desfaz tudo.
-- =====================================================================

begin;

-- ── [1] O carimbo perde o dono, mantém a equipe ──────────────────────────────
create or replace function cs.fn_hm_carimba_equipe_padrao()
returns trigger language plpgsql
set search_path to 'cs','public','pg_temp'
as $function$
declare
  v_equipe uuid;
begin
  if new.equipe_padrao_id is not null or new.responsavel_id is not null then
    return new;  -- já nasceu com equipe/dono explícito: respeita
  end if;

  select equipe_padrao_id into v_equipe from cs.hm_config where id = 1;

  if v_equipe is not null then
    update cs.contatos_hm set equipe_padrao_id = v_equipe where id = new.id;
  end if;

  -- 0265: o bloco que carimbava responsavel_id/responsavel_comercial_id
  -- (0161/0212) SAIU daqui, de propósito. Venda nova nasce sem operador — é a
  -- fila de entrada da Kelly (gerente_distribuidor, 0161), que distribui na
  -- mão. Quem ler a 0212 e achar que o carimbo de responsável ainda existe
  -- está lendo código morto: esta é a versão vigente da função.

  return new;
end$function$;

comment on function cs.fn_hm_carimba_equipe_padrao() is
  '0265: reverte o carimbo de responsavel_id/responsavel_comercial_id introduzido pela 0161 e estendido pela 0212 — venda nova de HM/AURUM nasce SEM operador (fila de entrada da Kelly, gerente_distribuidor). Mantem so o carimbo de equipe_padrao_id (0146), que e escopo de visibilidade, nao dono. Motivo: card com dono carimbado na hora do nascimento nunca sinalizava "falta distribuir" — a Kelly tratava como card normal dela.';

-- trigger em si não muda (AFTER INSERT em cs.contatos_hm) — recriada só para
-- garantir que aponta para a função nova, mesmo padrão das migrations 0146/0161.
drop trigger if exists trg_hm_carimba_equipe_padrao on cs.contatos_hm;
create trigger trg_hm_carimba_equipe_padrao
  after insert on cs.contatos_hm
  for each row execute function cs.fn_hm_carimba_equipe_padrao();

-- ── [2] hm_config.responsavel_padrao_id: zera, não dropa ────────────────────
-- Reversível com um UPDATE (`set responsavel_padrao_id = (select id from
-- cs.usuarios where email = 'kelly@advmais.com')`) se o Marcio decidir voltar
-- atrás — nenhuma migration nova precisaria rodar. Zerado agora para o dado
-- não mentir: a função que lia esta coluna parou de ler no bloco [1] acima.
update cs.hm_config
   set responsavel_padrao_id = null,
       atualizado_em = now()
 where id = 1;

comment on column cs.hm_config.responsavel_padrao_id is
  'Usuario que recebia toda venda NOVA de HM/AURUM como responsavel (0161). ZERADA em 0265: cs.fn_hm_carimba_equipe_padrao() parou de ler esta coluna — venda nova nasce sem operador. Coluna preservada (nao dropada) para reversibilidade: repopular com um UPDATE religa o comportamento antigo sem migration nova.';

-- ── [3] Alerta venda_sem_operador (padrão 0263: fn_hm_alerta_socio_sem_titular) ──
-- Um alerta crítico POR CARD ativo (não cancelado) que ficou 4h+ sem
-- responsavel_id. Janela de 4h — não fixada pelo Marcio; ajustável trocando o
-- `interval '4 hours'` abaixo num UPDATE de função (create or replace), sem
-- precisar de migration nova. `security definer` + `set search_path`, mesmo
-- padrão de segurança do resto do módulo HM.
create or replace function cs.fn_hm_alerta_venda_sem_operador()
returns integer
language plpgsql
security definer
set search_path to 'cs', 'public', 'pg_temp'
as $function$
declare v_n integer := 0;
begin
  insert into cs.hm_alertas (tipo, chave, severidade, detalhe)
  select 'venda_sem_operador', ch.id::text, 'critico',
         format('%s (%s), produto %s, está sem operador há %s — a distribuição para o comercial não foi feita.',
                coalesce(cmp.nome, '(sem nome)'),
                coalesce(cmp.email, '(sem e-mail)'),
                coalesce(ch.produto, 'HM'),
                to_char(now() - ch.criado_em, 'HH24"h"MI"m"'))
    from cs.contatos_hm ch
    join compradores cmp on cmp.id = ch.comprador_id
   where ch.responsavel_id is null
     and ch.cancelamento_em is null
     and ch.criado_em < now() - interval '4 hours'
     and not exists (
       select 1 from cs.hm_alertas a
        where a.tipo = 'venda_sem_operador' and a.chave = ch.id::text and a.resolvido_em is null)
   on conflict do nothing;
  get diagnostics v_n = row_count;

  -- Auto-resolução: card ganhou operador (Kelly distribuiu) — o alerta que
  -- ele abriu fecha sozinho.
  update cs.hm_alertas a set resolvido_em = now()
   where a.resolvido_em is null and a.tipo = 'venda_sem_operador'
     and exists (
       select 1 from cs.contatos_hm ch
        where ch.id::text = a.chave and ch.responsavel_id is not null);

  return v_n;
end$function$;

comment on function cs.fn_hm_alerta_venda_sem_operador() is
  '0265: um alerta critico por card ATIVO (cancelamento_em is null) de HM/AURUM sem responsavel_id ha mais de 4h (interval ajustavel por UPDATE nesta funcao). Dono = Kelly (gerente_distribuidor, 0161), que passa a distribuir na mao a venda nova. Chamada pelo cron diario (cs.fn_hm_health_check) como rede de seguranca — mesmo padrao de cs.fn_hm_alerta_socio_sem_titural (0263).';

grant execute on function cs.fn_hm_alerta_venda_sem_operador() to disparos_app;

-- Acrescenta a chamada ao corpo de cs.fn_hm_health_check por REPLACE MECÂNICO
-- do fonte (padrão 0216/0233/0263): o banco está à frente do repo nessa
-- função — reescrevê-la à mão apagaria o que as migrations anteriores
-- acumularam. Âncora: o `return query` final. A 0263 já injetou uma chamada
-- ali (fn_hm_alerta_socio_sem_titular) — a âncora `\n  return query` continua
-- casando UMA vez só (a chamada da 0263 fica ANTES do return query, esta fica
-- logo antes dela). Idempotência: se esta migration rodar duas vezes, a
-- segunda vez não encontra mais `\n  return query` cru (já foi substituído na
-- primeira) — cai no `raise exception` abaixo em vez de duplicar a chamada.
do $$
declare v_def text; v_novo text;
begin
  select pg_get_functiondef(p.oid) into v_def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'cs' and p.proname = 'fn_hm_health_check';

  if v_def is null then
    raise exception '0265: cs.fn_hm_health_check nao encontrada — abortado antes de mexer em nada';
  end if;

  if v_def like '%fn_hm_alerta_venda_sem_operador%' then
    raise exception '0265: cs.fn_hm_health_check ja chama fn_hm_alerta_venda_sem_operador() — migration ja aplicada, abortado para nao duplicar a chamada';
  end if;

  v_novo := replace(v_def,
    E'\n  return query',
    E'\n  perform cs.fn_hm_alerta_venda_sem_operador();\n\n  return query');

  if v_novo = v_def then
    raise exception '0265: a ancora "return query" nao casou no fonte de cs.fn_hm_health_check — abortado antes de gravar funcao incompleta';
  end if;

  execute v_novo;
end $$;

-- ── [4] Backfill: os 6 cards nunca remanejados ───────────────────────────────
-- Medido nesta migration (conferido em produção antes de escrever): 67 cards
-- com responsavel_id = Kelly, dos quais 6 têm SÓ interações de sistema
-- (criação, pagamento, a atribuição automática) — nenhuma interação humana
-- (mudanca_estagio, nota, atendimento). Os outros 61 estão em uso e NÃO são
-- tocados. IDs fixos (não uma condição dinâmica): evita que este backfill
-- pontual vire regra permanente se rodar em outro ambiente com histórico
-- diferente — mesmo espírito de "medição antes de corrigir" da 0263.
do $$
declare
  v_ids uuid[] := array[
    '0b1a4ea8-1f39-49ed-a29b-f49ba9b6cdb9',
    '5b3d74c7-c65c-4374-8492-71be59a4550c',
    'c26e0f71-a0de-4fb2-a86e-4bb878b1ef9a',
    'c6c7b165-d804-4bb2-b0db-98387463dd7f',
    'cf562ae8-f7ee-40be-a2bf-327b67840969',
    'e4eacbee-5c4c-4d2b-beae-0665cb2f7c73'
  ];
  v_conferidos int;
  v_atualizados int;
begin
  -- Confere ANTES de escrever: os 6 IDs têm de ser exatamente os cards sem
  -- nenhuma interação humana e com responsavel_id = Kelly hoje. Se o número
  -- mudou desde a medição (alguém já remanejou um deles na mão, por exemplo),
  -- aborta em vez de arriscar limpar um card que passou a estar em uso.
  select count(*) into v_conferidos
    from cs.contatos_hm ch
    join cs.usuarios u on u.id = ch.responsavel_id
   where ch.id = any(v_ids)
     and lower(btrim(u.email)) = 'kelly@advmais.com'
     and ch.cancelamento_em is null
     and not exists (select 1 from cs.interacoes i where i.contato_hm_id = ch.id and i.tipo <> 'sistema');

  if v_conferidos <> array_length(v_ids, 1) then
    raise exception '0265: esperava % cards intocados (so interacao de sistema, dono = Kelly), achou % — algum ja foi remanejado ou o estado mudou desde a medicao. Abortado sem tocar em nada.', array_length(v_ids,1), v_conferidos;
  end if;

  -- Só responsavel_id é limpo. responsavel_comercial_id NÃO é tocado: os 6
  -- já têm essa coluna congelada por fn_hm_congela_comercial (0212) — tentar
  -- mudar um valor não-nulo derruba a transação inteira (é histórico
  -- imutável, mesmo estando "errado" por causa do carimbo que esta migration
  -- está desligando).
  update cs.contatos_hm
     set responsavel_id = null,
         atualizado_em = now()
   where id = any(v_ids);
  get diagnostics v_atualizados = row_count;

  insert into cs.interacoes (contato_hm_id, tipo, descricao, autor)
  select id, 'sistema',
         'Responsável removido pela migration 0265: este card nunca foi remanejado desde a atribuição automática (0161/0212), que foi desligada. Volta para a fila de entrada da Kelly (gerente de distribuição) para associação manual.',
         'sistema'
    from cs.contatos_hm where id = any(v_ids);

  raise notice '0265: backfill limpou responsavel_id de % card(s) intocado(s) da Kelly.', v_atualizados;
end $$;

-- ── [5] cs.usuario_funcoes: Kelly ganha HM/comercial ─────────────────────────
-- Pedido explícito do Marcio (dropdown do responsável comercial: "a jusy,
-- kelly e jonathan"). `on conflict do nothing` — mesmo padrão do backfill da
-- 0210, idempotente por natureza (PK é usuario_id+portal+funcao). A Kelly já
-- tem o portal HM em cs.usuario_portais (conferido em produção antes desta
-- migration) — a trava de "ninguém tem função num portal que não possui"
-- (0210) já está satisfeita, sem precisar tocar em cs.usuario_portais aqui.
insert into cs.usuario_funcoes (usuario_id, portal, funcao)
select u.id, 'HM', 'comercial'
  from cs.usuarios u
 where lower(btrim(u.email)) = 'kelly@advmais.com'
on conflict do nothing;

do $$
declare v_kelly_comercial int;
begin
  select count(*) into v_kelly_comercial
    from cs.usuario_funcoes uf
    join cs.usuarios u on u.id = uf.usuario_id
   where lower(btrim(u.email)) = 'kelly@advmais.com' and uf.portal = 'HM' and uf.funcao = 'comercial';
  if v_kelly_comercial <> 1 then
    raise exception '0265: esperava a Kelly com HM/comercial em cs.usuario_funcoes, achei % vinculo(s) — conferir se o email kelly@advmais.com ainda e o correto.', v_kelly_comercial;
  end if;
end $$;

-- ── TRAVAS FINAIS (padrão 0263/0264) ─────────────────────────────────────────
do $$
declare
  v_def_carimbo text;
  v_def_saude   text;
  v_chamadas_saude int;
begin
  select pg_get_functiondef(p.oid) into v_def_carimbo
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'cs' and p.proname = 'fn_hm_carimba_equipe_padrao';

  if v_def_carimbo ilike '%responsavel_id = v_resp%' or v_def_carimbo ilike '%responsavel_comercial_id = v_resp%' then
    raise exception '0265: cs.fn_hm_carimba_equipe_padrao() ainda grava responsavel_id/responsavel_comercial_id — o carimbo automatico nao foi removido. Abortado.';
  end if;

  select pg_get_functiondef(p.oid) into v_def_saude
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'cs' and p.proname = 'fn_hm_health_check';

  -- Conta ocorrências da string "fn_hm_alerta_venda_sem_operador" dentro do
  -- fonte de fn_hm_health_check: a chamada "perform cs.fn_hm_alerta_venda_
  -- sem_operador();" tem de aparecer exatamente 1 vez — nem 0 (a injeção
  -- falhou em silêncio) nem 2+ (o replace mecânico injetou duas vezes).
  v_chamadas_saude := (length(v_def_saude) - length(replace(v_def_saude, 'fn_hm_alerta_venda_sem_operador', '')))
                       / length('fn_hm_alerta_venda_sem_operador');

  if v_chamadas_saude <> 1 then
    raise exception '0265: cs.fn_hm_health_check deveria chamar fn_hm_alerta_venda_sem_operador() exatamente 1 vez, achei % ocorrencia(s) no fonte.', v_chamadas_saude;
  end if;

  raise notice '0265: fn_hm_carimba_equipe_padrao sem carimbo de responsavel; fn_hm_health_check chama fn_hm_alerta_venda_sem_operador() exatamente 1x.';
end $$;

commit;
