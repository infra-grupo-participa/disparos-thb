// Regras de papel/nível compartilhadas entre servidor e cliente. SEM dependências
// de servidor (nada de node:crypto/next headers) — por isso mora aqui e não em
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

// Arraste/ação livre no board por equipe×evento (30/07, pedido do Marcio):
// no SEMINÁRIO (evento SEM) a equipe PRINCIPAL (Grupo Participa Pro Max) age em
// QUALQUER card — não só no pool/nos seus. O Seminário é outbound de SDR e o time
// principal remaneja a fila entre si o dia todo; a regra operador (só pool+dele)
// travava o arrasto de card de colega (403). Restrito à equipe principal —
// equipe comum (ex.: Equipe 2) segue com o gate normal.
// HM (03/08, pedido do Marcio): a MESMA dor apareceu na Ativação do Holding
// Masters. Ana Camila e Jusy (operadoras da equipe principal) ativam os alunos,
// mas cada card cai atribuído a UMA delas (webhook/pagamento) e a colega não
// conseguia arrastá-lo (draggable=false + 403 card_de_outro_operador). A equipe
// principal remaneja a esteira de ativação entre si igual ao Seminário — então HM
// entra na lista. Equipe comum e demais eventos (HT) seguem com o gate normal.
const EVENTOS_ACAO_LIVRE_PRINCIPAL: readonly string[] = ["SEM", "HM"];
export function acaoLivrePorEquipeEvento(u: Ator | null | undefined, evento?: string | null): boolean {
  return !!evento
    && EVENTOS_ACAO_LIVRE_PRINCIPAL.includes(evento)
    && u?.equipe_tipo === "principal";
}

// ===== Equipes / níveis de acesso ==========================================
// A equipe é ortogonal ao papel: o papel diz o que a pessoa FAZ, a equipe diz
// de quem são os cards que ela VÊ. 'principal' = Grupo Participa (Pro Max), a
// equipe-mãe; 'comum' = as demais equipes.
export type TipoEquipe = "principal" | "comum";

export function ehEquipePrincipal(tipo?: TipoEquipe | null): boolean {
  return tipo === "principal";
}

// O NÍVEL efetivo é derivado de papel × equipe — não é um 4º campo no banco.
// Decisão do Marcio (27/07):
//   master   → papel admin E equipe principal (GP): vê e gere tudo.
//   gestor   → papel admin OU líder de equipe, em QUALQUER equipe (que não seja
//              master): enxerga e distribui dentro da própria equipe. Isso cobre
//              os dois furos do modelo antigo — o admin de equipe comum sem a
//              flag (que caía em operador) e o líder do GP (que via tudo).
//   operador → o resto: pool + os cards dele.
export type Nivel = "master" | "gestor" | "operador";

// Tudo que a regra precisa saber sobre o ator. `Usuario` (lib/auth) e `Me`
// (use-me) satisfazem esta forma — as funções recebem o OBJETO, não mais
// (papel, tipo) solto: a regra cruza papel, equipe e flag, e espalhar os campos
// pelos call sites era o que deixava furo (cada rota combinava de um jeito).
export type Ator = {
  id: string;
  papel: Papel | null | undefined;
  equipe_id: string | null;
  equipe_tipo: TipoEquipe | null;
  lider_equipe?: boolean | null;
  portais?: string[] | null;
};

// Ator ausente (sessão ainda não carregada, autor de sistema) = o nível mais
// baixo. Nunca o contrário: na dúvida, a regra fecha.
export function nivelDe(u: Ator | null | undefined): Nivel {
  if (!u) return "operador";
  if (u.papel === "admin" && u.equipe_tipo === "principal") return "master";
  if (u.papel === "admin" || !!u.lider_equipe) return "gestor";
  return "operador";
}

export function ehMaster(u: Ator | null | undefined): boolean {
  return nivelDe(u) === "master";
}

// Vê TODOS os cards de todas as equipes = SÓ o master (admin do GP). Um membro
// comum do GP NÃO vê tudo (era o Furo 1: a equipe sozinha liberava a visão
// global), e um admin de equipe comum também não — cada equipe tem os seus.
// Merge 27/07: o db4dd24 (origin/main) tentava o mesmo conserto com
// `podeVerTudo = papel === 'admin'` — descartado de propósito: reabria o admin
// de equipe COMUM ver tudo. Aqui admin comum = gestor (só a própria equipe).
export function podeVerTudo(u: Ator | null | undefined): boolean {
  return ehMaster(u);
}

// Quem pode GERIR contas/acessos/config (portais por conta, canais, tags,
// equipes): exatamente o master. Papel admin em equipe comum gere a EQUIPE
// (nível gestor), não o sistema.
export function podeGerirAcesso(u: Ator | null | undefined): boolean {
  return ehMaster(u);
}

// Quem distribui cards para outras pessoas: master (a qualquer um) e gestor
// (dentro da própria equipe). Operador só assume para si — não "distribui".
export function podeDistribuir(u: Ator | null | undefined): boolean {
  return nivelDe(u) !== "operador";
}

// Pode atribuir um card PARA este destino?
//   master   → sempre (e a rota trava o card: porAdmin=true).
//   gestor   → só se o destino pertence à MESMA equipe dele. Destino sem equipe
//              (equipe_id null) NÃO passa: "null === null" não é "mesma equipe",
//              é dois desgarrados — e viraria brecha p/ gestor sem equipe.
//   operador → só se o destino é ELE MESMO (assumir).
// Destino null (devolver ao pool) NÃO passa por aqui — a rota decide com o card
// em mãos (precisa saber de quem o card é e se está travado pelo admin).
// PORTAL (28/07): além desta hierarquia, o destino precisa ter o PORTAL do card
// na whitelist (cs.usuario_portais) — senão o card some da vista dele no
// instante seguinte. Essa checagem exige banco e vive nos serviços de
// atribuição (atribuirResponsavelHm / atribuirResponsavel), que recusam com
// reason 'destino_sem_portal'. Este predicado isomórfico segue só papel×equipe.
export function podeAtribuirPara(
  ator: Ator,
  destino: { id: string; equipe_id: string | null } | null,
): boolean {
  if (!destino) return false;
  const nivel = nivelDe(ator);
  if (nivel === "master") return true;
  if (nivel === "gestor") return destino.equipe_id !== null && destino.equipe_id === ator.equipe_id;
  return destino.id === ator.id;
}

// ===== Acesso por portal (0145) ============================================
// Cada conta tem uma whitelist de portais (HT/SEM/CNHF/HM). Quem não tem o portal
// na lista não entra nem vê — nem pela página, nem pela API (lib/guard). Gerido
// pelo master.
export function podeAcessarPortal(portais: string[] | null | undefined, portalEvento: string): boolean {
  return !!portais && portais.includes(portalEvento);
}

// ===== Escopos: ENXERGAR ≠ PODER AGIR (decisão do Marcio, 28/07) ============
// Duas perguntas, duas funções — uma só respondendo às duas era exatamente o
// que fazia o operador não ver o trabalho dos colegas:
//   escopoVisibilidade(u) → LEITURA: o que aparece nas LISTAGENS (kanban,
//     tabela, inbox, agendamentos, elegíveis, relatórios, exports, dashboards,
//     atividade) e o que ABRE em modo leitura (ficha, conversa).
//   escopoAcao(u) → ESCRITA: em quais cards o ator pode AGIR (editar, mover,
//     atribuir, registrar atendimento, enviar mensagem, lote).
//
// Modos:
//   tudo     → sem recorte.
//   equipe   → POOL + os cards da equipe (equipeId) + os do PRÓPRIO usuário
//              (usuarioId — cobre o operador SEM equipe, cujos cards têm
//              equipe derivada nula e sumiriam do próprio dono sem este ramo).
//   operador → SÓ o POOL + os cards atribuídos a ELE.
export type EscopoVisibilidade =
  | { modo: "tudo" }
  | { modo: "equipe"; equipeId: string | null; usuarioId: string }
  | { modo: "operador"; usuarioId: string };

// LEITURA: master vê tudo; gestor E OPERADOR veem o pool + a equipe inteira —
// cada operador tem o seu fluxo, mas acompanha as ações dos colegas e o status
// dos cards da mesma equipe.
export function escopoVisibilidade(u: Ator): EscopoVisibilidade {
  if (nivelDe(u) === "master") return { modo: "tudo" };
  // SEM equipe (equipe_id null), gestor ou operador: modo 'equipe' com equipeId
  // null DE PROPÓSITO — no predicado SQL, `k.equipe_id = $x::uuid` com $x nulo
  // não casa nada; sobra o pool + os cards do PRÓPRIO (usuarioId). Jamais
  // degradar isso para 'tudo' (seria dar visão global a quem não tem equipe),
  // e jamais deixar `null = null` casar (vazaria todo card sem equipe).
  return { modo: "equipe", equipeId: u.equipe_id, usuarioId: u.id };
}

// ESCRITA: é o que escopoVisibilidade ERA antes de leitura e ação se separarem.
// master age em tudo; gestor no pool + na equipe dele; operador SÓ no pool
// (assumir) e nos cards dele. Card de colega abre em leitura e recusa escrita
// (403 reason 'card_de_outro_operador' — as rotas mapeiam via avaliarAcao).
export function escopoAcao(u: Ator): EscopoVisibilidade {
  const nivel = nivelDe(u);
  if (nivel === "master") return { modo: "tudo" };
  if (nivel === "gestor") return { modo: "equipe", equipeId: u.equipe_id, usuarioId: u.id };
  return { modo: "operador", usuarioId: u.id };
}

// Achata o escopo em 3 parâmetros para o WHERE das queries. O predicado padrão
// é o sqlEscopo de lib/services/visibilidade.ts (aplicado em kanban/tabela/
// inbox/elegíveis/agendamentos/exports, HM E genéricos):
//   (verTudo OR (responsavel_id null AND equipe_id null AND texto vazio) -- livre
//            OR equipe_id = equipeId                    -- modo equipe: a equipe
//            OR responsavel_id = usuarioId)             -- os do próprio usuário
// No modo 'equipe' equipeId E usuarioId vêm preenchidos (equipe + os dele); no
// modo 'operador' só usuarioId. Card com dono só em TEXTO (órfão) NÃO é livre —
// fica com o master.
export function paramsEscopo(e: EscopoVisibilidade): { verTudo: boolean; equipeId: string | null; usuarioId: string | null } {
  return {
    verTudo: e.modo === "tudo",
    equipeId: e.modo === "equipe" ? e.equipeId : null,
    usuarioId: e.modo === "tudo" ? null : e.usuarioId,
  };
}
