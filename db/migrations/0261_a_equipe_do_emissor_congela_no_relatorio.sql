-- 0261_a_equipe_do_emissor_congela_no_relatorio.sql
--
-- Achado ALTO do security-pentester (16/08), sobre a 0259: `buscarRelatorioEmitido`
-- (lib/protocolo.ts) decidia quem pode reabrir um relatório de escopo 'equipe' com um
-- `left join cs.usuarios` lendo `equipe_id` AO VIVO. Se o emissor trocar de equipe depois de
-- emitir (rota já existente `app/api/hm/equipes/[id]/membros`), os colegas NOVOS dele passam
-- a ler a folha com dinheiro e nome de aluno da equipe ANTIGA, e os colegas ANTIGOS perdem o
-- acesso que deveriam manter. O comentário do próprio código já dizia o certo ("a MESMA
-- equipe que o emissor TINHA ao emitir") — a implementação divergia do contrato dela mesma.
--
-- Correção: a equipe do emissor vira FATO GRAVADO na hora da emissão, como todo o resto de
-- `cs.relatorio_emitido` (a tabela inteira existe para congelar o momento — ver 0259). Sem
-- isto, cs.relatorio_emitido é a ÚNICA coluna de autorização que ainda lia estado mutável.
alter table cs.relatorio_emitido add column if not exists emitido_por_equipe_id uuid;

comment on column cs.relatorio_emitido.emitido_por_equipe_id is
  '0261: a equipe do emissor NO INSTANTE da emissao (ctx.sessao.equipe_id), nunca a equipe atual — quem decide reabertura de escopo ''equipe'' e este valor congelado, nao um JOIN ao vivo com cs.usuarios. Ver lib/protocolo.ts:buscarRelatorioEmitido.';

-- Backfill: nenhum. cs.relatorio_emitido é append-only e nasceu na 0259 — nenhum relatório
-- existe em produção ainda (achado do próprio pentester: "nenhum relatório existe em
-- produção ainda"), então não há linha para retroagir.
--
-- Volta: alter table cs.relatorio_emitido drop column emitido_por_equipe_id;
