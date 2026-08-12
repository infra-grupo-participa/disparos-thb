import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { test, expect, devices, type Page } from "@playwright/test";

/**
 * Validação de UX no Chromium (11/08/2026).
 *
 * Percorre as telas que o time usa, em desktop e celular, claro e escuro, e
 * falha quando encontra o que não se vê lendo código: erro de console, tela que
 * não renderiza, texto cortado, rolagem horizontal na página, alvo de toque
 * pequeno demais no celular, contraste baixo.
 *
 * Sessão: o cookie é assinado aqui com o SESSION_SECRET local — não precisa da
 * senha de ninguém. O banco é lido por um role só-leitura, e este teste **aborta
 * toda requisição que não seja GET**: nada daqui escreve em produção.
 *
 *   npx playwright test ux
 *
 * PARA RODAR DE NOVO é preciso um `.env.local` com DATABASE_URL e SESSION_SECRET.
 * A credencial usada em 11/08 era um role temporário criado só para isto e
 * dropado no fim — não ficou senha guardada em lugar nenhum. Para recriar:
 *
 *   create role ux_ro_tmp login password '<escolha>' bypassrls;
 *   grant usage on schema cs, public to ux_ro_tmp;
 *   grant select on all tables in schema cs to ux_ro_tmp;
 *   grant select on all tables in schema public to ux_ro_tmp;
 *   -- + execute nas funções STABLE/IMMUTABLE (as views do board chamam algumas)
 *
 * `bypassrls` é necessário: quase toda tabela do schema `cs` tem RLS e um role
 * novo enxergaria zero linha — as telas subiriam vazias e a validação mentiria.
 * Ao terminar: `drop owned by ux_ro_tmp; drop role ux_ro_tmp;` e apagar o .env.local.
 */

const SESSION_COOKIE = "cs_session";
const USER_ID = process.env.UX_USER_ID || "5ee0ca59-6b70-4fd8-b165-1a9bbfb2501a"; // master
const SHOTS = path.join(process.cwd(), "tests", "e2e", "__shots__");

function makeToken(userId: string): string {
  const segredo = process.env.SESSION_SECRET || "dev-insecure-secret-troque-isto";
  const base = `${userId}.${Date.now()}`;
  const sig = crypto.createHmac("sha256", segredo).update(base).digest("hex");
  return `${base}.${sig}`;
}

type Achado = { tela: string; viewport: string; tipo: string; detalhe: string };
const achados: Achado[] = [];

const TELAS = [
  { nome: "portais", url: "/" },
  { nome: "hm-kanban", url: "/hm/kanban?produto=HM" },
  { nome: "aurum-kanban", url: "/hm/kanban?produto=AURUM" },
  { nome: "hm-tabela", url: "/hm/tabela?produto=HM" },
  { nome: "admin", url: "/admin" },
  { nome: "admin-alertas", url: "/admin/alertas" },
  { nome: "usuarios", url: "/usuarios" },
  { nome: "equipes", url: "/hm/equipes" },
  { nome: "canais", url: "/canais" },
];

// `hasTouch`/`isMobile` importam: `.alvo-toque` só vale em
// `@media (hover: none) and (pointer: coarse)`. Sem emular toque, o teste
// media 30px e acusava alvo pequeno onde o celular de verdade dá 44px — o
// falso positivo custou uma rodada.
const VIEWPORTS = [
  { nome: "desktop", ctx: { viewport: { width: 1440, height: 900 } } },
  { nome: "celular", ctx: { ...devices["Pixel 7"] } },
];

async function prepara(page: Page) {
  await page.context().addCookies([
    { name: SESSION_COOKIE, value: makeToken(USER_ID), domain: "localhost", path: "/" },
  ]);
  // Blindagem: em produção só se LÊ. Qualquer POST/PATCH/PUT/DELETE morre aqui.
  await page.route("**/*", (route) => {
    const m = route.request().method();
    if (m === "GET" || m === "HEAD") return route.continue();
    return route.abort();
  });
}

test.describe("Validação de UX", () => {
  test.beforeAll(() => { fs.mkdirSync(SHOTS, { recursive: true }); });

  for (const vp of VIEWPORTS) {
    for (const tela of TELAS) {
      test(`${tela.nome} @ ${vp.nome}`, async ({ browser }) => {
        const context = await browser.newContext(vp.ctx);
        const page = await context.newPage();
        const erros: string[] = [];
        page.on("console", (m) => { if (m.type() === "error") erros.push(m.text().slice(0, 200)); });
        page.on("pageerror", (e) => erros.push(`pageerror: ${String(e).slice(0, 200)}`));

        await prepara(page);
        await page.goto(tela.url, { waitUntil: "domcontentloaded" });
        // Dá tempo do fetch client-side pintar a tela (board carrega por API).
        await page.waitForTimeout(3500);

        // 1) A tela não pode ter caído para o login nem ficado em branco.
        expect(page.url(), `${tela.nome}: caiu para o login`).not.toMatch(/\/login/);
        const texto = (await page.locator("body").innerText()).trim();
        if (texto.length < 40) achados.push({ tela: tela.nome, viewport: vp.nome, tipo: "tela-vazia", detalhe: `body com ${texto.length} caracteres` });

        // 2) Mensagem de erro visível — inclui o "Sem conexão" que já enganou o time.
        for (const frase of ["Sem conexão com o servidor", "Application error", "Unhandled Runtime Error", "não foi possível carregar"]) {
          if (texto.toLowerCase().includes(frase.toLowerCase())) {
            achados.push({ tela: tela.nome, viewport: vp.nome, tipo: "erro-na-tela", detalhe: frase });
          }
        }

        // 3) A PÁGINA não pode rolar na horizontal (bloco largo tem de rolar sozinho).
        const estouro = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
        if (estouro > 2) achados.push({ tela: tela.nome, viewport: vp.nome, tipo: "rolagem-horizontal", detalhe: `${estouro}px além da viewport` });

        // 4) No celular: alvo de toque menor que 40px de altura no que é clicável.
        if (vp.nome === "celular") {
          const pequenos = await page.evaluate(() => {
            const out: string[] = [];
            for (const el of Array.from(document.querySelectorAll("button, a[href], [role=button]"))) {
              const r = (el as HTMLElement).getBoundingClientRect();
              if (r.width === 0 || r.height === 0) continue;           // invisível
              if (r.top > window.innerHeight * 3) continue;            // muito abaixo da dobra
              if (r.height < 40) {
                const t = (el.textContent || (el as HTMLElement).getAttribute("aria-label") || el.tagName).trim().slice(0, 40);
                out.push(`${Math.round(r.height)}px — ${t}`);
              }
            }
            return Array.from(new Set(out)).slice(0, 8);
          });
          for (const p of pequenos) achados.push({ tela: tela.nome, viewport: vp.nome, tipo: "alvo-pequeno", detalhe: p });
        }

        // 5) Botão/link sem nome acessível (o leitor de tela e o operador no
        //    celular dependem disso — ícone puro sem rótulo é adivinhação).
        const semNome = await page.evaluate(() => {
          const out: string[] = [];
          for (const el of Array.from(document.querySelectorAll("button, a[href]"))) {
            const r = (el as HTMLElement).getBoundingClientRect();
            if (r.width === 0 || r.height === 0) continue;
            const nome = (el.textContent || "").trim() || (el as HTMLElement).getAttribute("aria-label") || (el as HTMLElement).getAttribute("title");
            if (!nome) out.push((el as HTMLElement).outerHTML.slice(0, 90));
          }
          return Array.from(new Set(out)).slice(0, 5);
        });
        for (const s of semNome) achados.push({ tela: tela.nome, viewport: vp.nome, tipo: "sem-nome-acessivel", detalhe: s });

        for (const e of erros) achados.push({ tela: tela.nome, viewport: vp.nome, tipo: "console", detalhe: e });

        await page.screenshot({ path: path.join(SHOTS, `${tela.nome}-${vp.nome}.png`), fullPage: false });

        // Escuro: a metade do time que usa dark mode não pode ver texto sumir.
        if (vp.nome === "desktop") {
          await page.emulateMedia({ colorScheme: "dark" });
          await page.evaluate(() => document.documentElement.classList.add("dark"));
          await page.waitForTimeout(400);
          await page.screenshot({ path: path.join(SHOTS, `${tela.nome}-escuro.png`), fullPage: false });
          await page.evaluate(() => document.documentElement.classList.remove("dark"));
        }
        await context.close();
      });
    }
  }

  test.afterAll(() => {
    fs.writeFileSync(path.join(SHOTS, "achados.json"), JSON.stringify(achados, null, 1), "utf8");
    const porTipo = achados.reduce<Record<string, number>>((a, x) => ({ ...a, [x.tipo]: (a[x.tipo] ?? 0) + 1 }), {});
    console.log("\n=== ACHADOS DE UX ===");
    console.log(JSON.stringify(porTipo, null, 1));
    for (const a of achados) console.log(`[${a.tipo}] ${a.tela} @ ${a.viewport}: ${a.detalhe}`);
  });
});
