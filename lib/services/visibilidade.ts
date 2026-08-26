import { query } from "@/lib/db";
import {
  escopoAcao, escopoVisibilidade, nivelDe,
  type Ator, type EscopoVisibilidade,
} from "@/lib/papeis";

// ===== A REGRA de visibilidade por escopo — num lugar só =====================
// HM (cs.contatos_hm / view cs.contatos_hm_kanban) e portais genéricos
// (cs.contatos / view cs.contatos_evento) respondem à MESMA pergunta — "quem
// pode ver este card?" — e por um tempo responderam DIFERENTE: o HM não olhava
// o texto órfão e tratava como pool um card cujo dono existia só como TEXTO
// (typo, apelido, ex-operador que perdeu o id). Este módulo é a resposta única.
//
// CARD LIVRE (pool) = responsavel_id NULL **e** equipe NULL **e** texto vazio.
// Card com texto órfão NÃO é pool: no mundo antigo ele era o card de alguém, e
// soltá-lo como "livre para todos" vazaria o lead para qualquer equipe assumir.
// Ele fica visível só a master até ser reatribuído por id (decisão documentada
// na migration 0146 — adotada também no HM em 27/07).
//
// Predicado padrão (verTudo OR livre OR minha equipe OR meu [OR esteira]), nas
// duas formas:
//   - sqlEscopo(...)        → fragmento SQL para o WHERE das listagens;
//   - podeVerPorEscopo(...) → o MESMO predicado em JS, para as rotas unitárias
//     (ficha, mover, inbox 1:1) — a lista não mostra, a ficha não abre.
// Se um dia a regra mudar, muda AQUI — e muda para os dois módulos de uma vez.
//
// ESTEIRA COMPARTILHADA (12/08/2026, ver lib/papeis.ts): ramo adicional e
// OPCIONAL — só entra quando o chamador declara as colunas `aba`/`tags` — que
// pega o card por evento×aba×produto (não por dono), respondendo à pergunta
// "este card está numa aba que esta sessão alcança no HM?" em vez de "é
// meu/da minha equipe?". Fica de fora por padrão (fail-closed, mesmo padrão do
// ramo `tags`): omitir as colunas em qualquer chamador (disparo, genéricos
// HT/SEM) é a forma de o ramo nunca entrar lá — omissão vira o comportamento
// seguro, não um esquecimento.
//
// ⚠️ (12/08, virada 0210→0212) O parâmetro deixou de ser um booleano único
// `esteira` e virou uma LISTA `abas` — a lista de abas que ESTA SESSÃO
// alcança (`abasDaEsteira`, lib/papeis.ts), resolvida por FUNÇÃO
// (`cs.usuario_funcoes`: comercial/ativação são independentes por pessoa).
// Antes um único booleano dizia "tem o bônus?" e a lista de abas era uma
// CONSTANTE fixa (`ABAS_ESTEIRA_COMPARTILHADA`) interpolada direto no SQL —
// igual para qualquer um que tivesse a marca. Agora o SQL casa a aba do CARD
// contra a lista RESOLVIDA da sessão, passada como `$n::text[]` — sem
// interpolação de string. Lista vazia (`[]`) é o mesmo "ramo morto" de antes,
// só que agora é o caso comum (maioria das sessões não tem função nenhuma no
// HM), não a exceção.

// Colunas que expõem responsavel_id, equipe_id e responsavel (texto) —
// cs.contatos_evento / cs.contatos_ht / cs.contatos_hm_kanban; para cs.contatos
// cru, o chamador junta cs.usuarios para ter a equipe.
type ColunasEscopo = { rid: string; eq: string; nome: string;
  // Coluna de tags do card (ex.: 'k.tags'). Quando presente, o predicado ganha
  // o ramo canal→pessoa (0154): o operador também vê/age em cards cuja tag está
  // atribuída a ele em cs.usuario_canais. Omitir onde a tabela não tem tags.
  tags?: string;
  // Colunas da esteira compartilhada (12/08, ver lib/papeis.ts): a aba e o
  // produto do card (ex.: 'k.estagio_aba', "'HM'"/coluna literal). Presentes
  // as DUAS → o predicado ganha o ramo esteira (aba do card está na lista
  // `abas` resolvida da sessão × produto = HM). Ausente qualquer uma = ramo
  // não entra (fail-closed) — é assim que /api/send e as listagens genéricas
  // HT/SEM ficam de fora sem precisar de um "if" próprio em cada rota.
  aba?: string;
  produto?: string };

// O predicado de CARD LIVRE em SQL — a definição canônica, usada dentro do
// sqlEscopo e sozinha onde a pergunta é só "está livre?" (pegar-leads).
export function sqlCardLivre(a: ColunasEscopo): string {
  return `(${a.rid} is null and ${a.eq} is null and coalesce(${a.nome}, '') = '')`;
}

// Fragmento SQL do predicado completo, para as rotas montarem o WHERE com os
// MESMOS placeholders sempre (verTudo boolean, usuarioId uuid, equipeId uuid —
// a ordem do paramsEscopo), mais os placeholders OPCIONAIS `abas` (text[]) e
// `produto` (text) da esteira compartilhada.
// NULL-safe por construção: `eq = $x::uuid` com $x nulo é unknown e NÃO casa —
// gestor sem equipe vê só o pool, nunca "null = null" virando vazamento.
//
// `poolRestrito` (0265, pedido do Marcio — caso da Kelly): SÓ o HM liga isto.
// Em todo portal genérico (HT/SEM/CNHF) e no board padrão do HM/AURUM, card
// LIVRE (sem responsável/equipe/texto) é o comportamento histórico — visível a
// QUALQUER operador, é o pool de onde qualquer um se serve. A venda nova de
// HM/AURUM deixou de ser carimbada com dono (0265, cs.fn_hm_carimba_equipe_
// padrao) — ela agora NASCE livre, e livre não pode mais significar "todo
// mundo vê": é a FILA DE ENTRADA da gestão, que só quem `verTudo` (master +
// gerente_distribuidor, ou seja, a Kelly) enxerga até ela distribuir. Por
// isso, com `poolRestrito=true`, o ramo `sqlCardLivre` SAI do OR geral — quem
// não é `verTudo` não ganha mais o card livre pelo ramo pool (o `$verTudo`
// já cobre quem deve ver). Omitido/false = comportamento de sempre — é assim
// que todo chamador que não é o board do HM continua igual sem precisar saber
// que este parâmetro existe.
export function sqlEscopo(
  a: ColunasEscopo,
  p: { verTudo: number; usuario: number; equipe: number; abas?: number; produto?: number },
  opts?: { poolRestrito?: boolean; soDono?: boolean },
): string {
  // Ramo canal→pessoa (0154): reusa o placeholder $usuario — sem novo parâmetro.
  // Card com alguma tag atribuída a mim em cs.usuario_canais entra na minha visão.
  // `$usuario` nulo (master, que já entra por verTudo) → EXISTS falso, inócuo.
  const ramoCanal = a.tags
    ? `\n       or exists (select 1 from cs.usuario_canais uc
                    where uc.usuario_id = $${p.usuario}::uuid and uc.canal = any(${a.tags}))`
    : "";
  // Ramo esteira compartilhada (12/08, virada 0210→0212 em lib/papeis.ts): SÓ
  // emitido quando o CHAMADOR declarou as colunas `aba`/`produto` E passou os
  // placeholders `abas`/`produto` — tudo junto, não uma peça isolada. `$abas`
  // já chega RESOLVIDO do JS (abasDaEsteira(sessao, "HM", produto)): a lista
  // de abas que esta sessão especificamente alcança, por função
  // (cs.usuario_funcoes) — sem repetir aqui a checagem de equipe/função. O SQL
  // só casa a aba/produto do CARD contra essa lista, com `= any($x::text[])`
  // em vez de uma lista de literais interpolada — array vazio nunca casa nada
  // (fail-closed, e é o caso comum agora: a maioria não tem função no HM).
  // ⚠️ estagio_aba é NULL-able — de propósito NÃO se usa coalesce(aba,'comercial')
  // aqui: um card sem aba (NULL) não entra no ramo esteira nem em SQL nem em JS
  // (podeVerPorEscopo espelha isso). Colocar coalesce só de um lado faria os
  // dois módulos divergirem exatamente no caso em que a coluna está vazia —
  // fail-closed nos dois, sempre.
  const ramoEsteira = a.aba && a.produto && p.abas !== undefined && p.produto !== undefined
    ? `\n       or (${a.aba} = any($${p.abas}::text[]) and ${a.produto} = $${p.produto}::text)`
    : "";
  // Card livre: fora do OR quando poolRestrito — só $verTudo alcança (ver o
  // comentário acima). Dentro do OR (comportamento de sempre) nos demais casos.
  const ramoLivre = opts?.poolRestrito ? "" : `\n       or ${sqlCardLivre(a)}`;
  // `soDono` (0311, 26/08 — Acelera Holding): derruba TAMBÉM o ramo de equipe.
  // No Acelera os cinco vendedores estão na MESMA equipe (Grupo Participa), e o
  // ramo `equipe` faria cada um enxergar a carteira dos outros quatro — o
  // oposto do pedido ("o Jonathan não pode ver os do Arthur"). poolRestrito
  // sozinho não resolve: ele trata o card SEM dono, não o card do colega.
  // Reparte a carteira sem inventar uma equipe por pessoa, que sujaria o
  // cadastro e quebraria os outros portais onde essas mesmas contas operam.
  const ramoEquipe = opts?.soDono ? "" : `\n       or ${a.eq} = $${p.equipe}::uuid`;
  return `($${p.verTudo}::boolean${ramoLivre}${ramoEquipe}
       or ${a.rid} = $${p.usuario}::uuid${ramoCanal}${ramoEsteira})`;
}

export type CardVisibilidade = {
  responsavel_id: string | null;
  equipe_id: string | null;
  responsavel: string | null;
  // Tags do card (canal→pessoa, 0154). Presente nas rotas unitárias que checam
  // o ramo de canais; ausente = o ramo não conta (fecha, não abre).
  tags?: string[] | null;
  // Aba e produto do card (esteira compartilhada, 12/08 — ver lib/papeis.ts).
  // Presentes os DOIS + o parâmetro `esteira=true` no chamador → o card da
  // Ativação/HM de OUTRA equipe entra na visão. Ausente/null = ramo não conta
  // (fail-closed) — as rotas unitárias fora do HM simplesmente não preenchem.
  aba?: string | null;
  produto?: string | null;
};

// O predicado de "card livre" em JS — o espelho EXATO do ramo pool do
// sqlEscopo, inclusive na semântica do texto: `coalesce(nome,'') = ''` NÃO
// trima, então texto só-de-espaços conta como dono (fail closed, igual ao SQL).
// Divergir daqui do SQL é reabrir o buraco: a listagem esconderia o card e a
// rota unitária o entregaria (ou vice-versa).
export function ehCardLivre(c: CardVisibilidade): boolean {
  return c.responsavel_id === null && c.equipe_id === null && (c.responsavel ?? "") === "";
}

// O predicado completo (verTudo OR livre OR minha equipe OR meu OR meu-canal
// [OR esteira]) sobre um card já carregado — usado por podeVerCardHm (hm.ts) e
// podeVerContato (contato.ts). `canais` = as tags que o usuário cuida
// (cs.usuario_canais, 0154); espelha EXATO o ramo canal do sqlEscopo.
// Omitido/[] = ramo não conta.
// `esteira` = o CHAMADOR já decidiu "esta sessão alcança ESTE card?" (tipicamente
// `esteiraCompartilhada(sessao, "HM", c.aba, c.produto)`, lib/papeis.ts, que por
// sua vez casa a aba do card contra `abasDaEsteira` — a lista resolvida por
// FUNÇÃO desta sessão). Omitido/false = ramo não conta (fail-closed).
export function podeVerPorEscopo(
  escopo: EscopoVisibilidade,
  c: CardVisibilidade,
  canais?: string[],
  esteira?: boolean,
  // `poolRestrito` (0265, mesmo parâmetro/motivo de sqlEscopo acima): card
  // livre deixa de abrir para todo mundo — só quem já é `escopo.modo==="tudo"`
  // (retornado na linha de cima) alcança. Omitido/false = comportamento de
  // sempre (pool visível a qualquer operador).
  poolRestrito?: boolean,
  // `soDono` (0311): espelha o sqlEscopo — sem o ramo de equipe. Tem de andar
  // junto: a lista não mostrar e a ficha abrir é o pior dos mundos.
  soDono?: boolean,
): boolean {
  if (escopo.modo === "tudo") return true;
  if (!poolRestrito && ehCardLivre(c)) return true;
  // Ramo canal→pessoa: card com alguma tag que EU cuido entra na minha visão
  // (mesma regra do SQL). fail-closed: sem canais ou sem tags, não abre nada.
  if (canais && canais.length && c.tags && c.tags.some((t) => canais.includes(t))) return true;
  // Ramo esteira compartilhada: mesma ordem do SQL (depois do canal, antes do
  // ramo de equipe/próprio) — casar a ORDEM não muda o resultado (é um OR),
  // mas divergir a ordem entre os dois lados é o tipo de coisa que confunde
  // quem lê os dois módulos lado a lado depois.
  // `esteira` chega RESOLVIDO pelo chamador como `esteiraCompartilhada(sessao,
  // "HM", c.aba, c.produto)` (lib/papeis.ts) — mas REVALIDA-SE `c.aba` aqui
  // como segunda camada de defesa: se o chamador computou `esteira` para OUTRO
  // card (bug de call site) e passou este `c` sem aba, o ramo NÃO deve abrir só
  // porque o booleano veio true. Foi exatamente a 2ª causa do 403 da Ana
  // Camila (12/08): `cardEscopoHm` devolvia `estagio_aba`, o tipo lia `aba`, o
  // TS não reclamava (campo opcional) e `c.aba` chegava `undefined` — sem esta
  // revalidação um teste que só chamasse `esteiraCompartilhada` não pegaria.
  if (esteira && c.aba) return true;
  // `equipe_id !== null` de propósito: ator sem equipe (equipeId null) não
  // pode casar com card de equipe nula — "null === null" viraria vazamento.
  // O ramo `responsavel_id === usuarioId` cobre o card do PRÓPRIO usuário
  // quando ele não tem equipe (equipe derivada do dono é nula nesses cards).
  // soDono: mesmo com modo "equipe", só o card do próprio usuário abre.
  return escopo.modo === "equipe" && !soDono
    ? (c.equipe_id !== null && c.equipe_id === escopo.equipeId) || c.responsavel_id === escopo.usuarioId
    : c.responsavel_id === escopo.usuarioId;
}

// ===== Leitura ≠ ação (28/07) ===============================================
// Veredicto de uma ESCRITA sobre um card já carregado, cruzando os dois
// escopos de lib/papeis:
//   ok                      → dentro do escopo de AÇÃO (pode escrever);
//   card_de_outro_operador  → ENXERGA (escopo de leitura: card da equipe dele)
//                             mas não pode agir — é o card de um colega. 403;
//                             o front traduz o reason.
//   sem_acesso              → nem leitura (outra equipe / texto órfão). 403.
// Usado por podeAgirCardHm (hm.ts) e podeAgirContato (contato.ts) — as DUAS
// perguntas saem do MESMO card carregado, uma query só.
export type VeredictoAcao = "ok" | "card_de_outro_operador" | "sem_acesso";

// `esteira` (12/08): mesmo booleano de podeVerPorEscopo, entra nos DOIS lados
// (ação e visibilidade) — a esteira compartilhada não separa leitura de
// escrita como o resto da regra: quem ganha o ramo pode ver E mover o card.
// Card de OUTRA equipe que caiu aqui só pelo ramo esteira nunca vira
// "card_de_outro_operador": ele É a esteira compartilhada, não um card de colega.
// `poolRestrito` (0265): mesmo parâmetro de podeVerPorEscopo, propagado para os
// DOIS lados — card livre do HM sem `verTudo` não abre nem em leitura nem em
// ação; sem isto o operador comum receberia "card_de_outro_operador" (403) em
// vez de "sem_acesso" (404-like) para um card que, na nova regra, ele nem
// deveria enxergar que existe.
export function veredictoAcao(
  sessao: Ator, c: CardVisibilidade, canais?: string[], esteira?: boolean, poolRestrito?: boolean,
): VeredictoAcao {
  // Canal→pessoa (0154): quem cuida do canal AGE no card como se fosse dele —
  // o ramo entra tanto na ação quanto na leitura, então nunca vira "card de colega".
  if (podeVerPorEscopo(escopoAcao(sessao), c, canais, esteira, poolRestrito)) return "ok";
  return podeVerPorEscopo(escopoVisibilidade(sessao), c, canais, esteira, poolRestrito) ? "card_de_outro_operador" : "sem_acesso";
}

// Lista de responsáveis para os seletores de atribuição, RECORTADA por nível
// E por PORTAL — a MESMA regra nas três telas que a montam (board HM, tabela
// HM, kanban genérico): master vê os usuários ativos COM o portal na whitelist
// (cs.usuario_portais, 0145) + os donos legados por texto (o `legados.sql` de
// cada módulo, coluna `responsavel`); gestor só os membros ativos da PRÓPRIA
// equipe que TÊM o portal (equipe_id null → lista vazia, nunca "todos");
// operador só a si (o guard já garantiu que ele tem o portal). O seletor não
// pode oferecer um destino que atribuirResponsavel(Hm) vai recusar
// (destino_fora_da_equipe / destino_sem_portal) — oferecer quem o backend
// recusa é fazer o operador descobrir o limite errando.
//
// `funcao` (0265, pedido do Marcio — "só quem é do comercial no dropdown, tipo
// a Jusy, a Kelly e o Jonathan"): filtro OPCIONAL adicional por
// `cs.usuario_funcoes(portal, funcao)`. Critério é FUNÇÃO, não papel — quem
// não tem a função não entra na lista, mesmo sendo membro ativo do portal.
// Omitido = comportamento de sempre (todo mundo com o portal, sem olhar
// função) — os chamadores que não passam nada (filtro "responsável" da tela,
// que é conveniência de busca, não atribuição) continuam iguais.
// Duas exceções deliberadas ao corte por função, as DUAS já preexistentes ao
// filtro (não são regressão nova):
//   · master sempre aparece — é quem distribui e precisa poder se auto-listar
//     como destino em qualquer portal, função ou não;
//   · os LEGADOS por texto (`legados.sql`) não têm `usuario_id`/função — são
//     donos históricos que já existem em cards antigos; continuam aparecendo
//     sempre, senão um card legado ficaria com um responsável que nem existe
//     mais como opção no próprio seletor.
export async function listaResponsaveis(
  sessao: Ator & { nome?: string | null },
  portal: string,
  legados: { sql: string; params?: unknown[] },
  funcao?: "comercial" | "ativacao",
): Promise<string[]> {
  const nivel = nivelDe(sessao);
  const TEM_PORTAL = (alias: string, p: number) =>
    `exists (select 1 from cs.usuario_portais up where up.usuario_id = ${alias}.id and up.portal = $${p})`;
  // GERENTE entra no ramo de cima junto com o master (10/08): ele vê a esteira
  // inteira e já podia atribuir para qualquer equipe (`podeAtribuirPara`) —
  // faltava a lista oferecer esses destinos. Sem isto a Kelly veria o card da
  // Jusy no board, mas não acharia a Jusy no filtro de operador nem no seletor
  // de atribuição: a tela esconderia um direito que o backend já concede.
  if (nivel === "master" || !!sessao.gerente_distribuidor) {
    // Placeholders dos legados vêm ANTES ($1..$n); o portal entra por último —
    // e `funcao` (quando presente) logo depois, no fim de tudo — assim o SQL
    // de cada módulo não precisa saber em que posição os dois caíram.
    const params = [...(legados.params ?? []), portal, ...(funcao ? [funcao] : [])];
    const pPortal = (legados.params ?? []).length + 1;
    const pFuncao = pPortal + 1;
    // TEM_FUNCAO: cada usuário ATIVO candidato entra se é MASTER (mesma
    // condição de nivelDe em lib/papeis.ts: admin da equipe principal — quem
    // distribui precisa poder se autolistar como destino, função ou não) OU
    // tem a função pedida em cs.usuario_funcoes. Os legados por texto (union
    // abaixo) não passam por este filtro — não têm usuario_id/função, são
    // donos históricos e continuam aparecendo sempre (ver comentário da função).
    const TEM_FUNCAO = funcao
      ? `and (eq.tipo = 'principal' and u.papel = 'admin'
             or exists (select 1 from cs.usuario_funcoes uf where uf.usuario_id = u.id and uf.portal = $${pPortal} and uf.funcao = $${pFuncao}))`
      : "";
    const rows = await query<{ responsavel: string }>(
      `select responsavel from (
          select u.nome as responsavel
            from cs.usuarios u
            left join cs.equipes eq on eq.id = u.equipe_id
           where u.ativo and ${TEM_PORTAL("u", pPortal)} ${TEM_FUNCAO}
          union
          ${legados.sql}
       ) u
       order by responsavel`,
      params,
    );
    return rows.map((r) => r.responsavel);
  }
  if (nivel === "gestor") {
    const rows = await query<{ responsavel: string }>(
      `select nome as responsavel from cs.usuarios u
        where u.ativo and u.equipe_id = $1 and ${TEM_PORTAL("u", 2)}
        order by nome`,
      [sessao.equipe_id, portal],
    );
    return rows.map((r) => r.responsavel);
  }
  return sessao.nome ? [sessao.nome] : [];
}
