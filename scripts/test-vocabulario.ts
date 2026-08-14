/**
 * Trava de vocabulário — o sistema fala a língua de quem opera (13/08/2026).
 *
 * Pedido do Marcio: "quem tá operando não entende de código nem um pouco. A
 * gente tem que deixar o sistema mastigadinho pra elas."
 *
 * O problema não era jargão técnico duro — "webhook", "migration" e "payload"
 * nunca vazaram para a tela. Era pior: palavras que PARECEM português e são
 * nossas. A mesma pessoa era chamada de lead, card, contato e aluno; a mesma
 * tela era Kanban, Jornada e board; e "pool" não quer dizer nada para quem não
 * é de TI.
 *
 * Renomear resolve uma vez. Esta trava é o que impede de voltar: rodar é
 * segundos, e falha o build se alguém reintroduzir a palavra banida no TEXTO
 * VISÍVEL (comentário e nome de variável seguem livres — ninguém opera lendo
 * o código).
 *
 *   npx tsx scripts/test-vocabulario.ts
 *
 * ESCOPO (ampliado em 13/08, segunda passada): telas do HM/AURUM/ETHB
 * (app/hm), os componentes que elas usam (app/_components), o /admin e o texto
 * dos alertas (lib/alertas-catalogo.ts). E duas varreduras, não uma: conteúdo
 * entre tags E literal de string — porque metade do jargão que sobrava viajava
 * em prop (`title=`, `description=`), invisível para a primeira.
 *
 * Nos portais HT/SEM/CNHF "lead" é CORRETO — lá a pessoa ainda não comprou. No
 * HM todo mundo do board já pagou, e foi por isso que o Marcio mandou tirar:
 * "não faz sentido ser lead, coloca aluno novo".
 */
import fs from "node:fs";
import path from "node:path";

type Regra = { palavra: RegExp; use: string; porque: string };

const BANIDAS: Regra[] = [
  { palavra: /\blead(s|\(s\))?\b/i, use: "aluno", porque: "no HM todo mundo do board já comprou — 'lead' é vocabulário do funil anterior" },
  { palavra: /\bpool\b/i, use: "sem dono", porque: "jargão de TI; ninguém fora do time sabe o que é" },
  { palavra: /\besteira\b/i, use: "Jornada", porque: "palavra nossa, nunca explicada na tela — e o menu já diz Jornada" },
  { palavra: /\bboard\b/i, use: "Jornada", porque: "a mesma tela não pode ter três nomes (Kanban, Jornada, board)" },
  { palavra: /\bcards?\b/i, use: "ficha (ou aluno)", porque: "card é o retângulo na tela; quem opera fala da PESSOA, não do retângulo" },
];

// Só o que o operador LÊ: conteúdo entre tags e os atributos de texto.
const PADROES_TEXTO = [
  />([^<>{}]{2,200})</g,
  /(?:placeholder|title|aria-label|alt)="([^"]{2,300})"/g,
];

const RAIZES = ["app/hm", "app/_components", "app/admin"];
// Componentes compartilhados que servem TAMBÉM os portais com lead de verdade.
// Isentos: componentes renderizados SÓ pelos portais genéricos (HT/SEM/CNHF),
// onde a pessoa de fato ainda não comprou e "lead" é a palavra certa.
// Confirmado por import: nenhum deles é importado por app/hm/**.
const ISENTOS = new Set([
  "app/_components/ajuda.tsx",
  "app/_components/perfil-canais.tsx",
  "app/_components/comportamento.tsx",
  "app/_components/disparo-email.tsx",
  "app/_components/inbox-composer.tsx",
]);

// 13/08, segunda passada — A TRAVA TINHA UM BURACO. Ela só olha `.tsx` dentro
// de app/hm e app/_components. Mas o texto dos alertas mora em
// lib/alertas-catalogo.ts (um `.ts`, e fora dessas raízes) porque a tela é
// client component e não pode importar o service — e passou verde com "Card
// sem canal de aquisição", "Pagou e não tem card" e "Cancelamento sem board
// definido" na tela, títulos que o operador lê.
//
// Aqui as strings não estão em JSX: são valores de objeto. Por isso a varredura
// é outra — literal de string inteiro, não conteúdo entre tags.
// SEGUNDO buraco, achado na mesma captura: a varredura de JSX pega o que está
// ENTRE tags. Não pega texto que viaja em prop —
//     <PageHeader description="…cancelamento sem board…" />
// — nem frase partida por <strong> no meio, que era o caso de "os cards com
// aquela tag (além do pool e dos cards dela)" no /admin. As duas passaram verde
// enquanto estavam escritas na tela, em tamanho normal, para a Kelly ler.
// Por isso a varredura de literal roda em TODO arquivo, não só nos soltos.
const TEXTOS_SOLTOS = ["lib/alertas-catalogo.ts"];

// Escape para o caso legítimo: string que NÃO é texto de tela e por acaso tem
// a palavra — valor de tag gravado no banco ("Lead novo", a tag antiga que
// continua existindo em 146 fichas), nome de rota, chave de API. Marque a linha
// com `vocabulario-ok` e explique ao lado POR QUE não é tela.
const ESCAPE = /vocabulario-ok/;

// Lista de classe Tailwind não é frase — e `shadow-card` casava com a regra de
// "card" em 15 lugares, todos falso positivo. Régua: três ou mais palavras com
// hífen ou dois-pontos e nenhuma pontuação de frase é CSS, não texto.
function pareceClasse(texto: string): boolean {
  // Ponto só conta como fim de frase se vier espaço ou fim depois — senão
  // "p-2.5" numa lista de classe passaria por frase.
  if (/[.!?…](\s|$)|[—,]\s/.test(texto)) return false;
  const tokens = texto.split(/\s+/);
  return tokens.filter((t) => /[-:]/.test(t)).length >= 3;
}

function literais(fonte: string): { texto: string; linha: number }[] {
  const achados: { texto: string; linha: number }[] = [];
  fonte.split("\n").forEach((linha, i) => {
    const t = linha.trim();
    if (t.startsWith("//") || t.startsWith("*") || t.startsWith("/*")) return;
    if (ESCAPE.test(linha)) return;
    for (const m of linha.matchAll(/"([^"]{4,400})"|'([^']{4,400})'/g)) {
      const texto = m[1] ?? m[2];
      // Só o que é frase para gente: precisa ter espaço e não ser caminho/import.
      if (!texto.includes(" ") || texto.startsWith("@/") || texto.startsWith("./")) continue;
      if (pareceClasse(texto)) continue;
      // Pedaço de template literal cortado pela regex de aspas — o texto real
      // dele é lido pela varredura de JSX, não aqui.
      if (texto.includes("${") || texto.includes("??")) continue;
      achados.push({ texto, linha: i + 1 });
    }
  });
  return achados;
}

function arquivos(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name).replace(/\\/g, "/");
    if (e.isDirectory()) return arquivos(p);
    return e.isFile() && p.endsWith(".tsx") ? [p] : [];
  });
}

let falhas = 0;
for (const arquivo of RAIZES.flatMap(arquivos)) {
  if (ISENTOS.has(arquivo)) continue;
  const fonte = fs.readFileSync(arquivo, "utf8");
  const linhas = fonte.split("\n");

  linhas.forEach((linha, i) => {
    // Comentário não é tela.
    const t = linha.trim();
    if (t.startsWith("//") || t.startsWith("*") || t.startsWith("/*")) return;

    for (const padrao of PADROES_TEXTO) {
      padrao.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = padrao.exec(linha)) !== null) {
        const texto = m[1];
        // Expressão dentro de chaves é código, não texto lido.
        if (/^\s*[{}]/.test(texto)) continue;
        for (const regra of BANIDAS) {
          if (regra.palavra.test(texto)) {
            falhas++;
            console.log(`  ✗ ${arquivo}:${i + 1}`);
            console.log(`      "${texto.trim().slice(0, 90)}"`);
            console.log(`      use "${regra.use}" — ${regra.porque}\n`);
          }
        }
      }
    }
  });
}

const COM_LITERAL = [...RAIZES.flatMap(arquivos).filter((a) => !ISENTOS.has(a)), ...TEXTOS_SOLTOS];
for (const arquivo of COM_LITERAL) {
  if (!fs.existsSync(arquivo)) continue;
  for (const { texto, linha } of literais(fs.readFileSync(arquivo, "utf8"))) {
    for (const regra of BANIDAS) {
      if (regra.palavra.test(texto)) {
        falhas++;
        console.log(`  ✗ ${arquivo}:${linha}`);
        console.log(`      "${texto.trim().slice(0, 90)}"`);
        console.log(`      use "${regra.use}" — ${regra.porque}\n`);
      }
    }
  }
}

if (falhas > 0) {
  console.log(`\n${falhas} ocorrência(s) de vocabulário interno no texto visível.`);
  console.log("A tela é lida por quem não conhece o sistema. Ver docs/plano-sistema-para-quem-opera.md\n");
  process.exit(1);
}
console.log("Vocabulário limpo: nenhuma palavra interna no texto visível das telas do HM.");
