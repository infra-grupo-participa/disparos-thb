import { test, expect } from "@playwright/test";
import { APP_PASSWORD, login } from "./helpers";

// Dashboard: KPIs, filtros (período + edição) e auto-refresh.
// Valida estrutura e comportamento dos controles, não os números reais.
test.describe("Dashboard", () => {
  test.beforeEach(async ({ page }) => {
    test.skip(!APP_PASSWORD, "APP_PASSWORD não configurado");
    await login(page);
    await page.getByRole("navigation").getByRole("link", { name: "Dashboard" }).click();
    await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();
  });

  test("mostra os 4 cards de KPI", async ({ page }) => {
    const kpis = page.getByTestId("kpis");
    for (const titulo of ["Enviados", "Respondidos", "Taxa de resposta", "SLA médio"]) {
      await expect(kpis.getByText(titulo, { exact: true })).toBeVisible();
    }
  });

  test("expõe os controles de filtro (período + edição)", async ({ page }) => {
    await expect(page.getByText("De", { exact: true })).toBeVisible();
    await expect(page.getByText("Até", { exact: true })).toBeVisible();
    await expect(page.getByText("Edição HT", { exact: true })).toBeVisible();
  });

  test("mudar o período dispara nova requisição ao endpoint", async ({ page }) => {
    // Conta chamadas ao endpoint de métricas após interagir com o filtro.
    const chamada = page.waitForResponse((r) => r.url().includes("/api/dashboard?") && r.url().includes("desde="));
    await page.locator('input[type="date"]').first().fill("2026-01-01");
    const resp = await chamada;
    expect(resp.ok()).toBeTruthy();
  });

  test("auto-refresh: exibe horário da última atualização", async ({ page }) => {
    await expect(page.getByText(/Atualizado às/)).toBeVisible();
    await expect(page.getByRole("button", { name: "Atualizar agora" })).toBeVisible();
  });
});
