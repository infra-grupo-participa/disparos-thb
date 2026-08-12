import crypto from "node:crypto";
import { cookies } from "next/headers";
import { queryOne } from "@/lib/db";
import { podeDisparar, type Papel, type TipoEquipe } from "@/lib/papeis";

export const SESSION_COOKIE = "cs_session";
const MAX_AGE_MS = 1000 * 60 * 60 * 24 * 30; // 30 dias

// Papéis e suas capacidades:
//   admin       — acesso total (gestão de usuários + disparos em tudo).
//   disparador  — operador que TAMBÉM dispara em qualquer evento.
//   operador    — opera Kanban/contatos/inbox; dispara só nos eventos de SDR
//                 (SEM/CNHF). A regra vive em lib/papeis (compartilhada com a UI).
export type { Papel };
export { podeDisparar };
// A equipe entra ao lado do papel (Fase 1 de equipes/visibilidade do HM): o papel
// diz O QUE a pessoa faz (admin/disparador/operador); a equipe diz de QUEM são os
// cards que ela enxerga (principal = Grupo Participa vê tudo; comum vê pool + próprios).
export type Usuario = {
  id: string; nome: string; email: string; papel: Papel; ativo: boolean; telefone: string | null;
  equipe_id: string | null; equipe_tipo: TipoEquipe | null; equipe_nome: string | null; equipe_cor: string | null;
  // Líder/ADM da própria equipe (0143): distribui dentro da equipe dele.
  lider_equipe: boolean;
  // Gerente distribuidor (0161): atribui para operador de QUALQUER equipe.
  gerente_distribuidor: boolean;
  // Equipe de ativação (0202): vê e move todo card da aba Ativação do HM,
  // inclusive de outra equipe. Marca por pessoa — ver lib/papeis.ts.
  // MANTIDA nesta fase (0210/0212) como rede de segurança — ver o comentário
  // de `ehEquipeDeAtivacao` em lib/papeis.ts.
  equipe_ativacao: boolean;
  // Funções por portal (0210): substitui o boolean acima como fonte principal.
  // Formato "portal:funcao" (ex.: "HM:comercial") — achatado assim porque a
  // sessão trafega como objeto simples (cookie→token→SELECT), não como lista
  // de pares; `temFuncao` (lib/papeis.ts) reconstrói a checagem.
  funcoes: string[];
  // Portais que esta conta pode acessar (0145). Vazio = nenhum (conta restrita).
  portais: string[];
};

function secret(): string {
  return process.env.SESSION_SECRET || "dev-insecure-secret-troque-isto";
}

// ===== Sessão (token sem store) ============================================
// Token: "<userId>.<ts>.<hmac(userId.ts)>". Válido se a assinatura bate e não
// expirou. O userId viaja no token para sabermos quem está logado sem store.
export function makeToken(userId: string): string {
  const ts = Date.now().toString();
  const base = `${userId}.${ts}`;
  const sig = crypto.createHmac("sha256", secret()).update(base).digest("hex");
  return `${base}.${sig}`;
}

// Retorna o userId se o token for válido (assinatura + validade); senão null.
export function verifyToken(token?: string | null): string | null {
  if (!token) return null;
  const i = token.lastIndexOf(".");
  if (i <= 0) return null;
  const base = token.slice(0, i); // "<userId>.<ts>"
  const sig = token.slice(i + 1);
  const j = base.indexOf(".");
  if (j <= 0) return null;
  const userId = base.slice(0, j);
  const ts = Number(base.slice(j + 1));
  if (!userId || !Number.isFinite(ts)) return null;

  const expected = crypto.createHmac("sha256", secret()).update(base).digest("hex");
  const a = new Uint8Array(Buffer.from(sig));
  const b = new Uint8Array(Buffer.from(expected));
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  if (Date.now() - ts >= MAX_AGE_MS) return null;
  return userId;
}

// Presença de sessão válida (não confirma que o usuário ainda existe/está ativo).
export function isAuthed(): boolean {
  return verifyToken(cookies().get(SESSION_COOKIE)?.value) !== null;
}

// Sessão completa: resolve o usuário no banco a partir do token. Retorna null se
// o token é inválido OU o usuário foi removido/desativado. Use quando precisar
// saber quem é / qual o papel (gating de admin, autoria, atribuição).
export async function getSessao(): Promise<Usuario | null> {
  const userId = verifyToken(cookies().get(SESSION_COOKIE)?.value);
  if (!userId) return null;
  const u = await queryOne<Usuario>(
    `select u.id, u.nome, u.email, u.papel, u.ativo, u.telefone, u.lider_equipe, u.gerente_distribuidor,
            u.equipe_ativacao,
            u.equipe_id, e.tipo as equipe_tipo, e.nome as equipe_nome, e.cor as equipe_cor,
            coalesce((select array_agg(up.portal) from cs.usuario_portais up where up.usuario_id = u.id), '{}') as portais,
            -- Funções por portal (0210/0212): "portal:funcao" achatado — a
            -- pessoa pode ter várias (ex.: HM:comercial e HM:ativacao).
            coalesce((select array_agg(uf.portal || ':' || uf.funcao) from cs.usuario_funcoes uf where uf.usuario_id = u.id), '{}') as funcoes
       from cs.usuarios u
       left join cs.equipes e on e.id = u.equipe_id
      where u.id = $1 and u.ativo = true`,
    [userId],
  );
  return u ?? null;
}

// ===== Senha (scrypt nativo) ===============================================
// Formato armazenado: "scrypt$<saltHex>$<hashHex>". Parâmetros default do
// scrypt (N=16384, r=8, p=1), keylen 64. Comparação em tempo constante.
const SCRYPT_KEYLEN = 64;

export function hashSenha(senha: string): string {
  const salt = new Uint8Array(crypto.randomBytes(16));
  const dk = new Uint8Array(crypto.scryptSync(senha, salt, SCRYPT_KEYLEN));
  return `scrypt$${Buffer.from(salt).toString("hex")}$${Buffer.from(dk).toString("hex")}`;
}

export function verifySenha(senha: string, armazenado: string | null | undefined): boolean {
  if (!armazenado) return false;
  const [algo, saltHex, hashHex] = armazenado.split("$");
  if (algo !== "scrypt" || !saltHex || !hashHex) return false;
  try {
    const salt = new Uint8Array(Buffer.from(saltHex, "hex"));
    const a = new Uint8Array(crypto.scryptSync(senha, salt, SCRYPT_KEYLEN));
    const b = new Uint8Array(Buffer.from(hashHex, "hex"));
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  } catch {
    return false;
  }
}
