-- 0160_canal_ht30_09_08.sql
-- Renomeia o canal da oferta R$697 de "Live HT 09/08" para **"HT30 - 09-08"**, no
-- padrão do "HT29 - 26-07" (pedido do Marcio, 10/08), e o promove a canal FIXO da
-- régua do board (o atalho no topo da esteira) — ver app/hm/_components/hm-canais.tsx.
--
-- ⚠️ O pedido veio como "HT30 - 09/09", mas as compras são de **09/08**. Confirmado
-- com o Marcio: mantém o número HT30 e corrige a data para 09-08. Formato com HÍFEN,
-- igual ao HT29 - 26-07 (barra no meio da tag atrapalha filtro por URL).
--
-- Nota para quem for ler `public.ht_editions` e estranhar: em 09/08 a edição vigente
-- lá é a **HT31** (03–16/08); a HT30 foi 20/07–02/08. O rótulo do CANAL segue a
-- convenção da operação (a live que converteu), não a janela de venda do ingresso —
-- por isso a origem vem da OFERTA e não da data ([[hm-canal-pelo-fato]]).
--
-- Duas escritas, e as DUAS importam:
--   1) `cs.hm_origem_por_oferta` — a FONTE: toda venda NOVA da oferta já nasce com o
--      canal certo. Sem isso, a próxima venda voltaria a nascer "Live HT 09/08" e o
--      canal apareceria partido em dois na régua.
--   2) `cs.contatos_hm.tags` — os 20 cards que já existem.
-- Idempotente (array_replace não duplica; roda de novo sem efeito).

update cs.hm_origem_por_oferta
   set origem = 'HT30 - 09-08',
       nota   = 'Oferta de entrada R$697 do HM apresentada na live do HT de 09/08/2026 (HT30). '
                'Canal vem da OFERTA, nao da data. Renomeado de "Live HT 09/08" em 10/08, '
                'para seguir o padrao do HT29 - 26-07.'
 where oferta_codigo = 'rlgjsrul';

update cs.contatos_hm
   set tags = array_replace(tags, 'Live HT 09/08', 'HT30 - 09-08'),
       atualizado_em = now()
 where 'Live HT 09/08' = any(tags);
