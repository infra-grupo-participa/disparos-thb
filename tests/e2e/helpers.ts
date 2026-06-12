import { Page, expect } from "@playwright/test";

// Credenciais de teste (e-mail + senha). Configure no ambiente:
//   TEST_EMAIL (default: admin do seed)  /  TEST_SENHA (obrigatória p/ rodar)
export const TEST_EMAIL = process.env.TEST_EMAIL ?? "marcio@advmais.com";
export const TEST_SENHA = process.env.TEST_SENHA ?? "";
// Compat: specs antigos usam APP_PASSWORD como "há credenciais?" para o skip.
export const APP_PASSWORD = TEST_SENHA;

// Faz login pela UI e espera sair da tela de login. Reaproveitado no beforeEach.
export async function login(page: Page) {
  if (!TEST_SENHA) throw new Error("TEST_SENHA ausente no ambiente — defina TEST_EMAIL/TEST_SENHA");
  await page.goto("/login");
  await page.locator("#email").fill(TEST_EMAIL);
  await page.locator("#password").fill(TEST_SENHA);
  await page.getByRole("button", { name: "Entrar" }).click();
  await page.waitForURL((url) => !url.pathname.startsWith("/login"));
}
