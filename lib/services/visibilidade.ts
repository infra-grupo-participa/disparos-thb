import { query } from "@/lib/db";
import { nivelDe, type Ator, type EscopoVisibilidade } from "@/lib/papeis";

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
type ColunasEscopo = { rid: string; eq: string; nome: string };

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
  return `($${p.verTudo}::boolean
       or ${sqlCardLivre(a)}
       or ${a.eq} = $${p.equipe}::uuid
       or ${a.rid} = $${p.usuario}::uuid)`;
}

export type CardVisibilidade = {
  responsavel_id: string | null;
  equipe_id: string | null;
  responsavel: string | null;
};

// O predicado de "card livre" em JS — o espelho EXATO do ramo pool do
// sqlEscopo, inclusive na semântica do texto: `coalesce(nome,'') = ''` NÃO
// trima, então texto só-de-espaços conta como dono (fail closed, igual ao SQL).
// Divergir daqui do SQL é reabrir o buraco: a listagem esconderia o card e a
// rota unitária o entregaria (ou vice-versa).
export function ehCardLivre(c: CardVisibilidade): boolean {
  return c.responsavel_id === null && c.equipe_id === null && (c.responsavel ?? "") === "";
}

// O predicado completo (verTudo OR livre OR minha equipe OR meu) sobre um card
// já carregado — usado por podeVerCardHm (hm.ts) e podeVerContato (contato.ts).
export function podeVerPorEscopo(escopo: EscopoVisibilidade, c: CardVisibilidade): boolean {
  if (escopo.modo === "tudo") return true;
  if (ehCardLivre(c)) return true;
  // `equipe_id !== null` de propósito: gestor sem equipe (equipeId null) não
  // pode casar com card de equipe nula — "null === null" viraria vazamento.
  return escopo.modo === "equipe"
    ? c.equipe_id !== null && c.equipe_id === escopo.equipeId
    : c.responsavel_id === escopo.usuarioId;
}

// Lista de responsáveis para os seletores de atribuição, RECORTADA por nível —
// a MESMA regra nas três telas que a montam (board HM, tabela HM, kanban
// genérico): master vê todos os usuários ativos + os donos legados por texto
// (o `legados.sql` de cada módulo, coluna `responsavel`); gestor só os membros
// ativos da PRÓPRIA equipe (equipe_id null → lista vazia, nunca "todos");
// operador só a si. O seletor não pode oferecer um destino que
// atribuirResponsavel(Hm) vai recusar.
export async function listaResponsaveis(
  sessao: Ator & { nome?: string | null },
  legados: { sql: string; params?: unknown[] },
): Promise<string[]> {
  const nivel = nivelDe(sessao);
  if (nivel === "master") {
    const rows = await query<{ responsavel: string }>(
      `select responsavel from (
          select nome as responsavel from cs.usuarios where ativo
          union
          ${legados.sql}
       ) u
       order by responsavel`,
      legados.params ?? [],
    );
    return rows.map((r) => r.responsavel);
  }
  if (nivel === "gestor") {
    const rows = await query<{ responsavel: string }>(
      `select nome as responsavel from cs.usuarios where ativo and equipe_id = $1 order by nome`,
      [sessao.equipe_id],
    );
    return rows.map((r) => r.responsavel);
  }
  return sessao.nome ? [sessao.nome] : [];
}
