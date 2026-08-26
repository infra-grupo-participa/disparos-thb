// A carteira do Acelera é individual: o vendedor vê o SEU card e mais nada.
// Os cinco estão na MESMA equipe (Grupo Participa), então o ramo `equipe` do
// predicado padrão os faria enxergar a carteira uns dos outros. Este teste
// existe para que ninguém religue esse ramo sem perceber.
import { podeVerPorEscopo, sqlEscopo } from "../lib/services/visibilidade";
import type { EscopoVisibilidade } from "../lib/papeis";

const EQUIPE = "eq-grupo-participa";
const jonathan: EscopoVisibilidade = { modo: "equipe", usuarioId: "u-jonathan", equipeId: EQUIPE };
const admin: EscopoVisibilidade = { modo: "tudo" };

const cardJonathan = { responsavel_id: "u-jonathan", equipe_id: EQUIPE, responsavel: "Jonathan Mendes" };
const cardArthur   = { responsavel_id: "u-arthur",   equipe_id: EQUIPE, responsavel: "Arthur Galvão" };
const cardLivre    = { responsavel_id: null,          equipe_id: null,   responsavel: "" };

const casos: [string, boolean, boolean][] = [
  // descrição, obtido, esperado
  ["Jonathan vê o card DELE",
    podeVerPorEscopo(jonathan, cardJonathan, undefined, undefined, true, true), true],
  ["Jonathan NÃO vê o card do Arthur (mesma equipe)",
    podeVerPorEscopo(jonathan, cardArthur, undefined, undefined, true, true), false],
  ["Jonathan NÃO vê card livre (poolRestrito)",
    podeVerPorEscopo(jonathan, cardLivre, undefined, undefined, true, true), false],
  ["admin vê o card do Arthur",
    podeVerPorEscopo(admin, cardArthur, undefined, undefined, true, true), true],
  // sem soDono (HT/Seminário/HM) o ramo de equipe continua valendo — nada mudou lá
  ["fora do Acelera, colega de equipe CONTINUA visível",
    podeVerPorEscopo(jonathan, cardArthur), true],
  ["fora do Acelera, card livre CONTINUA visível",
    podeVerPorEscopo(jonathan, cardLivre), true],
];

// O SQL precisa REFERENCIAR os 3 placeholders sempre — inclusive o de equipe,
// mesmo quando o ramo dele está desligado. Os chamadores montam o array de
// params por posição; se $7 some do texto, o pg recusa a query inteira
// ("bind message supplies 7 parameters, but prepared statement requires 6") e o
// board devolve 500. Aconteceu em 26/08; este caso existe para não repetir.
const colunas = { rid: "ct.responsavel_id", eq: "ru.equipe_id", nome: "ct.responsavel" };
const posicoes = { verTudo: 5, usuario: 6, equipe: 7 };
function todosOsParams(opts?: { soDono?: boolean; poolRestrito?: boolean }): boolean {
  const sql = sqlEscopo(colunas, posicoes, opts);
  const usados = new Set([...sql.matchAll(/\$(\d+)/g)].map((m) => Number(m[1])));
  return [5, 6, 7].every((n) => usados.has(n));
}
casos.push(
  ["SQL sem soDono referencia $5, $6 e $7", todosOsParams(), true],
  ["SQL COM soDono ainda referencia $5, $6 e $7", todosOsParams({ soDono: true, poolRestrito: true }), true],
);

let falhou = 0;
for (const [desc, teve, esperado] of casos) {
  const ok = teve === esperado;
  if (!ok) falhou++;
  console.log(`  ${ok ? "ok   " : "FALHA"} ${desc} → ${teve}`);
}
console.log(falhou ? `\n${falhou} FALHA(S)` : "\nTODOS OS CASOS PASSARAM");
process.exit(falhou ? 1 : 0);
