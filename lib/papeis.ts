// Regras de papel/nível compartilhadas entre servidor e cliente. SEM dependências
// de servidor (nada de node:crypto/next headers) — por isso mora aqui e não em
// lib/auth.ts, que é server-only. auth.ts e use-me.ts reexportam daqui, para a
// regra viver num lugar só.
export type Papel = "admin" | "disparador" | "operador";

// Eventos de ativação tocados por SDR: nesses, o operador comum TAMBÉM dispara —
// a abordagem outbound é o trabalho dele. Nos demais (HT carro-chefe, HM), o
// disparo segue restrito a admin/disparador.
// CNHF saiu daqui em 10/08/2026 junto com o portal (ver lib/marcas.ts). Ficou
// só o Seminário: sem tela, ninguém dispara pelo CNHF de qualquer forma, e
// deixar o evento na lista prometeria um direito que não tem mais porta.
export const EVENTOS_SDR: readonly string[] = ["SEM"];

// Fonte única de "pode efetuar disparos", usada pelo backend (/api/send) e pelo
// gating de UI. admin/disparador disparam em tudo; operador só nos eventos de SDR.
export function podeDisparar(papel: Papel | null | undefined, evento?: string | null): boolean {
  if (papel === "admin" || papel === "disparador") return true;
  if (papel === "operador" && evento && EVENTOS_SDR.includes(evento)) return true;
  return false;
}

// Arraste/ação livre no board por equipe×evento (30/07, pedido do Marcio):
// no SEMINÁRIO (evento SEM) a equipe PRINCIPAL (Grupo Participa) age em
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
// Critério de equipe reusado pelas duas esteiras compartilhadas (arraste livre
// por evento e a esteira compartilhada por aba/produto, abaixo): equipe
// PRINCIPAL, e só ela — nunca por papel. Extraído para não duplicar a mesma
// checagem em dois lugares (a duplicação É o tipo de furo que já aconteceu
// aqui: duas funções respondendo à mesma pergunta de jeitos que divergem).
function ehEquipeGrupoParticipa(u: Ator | null | undefined): boolean {
  return u?.equipe_tipo === "principal";
}

export function acaoLivrePorEquipeEvento(u: Ator | null | undefined, evento?: string | null): boolean {
  return !!evento
    && EVENTOS_ACAO_LIVRE_PRINCIPAL.includes(evento)
    && ehEquipeGrupoParticipa(u);
}

// ===== Funções por portal (0210, 12/08/2026 16h) ============================
// `cs.usuario_funcoes` (portal, funcao) substitui o boolean único
// `equipe_ativacao` como fonte principal de "que função a pessoa exerce em
// que portal" — uma pessoa pode ter 'comercial' e 'ativacao' no mesmo portal
// (o próprio caso Ana Camila/Thomas). `sessao.funcoes` chega achatada como
// "portal:funcao" (ver lib/auth.ts) porque a sessão trafega como objeto
// simples; esta função reconstrói a checagem sem a pessoa que chama precisar
// saber do formato.
export function temFuncao(u: Ator | null | undefined, portal: string, funcao: "comercial" | "ativacao"): boolean {
  return !!u?.funcoes?.includes(`${portal}:${funcao}`);
}

// Tags que marcam quem já foi aluno (THB ou Aurum) antes de reentrar pela
// Ativação (0213, gatilho de auto-marcação de acessos). Vive aqui porque é a
// MESMA lista que a migration 0213 espelha em SQL — mudar de um lado sem
// mudar do outro é o tipo de drift que este arquivo existe para evitar.
export const TAGS_ALUNO_ANTIGO: readonly string[] = ["Aluno THB", "Aluno Aurum"];

// ===== Esteira compartilhada: abas do HM por FUNÇÃO (12/08/2026, pedido do Marcio) ===
// A equipe de ativação (hoje Ana Camila e Thomas) precisa VER e MOVER todo card
// das abas do produto HM em que TÊM FUNÇÃO — inclusive os que hoje são só da
// Kelly (Equipe 2, equipe_tipo 'comum') e que hoje nem aparecem para elas. O
// card cai atribuído a UMA pessoa (webhook/pagamento), mas a ativação (e,
// desde 12/08 16h, o comercial) é trabalho de equipe.
//
// ⚠️ QUEM tem o bônus é decidido por FUNÇÃO (`cs.usuario_funcoes`, 0210), NÃO
// `equipe_tipo = 'principal'`. A diferença importa: o Grupo Participa tem 14
// pessoas ativas e o pedido nomeia 2. "Quem tem função no HM" é um SUBCONJUNTO
// da equipe principal — e um subconjunto que muda (entra e sai gente, e agora
// entra e sai POR ABA) sem que o tipo da equipe mude. Incluir a 3ª pessoa, ou
// dar a alguém só o comercial e não a ativação, é um INSERT em
// cs.usuario_funcoes; como tipo de equipe, seria migration + deploy, e daria o
// bônus a 12 pessoas que não o pediram.
// Mesmo espírito de `gerente_distribuidor` (0161) e `lider_equipe` (0143):
// capacidade de PESSOA mora no usuário, não no tipo da equipe.
//
// ⚠️ A LISTA DE ABAS NÃO É MAIS FIXA (12/08, virada 0210→0212). Até aqui
// `ABAS_ESTEIRA_COMPARTILHADA` era uma constante ["ativacao","comercial"] que
// valia igual para qualquer pessoa com a marca. Agora cada SESSÃO tem sua
// própria lista, resolvida por `abasDaEsteira` a partir de QUAIS funções ela
// tem: alguém só com `HM:ativacao` alcança card na aba ativação e NÃO alcança
// card no comercial — mesmo tendo a "marca" (o boolean de rede de segurança,
// ver `ehEquipeDeAtivacao`). Migrar o predicado (SQL e JS) de um booleano fixo
// para uma LISTA passada pelo chamador é o que torna essa granularidade
// possível sem duplicar a regra em N lugares — ver `abasDaEsteira` e
// `lib/services/visibilidade.ts` (sqlEscopo/podeVerPorEscopo recebem `abas` +
// `produto`, não mais um único booleano `esteira`).
//
// O recorte é a INTERSEÇÃO de: evento 'HM' · produto 'HM' (AURUM e ETHB são o
// MESMO evento HM, produtos diferentes — ficam INTACTOS, é o predicado mais
// caro de propósito) · a aba do card estar na lista de abas QUE ESTA SESSÃO
// alcança.
//
// O que esta regra deliberadamente NÃO cobre (decisões travadas do Marcio,
// 12/08/2026 — não mexer sem novo pedido):
//   · DISPARO — /api/send e /api/disparos/elegiveis continuam SEM o ramo
//     esteira (escopoDisparo passa por semBonusDeGerente e não por aqui).
//     Precedente: o mesmo corte que já existe para gerente_distribuidor —
//     "gerência sobre o card" ≠ "permissão de mandar campanha para a base".
//   · ASSUMIR (reatribuir para si) — atribuicao_travada de hm.ts continua
//     bloqueando. Ver/mover ≠ tomar posse do card de outra equipe.
//   · AURUM/ETHB — mesmo evento HM, produto diferente do predicado: intactos.
//
// As constantes moram AQUI, e só aqui — antes estavam digitadas soltas em ~10
// arquivos (hm.ts, telas do board, exports, script de relatório): um "ativacao"
// reescrito por engano num desses lugares silenciava a regra sem erro nenhum.
// Server (SQL) e cliente (JS) importam as MESMAS constantes.
export const ESTEIRA_COMPARTILHADA_PRODUTO = "HM";

// A(s) aba(s) que ESTA SESSÃO alcança pela esteira compartilhada, neste
// evento×produto. Vazio ([]) = ramo morto para esta sessão — fail-closed
// MAIS FORTE que antes: com a lista fixa, ter a marca bastava para as duas
// abas; agora cada função soma uma aba, e sem nenhuma função soma zero.
export function abasDaEsteira(
  ator: Ator | null | undefined,
  evento?: string | null,
  produto?: string | null,
): string[] {
  if (evento !== "HM" || produto !== ESTEIRA_COMPARTILHADA_PRODUTO) return [];
  const abas: string[] = [];
  if (temFuncao(ator, "HM", "comercial")) abas.push("comercial");
  if (temFuncao(ator, "HM", "ativacao")) abas.push("ativacao");
  return abas;
}

// A pergunta sobre um CARD já carregado: "esta sessão alcança este card pela
// esteira?" — casa a aba do card contra `abasDaEsteira`.
export function esteiraCompartilhada(
  ator: Ator | null | undefined,
  evento?: string | null,
  aba?: string | null,
  produto?: string | null,
): boolean {
  return !!aba && abasDaEsteira(ator, evento, produto).includes(aba);
}

// A marca por pessoa (0202) — boolean único, ORIGEM da funcionalidade antes
// de virar função granular por aba (0210/0212). MANTIDA como REDE DE
// SEGURANÇA deliberada por um deploy: o `||` cobre a janela entre "o código
// novo foi para produção" e "o backfill de cs.usuario_funcoes rodou / foi
// conferido" — se algo no backfill (0210) tiver ficado incompleto, quem já
// tinha `equipe_ativacao=true` não perde o acesso que já tinha hoje. Uma vez
// confirmado que `cs.usuario_funcoes` cobre todo mundo que precisa, este `||`
// vira candidato a remoção em migration futura (dropar a coluna também).
// Fail-closed nos dois lados: sem `funcoes` NEM `equipe_ativacao`, false.
export function ehEquipeDeAtivacao(u: Ator | null | undefined): boolean {
  return temFuncao(u, "HM", "ativacao") || !!u?.equipe_ativacao;
}

// ===== Separação dura COMERCIAL × ATIVAÇÃO no card do HM (12/08 23h) =======
// Pedido literal do Marcio, depois de "3 problemas absurdos" no mesmo dia:
// "se uma pessoa for associada a alguém no comercial, o pessoal da ativação
// NÃO pode mudar o pessoal do comercial, e vice-versa [...] vai ter um cara
// responsável pelo comercial e um cara responsável pela ativação. A gente vai
// medir a KPI deles com base nisso."
//
// Até aqui só `responsavel_comercial_id` era intocável (imutável por
// trigger, `fn_hm_congela_comercial`, 0212) — o dono VIGENTE
// (`responsavel_id`), a etapa da aba comercial e os campos da reunião
// seguiam abertos para QUALQUER sessão com autoridade de ESCREVER no card por
// qualquer caminho (dono, equipe, ação livre do GP — `acaoLivrePorEquipeEvento`
// — ou a esteira compartilhada, `esteiraCompartilhada`), sem olhar se o CAMPO
// era da aba dela. Espelho para o outro lado: `responsavel_ativacao_id` e o
// checklist/entrevista da ativação.
//
// Este gate é um SEGUNDO pedágio, ortogonal ao de `podeAgirCardHm`/
// `escopoAcao` (lib/services/hm.ts): aquele pergunta "posso escrever NESTE
// card"; este pergunta "posso escrever NESTE campo do card", e roda DEPOIS —
// mesmo um "ok" no primeiro pode cair aqui.
export type EscopoCampoHm = "comercial" | "ativacao";

// Campos do PATCH/lote da ficha que são exclusivos de uma aba — só os que o
// pedido nomeou como o buraco. O resto da ficha (observações, tags, acordo do
// saldo, crédito pró-rata, travas operacionais etc.) continua compartilhado:
// não fazia parte do pedido, e travar mais do que ele alcança é escopo que
// ninguém aprovou.
export const CAMPOS_HM_COMERCIAL: readonly string[] = [
  "responsavel_id", "responsavel",
  "reuniao_em", "reuniao_resultado", "reuniao_gravacao_url",
];
export const CAMPOS_HM_ATIVACAO: readonly string[] = [
  "responsavel_ativacao_id",
  "entrevista_em", "entrevista_resultado", "entrevista_gravacao_url",
  "ativ_searchie", "ativ_comunidade", "ativ_grupo", "ativ_pesquisa", "ativ_gps",
  "grupo_informes", "pendencia",
  "rev_searchie", "rev_comunidade", "rev_grupo", "rev_pesquisa",
];

// "Esta SESSÃO pode escrever em campos deste escopo?" — a regra central:
//   · master → sempre (acima de tudo, item (e) do pedido).
//   · as DUAS funções no mesmo portal (Ana Camila/Thomas hoje) → sempre, nos
//     dois escopos — "não regride quem já trabalha" (item (d) do pedido).
//   · SÓ uma das duas → só no escopo que tem.
//   · NENHUMA das duas (Kelly — gerente do comercial sem nenhuma linha em
//     cs.usuario_funcoes —, gestor comum, operador comum do GP sem função no
//     HM) → esta regra NÃO se aplica; o card-level (escopoAcao/
//     podeAgirCardHm/ação livre do GP/esteira) decide como já decidia. O
//     pedido define o corte para quem JÁ tem uma função HM — travar quem
//     nunca teve `cs.usuario_funcoes` regrediria a Kelly e qualquer operador
//     comum do GP que hoje edita a ficha pela ação livre da equipe principal.
export function podeEscreverEscopoHm(sessao: Ator | null | undefined, escopo: EscopoCampoHm): boolean {
  if (ehMaster(sessao)) return true;
  const comercial = temFuncao(sessao, "HM", "comercial");
  const ativacao = temFuncao(sessao, "HM", "ativacao");
  if (comercial === ativacao) return true; // as duas OU nenhuma: sem corte aqui
  return escopo === "comercial" ? comercial : ativacao;
}

export type VeredictoCampoHm = "ok" | "sem_permissao_comercial" | "sem_permissao_ativacao";

// A resposta pronta para a rota: quais campos do BODY tocam cada aba + (opcional)
// a aba de DESTINO de um `estagio_chave` pedido (resolver a aba do estágio pede
// banco — quem chama, em lib/services/hm.ts, resolve e passa aqui). Pura e
// testável sem servidor (scripts/test-papeis.ts).
export function veredictoEscopoCamposHm(
  sessao: Ator | null | undefined,
  camposPresentes: readonly string[],
  abaDestino?: string | null,
): VeredictoCampoHm {
  const tocaComercial = camposPresentes.some((c) => CAMPOS_HM_COMERCIAL.includes(c)) || abaDestino === "comercial";
  const tocaAtivacao = camposPresentes.some((c) => CAMPOS_HM_ATIVACAO.includes(c)) || abaDestino === "ativacao";
  if (tocaComercial && !podeEscreverEscopoHm(sessao, "comercial")) return "sem_permissao_comercial";
  if (tocaAtivacao && !podeEscreverEscopoHm(sessao, "ativacao")) return "sem_permissao_ativacao";
  return "ok";
}

// ===== Equipes / níveis de acesso ==========================================
// A equipe é ortogonal ao papel: o papel diz o que a pessoa FAZ, a equipe diz
// de quem são os cards que ela VÊ. 'principal' = Grupo Participa, a
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
  /**
   * GERENTE (10/08, pedido do Marcio — caso da Kelly). Duas coisas, nesta ordem
   * histórica:
   *   · distribui card para QUALQUER operador, de QUALQUER equipe
   *     (`podeAtribuirPara`);
   *   · VÊ a esteira inteira, de todas as equipes (`podeVerTudo`) — ampliado no
   *     mesmo dia, 20h30: a Kelly virou gerente com equipe própria e precisa
   *     acompanhar também os leads da Jusy e do Jonathan, que são da equipe
   *     principal. Sem isso ela distribuía para gente cujo trabalho não
   *     enxergava.
   *
   * O que o gerente NÃO ganha, de propósito: gerir contas, portais, canais,
   * tags e equipes (`podeGerirAcesso` segue master-only) e escrever em card de
   * outra equipe (`escopoAcao` continua pelo nível). Ver a operação inteira é
   * o trabalho dele; mexer no cadastro do sistema não é.
   */
  gerente_distribuidor?: boolean | null;
  /**
   * EQUIPE DE ATIVAÇÃO (12/08, pedido do Marcio — Ana Camila e Thomas): vê e
   * MOVE todo card que chega na aba Ativação do produto HM, inclusive de outra
   * equipe. Coluna `cs.usuarios.equipe_ativacao` (migration 0202).
   *
   * É marca por PESSOA, não por equipe, porque a equipe de ativação é um
   * subconjunto do Grupo Participa (2 de 14) que muda sem o tipo da equipe
   * mudar — incluir alguém é um UPDATE, não um deploy.
   *
   * NÃO dá posse do card (assumir segue travado) nem permissão de disparo —
   * mesmo corte do `gerente_distribuidor`.
   */
  equipe_ativacao?: boolean | null;
  /**
   * FUNÇÕES POR PORTAL (0210, 12/08 16h): substitui `equipe_ativacao` como
   * fonte principal de "que função a pessoa exerce em que portal". Formato
   * achatado "portal:funcao" (ex.: "HM:comercial", "HM:ativacao") — casado
   * por `temFuncao`. Uma pessoa pode ter as duas funções no mesmo portal.
   *
   * `equipe_ativacao` continua no tipo como rede de segurança (`||` em
   * `ehEquipeDeAtivacao`) — ver o comentário dela.
   */
  funcoes?: string[] | null;
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
// GERENTE (10/08, 20h30): entra aqui junto com o master. É LEITURA — enxergar a
// esteira inteira. A escrita continua governada por `escopoAcao`/`nivelDe`, e a
// gestão de contas/config por `podeGerirAcesso`, que segue exclusiva do master.
export function podeVerTudo(u: Ator | null | undefined): boolean {
  return ehMaster(u) || !!u?.gerente_distribuidor;
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

// O CADEADO da atribuição (`cs.contatos_hm.atribuicao_admin`, 0142). Quem
// distribui de cima trava o card: o operador que recebeu não devolve ao pool
// nem passa adiante o que a gestão decidiu. Decisão do Marcio (11/08):
// "aquele cadeado que impede o operador de mudar algo que o gestor alterou —
// mantenha isso".
//
// Antes só o master travava. O gerente entra porque é ele quem distribui a
// esteira do comercial hoje; sem isso a distribuição dele era desfeita pelo
// próprio destinatário.
export function podeTravarAtribuicao(u: Ator | null | undefined): boolean {
  return ehMaster(u) || !!u?.gerente_distribuidor;
}

// ...e quem ABRE o cadeado. Tem de ser exatamente quem pode pôr, senão a
// primeira distribuição congela o card: a Kelly travaria para a Jusy e depois
// não conseguiria remanejar para o Jonathan. Operador nunca abre — é o ponto
// inteiro da trava.
export function podeRemanejarTravado(u: Ator | null | undefined): boolean {
  return podeTravarAtribuicao(u);
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
  // GERENTE DISTRIBUIDOR (10/08): atravessa a cerca de equipe SÓ para atribuir.
  // A Kelly recebe toda venda de HM/Aurum e repassa para o operador certo, que
  // pode ser de outra equipe — com a regra antiga (gestor só atribui dentro da
  // própria equipe) isso dava `destino_fora_da_equipe`. O admin segue podendo
  // distribuir pelos caminhos de sempre (master, ou gestor dentro da equipe).
  if (ator.gerente_distribuidor) return true;
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
  // `podeVerTudo` e não `nivelDe === master`: o GERENTE também lê a esteira
  // inteira (10/08). A escrita segue em escopoAcao, que continua pelo nível.
  if (podeVerTudo(u)) return { modo: "tudo" };
  // SEM equipe (equipe_id null), gestor ou operador: modo 'equipe' com equipeId
  // null DE PROPÓSITO — no predicado SQL, `k.equipe_id = $x::uuid` com $x nulo
  // não casa nada; sobra o pool + os cards do PRÓPRIO (usuarioId). Jamais
  // degradar isso para 'tudo' (seria dar visão global a quem não tem equipe),
  // e jamais deixar `null = null` casar (vazaria todo card sem equipe).
  return { modo: "equipe", equipeId: u.equipe_id, usuarioId: u.id };
}

// O bônus do gerente vale para o CARD do board de ativação — não é um cheque em
// branco. Esta função devolve o mesmo ator "sem o bônus", para os caminhos em que
// a flag não deve valer:
//   · DISPARO em massa (`escopoDisparo`) — achado da auditoria de 11/08: com
//     escopoAcao='tudo', a Kelly (papel `disparador`) passaria a poder mandar
//     campanha de WhatsApp/e-mail para QUALQUER contato do portal, não só para
//     quem ela gerencia. Ninguém pediu isso; o risco é ban do número e contato
//     sem finalidade. Disparo continua pelo nível.
//   · PORTAIS GENÉRICOS (HT/SEM) — a flag nasceu para a esteira de ativação
//     (migration 0161: "a flag é cirúrgica"). Ela é transversal por acidente:
//     se um dia a conta ganhar o portal HT, herdaria escrita irrestrita lá sem
//     ninguém ter decidido. `lib/services/contato.ts` chama daqui.
export function semBonusDeGerente(u: Ator): Ator {
  return { ...u, gerente_distribuidor: false };
}

// Recorte dos DESTINATÁRIOS de um disparo. Deliberadamente diferente de
// escopoAcao: mexer no card de quem você gerencia é uma coisa, mandar mensagem
// para a base inteira é outra.
export function escopoDisparo(u: Ator): EscopoVisibilidade {
  return escopoAcao(semBonusDeGerente(u));
}

// ESCRITA: é o que escopoVisibilidade ERA antes de leitura e ação se separarem.
// master age em tudo; gestor no pool + na equipe dele; operador SÓ no pool
// (assumir) e nos cards dele. Card de colega abre em leitura e recusa escrita
// (403 reason 'card_de_outro_operador' — as rotas mapeiam via avaliarAcao).
export function escopoAcao(u: Ator): EscopoVisibilidade {
  const nivel = nivelDe(u);
  if (nivel === "master") return { modo: "tudo" };
  // GERENTE (11/08, pedido do Marcio): passa a AGIR onde já enxergava. Em 10/08
  // ele ganhou ver tudo + atribuir para qualquer equipe, mas a escrita continuou
  // presa à própria equipe — e o gate de ação roda ANTES de tudo no PATCH, então
  // na prática a Kelly levava 403 nos 101 cards da Jusy e do Jonathan: não movia
  // no board, não reatribuía, não registrava atendimento. Gerência que não pode
  // mexer no card de quem gerencia não é gerência.
  // O que ele continua NÃO podendo, e é de propósito: gerir contas/portais/
  // equipes (podeGerirAcesso segue master-only) e mexer em card cancelado
  // (a trava de Reclamada/Reembolsado é ehMaster, gate separado).
  if (u.gerente_distribuidor) return { modo: "tudo" };
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
