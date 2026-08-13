/**
 * Regras de acesso — teste das funções puras de `lib/papeis.ts`.
 *
 *   npx tsx scripts/test-papeis.ts
 *
 * Por que existe: papel × equipe × flags é a parte do sistema onde um engano não
 * dá erro — dá acesso a mais ou 403 em quem deveria trabalhar. Em 11/08/2026 a
 * Kelly (gerente do comercial) enxergava os 101 cards da Jusy e do Jonathan e
 * levava 403 em todos: `escopoAcao` ainda a prendia na própria equipe. O caso
 * virou teste para não voltar.
 *
 * Sem banco, sem servidor, sem rede: `lib/papeis.ts` é puro de propósito.
 * Sai com código 1 se algum caso falhar.
 */
import { podeVerPorEscopo } from "@/lib/services/visibilidade";
import {
  ehEquipeDeAtivacao, escopoAcao, escopoDisparo, escopoVisibilidade, esteiraCompartilhada,
  nivelDe, podeAtribuirPara, podeGerirAcesso,
  podeRemanejarTravado, podeTravarAtribuicao, podeVerTudo, semBonusDeGerente, temFuncao, type Ator,
} from "@/lib/papeis";

const EQ_GP = "2a1f9c6e-2825-441e-a10e-23aec4b1757b";  // Grupo Participa (principal)
const EQ_2 = "550d20d1-f4fe-4d4b-bd72-6c78ba2ca3ad";   // Equipe 2 (comum)

const kelly: Ator = { id: "kelly", papel: "disparador", equipe_id: EQ_2, equipe_tipo: "comum", lider_equipe: true, gerente_distribuidor: true };
const jusy: Ator = { id: "jusy", papel: "disparador", equipe_id: EQ_GP, equipe_tipo: "principal", lider_equipe: false, gerente_distribuidor: false };
const jonathan: Ator = { id: "jonathan", papel: "disparador", equipe_id: EQ_GP, equipe_tipo: "principal" };
const master: Ator = { id: "marcio", papel: "admin", equipe_id: EQ_GP, equipe_tipo: "principal" };
const gestorComum: Ator = { id: "gestor2", papel: "admin", equipe_id: EQ_2, equipe_tipo: "comum" };
const operadorGP: Ator = { id: "ana", papel: "operador", equipe_id: EQ_GP, equipe_tipo: "principal" };

let falhas = 0;
function ok(nome: string, real: unknown, esperado: unknown) {
  const bate = JSON.stringify(real) === JSON.stringify(esperado);
  if (!bate) falhas++;
  console.log(`${bate ? "  ok  " : "FALHOU"} ${nome} → ${JSON.stringify(real)}${bate ? "" : `  (esperado ${JSON.stringify(esperado)})`}`);
}

console.log("\n== KELLY (gerente do comercial: líder da Equipe 2 + gerente_distribuidor) ==");
ok("nível", nivelDe(kelly), "gestor");
ok("vê a esteira inteira", podeVerTudo(kelly), true);
ok("LEITURA em tudo", escopoVisibilidade(kelly).modo, "tudo");
ok("AÇÃO em tudo (era 'equipe' — o 403 nos cards da Jusy)", escopoAcao(kelly).modo, "tudo");
ok("atribui para a Jusy (outra equipe)", podeAtribuirPara(kelly, { id: jusy.id, equipe_id: jusy.equipe_id }), true);
ok("atribui para o Jonathan", podeAtribuirPara(kelly, { id: jonathan.id, equipe_id: jonathan.equipe_id }), true);
ok("trava o card ao distribuir (cadeado)", podeTravarAtribuicao(kelly), true);
ok("remaneja o que ela mesma travou", podeRemanejarTravado(kelly), true);
ok("NÃO gere contas/portais/equipes", podeGerirAcesso(kelly), false);

console.log("\n== JUSY / JONATHAN (quem a Kelly gerencia) ==");
ok("nível da Jusy", nivelDe(jusy), "operador");
ok("Jusy age só nos cards dela", escopoAcao(jusy).modo, "operador");
ok("Jusy NÃO abre o cadeado da Kelly", podeRemanejarTravado(jusy), false);
ok("Jusy não passa o card para o Jonathan", podeAtribuirPara(jusy, { id: jonathan.id, equipe_id: jonathan.equipe_id }), false);
ok("Jusy assume card para si", podeAtribuirPara(jusy, { id: jusy.id, equipe_id: jusy.equipe_id }), true);

console.log("\n== o bônus do gerente NÃO é cheque em branco (auditoria de 11/08) ==");
// Achado ALTO: com escopoAcao='tudo', a Kelly (papel `disparador`) herdaria a
// base inteira como destinatária de campanha de WhatsApp/e-mail. Ninguém pediu
// isso — disparo continua pelo nível.
ok("disparo da Kelly fica no escopo do nível dela", escopoDisparo(kelly).modo, "equipe");
ok("disparo do master continua amplo", escopoDisparo(master).modo, "tudo");
ok("ação no card segue ampla (é o que ela precisa)", escopoAcao(kelly).modo, "tudo");
// Achado MÉDIO: a flag é transversal a portal. Nos genéricos (HT/SEM) não vale.
ok("nos portais genéricos ela age como gestora comum", escopoAcao(semBonusDeGerente(kelly)).modo, "equipe");
ok("e não atribui fora da equipe por lá", podeAtribuirPara(semBonusDeGerente(kelly), { id: jusy.id, equipe_id: jusy.equipe_id }), false);

console.log("\n== o que não pode regredir ==");
ok("master age em tudo", escopoAcao(master).modo, "tudo");
ok("master trava", podeTravarAtribuicao(master), true);
ok("master gere acesso", podeGerirAcesso(master), true);
ok("gestor comum age só na equipe dele", escopoAcao(gestorComum).modo, "equipe");
ok("gestor comum NÃO trava (o cadeado é de quem distribui a esteira)", podeTravarAtribuicao(gestorComum), false);
ok("gestor comum não atribui fora da equipe", podeAtribuirPara(gestorComum, { id: jusy.id, equipe_id: jusy.equipe_id }), false);
ok("gestor comum atribui dentro da equipe", podeAtribuirPara(gestorComum, { id: "x", equipe_id: EQ_2 }), true);
ok("operador não vê tudo", podeVerTudo(operadorGP), false);
ok("operador não gere acesso", podeGerirAcesso(operadorGP), false);
ok("sessão ausente cai no nível mais baixo", nivelDe(null), "operador");
ok("sessão ausente não trava", podeTravarAtribuicao(null), false);

// ===== Esteira de ativação (0210/0212, 12/08) ================================
// A Ana Camila VIA os 9 cards da Kelly no board e levava 403 ao arrastar. Causa:
// `SessaoEquipe` (lib/services/hm.ts) não declarava `equipe_ativacao`, então o
// `sessao as Ator` entregava o campo como undefined e o ramo nunca entrava — sem
// erro de TS, sem log. O MESMO defeito que já tinha acontecido com
// `gerente_distribuidor` em 11/08. Estes casos existem para a 3ª vez não passar.
//
// 12/08 16h→noite: o boolean único `equipe_ativacao` virou FUNÇÃO por portal
// (`cs.usuario_funcoes`, 0210) — comercial e ativação agora são independentes
// por pessoa. `anaAtivacao` abaixo tem as DUAS funções (é o backfill real da
// 0210: Ana Camila e Thomas ficam com as duas, para não perder alcance).
console.log("\n== esteira de ativação (Ana Camila e Thomas — funções HM:comercial + HM:ativacao) ==");
const anaAtivacao: Ator = { ...operadorGP, funcoes: ["HM:comercial", "HM:ativacao"] };
const CARD_ATIV = { aba: "ativacao", produto: "HM" };

ok("com as duas funções: move card da Ativação do HM",
  esteiraCompartilhada(anaAtivacao, "HM", CARD_ATIV.aba, CARD_ATIV.produto), true);
ok("SEM função nenhuma: não ganha o bônus (os outros 12 do GP)",
  esteiraCompartilhada(operadorGP, "HM", CARD_ATIV.aba, CARD_ATIV.produto), false);
// 12/08 16h: o COMERCIAL ENTROU no escopo (caso Gabriela — ver lib/papeis.ts).
// Este caso já testou o contrário de manhã; a inversão é intencional.
ok("o comercial do HM ENTROU no escopo (caso Gabriela, 12/08 16h)",
  esteiraCompartilhada(anaAtivacao, "HM", "comercial", "HM"), true);
ok("a marca não vaza para o AURUM", esteiraCompartilhada(anaAtivacao, "HM", "ativacao", "AURUM"), false);
ok("a marca não vaza para o ETHB", esteiraCompartilhada(anaAtivacao, "HM", "ativacao", "ETHB"), false);
ok("a marca não vale em outro evento (HT/SEM)",
  esteiraCompartilhada(anaAtivacao, "HT", "ativacao", "HM"), false);
// estagio_aba é NULL-able: card sem aba não pode entrar por omissão.
ok("card SEM aba não entra (fail-closed)", esteiraCompartilhada(anaAtivacao, "HM", null, "HM"), false);
ok("sessão ausente não ganha o bônus", esteiraCompartilhada(null, "HM", "ativacao", "HM"), false);
ok("ehEquipeDeAtivacao lê a função HM:ativacao", ehEquipeDeAtivacao(anaAtivacao), true);
ok("ehEquipeDeAtivacao é fail-closed sem função nem boolean", ehEquipeDeAtivacao(operadorGP), false);
// A marca é de VER/MOVER, não de disparo — mesmo corte do gerente_distribuidor.
ok("a marca NÃO amplia o escopo de disparo", escopoDisparo(anaAtivacao).modo, escopoDisparo(operadorGP).modo);

console.log("\n== granularidade por FUNÇÃO (0210/0212): comercial ≠ ativação ==");
// O caso que a virada de boolean→função existe para resolver: alguém com SÓ
// a função ativação não alcança o comercial, e vice-versa — no boolean antigo
// a marca era tudo-ou-nada para as duas abas.
const soAtivacao: Ator = { ...operadorGP, funcoes: ["HM:ativacao"] };
const soComercial: Ator = { ...operadorGP, funcoes: ["HM:comercial"] };
ok("temFuncao lê HM:ativacao isolada", temFuncao(soAtivacao, "HM", "ativacao"), true);
ok("temFuncao NÃO confunde ativacao com comercial", temFuncao(soAtivacao, "HM", "comercial"), false);
ok("SÓ ativação: alcança card na aba ativação",
  esteiraCompartilhada(soAtivacao, "HM", "ativacao", "HM"), true);
ok("SÓ ativação: NÃO alcança card comercial (o caso novo)",
  esteiraCompartilhada(soAtivacao, "HM", "comercial", "HM"), false);
ok("SÓ comercial: alcança card no comercial",
  esteiraCompartilhada(soComercial, "HM", "comercial", "HM"), true);
ok("SÓ comercial: NÃO alcança card na ativação",
  esteiraCompartilhada(soComercial, "HM", "ativacao", "HM"), false);
// A rede de segurança do `||` em ehEquipeDeAtivacao é só para essa função
// isolada (ex.: telas que ainda perguntam "é da equipe de ativação?" sem
// precisar de aba) — `abasDaEsteira`/`esteiraCompartilhada` somam aba SÓ por
// FUNÇÃO (cs.usuario_funcoes), nunca pelo boolean legado. Documentado aqui
// para não vazar visibilidade de comercial para quem só tem o boolean antigo.
const soBooleanLegado: Ator = { ...operadorGP, equipe_ativacao: true };
ok("ehEquipeDeAtivacao ainda lê o boolean legado (rede de segurança)", ehEquipeDeAtivacao(soBooleanLegado), true);
ok("mas esteiraCompartilhada NÃO soma aba pelo boolean legado sozinho",
  esteiraCompartilhada(soBooleanLegado, "HM", "ativacao", "HM"), false);

// O predicado inteiro, com o objeto de card no formato que `podeVerPorEscopo`
// espera. Este caso pega a 2ª causa do 403 da Ana Camila: `cardEscopoHm`
// devolvia a coluna como `estagio_aba`, mas o tipo `CardVisibilidade` lê `aba` —
// e como `aba` é OPCIONAL no tipo, o TS não reclamou, `c.aba` virou undefined e
// o ramo foi descartado mesmo com `esteira=true`. Um teste que só chamasse
// `esteiraCompartilhada` NÃO teria pego: aquela função devolvia true.
const cardKellyAtivacao = {
  responsavel_id: "kelly", equipe_id: EQ_2, responsavel: "Kelly",
  tags: ["Aluno Aurum"], aba: "ativacao", produto: "HM",
};
ok("predicado completo: move card da Kelly na Ativação",
  podeVerPorEscopo(escopoAcao(anaAtivacao), cardKellyAtivacao, [], true), true);
ok("predicado completo: card SEM a chave `aba` não entra (regressão do 403)",
  podeVerPorEscopo(escopoAcao(anaAtivacao), { ...cardKellyAtivacao, aba: undefined }, [], true), false);
ok("predicado completo: comercial da Kelly agora ABRE (com esteira=true)",
  podeVerPorEscopo(escopoAcao(anaAtivacao), { ...cardKellyAtivacao, aba: "comercial" }, [], true), true);
ok("predicado completo: sem o bônus, comercial da Kelly segue fechado",
  podeVerPorEscopo(escopoAcao(operadorGP), { ...cardKellyAtivacao, aba: "comercial" }, [], false), false);
// O que continua FORA mesmo com o comercial dentro: outro produto.
ok("AURUM segue fora mesmo no comercial",
  esteiraCompartilhada(anaAtivacao, "HM", "comercial", "AURUM"), false);

// ===== Kelly NÃO manda na ativação (12/08, achado do pentester, ALTO) =======
// "A Kelly não manda na ativação. Manda no comercial — toda esteira do
// comercial é responsabilidade dela." `escopoAcao(kelly).modo === 'tudo'`
// (linha 43 acima) não olha a ABA do card — sem carve-out, o bônus
// `gerente_distribuidor` deixava a Kelly mover/editar/reatribuir QUALQUER
// card na Ativação de QUALQUER equipe (papel de quem tem HM:ativacao, hoje
// só Ana Camila/Thomas, ou do master). O conserto é em
// `lib/services/hm.ts:podeAgirCardHm` (não em `escopoAcao`, que continua
// geral e é usado por outros caminhos) — este bloco simula a MESMA composição
// que a função faz: card.aba === "ativacao" e a sessão SEM esteira própria →
// `semBonusDeGerente` antes de resolver o escopo de ação.
console.log("\n== Kelly NÃO manda na ativação (achado do pentester, ALTO) ==");
const cardJusyAtivacao = {
  responsavel_id: jusy.id, equipe_id: EQ_GP, responsavel: "Jusy",
  tags: [] as string[], aba: "ativacao", produto: "HM",
};
const esteiraKellyAtivacao = esteiraCompartilhada(kelly, "HM", cardJusyAtivacao.aba, cardJusyAtivacao.produto);
const atorAgindoNaAtivacao = (cardJusyAtivacao.aba === "ativacao" && !esteiraKellyAtivacao) ? semBonusDeGerente(kelly) : kelly;
ok("esteira da Kelly na ativação: nenhuma (zero cs.usuario_funcoes)", esteiraKellyAtivacao, false);
ok("Kelly SEM função de ativação NÃO age no card de OUTRA equipe na Ativação (era 'tudo' — o furo)",
  podeVerPorEscopo(escopoAcao(atorAgindoNaAtivacao), cardJusyAtivacao, [], esteiraKellyAtivacao), false);
ok("...e continua sem VER mudar (escopo de leitura intacto — decisão de UX fica com o dono)",
  podeVerPorEscopo(escopoVisibilidade(kelly), cardJusyAtivacao, [], esteiraKellyAtivacao), true);
ok("Kelly segue agindo em QUALQUER card no COMERCIAL (a esteira dela, sem carve-out)",
  podeVerPorEscopo(escopoAcao(kelly), { ...cardJusyAtivacao, aba: "comercial" }, [], esteiraCompartilhada(kelly, "HM", "comercial", "HM")), true);
// Master e a esteira própria continuam furando o carve-out — não é uma trava nova, é recorte do bônus.
ok("master segue agindo na Ativação de qualquer equipe (carve-out não é dele)",
  escopoAcao(master).modo, "tudo");
ok("Ana Camila (função HM:ativacao) segue agindo na Ativação — esteira própria, não o bônus da Kelly",
  podeVerPorEscopo(escopoAcao(anaAtivacao), cardJusyAtivacao, [], esteiraCompartilhada(anaAtivacao, "HM", cardJusyAtivacao.aba, cardJusyAtivacao.produto)), true);

console.log(falhas === 0 ? "\nTODOS OS CASOS PASSARAM\n" : `\n${falhas} CASO(S) FALHARAM\n`);
process.exit(falhas === 0 ? 0 : 1);
