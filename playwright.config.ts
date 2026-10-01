import { defineConfig, devices } from "@playwright/test";

// End-to-end tests run against a real Supabase (local `supabase start`, or any
// stack exposing the same API) and a running app:
//   NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY (or _ANON_KEY),
//   SUPABASE_SERVICE_ROLE_KEY (tests only: creates and signs in test users),
//   E2E_BASE_URL (default http://localhost:3000).
// Set E2E_START_SERVER=1 to let Playwright start `npm run start` (after `npm run build`).
const baseURL = process.env.E2E_BASE_URL ?? "http://localhost:3000";

export default defineConfig({
  testDir: "e2e",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"]],
  timeout: 60_000,
  use: {
    baseURL,
    trace: "retain-on-failure",
    locale: "fr-FR",
    timezoneId: "Europe/Paris",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"], viewport: { width: 1280, height: 900 } } }],
  webServer: process.env.E2E_START_SERVER
    ? { command: `npm run start -- -p ${new URL(baseURL).port || 3000}`, url: baseURL, reuseExistingServer: true }
    : undefined,
});
