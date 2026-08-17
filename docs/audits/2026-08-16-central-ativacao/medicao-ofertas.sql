-- =====================================================================
-- PACOTE DE MEDICAO - catalogo de ofertas x CSV do Joao x dinheiro real
-- SOMENTE LEITURA. Nenhum insert/update/delete/DDL.
-- Papel precisa de SELECT em public.compras e public.hm_product_catalog.
-- disparos_app NAO tem (ver lib/services/hm-ficha.ts:100).
-- =====================================================================

-- Q0. PRIMEIRO: quais status existem. Nao filtrar antes de ver.
select status, count(*) as compras, count(distinct oferta_codigo) as ofertas,
       to_char(sum(preco),'FM999G999G999D00') as soma
  from public.compras group by 1 order by 2 desc;

-- Q0b. Universo dos identificadores
select (select count(*) from public.hm_product_catalog)           as catalogo,
       (select count(*) from cs.hm_ofertas_saldo)                 as ofertas_saldo,
       (select count(*) from cs.hm_origem_por_oferta)             as canais,
       (select count(*) from cs.hm_produto_hotmart)               as produtos_mapeados,
       (select count(*) from public.compras)                      as compras,
       (select count(distinct oferta_codigo) from public.compras) as ofertas_em_compras,
       (select count(distinct produto_id) from public.compras)    as produtos_em_compras;

-- =====================================================================
-- 1) DRIFT: banco x migrations do repo
-- =====================================================================
-- 1a. no BANCO e em NENHUMA migration -> nasceram a mao no console
with repo(offer_code) as (values
  ('9f3dm6af'),('cgerr0pt'),('0ulco7sq'),('hgph3cfh'),('s2kvgyli'),('7nzol8wb'),('qu1hz5xd'),
  ('r9wdsusx'),('xghljp43'),('8dgokcy4'),('c515e1ei'),('dl54fceb'),('ppbt91sk'),('rlgjsrul'),
  ('6lcg6d5q'),('f36zo585'),('a77262a0')
), repo_saldo(codigo) as (values
  ('1ayp826g'),('x0waxuab'),('2jaj1deq'),('8a87ktsr'),('ikgazdy8'),('o1sxigxl'),('cx3rwir9'),
  ('nu1t1h67'),('ntebmlv0'),('5f843knv'),('5uqyub1h'),('b13te6c0'),('bgu5i1zd'),('wkd93am7'),
  ('2vibw97m'),('2mxcjw8t'),('yuzm73ri'),('71dywe6l'),('ym44m2ea'),('faw8996d'),('cck38o0v'),
  ('c81z7l0e'),('yqipi87j'),('hqe8z7r8'),('izxq8lmo'),('gtm8frjx'),('m0qvagzx'),('cudmp0uw'),
  ('tomp81oq'),('sk9crwi3'),('7sjhxiz8'),('hzvq3ejv'),('sxjnedi5'),('pfp5ulqr'),('9rf41pie'),
  ('mo0tcg47'),('j7lx2qdp'),('ig30cmda'),('8a7xapie'),('zped30fg'),('z244ubp2'),('cfc4g5qq'),
  ('bgr5c91b'),('cqvhyjh7'),('du5wsb5t'),('p59n0ket'),('7nzol8wb'),('qu1hz5xd'),('r9wdsusx'),
  ('xghljp43'),('8dgokcy4'),('c515e1ei'),('dl54fceb'),('ppbt91sk'),('6lcg6d5q'),('f36zo585')
)
select c.offer_code, c.product_id, c.product_name, c.categoria, c.entrada_do_programa,
       c.pacote_cheio, left(c.notes,90) as notes
  from public.hm_product_catalog c
 where c.offer_code not in (select offer_code from repo)
   and c.offer_code not in (select codigo from repo_saldo)
 order by c.categoria nulls first, c.offer_code;
-- previsao a bater: 96 - 63 = 33 linhas, se o repo for subconjunto do banco.

-- 1b. ofertas de saldo no banco e fora das migrations
with repo_saldo(codigo) as (values
  ('1ayp826g'),('x0waxuab'),('2jaj1deq'),('8a87ktsr'),('ikgazdy8'),('o1sxigxl'),('cx3rwir9'),
  ('nu1t1h67'),('ntebmlv0'),('5f843knv'),('5uqyub1h'),('b13te6c0'),('bgu5i1zd'),('wkd93am7'),
  ('2vibw97m'),('2mxcjw8t'),('yuzm73ri'),('71dywe6l'),('ym44m2ea'),('faw8996d'),('cck38o0v'),
  ('c81z7l0e'),('yqipi87j'),('hqe8z7r8'),('izxq8lmo'),('gtm8frjx'),('m0qvagzx'),('cudmp0uw'),
  ('tomp81oq'),('sk9crwi3'),('7sjhxiz8'),('hzvq3ejv'),('sxjnedi5'),('pfp5ulqr'),('9rf41pie'),
  ('mo0tcg47'),('j7lx2qdp'),('ig30cmda'),('8a7xapie'),('zped30fg'),('z244ubp2'),('cfc4g5qq'),
  ('bgr5c91b'),('cqvhyjh7'),('du5wsb5t'),('p59n0ket'),('7nzol8wb'),('qu1hz5xd'),('r9wdsusx'),
  ('xghljp43'),('8dgokcy4'),('c515e1ei'),('dl54fceb'),('ppbt91sk'),('6lcg6d5q'),('f36zo585')
)
select s.* from cs.hm_ofertas_saldo s
 where s.codigo not in (select codigo from repo_saldo) order by s.valor;
-- previsao a bater: 57 - 56 = 1 linha, e deve ser 's8i8edv7'
-- (0188 diz em comentario que catalogou; o arquivo tem 79 linhas e zero SQL)

-- 1c. na MIGRATION e ausente do banco = migration nao aplicada
with repo(offer_code) as (values
  ('9f3dm6af'),('cgerr0pt'),('0ulco7sq'),('hgph3cfh'),('s2kvgyli'),('7nzol8wb'),('qu1hz5xd'),
  ('r9wdsusx'),('xghljp43'),('8dgokcy4'),('c515e1ei'),('dl54fceb'),('ppbt91sk'),('rlgjsrul'),
  ('6lcg6d5q'),('f36zo585'),('a77262a0')
)
select r.offer_code from repo r
  left join public.hm_product_catalog c on c.offer_code = r.offer_code
 where c.offer_code is null;

-- =====================================================================
-- 2) CSV x BANCO - os 63 codigos do Joao, por produto
-- =====================================================================
with csv(codigo, produto_csv, valor_csv, rotulo_csv) as (values
  ('6qxsk9kq','HM',2497.00,'Renovação Holding Masters - acesso dez/26 + ingresso plateia ETHB'),
  ('bgu5i1zd','HM',null,'Holding Masters'),
  ('vg96e2tc','AURUM',43000.00,'Aurum'),
  ('7ekxtlls','ETHB',500.00,'ETHB 2026'),
  ('j3jmszma','ETHB',1000.00,'ETHB 2026'),
  ('2euebtzg','ETHB',1500.00,'ETHB 2026'),
  ('6xys4ypa','?',null,'ETHB 2026'),
  ('t8yzswu6','?',null,'ETHB 2026'),
  ('dp41etyr','AURUM',45000.00,'Aurum'),
  ('z391kxd9','HM',300.00,'Holding Masters - Sinal R$ 300 de R$ 15.000'),
  ('2vibw97m','HM',14700.00,'Holding Masters - Saldol R$ 12.700 de R$ 15.000'),
  ('z950cse4','AURUM',21500.00,'Aurum'),
  ('fysepc10','AURUM',43000.00,'Aurum'),
  ('2mxcjw8t','HM',14700.00,'Holding Masters - Saldol R$ 12.700 de R$ 15.000 (recorrente)'),
  ('t4pje4k3','HM',null,'Holding Masters - Saldo 6.500'),
  ('frw73xd5','FIRE',32823.01,'Catena no Fire'),
  ('b6feodjs','FIRE',32823.01,'Wiliam Loro no Fire'),
  ('1ayp826g','HM',13960.27,'Saldo HM Programa de Implementação'),
  ('ikgazdy8','HM',12772.68,'Saldo HM Programa de Implementação'),
  ('wkd93am7','HM',4900.00,'Saldo ATM Programa de Implementação'),
  ('2jaj1deq','HM',13254.87,'Saldo HM Programa de Implementação'),
  ('cx3rwir9','HM',11675.34,'Saldo HM Programa de Implementação'),
  ('ntebmlv0','HM',11084.28,'Saldo HM Programa de Implementação'),
  ('5uqyub1h','HM',11042.47,'Saldo HM Programa de Implementação'),
  ('cck38o0v','HM',6891.78,'Saldo HM Programa de Implementação'),
  ('yuzm73ri','HM',645.21,'Saldo HM Programa de Implementação'),
  ('ym44m2ea','HM',4968.49,'Saldo HM Programa de Implementação'),
  ('yqipi87j','HM',6932.88,'Saldo HM Programa de Implementação'),
  ('izxq8lmo','HM',7235.26,'Saldo HM Programa de Implementação'),
  ('m0qvagzx','HM',8782.19,'Saldo HM Programa de Implementação'),
  ('tomp81oq','HM',8823.29,'Saldo HM Programa de Implementação'),
  ('sxjnedi5','HM',9440.78,'Saldo HM Programa de Implementação'),
  ('9rf41pie','HM',11806.85,'Saldo HM Programa de Implementação'),
  ('j7lx2qdp','HM',11964.38,'Saldo HM Programa de Implementação'),
  ('z244ubp2','HM',12501.93,'Saldo HM Programa de Implementação'),
  ('bgr5c91b','HM',12802.58,'Saldo HM Programa de Implementação'),
  ('du5wsb5t','HM',12990.41,'Saldo HM Programa de Implementação'),
  ('7sjhxiz8','HM',9358.60,'Saldo HM Programa de Implementação'),
  ('8a7xapie','HM',12512.02,'Saldo HM Programa de Implementação'),
  ('dl54fceb','HM',10765.00,'Saldo HM Programa de Implementação'),
  ('t8t12rup','HM',4212.33,'Saldo HM Programa de Implementação'),
  ('7nzol8wb','HM',13402.67,'Saldo HM Programa de Implementação'),
  ('r9wdsusx','HM',12969.79,'Saldo HM Programa de Implementação'),
  ('8dgokcy4','HM',7072.60,'Saldo HM Programa de Implementação'),
  ('32e1n186','HM',10330.38,'Saldo HM Programa de Implementação'),
  ('ljiov5j3','TRANSMISSAO',197.00,'Tranmissão Online THB SP 2026'),
  ('qm4lu7py','AURUM',1000.00,'Sinal Aurum ETHB/SP R$ 1.000 de R$ 60.000'),
  ('j0gsd19c','ETHB',497.00,'Encontro do Time Holding Brasil/2027'),
  ('s8i8edv7','HM',14303.00,'Saldo HM Programa de Implementação'),
  ('c26ip733','HM',13041.35,'Saldo HM Programa de Implementação'),
  ('1wvjy28l','HM',9701.18,'Saldo HM Programa de Implementação'),
  ('art7p6yd','HM',12715.15,'Saldo HM Programa de Implementação'),
  ('u1nhykj5','HM',9742.27,'Saldo HM Programa de Implementação'),
  ('pmak6v9u','HM',13218.88,'Saldo HM Programa de Implementação'),
  ('d8bf90k9','HM',12726.10,'Saldo HM Programa de Implementação'),
  ('2g38mv98','HM',13120.62,'Saldo HM Programa de Implementação'),
  ('vzehb16i','AURUM',45927.32,'Saldo Aurum - ETHB'),
  ('8vil8s4u','AURUM',52876.71,'Saldo Aurum - ETHB'),
  ('4y1ggvj9','AURUM',49917.81,'Saldo Aurum - ETHB'),
  ('e288p4zk','AURUM',59000.00,'Saldo Aurum - ETHB'),
  ('5jhjnhe8','AURUM',58700.00,'Saldo Aurum - ETHB'),
  ('f8akw09u','AURUM',51808.22,'Saldo Aurum - ETHB'),
  ('n84xawd3','HM',null,'Saldo Aurum - ETHB - R$ 13.800,00 ou em 12 x de R$ 1.461,05 * no cartã')
)
select csv.produto_csv,
       count(*)                          as no_csv,
       count(cat.offer_code)             as ja_no_catalogo,
       count(*) - count(cat.offer_code)  as faltam,
       count(sal.codigo)                 as com_link_de_saldo
  from csv
  left join public.hm_product_catalog cat on cat.offer_code = csv.codigo
  left join cs.hm_ofertas_saldo       sal on sal.codigo     = csv.codigo
 group by 1 order by 1;

-- 2b. NOME POR NOME o que falta cadastrar (+ dinheiro que ja passou por ele)
with csv(codigo, produto_csv, valor_csv, rotulo_csv) as (values
  ('6qxsk9kq','HM',2497.00,'Renovação Holding Masters - acesso dez/26 + ingresso plateia ETHB'),
  ('bgu5i1zd','HM',null,'Holding Masters'),
  ('vg96e2tc','AURUM',43000.00,'Aurum'),
  ('7ekxtlls','ETHB',500.00,'ETHB 2026'),
  ('j3jmszma','ETHB',1000.00,'ETHB 2026'),
  ('2euebtzg','ETHB',1500.00,'ETHB 2026'),
  ('6xys4ypa','?',null,'ETHB 2026'),
  ('t8yzswu6','?',null,'ETHB 2026'),
  ('dp41etyr','AURUM',45000.00,'Aurum'),
  ('z391kxd9','HM',300.00,'Holding Masters - Sinal R$ 300 de R$ 15.000'),
  ('2vibw97m','HM',14700.00,'Holding Masters - Saldol R$ 12.700 de R$ 15.000'),
  ('z950cse4','AURUM',21500.00,'Aurum'),
  ('fysepc10','AURUM',43000.00,'Aurum'),
  ('2mxcjw8t','HM',14700.00,'Holding Masters - Saldol R$ 12.700 de R$ 15.000 (recorrente)'),
  ('t4pje4k3','HM',null,'Holding Masters - Saldo 6.500'),
  ('frw73xd5','FIRE',32823.01,'Catena no Fire'),
  ('b6feodjs','FIRE',32823.01,'Wiliam Loro no Fire'),
  ('1ayp826g','HM',13960.27,'Saldo HM Programa de Implementação'),
  ('ikgazdy8','HM',12772.68,'Saldo HM Programa de Implementação'),
  ('wkd93am7','HM',4900.00,'Saldo ATM Programa de Implementação'),
  ('2jaj1deq','HM',13254.87,'Saldo HM Programa de Implementação'),
  ('cx3rwir9','HM',11675.34,'Saldo HM Programa de Implementação'),
  ('ntebmlv0','HM',11084.28,'Saldo HM Programa de Implementação'),
  ('5uqyub1h','HM',11042.47,'Saldo HM Programa de Implementação'),
  ('cck38o0v','HM',6891.78,'Saldo HM Programa de Implementação'),
  ('yuzm73ri','HM',645.21,'Saldo HM Programa de Implementação'),
  ('ym44m2ea','HM',4968.49,'Saldo HM Programa de Implementação'),
  ('yqipi87j','HM',6932.88,'Saldo HM Programa de Implementação'),
  ('izxq8lmo','HM',7235.26,'Saldo HM Programa de Implementação'),
  ('m0qvagzx','HM',8782.19,'Saldo HM Programa de Implementação'),
  ('tomp81oq','HM',8823.29,'Saldo HM Programa de Implementação'),
  ('sxjnedi5','HM',9440.78,'Saldo HM Programa de Implementação'),
  ('9rf41pie','HM',11806.85,'Saldo HM Programa de Implementação'),
  ('j7lx2qdp','HM',11964.38,'Saldo HM Programa de Implementação'),
  ('z244ubp2','HM',12501.93,'Saldo HM Programa de Implementação'),
  ('bgr5c91b','HM',12802.58,'Saldo HM Programa de Implementação'),
  ('du5wsb5t','HM',12990.41,'Saldo HM Programa de Implementação'),
  ('7sjhxiz8','HM',9358.60,'Saldo HM Programa de Implementação'),
  ('8a7xapie','HM',12512.02,'Saldo HM Programa de Implementação'),
  ('dl54fceb','HM',10765.00,'Saldo HM Programa de Implementação'),
  ('t8t12rup','HM',4212.33,'Saldo HM Programa de Implementação'),
  ('7nzol8wb','HM',13402.67,'Saldo HM Programa de Implementação'),
  ('r9wdsusx','HM',12969.79,'Saldo HM Programa de Implementação'),
  ('8dgokcy4','HM',7072.60,'Saldo HM Programa de Implementação'),
  ('32e1n186','HM',10330.38,'Saldo HM Programa de Implementação'),
  ('ljiov5j3','TRANSMISSAO',197.00,'Tranmissão Online THB SP 2026'),
  ('qm4lu7py','AURUM',1000.00,'Sinal Aurum ETHB/SP R$ 1.000 de R$ 60.000'),
  ('j0gsd19c','ETHB',497.00,'Encontro do Time Holding Brasil/2027'),
  ('s8i8edv7','HM',14303.00,'Saldo HM Programa de Implementação'),
  ('c26ip733','HM',13041.35,'Saldo HM Programa de Implementação'),
  ('1wvjy28l','HM',9701.18,'Saldo HM Programa de Implementação'),
  ('art7p6yd','HM',12715.15,'Saldo HM Programa de Implementação'),
  ('u1nhykj5','HM',9742.27,'Saldo HM Programa de Implementação'),
  ('pmak6v9u','HM',13218.88,'Saldo HM Programa de Implementação'),
  ('d8bf90k9','HM',12726.10,'Saldo HM Programa de Implementação'),
  ('2g38mv98','HM',13120.62,'Saldo HM Programa de Implementação'),
  ('vzehb16i','AURUM',45927.32,'Saldo Aurum - ETHB'),
  ('8vil8s4u','AURUM',52876.71,'Saldo Aurum - ETHB'),
  ('4y1ggvj9','AURUM',49917.81,'Saldo Aurum - ETHB'),
  ('e288p4zk','AURUM',59000.00,'Saldo Aurum - ETHB'),
  ('5jhjnhe8','AURUM',58700.00,'Saldo Aurum - ETHB'),
  ('f8akw09u','AURUM',51808.22,'Saldo Aurum - ETHB'),
  ('n84xawd3','HM',null,'Saldo Aurum - ETHB - R$ 13.800,00 ou em 12 x de R$ 1.461,05 * no cartã')
)
select csv.produto_csv, csv.codigo, csv.valor_csv, csv.rotulo_csv,
       count(c.id)                                        as compras_ja_feitas,
       count(distinct c.comprador_id)                     as pessoas,
       to_char(coalesce(sum(c.preco),0),'FM999G999D00')   as r$_ja_movimentado
  from csv
  left join public.hm_product_catalog cat on cat.offer_code = csv.codigo
  left join public.compras c on c.oferta_codigo = csv.codigo
                            and c.status in (/* Q0 */)
 where cat.offer_code is null
 group by 1,2,3,4
 order by csv.produto_csv, coalesce(sum(c.preco),0) desc;

-- 2c. o contrario: catalogado no banco e ausente do CSV (cobertura do CSV)
with csv(codigo, produto_csv, valor_csv, rotulo_csv) as (values
  ('6qxsk9kq','HM',2497.00,'Renovação Holding Masters - acesso dez/26 + ingresso plateia ETHB'),
  ('bgu5i1zd','HM',null,'Holding Masters'),
  ('vg96e2tc','AURUM',43000.00,'Aurum'),
  ('7ekxtlls','ETHB',500.00,'ETHB 2026'),
  ('j3jmszma','ETHB',1000.00,'ETHB 2026'),
  ('2euebtzg','ETHB',1500.00,'ETHB 2026'),
  ('6xys4ypa','?',null,'ETHB 2026'),
  ('t8yzswu6','?',null,'ETHB 2026'),
  ('dp41etyr','AURUM',45000.00,'Aurum'),
  ('z391kxd9','HM',300.00,'Holding Masters - Sinal R$ 300 de R$ 15.000'),
  ('2vibw97m','HM',14700.00,'Holding Masters - Saldol R$ 12.700 de R$ 15.000'),
  ('z950cse4','AURUM',21500.00,'Aurum'),
  ('fysepc10','AURUM',43000.00,'Aurum'),
  ('2mxcjw8t','HM',14700.00,'Holding Masters - Saldol R$ 12.700 de R$ 15.000 (recorrente)'),
  ('t4pje4k3','HM',null,'Holding Masters - Saldo 6.500'),
  ('frw73xd5','FIRE',32823.01,'Catena no Fire'),
  ('b6feodjs','FIRE',32823.01,'Wiliam Loro no Fire'),
  ('1ayp826g','HM',13960.27,'Saldo HM Programa de Implementação'),
  ('ikgazdy8','HM',12772.68,'Saldo HM Programa de Implementação'),
  ('wkd93am7','HM',4900.00,'Saldo ATM Programa de Implementação'),
  ('2jaj1deq','HM',13254.87,'Saldo HM Programa de Implementação'),
  ('cx3rwir9','HM',11675.34,'Saldo HM Programa de Implementação'),
  ('ntebmlv0','HM',11084.28,'Saldo HM Programa de Implementação'),
  ('5uqyub1h','HM',11042.47,'Saldo HM Programa de Implementação'),
  ('cck38o0v','HM',6891.78,'Saldo HM Programa de Implementação'),
  ('yuzm73ri','HM',645.21,'Saldo HM Programa de Implementação'),
  ('ym44m2ea','HM',4968.49,'Saldo HM Programa de Implementação'),
  ('yqipi87j','HM',6932.88,'Saldo HM Programa de Implementação'),
  ('izxq8lmo','HM',7235.26,'Saldo HM Programa de Implementação'),
  ('m0qvagzx','HM',8782.19,'Saldo HM Programa de Implementação'),
  ('tomp81oq','HM',8823.29,'Saldo HM Programa de Implementação'),
  ('sxjnedi5','HM',9440.78,'Saldo HM Programa de Implementação'),
  ('9rf41pie','HM',11806.85,'Saldo HM Programa de Implementação'),
  ('j7lx2qdp','HM',11964.38,'Saldo HM Programa de Implementação'),
  ('z244ubp2','HM',12501.93,'Saldo HM Programa de Implementação'),
  ('bgr5c91b','HM',12802.58,'Saldo HM Programa de Implementação'),
  ('du5wsb5t','HM',12990.41,'Saldo HM Programa de Implementação'),
  ('7sjhxiz8','HM',9358.60,'Saldo HM Programa de Implementação'),
  ('8a7xapie','HM',12512.02,'Saldo HM Programa de Implementação'),
  ('dl54fceb','HM',10765.00,'Saldo HM Programa de Implementação'),
  ('t8t12rup','HM',4212.33,'Saldo HM Programa de Implementação'),
  ('7nzol8wb','HM',13402.67,'Saldo HM Programa de Implementação'),
  ('r9wdsusx','HM',12969.79,'Saldo HM Programa de Implementação'),
  ('8dgokcy4','HM',7072.60,'Saldo HM Programa de Implementação'),
  ('32e1n186','HM',10330.38,'Saldo HM Programa de Implementação'),
  ('ljiov5j3','TRANSMISSAO',197.00,'Tranmissão Online THB SP 2026'),
  ('qm4lu7py','AURUM',1000.00,'Sinal Aurum ETHB/SP R$ 1.000 de R$ 60.000'),
  ('j0gsd19c','ETHB',497.00,'Encontro do Time Holding Brasil/2027'),
  ('s8i8edv7','HM',14303.00,'Saldo HM Programa de Implementação'),
  ('c26ip733','HM',13041.35,'Saldo HM Programa de Implementação'),
  ('1wvjy28l','HM',9701.18,'Saldo HM Programa de Implementação'),
  ('art7p6yd','HM',12715.15,'Saldo HM Programa de Implementação'),
  ('u1nhykj5','HM',9742.27,'Saldo HM Programa de Implementação'),
  ('pmak6v9u','HM',13218.88,'Saldo HM Programa de Implementação'),
  ('d8bf90k9','HM',12726.10,'Saldo HM Programa de Implementação'),
  ('2g38mv98','HM',13120.62,'Saldo HM Programa de Implementação'),
  ('vzehb16i','AURUM',45927.32,'Saldo Aurum - ETHB'),
  ('8vil8s4u','AURUM',52876.71,'Saldo Aurum - ETHB'),
  ('4y1ggvj9','AURUM',49917.81,'Saldo Aurum - ETHB'),
  ('e288p4zk','AURUM',59000.00,'Saldo Aurum - ETHB'),
  ('5jhjnhe8','AURUM',58700.00,'Saldo Aurum - ETHB'),
  ('f8akw09u','AURUM',51808.22,'Saldo Aurum - ETHB'),
  ('n84xawd3','HM',null,'Saldo Aurum - ETHB - R$ 13.800,00 ou em 12 x de R$ 1.461,05 * no cartã')
)
select cat.offer_code, cat.categoria, cat.product_name, left(cat.notes,70) as notes,
       s.valor as valor_saldo, s.recorrente
  from public.hm_product_catalog cat
  left join cs.hm_ofertas_saldo s on s.codigo = cat.offer_code
 where cat.offer_code not in (select codigo from csv)
 order by cat.categoria nulls first, cat.offer_code;

-- 2d. divergencia de VALOR: CSV x cs.hm_ofertas_saldo
with csv(codigo, produto_csv, valor_csv, rotulo_csv) as (values
  ('6qxsk9kq','HM',2497.00,'Renovação Holding Masters - acesso dez/26 + ingresso plateia ETHB'),
  ('bgu5i1zd','HM',null,'Holding Masters'),
  ('vg96e2tc','AURUM',43000.00,'Aurum'),
  ('7ekxtlls','ETHB',500.00,'ETHB 2026'),
  ('j3jmszma','ETHB',1000.00,'ETHB 2026'),
  ('2euebtzg','ETHB',1500.00,'ETHB 2026'),
  ('6xys4ypa','?',null,'ETHB 2026'),
  ('t8yzswu6','?',null,'ETHB 2026'),
  ('dp41etyr','AURUM',45000.00,'Aurum'),
  ('z391kxd9','HM',300.00,'Holding Masters - Sinal R$ 300 de R$ 15.000'),
  ('2vibw97m','HM',14700.00,'Holding Masters - Saldol R$ 12.700 de R$ 15.000'),
  ('z950cse4','AURUM',21500.00,'Aurum'),
  ('fysepc10','AURUM',43000.00,'Aurum'),
  ('2mxcjw8t','HM',14700.00,'Holding Masters - Saldol R$ 12.700 de R$ 15.000 (recorrente)'),
  ('t4pje4k3','HM',null,'Holding Masters - Saldo 6.500'),
  ('frw73xd5','FIRE',32823.01,'Catena no Fire'),
  ('b6feodjs','FIRE',32823.01,'Wiliam Loro no Fire'),
  ('1ayp826g','HM',13960.27,'Saldo HM Programa de Implementação'),
  ('ikgazdy8','HM',12772.68,'Saldo HM Programa de Implementação'),
  ('wkd93am7','HM',4900.00,'Saldo ATM Programa de Implementação'),
  ('2jaj1deq','HM',13254.87,'Saldo HM Programa de Implementação'),
  ('cx3rwir9','HM',11675.34,'Saldo HM Programa de Implementação'),
  ('ntebmlv0','HM',11084.28,'Saldo HM Programa de Implementação'),
  ('5uqyub1h','HM',11042.47,'Saldo HM Programa de Implementação'),
  ('cck38o0v','HM',6891.78,'Saldo HM Programa de Implementação'),
  ('yuzm73ri','HM',645.21,'Saldo HM Programa de Implementação'),
  ('ym44m2ea','HM',4968.49,'Saldo HM Programa de Implementação'),
  ('yqipi87j','HM',6932.88,'Saldo HM Programa de Implementação'),
  ('izxq8lmo','HM',7235.26,'Saldo HM Programa de Implementação'),
  ('m0qvagzx','HM',8782.19,'Saldo HM Programa de Implementação'),
  ('tomp81oq','HM',8823.29,'Saldo HM Programa de Implementação'),
  ('sxjnedi5','HM',9440.78,'Saldo HM Programa de Implementação'),
  ('9rf41pie','HM',11806.85,'Saldo HM Programa de Implementação'),
  ('j7lx2qdp','HM',11964.38,'Saldo HM Programa de Implementação'),
  ('z244ubp2','HM',12501.93,'Saldo HM Programa de Implementação'),
  ('bgr5c91b','HM',12802.58,'Saldo HM Programa de Implementação'),
  ('du5wsb5t','HM',12990.41,'Saldo HM Programa de Implementação'),
  ('7sjhxiz8','HM',9358.60,'Saldo HM Programa de Implementação'),
  ('8a7xapie','HM',12512.02,'Saldo HM Programa de Implementação'),
  ('dl54fceb','HM',10765.00,'Saldo HM Programa de Implementação'),
  ('t8t12rup','HM',4212.33,'Saldo HM Programa de Implementação'),
  ('7nzol8wb','HM',13402.67,'Saldo HM Programa de Implementação'),
  ('r9wdsusx','HM',12969.79,'Saldo HM Programa de Implementação'),
  ('8dgokcy4','HM',7072.60,'Saldo HM Programa de Implementação'),
  ('32e1n186','HM',10330.38,'Saldo HM Programa de Implementação'),
  ('ljiov5j3','TRANSMISSAO',197.00,'Tranmissão Online THB SP 2026'),
  ('qm4lu7py','AURUM',1000.00,'Sinal Aurum ETHB/SP R$ 1.000 de R$ 60.000'),
  ('j0gsd19c','ETHB',497.00,'Encontro do Time Holding Brasil/2027'),
  ('s8i8edv7','HM',14303.00,'Saldo HM Programa de Implementação'),
  ('c26ip733','HM',13041.35,'Saldo HM Programa de Implementação'),
  ('1wvjy28l','HM',9701.18,'Saldo HM Programa de Implementação'),
  ('art7p6yd','HM',12715.15,'Saldo HM Programa de Implementação'),
  ('u1nhykj5','HM',9742.27,'Saldo HM Programa de Implementação'),
  ('pmak6v9u','HM',13218.88,'Saldo HM Programa de Implementação'),
  ('d8bf90k9','HM',12726.10,'Saldo HM Programa de Implementação'),
  ('2g38mv98','HM',13120.62,'Saldo HM Programa de Implementação'),
  ('vzehb16i','AURUM',45927.32,'Saldo Aurum - ETHB'),
  ('8vil8s4u','AURUM',52876.71,'Saldo Aurum - ETHB'),
  ('4y1ggvj9','AURUM',49917.81,'Saldo Aurum - ETHB'),
  ('e288p4zk','AURUM',59000.00,'Saldo Aurum - ETHB'),
  ('5jhjnhe8','AURUM',58700.00,'Saldo Aurum - ETHB'),
  ('f8akw09u','AURUM',51808.22,'Saldo Aurum - ETHB'),
  ('n84xawd3','HM',null,'Saldo Aurum - ETHB - R$ 13.800,00 ou em 12 x de R$ 1.461,05 * no cartã')
)
select csv.codigo, csv.valor_csv, s.valor as valor_banco,
       round(csv.valor_csv - s.valor, 2) as diferenca, s.recorrente, s.ativo
  from csv join cs.hm_ofertas_saldo s on s.codigo = csv.codigo
 where csv.valor_csv is not null and s.valor is not null
   and abs(csv.valor_csv - s.valor) > 0.01
 order by abs(csv.valor_csv - s.valor) desc;

-- =====================================================================
-- 3) DINHEIRO EM OFERTA NAO CATALOGADA (o furo que some em silencio)
-- =====================================================================
with csv(codigo, produto_csv, valor_csv, rotulo_csv) as (values
  ('6qxsk9kq','HM',2497.00,'Renovação Holding Masters - acesso dez/26 + ingresso plateia ETHB'),
  ('bgu5i1zd','HM',null,'Holding Masters'),
  ('vg96e2tc','AURUM',43000.00,'Aurum'),
  ('7ekxtlls','ETHB',500.00,'ETHB 2026'),
  ('j3jmszma','ETHB',1000.00,'ETHB 2026'),
  ('2euebtzg','ETHB',1500.00,'ETHB 2026'),
  ('6xys4ypa','?',null,'ETHB 2026'),
  ('t8yzswu6','?',null,'ETHB 2026'),
  ('dp41etyr','AURUM',45000.00,'Aurum'),
  ('z391kxd9','HM',300.00,'Holding Masters - Sinal R$ 300 de R$ 15.000'),
  ('2vibw97m','HM',14700.00,'Holding Masters - Saldol R$ 12.700 de R$ 15.000'),
  ('z950cse4','AURUM',21500.00,'Aurum'),
  ('fysepc10','AURUM',43000.00,'Aurum'),
  ('2mxcjw8t','HM',14700.00,'Holding Masters - Saldol R$ 12.700 de R$ 15.000 (recorrente)'),
  ('t4pje4k3','HM',null,'Holding Masters - Saldo 6.500'),
  ('frw73xd5','FIRE',32823.01,'Catena no Fire'),
  ('b6feodjs','FIRE',32823.01,'Wiliam Loro no Fire'),
  ('1ayp826g','HM',13960.27,'Saldo HM Programa de Implementação'),
  ('ikgazdy8','HM',12772.68,'Saldo HM Programa de Implementação'),
  ('wkd93am7','HM',4900.00,'Saldo ATM Programa de Implementação'),
  ('2jaj1deq','HM',13254.87,'Saldo HM Programa de Implementação'),
  ('cx3rwir9','HM',11675.34,'Saldo HM Programa de Implementação'),
  ('ntebmlv0','HM',11084.28,'Saldo HM Programa de Implementação'),
  ('5uqyub1h','HM',11042.47,'Saldo HM Programa de Implementação'),
  ('cck38o0v','HM',6891.78,'Saldo HM Programa de Implementação'),
  ('yuzm73ri','HM',645.21,'Saldo HM Programa de Implementação'),
  ('ym44m2ea','HM',4968.49,'Saldo HM Programa de Implementação'),
  ('yqipi87j','HM',6932.88,'Saldo HM Programa de Implementação'),
  ('izxq8lmo','HM',7235.26,'Saldo HM Programa de Implementação'),
  ('m0qvagzx','HM',8782.19,'Saldo HM Programa de Implementação'),
  ('tomp81oq','HM',8823.29,'Saldo HM Programa de Implementação'),
  ('sxjnedi5','HM',9440.78,'Saldo HM Programa de Implementação'),
  ('9rf41pie','HM',11806.85,'Saldo HM Programa de Implementação'),
  ('j7lx2qdp','HM',11964.38,'Saldo HM Programa de Implementação'),
  ('z244ubp2','HM',12501.93,'Saldo HM Programa de Implementação'),
  ('bgr5c91b','HM',12802.58,'Saldo HM Programa de Implementação'),
  ('du5wsb5t','HM',12990.41,'Saldo HM Programa de Implementação'),
  ('7sjhxiz8','HM',9358.60,'Saldo HM Programa de Implementação'),
  ('8a7xapie','HM',12512.02,'Saldo HM Programa de Implementação'),
  ('dl54fceb','HM',10765.00,'Saldo HM Programa de Implementação'),
  ('t8t12rup','HM',4212.33,'Saldo HM Programa de Implementação'),
  ('7nzol8wb','HM',13402.67,'Saldo HM Programa de Implementação'),
  ('r9wdsusx','HM',12969.79,'Saldo HM Programa de Implementação'),
  ('8dgokcy4','HM',7072.60,'Saldo HM Programa de Implementação'),
  ('32e1n186','HM',10330.38,'Saldo HM Programa de Implementação'),
  ('ljiov5j3','TRANSMISSAO',197.00,'Tranmissão Online THB SP 2026'),
  ('qm4lu7py','AURUM',1000.00,'Sinal Aurum ETHB/SP R$ 1.000 de R$ 60.000'),
  ('j0gsd19c','ETHB',497.00,'Encontro do Time Holding Brasil/2027'),
  ('s8i8edv7','HM',14303.00,'Saldo HM Programa de Implementação'),
  ('c26ip733','HM',13041.35,'Saldo HM Programa de Implementação'),
  ('1wvjy28l','HM',9701.18,'Saldo HM Programa de Implementação'),
  ('art7p6yd','HM',12715.15,'Saldo HM Programa de Implementação'),
  ('u1nhykj5','HM',9742.27,'Saldo HM Programa de Implementação'),
  ('pmak6v9u','HM',13218.88,'Saldo HM Programa de Implementação'),
  ('d8bf90k9','HM',12726.10,'Saldo HM Programa de Implementação'),
  ('2g38mv98','HM',13120.62,'Saldo HM Programa de Implementação'),
  ('vzehb16i','AURUM',45927.32,'Saldo Aurum - ETHB'),
  ('8vil8s4u','AURUM',52876.71,'Saldo Aurum - ETHB'),
  ('4y1ggvj9','AURUM',49917.81,'Saldo Aurum - ETHB'),
  ('e288p4zk','AURUM',59000.00,'Saldo Aurum - ETHB'),
  ('5jhjnhe8','AURUM',58700.00,'Saldo Aurum - ETHB'),
  ('f8akw09u','AURUM',51808.22,'Saldo Aurum - ETHB'),
  ('n84xawd3','HM',null,'Saldo Aurum - ETHB - R$ 13.800,00 ou em 12 x de R$ 1.461,05 * no cartã')
)
select c.oferta_codigo,
       coalesce(m.produto,'FORA DO MAPA')                  as board,
       c.produto_id, max(c.produto_nome)                   as produto_hotmart,
       count(*)                                            as compras,
       count(distinct c.comprador_id)                      as pessoas,
       to_char(sum(c.preco),'FM999G999G999D00')            as r$,
       min(coalesce(c.data_aprovacao,c.data_compra))::date as primeira,
       max(coalesce(c.data_aprovacao,c.data_compra))::date as ultima,
       bool_or(csv.codigo is not null)                     as esta_na_planilha,
       exists (select 1 from cs.hm_alertas a
                where a.tipo='oferta_orfa' and a.chave=c.oferta_codigo
                  and a.resolvido_em is null)              as tem_alerta_aberto
  from public.compras c
  left join public.hm_product_catalog cat on cat.offer_code = c.oferta_codigo
  left join cs.hm_produto_hotmart     m   on m.produto_id   = c.produto_id
  left join csv                           on csv.codigo     = c.oferta_codigo
 where cat.offer_code is null and c.oferta_codigo is not null
   and c.status in (/* Q0 */)
 group by c.oferta_codigo, m.produto, c.produto_id
 order by sum(c.preco) desc;

-- 3b. o que nao gera nem alerta: produto fora de cs.hm_produto_hotmart
--     0195:189-191 -> return new sem alertar quando o produto nao esta mapeado
select coalesce(m.produto,'FORA DO MAPA') as board, c.produto_id,
       max(c.produto_nome) as produto_hotmart, count(*) as compras,
       to_char(sum(c.preco),'FM999G999G999D00') as r$
  from public.compras c
  left join cs.hm_produto_hotmart m on m.produto_id = c.produto_id
 where m.produto_id is null and c.status in (/* Q0 */)
 group by 1,2 order by sum(c.preco) desc;

-- =====================================================================
-- 4) O 'UM REAL ERRADO': link do saldo x saldo devido
--    lib/services/hm-ficha.ts:193-199 sugere por abs(valor-alvo), SEM tolerancia
-- =====================================================================
select cp.nome, ch.produto, f.saldo_a_perseguir as devido,
       ch.oferta_saldo_codigo as link_gravado, s.valor as valor_do_link,
       round(s.valor - f.saldo_a_perseguir, 2) as erro, ch.link_saldo_enviado_em,
       exists (select 1 from cs.hm_ofertas_saldo o
                where o.ativo and o.valor is not null
                  and abs(o.valor - f.saldo_a_perseguir) <= 0.01) as tem_oferta_exata
  from cs.contatos_hm ch
  join cs.vw_hm_financeiro f on f.comprador_id = ch.comprador_id
                            and f.produto      = ch.produto
  left join public.compradores  cp on cp.id    = ch.comprador_id
  left join cs.hm_ofertas_saldo s  on s.codigo = ch.oferta_saldo_codigo
 where ch.cancelamento_efetivado_em is null
   and coalesce(f.saldo_a_perseguir,0) > 0
 order by abs(coalesce(s.valor,0) - f.saldo_a_perseguir) desc nulls last;

-- 4b. o placar em uma linha
select count(*)                                                as universo_com_saldo,
       count(ch.oferta_saldo_codigo)                           as com_link_gravado,
       count(*) filter (where ch.oferta_saldo_codigo is not null
                          and abs(s.valor - f.saldo_a_perseguir) > 0.01) as link_errado,
       to_char(coalesce(sum(abs(s.valor - f.saldo_a_perseguir)) filter (
              where ch.oferta_saldo_codigo is not null
                and abs(s.valor - f.saldo_a_perseguir) > 0.01),0),'FM999G999D00') as r$_de_erro,
       count(*) filter (where not exists (
              select 1 from cs.hm_ofertas_saldo o
               where o.ativo and o.valor is not null
                 and abs(o.valor - f.saldo_a_perseguir) <= 0.01))        as sem_oferta_exata
  from cs.contatos_hm ch
  join cs.vw_hm_financeiro f on f.comprador_id = ch.comprador_id
                            and f.produto      = ch.produto
  left join cs.hm_ofertas_saldo s on s.codigo = ch.oferta_saldo_codigo
 where ch.cancelamento_efetivado_em is null
   and coalesce(f.saldo_a_perseguir,0) > 0;

-- =====================================================================
-- 5) AURUM - os 5 codigos do CSV casam? e quem e 8vil8s4u (52.876,71)?
-- =====================================================================
select a.saldo_a_pagar as saldo, count(*) as pessoas,
       string_agg(a.nome, ' | ' order by a.nome) as quem
  from cs.vw_aurum_saldo a
 where a.saldo_a_pagar is not null
 group by 1 order by 1 desc;
-- casar com: 59000 e288p4zk | 58700 5jhjnhe8 | 51808.22 f8akw09u
--            49917.81 4y1ggvj9 | 45927.32 vzehb16i | 52876.71 8vil8s4u (sem dono conhecido)

-- 5b. total a receber medido (o vault dizia 1.829.807,99 em 14/08)
select count(*) filter (where saldo_a_pagar is not null) as cobraveis,
       count(*) filter (where saldo_a_pagar is null)     as nao_cobrar,
       to_char(sum(saldo_a_pagar),'FM999G999G999D00')    as a_receber
  from cs.vw_aurum_saldo;

-- 5c. quem esta perto de 52.876,71 (o orfao)
select nome, saldo_a_pagar, round(saldo_a_pagar - 52876.71,2) as delta
  from cs.vw_aurum_saldo where saldo_a_pagar is not null
 order by abs(saldo_a_pagar - 52876.71) limit 5;

-- =====================================================================
-- 6) WEBHOOK CEGO - ETHB 2026 / Fire / Transmissao existem no banco?
-- =====================================================================
select c.produto_id, max(c.produto_nome) as nome, count(*) as compras,
       to_char(sum(c.preco),'FM999G999G999D00') as r$,
       min(coalesce(c.data_aprovacao,c.data_compra))::date as desde,
       (m.produto_id is not null) as mapeado
  from public.compras c
  left join cs.hm_produto_hotmart m on m.produto_id = c.produto_id
 group by c.produto_id, m.produto_id order by count(*) desc;

-- 6b. CONTADOR INDEPENDENTE: cs.hotmart_eventos grava ANTES de qualquer guard.
--     Produto que aparece aqui e NAO em public.compras = dinheiro invisivel.
select e.payload->'data'->'product'->>'id'   as produto_id,
       e.payload->'data'->'product'->>'name' as produto_nome,
       count(*) as eventos,
       count(*) filter (where not exists (
         select 1 from public.compras c
          where c.hotmart_transaction =
                e.payload->'data'->'purchase'->>'transaction')) as sem_compra_gravada
  from cs.hotmart_eventos e
 group by 1,2 order by 3 desc;

-- =====================================================================
-- 7) CLASSIFICACAO CONTRADITORIA + quanto cada uma moveu
-- =====================================================================
with marcado as (
  select cat.*, case
    when cat.categoria='sinal'  and not coalesce(cat.entrada_do_programa,false)
         then 'sinal que NAO e entrada do programa'
    when cat.categoria<>'sinal' and coalesce(cat.entrada_do_programa,false)
         then 'entrada do programa fora da categoria sinal'
    when coalesce(cat.entrada_condicao_fechada,false) and cat.pacote_cheio is null
         then 'condicao fechada sem pacote'
    when cat.categoria='diferenca' and not exists (
         select 1 from cs.hm_ofertas_saldo s where s.codigo=cat.offer_code)
         then 'saldo sem link em hm_ofertas_saldo'
    when cat.categoria='renovacao' and coalesce(cat.concede_trilha,false)
         then 'renovacao concedendo trilha'
    when cat.categoria is null then 'sem categoria (o trigger IGNORA a venda)'
  end as contradicao
    from public.hm_product_catalog cat
)
select m.offer_code, m.categoria, m.entrada_do_programa, m.pacote_cheio,
       m.concede_trilha, m.contradicao, left(m.notes,70) as notes,
       count(c.id) as compras, count(distinct c.comprador_id) as pessoas,
       to_char(coalesce(sum(c.preco),0),'FM999G999G999D00') as r$
  from marcado m
  left join public.compras c on c.oferta_codigo = m.offer_code
                            and c.status in (/* Q0 */)
 where m.contradicao is not null
 group by 1,2,3,4,5,6,7
 order by coalesce(sum(c.preco),0) desc;
