-- 0170_portal_cnhf_fora_do_ar.sql
-- O portal do CNHF (Curso Nacional de Formação em Holding Familiar) sai do ar a
-- pedido do Marcio (10/08/2026): o time não trabalha por ele e a tela só pesa.
--
-- ---------------------------------------------------------------------------
-- O QUE SAI E O QUE FICA — a diferença importa
--
-- Sai a SUPERFÍCIE: o card na tela de seleção, a rota /curso/* (agora 404), a
-- marca em lib/marcas.ts, a caixa "Curso" na tela de usuários e o direito de
-- disparo por SDR no evento.
--
-- FICA tudo o que é dado e processo. Medido antes de decidir:
--   · cs.contatos com evento='CNHF' .................. 12.228
--   · desses, atualizados nos últimos 7 dias ......... 12.181
--   · último toque .................................. 10/08/2026 19:56
-- É o maior volume do sistema (HT tem 757, Seminário 373) e está sendo escrito
-- AGORA. Os jobs que alimentam esses contatos (sync do ActiveCampaign, inbox,
-- mensageria) sustentam a operação do evento de agosto, que roda fora deste
-- portal. Desligá-los seria apagar o evento, não a tela — por isso não foram
-- tocados. Se um dia for para matar o pipeline também, é outra decisão, com
-- backup antes.
--
-- ---------------------------------------------------------------------------
-- POR QUE ESTA MIGRATION EXISTE
--
-- `UsuarioPortaisSchema` (lib/validators.ts) deixou de aceitar 'CNHF'. As 16
-- contas que tinham o portal na whitelist passariam a falhar na validação assim
-- que alguém salvasse qualquer alteração nelas — um erro que só apareceria dias
-- depois, no primeiro admin tentando mexer num usuário. Limpar a whitelist é o
-- que fecha o buraco.
--
-- A lista das contas afetadas fica registrada em cs.interacoes? Não: interacoes é
-- do HM. Fica aqui, no log da própria migration (raise notice) e no vault. Para
-- devolver o portal, basta reinserir a linha por usuário — nada mais foi perdido.
--
-- As 16 contas que tinham 'CNHF' na whitelist em 10/08/2026, para reversão:
--   aldri@advmais.com, anacamila@advmais.com, arthur@advmais.com,
--   contato@terceirizacs.com.br, elaine@advmais.com, financeiro@advmais.com,
--   isabela@advmais.com, joao@advmais.com, jonathan@advmais.com,
--   jusy@advmais.com, marcio@advmais.com, marco@advmais.com,
--   tercerizacs@gmail.com (inativa), thomas@advmais.com,
--   victorhugo@advmais.com, victorlopes@advmais.com (inativa)
-- Idempotente.
do $$
declare
  n integer;
  quem text;
begin
  select count(*), coalesce(string_agg(u.email, ', ' order by u.email), '(nenhum)')
    into n, quem
    from cs.usuario_portais p
    join cs.usuarios u on u.id = p.usuario_id
   where p.portal = 'CNHF';

  raise notice '0170: removendo o portal CNHF de % conta(s): %', n, quem;

  delete from cs.usuario_portais where portal = 'CNHF';
end $$;
