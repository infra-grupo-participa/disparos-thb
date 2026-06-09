import { test, expect } from "@playwright/test";
import { APP_PASSWORD, login } from "./helpers";

// Navegação entre os 4 painéis. Assertions estruturais apenas (cabeçalhos e
// elementos de layout) — não inspeciona dados de contatos.
test.describe("Navegação", () => {
  test.beforeEach(async ({ page }) => {
    test.skip(!APP_PASSWORD, "APP_PASSWORD não configurado");
    await login(page);
  });

  test("topo de navegação mostra os 4 links", async ({ page }) => {
    const nav = page.getByRole("navigation");
    for (const label of ["Contatos", "Disparar", "Dashboard", "Templates"]) {
      await expect(nav.getByRole("link", { name: label })).toBeVisible();
    }
  });

  test("Contatos: cabeçalho, filtros e tabela", async ({ page }) => {
    await page.getByRole("navigation").getByRole("link", { name: "Contatos" }).click();
    await expect(page.getByRole("heading", { name: "Contatos HT" })).toBeVisible();
    await expect(page.getByPlaceholder("Buscar nome, e-mail ou telefone")).toBeVisible();
    await expect(page.getByRole("table")).toBeVisible();
  });

  test("Templates: cabeçalho e formulário de cadastro", async ({ page }) => {
    await page.getByRole("navigation").getByRole("link", { name: "Templates" }).click();
    await expect(page.getByRole("heading", { name: "Templates" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Novo template" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Cadastrar template" })).toBeVisible();
  });

  test("Disparar sem seleção mostra estado vazio", async ({ page }) => {
    await page.getByRole("navigation").getByRole("link", { name: "Disparar" }).click();
    await expect(page.getByText("Nenhum contato selecionado")).toBeVisible();
  });
});
