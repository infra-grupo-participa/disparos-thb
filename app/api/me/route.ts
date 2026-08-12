import { NextResponse } from "next/server";
import { getSessao, type Usuario } from "@/lib/auth";

export const runtime = "nodejs";

// Os campos que a UI recebe de /api/me — um SUBCONJUNTO de `Usuario` (lib/auth),
// nunca um literal solto. `Pick<Usuario, ...>` faz o TS reclamar sozinho quando
// `Usuario` ganhar um campo novo relevante para a UI e este objeto não o
// incluir — fecha a classe de bug que já mordeu o projeto 4x ("campo existe de
// um lado e não do outro": equipe_ativacao, gerente_distribuidor, funcoes…).
// Campos que a UI genuinamente não precisa (ex.: e-mail de login separado, hash
// de senha) ficam de fora por decisão explícita, não por esquecimento.
type MeResponse = Pick<
  Usuario,
  | "id" | "nome" | "email" | "papel" | "telefone"
  | "equipe_id" | "equipe_tipo" | "equipe_nome" | "equipe_cor"
  | "lider_equipe" | "gerente_distribuidor" | "portais"
  // 0202: sem este campo, a UI não sabe que a conta é da equipe de ativação —
  // o selo não aparece e o predicado do cliente (use-me) trata como "não tem o
  // bônus", divergindo do backend.
  | "equipe_ativacao"
  // 0210/0212: funções por portal ("HM:comercial", "HM:ativacao") — fonte
  // principal do predicado de esteira compartilhada; sem isto aqui a UI cai
  // sempre na rede de segurança (equipe_ativacao) e nunca no critério novo.
  | "funcoes"
>;

function paraResposta(u: Usuario): MeResponse {
  return {
    id: u.id, nome: u.nome, email: u.email, papel: u.papel, telefone: u.telefone,
    equipe_id: u.equipe_id, equipe_tipo: u.equipe_tipo, equipe_nome: u.equipe_nome, equipe_cor: u.equipe_cor,
    lider_equipe: u.lider_equipe, gerente_distribuidor: u.gerente_distribuidor, portais: u.portais,
    equipe_ativacao: u.equipe_ativacao,
    funcoes: u.funcoes,
  };
}

// GET /api/me — usuário logado (para o menu/cabeçalho e gating de UI).
export async function GET() {
  const u = await getSessao();
  if (!u) return NextResponse.json({ ok: false }, { status: 401 });
  return NextResponse.json({ ok: true, usuario: paraResposta(u) });
}
