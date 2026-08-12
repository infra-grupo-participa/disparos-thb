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
import {
  escopoAcao, escopoDisparo, escopoVisibilidade, nivelDe, podeAtribuirPara, podeGerirAcesso,
  podeRemanejarTravado, podeTravarAtribuicao, podeVerTudo, semBonusDeGerente, type Ator,
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

console.log(falhas === 0 ? "\nTODOS OS CASOS PASSARAM\n" : `\n${falhas} CASO(S) FALHARAM\n`);
process.exit(falhas === 0 ? 0 : 1);
