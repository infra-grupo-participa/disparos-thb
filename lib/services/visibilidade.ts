import { query } from "@/lib/db";
import { escopoAcao, escopoVisibilidade, nivelDe, type Ator, type EscopoVisibilidade } from "@/lib/papeis";

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
// Predicado padrão (verTudo OR livre OR minha equipe OR meu), nas duas formas:
//   - sqlEscopo(...)        → fragmento SQL para o WHERE das listagens;
//   - podeVerPorEscopo(...) → o MESMO predicado em JS, para as rotas unitárias
//     (ficha, mover, inbox 1:1) — a lista não mostra, a ficha não abre.
// Se um dia a regra mudar, muda AQUI — e muda para os dois módulos de uma vez.

// Colunas que expõem responsavel_id, equipe_id e responsavel (texto) —
// cs.contatos_evento / cs.contatos_ht / cs.contatos_hm_kanban; para cs.contatos
// cru, o chamador junta cs.usuarios para ter a equipe.
type ColunasEscopo = { rid: string; eq: string; nome: string;
  // Coluna de tags do card (ex.: 'k.tags'). Quando presente, o predicado ganha
  // o ramo canal→pessoa (0154): o operador também vê/age em cards cuja tag está
  // atribuída a ele em cs.usuario_canais. Omitir onde a tabela não tem tags.
  tags?: string };

// O predicado de CARD LIVRE em SQL — a definição canônica, usada dentro do
// sqlEscopo e sozinha onde a pergunta é só "está livre?" (pegar-leads).
export function sqlCardLivre(a: ColunasEscopo): string {
  return `(${a.rid} is null and ${a.eq} is null and coalesce(${a.nome}, '') = '')`;
}

// Fragmento SQL do predicado completo, para as rotas montarem o WHERE com os
// MESMOS placeholders sempre (verTudo boolean, usuarioId uuid, equipeId uuid —
// a ordem do paramsEscopo).
// NULL-safe por construção: `eq = $x::uuid` com $x nulo é unknown e NÃO casa —
// gestor sem equipe vê só o pool, nunca "null = null" virando vazamento.
export function sqlEscopo(a: ColunasEscopo, p: { verTudo: number; usuario: number; equipe: number }): string {
  // Ramo canal→pessoa (0154): reusa o placeholder $usuario — sem novo parâmetro.
  // Card com alguma tag atribuída a mim em cs.usuario_canais entra na minha visão.
  // `$usuario` nulo (master, que já entra por verTudo) → EXISTS falso, inócuo.
  const ramoCanal = a.tags
    ? `\n       or exists (select 1 from cs.usuario_canais uc
                    where uc.usuario_id = $${p.usuario}::uuid and uc.canal = any(${a.tags}))`
    : "";
  return `($${p.verTudo}::boolean
       or ${sqlCardLivre(a)}
       or ${a.eq} = $${p.equipe}::uuid
       or ${a.rid} = $${p.usuario}::uuid${ramoCanal})`;
}

export type CardVisibilidade = {
  responsavel_id: string | null;
  equipe_id: string | null;
  responsavel: string | null;
  // Tags do card (canal→pessoa, 0154). Presente nas rotas unitárias que checam
  // o ramo de canais; ausente = o ramo não conta (fecha, não abre).
  tags?: string[] | null;
};

// O predicado de "card livre" em JS — o espelho EXATO do ramo pool do
// sqlEscopo, inclusive na semântica do texto: `coalesce(nome,'') = ''` NÃO
// trima, então texto só-de-espaços conta como dono (fail closed, igual ao SQL).
// Divergir daqui do SQL é reabrir o buraco: a listagem esconderia o card e a
// rota unitária o entregaria (ou vice-versa).
export function ehCardLivre(c: CardVisibilidade): boolean {
  return c.responsavel_id === null && c.equipe_id === null && (c.responsavel ?? "") === "";
}

// O predicado completo (verTudo OR livre OR minha equipe OR meu OR meu-canal)
// sobre um card já carregado — usado por podeVerCardHm (hm.ts) e podeVerContato
// (contato.ts). `canais` = as tags que o usuário cuida (cs.usuario_canais, 0154);
// espelha EXATO o ramo canal do sqlEscopo. Omitido/[] = ramo não conta.
export function podeVerPorEscopo(escopo: EscopoVisibilidade, c: CardVisibilidade, canais?: string[]): boolean {
  if (escopo.modo === "tudo") return true;
  if (ehCardLivre(c)) return true;
  // Ramo canal→pessoa: card com alguma tag que EU cuido entra na minha visão
  // (mesma regra do SQL). fail-closed: sem canais ou sem tags, não abre nada.
  if (canais && canais.length && c.tags && c.tags.some((t) => canais.includes(t))) return true;
  // `equipe_id !== null` de propósito: ator sem equipe (equipeId null) não
  // pode casar com card de equipe nula — "null === null" viraria vazamento.
  // O ramo `responsavel_id === usuarioId` cobre o card do PRÓPRIO usuário
  // quando ele não tem equipe (equipe derivada do dono é nula nesses cards).
  return escopo.modo === "equipe"
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

export function veredictoAcao(sessao: Ator, c: CardVisibilidade, canais?: string[]): VeredictoAcao {
  // Canal→pessoa (0154): quem cuida do canal AGE no card como se fosse dele —
  // o ramo entra tanto na ação quanto na leitura, então nunca vira "card de colega".
  if (podeVerPorEscopo(escopoAcao(sessao), c, canais)) return "ok";
  return podeVerPorEscopo(escopoVisibilidade(sessao), c, canais) ? "card_de_outro_operador" : "sem_acesso";
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
export async function listaResponsaveis(
  sessao: Ator & { nome?: string | null },
  portal: string,
  legados: { sql: string; params?: unknown[] },
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
    // assim o SQL de cada módulo não precisa saber em que posição ele caiu.
    const params = [...(legados.params ?? []), portal];
    const rows = await query<{ responsavel: string }>(
      `select responsavel from (
          select nome as responsavel from cs.usuarios u where u.ativo and ${TEM_PORTAL("u", params.length)}
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
