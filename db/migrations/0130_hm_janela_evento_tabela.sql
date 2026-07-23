-- =====================================================================
-- 0130_hm_janela_evento_tabela
--
-- As janelas de canal por data de compra viram TABELA editável
-- (config-driven), em vez de hardcoded na fn_hm_janela_evento. Motivo:
-- captar os próximos eventos (T40 e futuros) sem depender de migration —
-- cada evento novo é UMA linha em cs.hm_evento_janela. Decisão do Marcio
-- (23/07): tabela editável + repetir os nomes de canal do T39 (a turma
-- distingue a edição nos relatórios).
--
-- Popula com o T39 (mesmas datas/nomes → comportamento idêntico ao
-- histórico). O T40 entra por INSERT quando as datas forem definidas:
--   insert into cs.hm_evento_janela (canal, inicio, fim, turma, nota) values
--     ('Live Direto ao Ponto', '2026-07-26 20:00:00-03', '2026-07-...', 'T40', 'Lançamento T40');
-- Ver [[HM - Ofertas, tags e janelas de evento]].
-- =====================================================================
create table if not exists cs.hm_evento_janela (
  id         bigserial primary key,
  canal      text not null,
  inicio     timestamptz not null,
  fim        timestamptz not null,
  turma      text,
  nota       text,
  criado_em  timestamptz not null default now(),
  check (fim > inicio)
);

comment on table cs.hm_evento_janela is
  'Janelas de canal por data de compra (HM). fn_hm_janela_evento lê daqui. Um evento = uma linha. Sem sobreposição.';

-- impede 2 canais na mesma data (erro operacional que tagearia errado)
do $$
begin
  alter table cs.hm_evento_janela
    add constraint hm_evento_janela_sem_overlap
    exclude using gist (tstzrange(inicio, fim) with &&);
exception when others then
  null;
end $$;

-- T39 (mesmas datas/nomes de antes — idêntico ao histórico)
insert into cs.hm_evento_janela (canal, inicio, fim, turma, nota)
select * from (values
  ('Live Direto ao Ponto',      '2026-06-25 00:00:00-03'::timestamptz, '2026-06-27 00:00:00-03'::timestamptz, 'T39', 'Lançamento T39'),
  ('HT ATM',                    '2026-07-06 00:00:00-03'::timestamptz, '2026-07-08 00:00:00-03'::timestamptz, 'T39', 'HT ATM T39'),
  ('Ex aluno Direto ao Ponto',  '2026-07-13 00:00:00-03'::timestamptz, '2026-07-14 00:00:00-03'::timestamptz, 'T39', 'Ex aluno T39')
) v
where not exists (select 1 from cs.hm_evento_janela);

-- função lê da tabela (STABLE — antes era IMMUTABLE hardcoded)
create or replace function cs.fn_hm_janela_evento(p_venda_em timestamptz)
 returns text language sql stable
 set search_path to 'cs','public','pg_temp'
as $function$
  select coalesce(
    (select w.canal from cs.hm_evento_janela w
      where p_venda_em >= w.inicio and p_venda_em < w.fim
      order by w.inicio desc
      limit 1),
    'Venda direta');
$function$;
