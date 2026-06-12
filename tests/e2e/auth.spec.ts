import { test, expect } from "@playwright/test";
import { APP_PASSWORD, login } from "./helpers";

test.describe("Autenticação", () => {
  test("rejeita credenciais incorretas", async ({ page }) => {
    await page.goto("/login");
    await page.locator("#email").fill("ninguem@advmais.com");
    await page.locator("#password").fill("senha-errada-xyz");
    await page.getByRole("button", { name: "Entrar" }).click();
    await expect(page.getByText("E-mail ou senha incorretos.")).toBeVisible();
    await expect(page).toHaveURL(/\/login$/);
  });

  test("aceita credenciais corretas e entra no app", async ({ page }) => {
    test.skip(!APP_PASSWORD, "TEST_SENHA não configurada");
    await login(page);
    await expect(page).toHaveURL(/\/kanban$/);
  });

  test("redireciona usuário não autenticado para /login", async ({ page }) => {
    await page.goto("/dashboard");
    await expect(page).toHaveURL(/\/login$/);
  });

  test("logout encerra a sessão", async ({ page }) => {
    test.skip(!APP_PASSWORD, "TEST_SENHA não configurada");
    await login(page);
    await page.getByRole("button", { name: "Menu do usuário" }).click();
    await page.getByRole("button", { name: "Sair" }).click();
    await page.waitForURL("**/login");
    // sessão encerrada: acessar rota protegida volta pro login
    await page.goto("/contatos");
    await expect(page).toHaveURL(/\/login$/);
  });
});
