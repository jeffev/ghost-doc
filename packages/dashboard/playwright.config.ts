import { defineConfig, devices } from "@playwright/test";

/**
 * E2E Playwright configuration.
 *
 * Prerequisites before running:
 *   1. `npx ghost-doc start` — Hub must be running on localhost:3001
 *   2. `pnpm dev` (or `pnpm preview`) — Dashboard must be served on localhost:8080
 *
 * The tests start their own Hub + Vite preview server automatically via
 * `webServer` below, so manual startup is not required in CI.
 */
export default defineConfig({
  testDir: "./e2e",
  timeout: 30_000,
  retries: 1,
  use: {
    baseURL: "http://localhost:8080",
    headless: true,
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  // Automatically start the Vite preview server before running E2E tests.
  webServer: {
    command: "pnpm build && pnpm preview --port 8080",
    url: "http://localhost:8080",
    reuseExistingServer: !process.env["CI"],
    timeout: 60_000,
  },
});
