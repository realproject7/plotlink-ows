import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  snapshotPathTemplate: "{testDir}/__snapshots__/{testFileName}/{arg}{ext}",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: "list",
  use: {
    baseURL: process.env.CI ? "http://127.0.0.1:3000" : "http://localhost:3000",
    trace: "on-first-retry",
  },
  projects: [
    {
      name: "chromium",
      use: { browserName: "chromium" },
    },
  ],
  webServer: {
    command: process.env.CI
      ? "npx next start -H 127.0.0.1 -p 3000"
      : "npm run dev",
    url: process.env.CI
      ? "http://127.0.0.1:3000/api/health"
      : "http://localhost:3000",
    reuseExistingServer: !process.env.CI,
    stdout: "pipe",
    timeout: 120_000,
  },
});
