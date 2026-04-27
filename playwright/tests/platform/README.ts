/**
 * Platform-specific Playwright config templates.
 *
 * These configs start the appropriate backend for each framework adapter.
 * Copy the desired export to a top-level config file or pass via CLI:
 *
 *   npx playwright test --config=playwright.nestjs.config.ts
 *   npx playwright test --config=playwright.nextjs.config.ts
 *
 * ---
 *
 * For the Express adapter, the default playwright.config.ts already handles
 * starting Express + Vite, so Express tests run with the standard config.
 *
 * The NestJS and Next.js configs are designed to run their tests in isolation
 * with their own webServer processes.
 *
 * === NestJS Config (playwright.nestjs.config.ts) ===
 *
 *   import { defineConfig, devices } from "@playwright/test";
 *
 *   export default defineConfig({
 *     testDir: "./tests/platform",
 *     testMatch: "nestjs-api.spec.ts",
 *     outputDir: "./test-results/nestjs",
 *     timeout: 60_000,
 *     use: {
 *       baseURL: "http://localhost:3001",
 *       trace: "on-first-retry",
 *       screenshot: "only-on-failure",
 *     },
 *     forbidOnly: !!process.env.CI,
 *     retries: process.env.CI ? 1 : 0,
 *     reporter: process.env.CI ? "github" : "html",
 *     projects: [{ name: "nestjs", use: { ...devices["Desktop Chrome"] } }],
 *     webServer: {
 *       command: "cd examples/nest-prisma && PORT=3001 npx nest start",
 *       url: "http://localhost:3001/flowlib/flows",
 *       reuseExistingServer: !process.env.CI,
 *       timeout: 60_000,
 *       stdout: "pipe",
 *       stderr: "pipe",
 *       env: { PORT: "3001", FLOW_DB_URL: "file:./test-platform.db" },
 *     },
 *   });
 *
 * === Next.js Config (playwright.nextjs.config.ts) ===
 *
 *   import { defineConfig, devices } from "@playwright/test";
 *
 *   export default defineConfig({
 *     testDir: "./tests/platform",
 *     testMatch: ["nextjs-api.spec.ts", "nextjs-frontend.spec.ts"],
 *     outputDir: "./test-results/nextjs",
 *     timeout: 60_000,
 *     use: {
 *       baseURL: "http://localhost:3002",
 *       trace: "on-first-retry",
 *       screenshot: "only-on-failure",
 *       video: "on-first-retry",
 *     },
 *     forbidOnly: !!process.env.CI,
 *     retries: process.env.CI ? 1 : 0,
 *     reporter: process.env.CI ? "github" : "html",
 *     projects: [{ name: "nextjs", use: { ...devices["Desktop Chrome"] } }],
 *     webServer: {
 *       command: "cd examples/nextjs-app-router && PORT=3002 npx next dev --port 3002",
 *       url: "http://localhost:3002",
 *       reuseExistingServer: !process.env.CI,
 *       timeout: 120_000,
 *       stdout: "pipe",
 *       stderr: "pipe",
 *       env: { PORT: "3002" },
 *     },
 *   });
 */
export {};
