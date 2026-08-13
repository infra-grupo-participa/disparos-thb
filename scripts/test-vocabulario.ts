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
 * ESCOPO: só as telas do HM/AURUM/ETHB (app/hm) e os componentes que elas usam.
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
];

// Só o que o operador LÊ: conteúdo entre tags e os atributos de texto.
const PADROES_TEXTO = [
  />([^<>{}]{2,200})</g,
  /(?:placeholder|title|aria-label|alt)="([^"]{2,300})"/g,
];

const RAIZES = ["app/hm", "app/_components"];
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

if (falhas > 0) {
  console.log(`\n${falhas} ocorrência(s) de vocabulário interno no texto visível.`);
  console.log("A tela é lida por quem não conhece o sistema. Ver docs/plano-sistema-para-quem-opera.md\n");
  process.exit(1);
}
console.log("Vocabulário limpo: nenhuma palavra interna no texto visível das telas do HM.");
