import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  workers: 1,
  timeout: 120_000,
  expect: { timeout: 20_000 },
  use: { baseURL: "http://127.0.0.1:3107", channel: "msedge", trace: "retain-on-failure", actionTimeout: 20_000 },
  webServer: {
    command: "node e2e/server.cjs",
    url: "http://127.0.0.1:3107/api/health",
    timeout: 180_000,
    reuseExistingServer: false,
  },
});
