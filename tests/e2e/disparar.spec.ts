import { test, expect } from "@playwright/test";
import { APP_PASSWORD, login } from "./helpers";

// Fluxo de disparo SEM efeito colateral: injeta uma seleção fake no sessionStorage
// (não toca o banco de contatos) e valida a tela de configuração, preview e as
// travas de segurança. NÃO clica em "Disparar" — isso enviaria de verdade.
const SELECAO_FAKE = [
  { comprador_id: "00000000-0000-0000-0000-000000000001", nome: "Fulano de Teste", telefone: "5511999990001", edicao: "HT99" },
  { comprador_id: "00000000-0000-0000-0000-000000000002", nome: "Ciclana de Teste", telefone: "5511999990002", edicao: "HT99" },
];

test.describe("Tela de disparo (validações, sem enviar)", () => {
  test.beforeEach(async ({ page }) => {
    test.skip(!APP_PASSWORD, "APP_PASSWORD não configurado");
    await login(page);
    // Semeia a seleção como se viesse da tela de Contatos.
    await page.evaluate((sel) => sessionStorage.setItem("cs_disparo_selecao", JSON.stringify(sel)), SELECAO_FAKE);
    await page.goto("/disparar");
  });

  test("mostra a contagem de contatos selecionados", async ({ page }) => {
    await expect(page.getByText("2 contato(s) selecionado(s)")).toBeVisible();
  });

  test("botão de disparo começa desabilitado (sem template nem confirmação)", async ({ page }) => {
    const botao = page.getByRole("button", { name: /Disparar para 2 contato/ });
    await expect(botao).toBeDisabled();
  });

  test("pré-seleciona a edição quando todos os contatos são da mesma", async ({ page }) => {
    const select = page.locator("select").filter({ has: page.locator('option[value="HT99"]') });
    await expect(select).toHaveValue("HT99");
  });

  test("marcar confirmação sem template mantém o botão travado", async ({ page }) => {
    await page.getByRole("checkbox").check();
    await expect(page.getByRole("button", { name: /Disparar para 2 contato/ })).toBeDisabled();
  });

  test("dupla confirmação: abre modal com ação rotulada e Cancelar fecha (sem enviar)", async ({ page }) => {
    // Precisa de um template ativo para habilitar o disparo. Espera o fetch
    // assíncrono de /api/templates popular o select antes de contar.
    const templateSelect = page.locator("select").first();
    await templateSelect
      .locator('option:not([value=""])')
      .first()
      .waitFor({ state: "attached", timeout: 5000 })
      .catch(() => {});
    const qtdOpcoes = await templateSelect.locator("option").count();
    test.skip(qtdOpcoes < 2, "nenhum template ativo cadastrado");

    await templateSelect.selectOption({ index: 1 });
    await page.getByRole("checkbox").check();
    await page.getByRole("button", { name: /Disparar para 2 contato/ }).click();

    // Modal de dupla confirmação com a ação rotulada pela ação real.
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole("button", { name: /Enviar para 2 contato/ })).toBeVisible();

    // Cancelar fecha sem disparar.
    await dialog.getByRole("button", { name: "Cancelar" }).click();
    await expect(page.getByRole("dialog")).toBeHidden();
  });
});
