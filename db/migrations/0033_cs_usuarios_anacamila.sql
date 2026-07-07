-- =====================================================================
-- 0033_cs_usuarios_anacamila
-- Novo acesso operador: Ana Camila (anacamila@advmais.com), senha "Abc@102030"
-- (hash scrypt, salt próprio — ver lib/auth.ts). Papel 'operador', igual à
-- Jusy Machado (já criada no seed 0015). Idempotente: não sobrescreve se o
-- e-mail já existir.
-- =====================================================================
insert into cs.usuarios (nome, email, senha_hash, papel) values
  ('Ana Camila', 'anacamila@advmais.com', 'scrypt$beb4d69b0d7b8ca62671e9b3f5f8588d$5aff39354749eb3c842e40ceea6180c6e1b416e31642963d9c12c7dc587907a7417052c0520420eb350b9b618c7741b58908828f3404b5f4719b2ef0afb0bb98', 'operador')
on conflict do nothing;
