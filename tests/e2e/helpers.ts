import { Page, expect } from "@playwright/test";

export const APP_PASSWORD = process.env.APP_PASSWORD ?? "";

// Faz login pela UI e espera sair da tela de login. Reaproveitado no beforeEach.
export async function login(page: Page) {
  if (!APP_PASSWORD) throw new Error("APP_PASSWORD ausente no ambiente — confira o .env.local");
  await page.goto("/login");
  await page.getByRole("textbox").fill(APP_PASSWORD);
  await page.getByRole("button", { name: "Entrar" }).click();
  await page.waitForURL((url) => !url.pathname.startsWith("/login"));
}
