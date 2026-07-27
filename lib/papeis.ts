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

// Vê TODOS os cards de todas as equipes = SÓ o papel `admin`.
// Decisão do Marcio (27/07, revisada): visão global é do ADMIN, não da equipe.
// Antes "estar no GP" dava visão total — mas isso fazia um OPERADOR do GP (ex.:
// Jusy) ver os cards de outras equipes (Kelly). Agora: só o admin vê tudo; operador
// do GP vê só o dele + pool, como qualquer operador; o gestor (líder) vê a equipe dele.
export function podeVerTudo(papel: Papel | null | undefined, _tipoEquipe?: TipoEquipe | null): boolean {
  return papel === "admin";
}

// ===== Acesso por portal (0145) ============================================
// Cada conta tem uma whitelist de portais (HT/SEM/CNHF/HM). Quem não tem o portal
// na lista não entra nem vê. Gerido pelos admins do Grupo Participa.
export function podeAcessarPortal(portais: string[] | null | undefined, portalEvento: string): boolean {
  return !!portais && portais.includes(portalEvento);
}

// Quem pode GERIR os acessos (portais por conta): admin E do Grupo Participa (GP).
// Reconcilia os dois eixos de autoridade — papel admin não basta se não for do GP.
export function podeGerirAcesso(papel: Papel | null | undefined, tipoEquipe?: TipoEquipe | null): boolean {
  return papel === "admin" && ehEquipePrincipal(tipoEquipe);
}

// Gestor = líder da própria equipe (0143): enxerga e distribui dentro da equipe
// dele (o dele + os dos operadores da mesma equipe), mas NÃO vê outras equipes.
// Vale para qualquer equipe (comum ou GP) — só o admin tem visão global agora.
export function ehLiderEquipe(u: { lider_equipe?: boolean | null; equipe_tipo?: TipoEquipe | null }): boolean {
  return !!u.lider_equipe && !!u.equipe_tipo; // é líder e está numa equipe
}

// Escopo de visibilidade para o WHERE das queries do board/tabela/inbox do HM.
//   tudo     → ADMIN (sem recorte): vê tudo, e o que está com cada operador.
//   equipe   → gestor/líder da equipe: vê o POOL + TODOS os cards da equipe dele
//              (de qualquer operador da equipe) — para distribuir e acompanhar.
//   operador → o resto (incl. operador do GP como a Jusy): vê SÓ o POOL (sem dono)
//              + os cards atribuídos a ELE (ou que ele pescou). Não vê os dos colegas.
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
