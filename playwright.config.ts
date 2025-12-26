// FILE: playwright.config.ts
import { defineConfig, devices } from "@playwright/test";
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

// Fix for __dirname in ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load environment variables from .env
dotenv.config({ path: path.resolve(__dirname, ".env") });

// Determine the DB URL to use for testing
const TEST_DB_URL = process.env.DATABASE_URL_TEST || 
                    process.env.DATABASE_URL_LOCAL || 
                    process.env.DATABASE_URL;

if (!TEST_DB_URL) {
  throw new Error("No database URL found for testing.");
}

export default defineConfig({
  testDir: "./tests/e2e",
  // ✅ FIX: Add globalSetup
  globalSetup: "./tests/e2e/global-setup.ts",
  
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: "list",
  
  use: {
    // ✅ FIX: Use 127.0.0.1 instead of localhost to match Vite's explicit binding
    baseURL: "http://127.0.0.1:3000",
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
    ignoreHTTPSErrors: true,
    
    // NixOS Support
    launchOptions: {
      executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
    },
  },

  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],

  webServer: {
    command: "npm run dev",
    // ✅ FIX: Check 127.0.0.1 explicitly
    url: "http://127.0.0.1:3000",
    reuseExistingServer: !process.env.CI,
    stdout: "pipe",
    stderr: "pipe",
    timeout: 120 * 1000,
    ignoreHTTPSErrors: true,
    // ✅ FIX: Force the server to use the test database
    env: {
      DATABASE_URL: TEST_DB_URL,
      // We explicitly disable the proxy flag to force usage of DATABASE_URL
      USE_LOCAL_NEON_PROXY: "false", 
    }
  },
});
