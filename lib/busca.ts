// Busca livre de PESSOAS nas telas client-side (board HM, tabela HM, inbox).
// Espelha, em TypeScript, a MESMA semântica do filtro server-side de
// lib/services/contatos-filtro.ts — de propósito: a barra de pesquisa não pode
// responder diferente dependendo da tela em que o operador está. Mudou a regra
// de um lado, muda do outro.
//
// Três regras, cada uma nascida de um furo medido na base de produção
// (05/08/2026, 8.902 contatos):
//
//  1. ACENTO NÃO CONTA. 15,7% dos nomes da base têm acento e ninguém digita
//     acento na correria: "joao" tem que achar "João", "antonio" tem que achar
//     "Antônio". Antes não achava — e ninguém desconfiava, porque a busca
//     devolvia ALGUNS resultados (os sem acento), não zero.
//
//  2. TELEFONE COMPARA SÓ DÍGITOS. A coluna guarda dígitos crus em formatos
//     misturados (com e sem o 55 na frente), mas a tela EXIBE formatado. Copiar
//     o número da tela — "(11) 91158-1960" — e colar na busca não achava nada.
//
//  3. PALAVRAS SOMAM COM "E", EM QUALQUER ORDEM. Substring única exigia que o
//     operador digitasse o nome exatamente como está gravado: "joao silva" não
//     achava "João Pedro Silva".

const semAcento = (s: string): string =>
  s.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();

const digitos = (s: string): string => s.replace(/\D/g, "");

// Abaixo de 4 dígitos um termo numérico casaria meia base de telefones e a
// busca viraria ruído — "11" não é uma pesquisa, é um DDD. Telas de fila curta
// (inbox, ~200 conversas) baixam esse mínimo de propósito via `minDigitos`.
const MIN_DIGITOS_PADRAO = 4;

export type AlvoBusca = {
  /** Campos de texto (nome, e-mail, nome do titular…). Nulos são ignorados. */
  texto: (string | null | undefined)[];
  /** Campos numéricos (telefone, CPF) — comparados só por dígitos, cada um
   *  isoladamente (juntar antes de limpar colaria o fim de um no início do
   *  outro e criaria casamento que não existe). */
  numero?: (string | null | undefined)[];
  /** Mínimo de dígitos para o termo valer como busca numérica (padrão 4). */
  minDigitos?: number;
};

/** O `termo` casa com o `alvo`? Termo vazio casa tudo (barra em branco = sem filtro). */
export function casaBusca(termo: string, alvo: AlvoBusca): boolean {
  const t = semAcento(termo).trim().replace(/\s+/g, " ");
  if (!t) return true;

  const texto = semAcento(alvo.texto.filter(Boolean).join(" "));
  const numeros = (alvo.numero ?? []).filter(Boolean).map((v) => digitos(String(v)));
  const minDig = alvo.minDigitos ?? MIN_DIGITOS_PADRAO;
  const casaNumero = (d: string) => d.length >= minDig && numeros.some((n) => n.includes(d));

  // Termo inteiro SEM nenhuma letra = telefone/CPF colado da tela, com espaço
  // no meio ("(11) 91158-1960"). Tem que casar ANTES de quebrar em palavras:
  // "(11)" isolado não existe em campo nenhum e, com 2 dígitos, não chega no
  // mínimo numérico — a linha certa seria descartada pela regra 3.
  if (!/[a-z]/.test(t) && casaNumero(digitos(t))) return true;

  return t.split(" ").every((tok) => texto.includes(tok) || casaNumero(digitos(tok)));
}
