// Regras de papel compartilhadas entre servidor e cliente. SEM dependências de
// servidor (nada de node:crypto/next headers) — por isso mora aqui e não em
// lib/auth.ts, que é server-only. auth.ts e use-me.ts reexportam daqui, para a
// regra viver num lugar só.
export type Papel = "admin" | "disparador" | "operador";

// Eventos de ativação tocados por SDR: nesses, o operador comum TAMBÉM dispara —
// a abordagem outbound é o trabalho dele. Nos demais (HT carro-chefe, HM), o
// disparo segue restrito a admin/disparador.
export const EVENTOS_SDR: readonly string[] = ["SEM", "CNHF"];

// Fonte única de "pode efetuar disparos", usada pelo backend (/api/send) e pelo
// gating de UI. admin/disparador disparam em tudo; operador só nos eventos de SDR.
export function podeDisparar(papel: Papel | null | undefined, evento?: string | null): boolean {
  if (papel === "admin" || papel === "disparador") return true;
  if (papel === "operador" && evento && EVENTOS_SDR.includes(evento)) return true;
  return false;
}

// ===== Equipes / visibilidade do board HM ==================================
// A equipe é ortogonal ao papel: o papel diz o que a pessoa FAZ, a equipe diz
// de quem são os cards que ela VÊ. 'principal' = Grupo Participa (Pro Max), a
// equipe-mãe com visão global; 'comum' = equipe que só vê o pool + os próprios.
export type TipoEquipe = "principal" | "comum";

export function ehEquipePrincipal(tipo?: TipoEquipe | null): boolean {
  return tipo === "principal";
}

// Vê TODOS os cards de todas as equipes: admin (gestão) OU equipe principal (GP).
export function podeVerTudo(papel: Papel | null | undefined, tipoEquipe?: TipoEquipe | null): boolean {
  return papel === "admin" || ehEquipePrincipal(tipoEquipe);
}

// Escopo de visibilidade para o WHERE das queries do board/tabela do HM:
//   tudo   → GP/admin (sem recorte)
//   equipe → comum: pool (sem dono e sem equipe) + cards da própria equipe
export type EscopoVisibilidade =
  | { modo: "tudo" }
  | { modo: "equipe"; equipeId: string | null };

export function escopoVisibilidade(u: {
  papel: Papel | null | undefined;
  equipe_id: string | null;
  equipe_tipo: TipoEquipe | null;
}): EscopoVisibilidade {
  return podeVerTudo(u.papel, u.equipe_tipo) ? { modo: "tudo" } : { modo: "equipe", equipeId: u.equipe_id };
}
