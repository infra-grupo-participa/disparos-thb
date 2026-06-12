-- =====================================================================
-- 0015_cs_usuarios
-- Usuários do workspace de CS (operadores da ativação) com níveis de acesso.
-- Substitui a autenticação por senha única global (APP_PASSWORD) por login
-- individual (email + senha). A senha é guardada com hash scrypt no formato
-- "scrypt$<saltHex>$<hashHex>" (ver lib/auth.ts). Papéis: admin | operador.
-- O nome do usuário é usado como `responsavel` em cs.contatos (atribuição).
-- =====================================================================
create table if not exists cs.usuarios (
  id            uuid primary key default gen_random_uuid(),
  nome          text not null,
  email         text not null,
  senha_hash    text not null,
  papel         text not null default 'operador' check (papel in ('admin', 'operador')),
  ativo         boolean not null default true,
  criado_em     timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);

-- E-mail único (case-insensitive) — login normaliza para minúsculas.
create unique index if not exists cs_usuarios_email_uidx on cs.usuarios (lower(email));

grant select, insert, update, delete on cs.usuarios to disparos_app;
alter table cs.usuarios enable row level security;
drop policy if exists app_all on cs.usuarios;
create policy app_all on cs.usuarios to disparos_app using (true) with check (true);

-- Seed inicial — senha "Abc@102030" (hash scrypt, salt distinto por usuário).
-- Idempotente: não sobrescreve se o e-mail já existir.
insert into cs.usuarios (nome, email, senha_hash, papel) values
  ('Marcio', 'marcio@advmais.com', 'scrypt$6b1503c8bb9069f94444e0eb6233a872$42657032471072c5d34fb9da0b1621914ed255c4e0de524c03121f2df9a6320c26677844f6dbdf196821bb3b37ebd014ef9417cfb9d301434019b719a50a04c2', 'admin'),
  ('Jonathan Mendes', 'jonathan@advmais.com', 'scrypt$95fbc45498832b8c2bb5eb45ad8ffa08$4216a8c7170fa10fbb76b54acdfe5c3701223aa4d55794d62619a1ba7db534e499dd994505d8af1cca0695e0e99ed41608be2d5d2c74e7ab8c70e58aaee9f104', 'operador'),
  ('Marco', 'marco@advmais.com', 'scrypt$1da11bd58cff682a83047bc459443a0c$d12cadc6d0c35f80495ae95adfe9d5ec3a6fd7ad07dbe18b1cef7d4c3880046214847ac7b1a3df3e1199c10e5d5a2f12c43c6e07e6ce0020131b90903e2bbe75', 'operador'),
  ('Jusy Machado', 'jusy@advmais.com', 'scrypt$b43de4bf18b38824bfa9ea7e4346f2a3$6f996514d88f7a4441433fd4a7657a1ce4cd7a11de56dae9d0b05081c8384bfdfcd7cff67bd765d02f8097ad7d1d73e7ef4d6a1f29f1f2fba5f645d789a3f797', 'operador')
on conflict do nothing;
