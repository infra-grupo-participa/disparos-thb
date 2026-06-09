import { defineConfig, devices } from "@playwright/test";
import { loadEnvConfig } from "@next/env";

// Carrega .env.local para que os testes tenham APP_PASSWORD etc. no process.env.
loadEnvConfig(process.cwd());

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  workers: 1, // serial: o app é stateful (sessão única, banco compartilhado)
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: [["list"]],
  use: {
    baseURL: "http://localhost:3000",
    trace: "on-first-retry",
    screenshot: "only-on-failure",
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
  ],
  webServer: {
    command: "npm run dev",
    url: "http://localhost:3000",
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
