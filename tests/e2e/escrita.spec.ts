import crypto from "node:crypto";
import { test, expect, type Page, type BrowserContext } from "@playwright/test";

/**
 * Fluxo de ESCRITA no Chromium (11/08/2026): arrastar card e atribuir, com as
 * sessões reais da Kelly (gerente), da Jusy (operadora) e do master.
 *
 * Diferente de `ux.spec.ts`, aqui o teste ESCREVE. Por isso ele age só sobre um
 * card marcado `ZZ TESTE UX` — criado e apagado fora do teste — e nunca sobre
 * lead de cliente. Se o card de teste não existir, os testes são pulados em vez
 * de cair em cima de outro card.
 *
 *   npx playwright test escrita
 *
 * Precisa de `.env.local` com DATABASE_URL de um role COM ESCRITA e o
 * SESSION_SECRET local (ver cabeçalho de ux.spec.ts).
 */

const SESSION_COOKIE = "cs_session";
const EMAIL_TESTE = "zz.teste.ux@example.invalid";

// Quem é quem em produção — os ids são estáveis.
const KELLY = "1e600498-25b3-4fe8-8280-7bc37c504049";   // gerente: líder da Equipe 2 + gerente_distribuidor
const JUSY = "bdbf28f4-ead9-435a-9ea9-db42d030c5a7";    // operadora do Grupo Participa
const MASTER = "5ee0ca59-6b70-4fd8-b165-1a9bbfb2501a";

function token(userId: string): string {
  const segredo = process.env.SESSION_SECRET || "dev-insecure-secret-troque-isto";
  const base = `${userId}.${Date.now()}`;
  return `${base}.${crypto.createHmac("sha256", segredo).update(base).digest("hex")}`;
}

async function sessao(browser: import("@playwright/test").Browser, userId: string): Promise<{ ctx: BrowserContext; page: Page }> {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await ctx.addCookies([{ name: SESSION_COOKIE, value: token(userId), domain: "localhost", path: "/" }]);
  return { ctx, page: await ctx.newPage() };
}

/** O card de teste, pela API do board — mesma fonte que a tela usa. */
async function cardDeTeste(page: Page): Promise<{ comprador_id: string; estagio_chave: string; responsavel: string | null } | null> {
  const r = await page.request.get("/api/hm/kanban?produto=HM");
  if (!r.ok()) return null;
  const d = await r.json();
  const c = (d.cards ?? []).find((x: { email?: string }) => x.email === EMAIL_TESTE);
  return c ? { comprador_id: c.comprador_id, estagio_chave: c.estagio_chave, responsavel: c.responsavel ?? null } : null;
}

test.describe.configure({ mode: "serial" }); // um fluxo só, na ordem

test.describe("Escrita: atribuir e arrastar", () => {
  test("a Kelly atribui o card para a Jusy — e o cadeado fecha", async ({ browser }) => {
    const { ctx, page } = await sessao(browser, KELLY);
    await page.goto("/hm/kanban?produto=HM");
    const antes = await cardDeTeste(page);
    test.skip(!antes, "card ZZ TESTE UX não está no board");

    const r = await page.request.patch(`/api/hm/contato/${antes!.comprador_id}?produto=HM`, {
      data: { responsavel_id: JUSY },
    });
    expect(r.status(), "a Kelly tem de conseguir atribuir para outra equipe").toBe(200);

    const depois = await cardDeTeste(page);
    expect(depois?.responsavel, "o card foi para a Jusy").toContain("Jusy");
    await ctx.close();
  });

  test("a Jusy NÃO desfaz o que a gerente decidiu", async ({ browser }) => {
    const { ctx, page } = await sessao(browser, JUSY);
    await page.goto("/hm/kanban?produto=HM");
    const card = await cardDeTeste(page);
    test.skip(!card, "card ZZ TESTE UX não está no board");

    // devolver ao pool: barrado pelo cadeado
    const pool = await page.request.patch(`/api/hm/contato/${card!.comprador_id}?produto=HM`, { data: { responsavel_id: null } });
    expect(pool.status(), "operador não devolve ao pool card travado pela gestão").toBe(403);

    // passar para outra pessoa: idem
    const outro = await page.request.patch(`/api/hm/contato/${card!.comprador_id}?produto=HM`, { data: { responsavel_id: KELLY } });
    expect(outro.status(), "operador não repassa o card").toBe(403);

    const ainda = await cardDeTeste(page);
    expect(ainda?.responsavel, "o card continua com a Jusy").toContain("Jusy");
    await ctx.close();
  });

  test("a Kelly remaneja o que ela mesma travou", async ({ browser }) => {
    const { ctx, page } = await sessao(browser, KELLY);
    await page.goto("/hm/kanban?produto=HM");
    const card = await cardDeTeste(page);
    test.skip(!card, "card ZZ TESTE UX não está no board");

    const r = await page.request.patch(`/api/hm/contato/${card!.comprador_id}?produto=HM`, { data: { responsavel_id: KELLY } });
    expect(r.status(), "quem põe o cadeado consegue tirar").toBe(200);
    const depois = await cardDeTeste(page);
    expect(depois?.responsavel).toContain("Kelly");
    await ctx.close();
  });

  test("arrastar o card entre etapas, com o mouse, move de verdade", async ({ browser }) => {
    const { ctx, page } = await sessao(browser, MASTER);
    await page.goto("/hm/kanban?produto=HM");
    await page.waitForTimeout(4000);
    const antes = await cardDeTeste(page);
    test.skip(!antes, "card ZZ TESTE UX não está no board");

    const card = page.locator("text=ZZ TESTE UX").first();
    await expect(card, "o card de teste aparece no board").toBeVisible({ timeout: 15_000 });

    // Destino: uma coluna DIFERENTE da atual — senão o teste "passa" na primeira
    // execução e falha na segunda, porque arrastar para onde o card já está não
    // muda nada. Nenhuma das duas dispara regra de pagamento/cancelamento.
    const nomeDestino = antes!.estagio_chave === "hm_aguardando_retorno" ? "Contato Inicial" : "Aguardando Retorno";
    const destino = page.locator(`text=${nomeDestino}`).first();
    await expect(destino, `a coluna "${nomeDestino}" está visível`).toBeVisible();

    const o = await card.boundingBox();
    const d = await destino.boundingBox();
    expect(o && d, "consegui medir origem e destino").toBeTruthy();

    // Arrasto com passos: dnd que escuta pointermove precisa de movimento real.
    await page.mouse.move(o!.x + o!.width / 2, o!.y + o!.height / 2);
    await page.mouse.down();
    for (let i = 1; i <= 12; i++) {
      await page.mouse.move(
        o!.x + ((d!.x + d!.width / 2 - o!.x) * i) / 12,
        o!.y + ((d!.y + 120 - o!.y) * i) / 12,
        { steps: 3 },
      );
      await page.waitForTimeout(60);
    }
    await page.mouse.up();
    await page.waitForTimeout(3000);

    const depois = await cardDeTeste(page);
    expect(depois?.estagio_chave, `o card mudou de etapa (era ${antes!.estagio_chave})`).not.toBe(antes!.estagio_chave);
    console.log(`  arrastar: ${antes!.estagio_chave} -> ${depois?.estagio_chave}`);
    await ctx.close();
  });

  test("card de outra equipe: a Jusy nem enxerga, e a escrita é recusada", async ({ browser }) => {
    // O comprador_id vem por uma sessão de MASTER de propósito: depois do teste 3
    // o card está com a Kelly (Equipe 2) e a Jusy — operadora do Grupo Participa —
    // deixa de VÊ-LO na listagem. Buscar pela listagem dela daria "pulado" e
    // esconderia justamente o que se quer provar: o isolamento funciona nas duas
    // pontas, na leitura e na escrita.
    const m = await sessao(browser, MASTER);
    await m.page.goto("/hm/kanban?produto=HM");
    const card = await cardDeTeste(m.page);
    await m.ctx.close();
    test.skip(!card, "card ZZ TESTE UX não está no board");

    const { ctx, page } = await sessao(browser, JUSY);
    await page.goto("/hm/kanban?produto=HM");

    // 1) leitura: o card não aparece na listagem dela
    const naListaDela = await cardDeTeste(page);
    expect(naListaDela, "card de outra equipe não entra na listagem do operador").toBeNull();

    // 2) escrita: recusada com motivo explícito, que a tela traduz
    const r = await page.request.patch(`/api/hm/contato/${card!.comprador_id}?produto=HM`, {
      data: { estagio_chave: "hm_reuniao_agendada" },
    });
    expect(r.status()).toBe(403);
    const d = await r.json();
    expect(["card_de_outro_operador", "sem_acesso"]).toContain(d.reason);
    console.log(`  escrita recusada: ${d.reason}`);
    await ctx.close();
  });
});
