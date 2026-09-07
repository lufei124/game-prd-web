import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "tests",
  testMatch: "*.spec.ts",
  fullyParallel: false,
  workers: 1,
  timeout: 60000,
  use: {
    baseURL: "http://127.0.0.1:4318",
    actionTimeout: 10000,
    viewport: { width: 1512, height: 982 },
    headless: true,
    ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE
      ? {
          launchOptions: {
            executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE,
          },
        }
      : {}),
    screenshot: "only-on-failure",
  },
  webServer: {
    command: "node --import tsx tests/browser-server.ts",
    url: "http://127.0.0.1:4318",
    reuseExistingServer: false,
    timeout: 30000,
  },
});
