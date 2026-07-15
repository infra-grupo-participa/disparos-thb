-- =====================================================================
-- 0093_nomes_padronizados
--
-- NOME DE GENTE ESCRITO COMO NOME DE GENTE — EM UM LUGAR SÓ.
--
-- A base tem 328 de 1.187 nomes fora do padrão: 27 tudo minúsculo
-- ("izildinha souza"), 132 tudo maiúsculo ("MARIA DE SOUZA"), e o resto com
-- caixa torta. Eles entram por vários caminhos — webhook da Hotmart (nome do
-- checkout), cadastro manual, edição administrativa, imports de planilha — e
-- consertar em cada um deixaria brechas: bastaria um caminho novo para o
-- problema voltar.
--
-- A correção mora onde o dado mora: um gatilho BEFORE em public.compradores.
-- Todo nome escrito, venha de onde vier, sai padronizado (Title Case, com as
-- preposições de/da/do em minúscula). É a mesma tabela que HT, Clínica e HM
-- leem — então o padrão vale para o sistema inteiro, sem uma tela divergir da
-- outra. NÃO toca public.thb_alunos: a base mestre é de outro domínio (o GPS),
-- e escrever nela daqui seria cruzar a fronteira do produto.
--
-- Idempotente: a função é pura e o backfill só mexe em quem está fora do padrão.
-- =====================================================================

-- 1) O padrão, numa função pura -----------------------------------------
-- "izildinha souza" → "Izildinha Souza"; "MARIA DE SOUZA" → "Maria de Souza".
-- Minúscula primeiro (mata o CAPS), depois inicial maiúscula por palavra, exceto
-- as preposições — que ficam minúsculas quando não são a primeira palavra.
create or replace function public.fn_nome_padronizado(raw text)
returns text
language sql
immutable
as $fn$
  select case
    when nullif(btrim(raw), '') is null then raw
    else (
      select string_agg(
        case
          when ord > 1 and palavra = any(array['de','da','do','das','dos','e','di','du','del','della','van','von'])
            then palavra
          else upper(left(palavra, 1)) || substr(palavra, 2)
        end,
        ' ' order by ord
      )
      from unnest(regexp_split_to_array(lower(btrim(regexp_replace(raw, '\s+', ' ', 'g'))), ' '))
           with ordinality as w(palavra, ord)
    )
  end
$fn$;

grant execute on function public.fn_nome_padronizado(text) to public;

-- 2) O gatilho — a fronteira única de escrita ---------------------------
create or replace function public.fn_normaliza_nome_comprador()
returns trigger
language plpgsql
as $fn$
begin
  new.nome := public.fn_nome_padronizado(new.nome);
  return new;
end$fn$;

grant execute on function public.fn_normaliza_nome_comprador() to public;

drop trigger if exists trg_normaliza_nome on public.compradores;
create trigger trg_normaliza_nome
  before insert or update of nome on public.compradores
  for each row execute function public.fn_normaliza_nome_comprador();

-- 3) Backfill do que já está torto --------------------------------------
-- Só quem muda de fato — não sujar atualizado_em de 859 registros que já estão
-- certos. O gatilho reprocessa (idempotente), mas o WHERE evita o trabalho.
update public.compradores
   set nome = public.fn_nome_padronizado(nome),
       atualizado_em = now()
 where nome is distinct from public.fn_nome_padronizado(nome);
