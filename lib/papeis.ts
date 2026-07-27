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

// Líder/ADM da própria equipe (0143): distribui e enxerga dentro da equipe dele,
// mas NÃO vê o GP nem outra equipe. É admin escopado — abaixo do admin global.
export function ehLiderEquipe(u: { lider_equipe?: boolean | null; equipe_tipo?: TipoEquipe | null }): boolean {
  // Só faz sentido em equipe comum: um "líder" na equipe principal já é master.
  return !!u.lider_equipe && u.equipe_tipo === "comum";
}

// Escopo de visibilidade para o WHERE das queries do board/tabela/inbox do HM.
//   tudo     → GP/admin (sem recorte): vê tudo, e o que está com cada operador.
//   equipe   → líder da equipe: vê o POOL + TODOS os cards da equipe dele (de
//              qualquer operador da equipe) — para poder distribuir e acompanhar.
//   operador → comum: vê SÓ o POOL (sem dono) + os cards atribuídos a ELE. Não vê
//              os dos colegas. Cada um enxerga o que é dele + o que está livre.
export type EscopoVisibilidade =
  | { modo: "tudo" }
  | { modo: "equipe"; equipeId: string | null }
  | { modo: "operador"; usuarioId: string };

export function escopoVisibilidade(u: {
  id: string;
  papel: Papel | null | undefined;
  equipe_id: string | null;
  equipe_tipo: TipoEquipe | null;
  lider_equipe?: boolean | null;
}): EscopoVisibilidade {
  if (podeVerTudo(u.papel, u.equipe_tipo)) return { modo: "tudo" };
  if (ehLiderEquipe(u)) return { modo: "equipe", equipeId: u.equipe_id };
  return { modo: "operador", usuarioId: u.id };
}

// Achata o escopo em 3 parâmetros para o WHERE das queries — só um de
// equipeId/usuarioId é não-nulo. Predicado padrão (aplicado em kanban/tabela/
// inbox/elegíveis):
//   (verTudo OR (responsavel_id is null and equipe_id is null)  -- pool
//            OR equipe_id = equipeId                            -- líder: a equipe
//            OR responsavel_id = usuarioId)                     -- operador: os dele
export function paramsEscopo(e: EscopoVisibilidade): { verTudo: boolean; equipeId: string | null; usuarioId: string | null } {
  return {
    verTudo: e.modo === "tudo",
    equipeId: e.modo === "equipe" ? e.equipeId : null,
    usuarioId: e.modo === "operador" ? e.usuarioId : null,
  };
}
