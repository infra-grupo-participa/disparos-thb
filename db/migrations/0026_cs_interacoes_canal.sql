-- =====================================================================
-- 0026_cs_interacoes_canal
-- Marca o CANAL de cada ação na timeline do aluno (whatsapp | email | ligacao),
-- base da estratégia "3 ao cubo": reconstruir a SEQUÊNCIA de canais por aluno
-- (1º, 2º, 3º toque) e correlacionar com a conversão no funil.
--
-- Hoje WhatsApp e e-mail compartilham o tipo 'disparo' (indistinguíveis); o
-- canal resolve isso. Backfill por heurística da descrição já gravada.
-- =====================================================================
alter table cs.interacoes add column if not exists canal text;  -- whatsapp | email | ligacao

-- Backfill das ações já registradas:
update cs.interacoes set canal = 'ligacao'
 where tipo = 'ligacao' and canal is null;

update cs.interacoes set canal = 'email'
 where tipo = 'disparo' and canal is null and descricao like 'E-mail%';

update cs.interacoes set canal = 'whatsapp'
 where tipo = 'disparo' and canal is null and (descricao is null or descricao not like 'E-mail%');

create index if not exists ix_interacoes_canal on cs.interacoes (canal, criado_em);
