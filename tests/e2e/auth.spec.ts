import { test, expect } from "@playwright/test";
import { APP_PASSWORD, login } from "./helpers";

test.describe("Autenticação", () => {
  test("rejeita senha incorreta", async ({ page }) => {
    await page.goto("/login");
    await page.getByRole("textbox").fill("senha-errada-xyz");
    await page.getByRole("button", { name: "Entrar" }).click();
    await expect(page.getByText("Senha incorreta.")).toBeVisible();
    await expect(page).toHaveURL(/\/login$/);
  });

  test("aceita senha correta e entra no app", async ({ page }) => {
    test.skip(!APP_PASSWORD, "APP_PASSWORD não configurado");
    await login(page);
    await expect(page).toHaveURL(/\/contatos$/);
  });

  test("redireciona usuário não autenticado para /login", async ({ page }) => {
    await page.goto("/dashboard");
    await expect(page).toHaveURL(/\/login$/);
  });

  test("logout encerra a sessão", async ({ page }) => {
    test.skip(!APP_PASSWORD, "APP_PASSWORD não configurado");
    await login(page);
    await page.getByRole("button", { name: "Sair" }).click();
    await page.waitForURL("**/login");
    // sessão encerrada: acessar rota protegida volta pro login
    await page.goto("/contatos");
    await expect(page).toHaveURL(/\/login$/);
  });
});
