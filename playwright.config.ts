import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./tests/e2e",
  workers: 1,
  timeout: 120000,
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    baseURL: "http://127.0.0.1:5173",
    browserName: "chromium",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  webServer: [
    {
      command: "tsx apps/api/src/server.ts",
      url: "http://127.0.0.1:3001/health/ready",
      reuseExistingServer: false,
      timeout: 60000,
      env: {
        DATABASE_URL:
          process.env.DATABASE_URL ||
          "postgresql://bms_runtime:bms_runtime_pass_change_in_production@127.0.0.1:5432/bms",
      },
    },
    {
      command: "pnpm --filter @business/web exec vite preview --host 127.0.0.1",
      url: "http://127.0.0.1:5173",
      reuseExistingServer: false,
      timeout: 60000,
    },
  ],
});
