// A carteira do Acelera é individual: o vendedor vê o SEU card e mais nada.
// Os cinco estão na MESMA equipe (Grupo Participa), então o ramo `equipe` do
// predicado padrão os faria enxergar a carteira uns dos outros. Este teste
// existe para que ninguém religue esse ramo sem perceber.
import { podeVerPorEscopo } from "../lib/services/visibilidade";
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

let falhou = 0;
for (const [desc, teve, esperado] of casos) {
  const ok = teve === esperado;
  if (!ok) falhou++;
  console.log(`  ${ok ? "ok   " : "FALHA"} ${desc} → ${teve}`);
}
console.log(falhou ? `\n${falhou} FALHA(S)` : "\nTODOS OS CASOS PASSARAM");
process.exit(falhou ? 1 : 0);
