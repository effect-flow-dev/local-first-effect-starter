// File: ./vitest.config.ts
import { defineConfig, configDefaults } from "vitest/config";
import { loadEnv } from "vite";

export default defineConfig(({ mode }) => ({
  test: {
    // Load env vars (including DATABASE_URL)
    env: loadEnv(mode, process.cwd(), ""),
    
    globals: true,
    testTimeout: 15000, // Increased slightly for DB provisioning
    environment: "jsdom",
    include: ["src/**/*.{test,spec}.ts"],
    exclude: [...configDefaults.exclude, "**/*.wtr.test.ts"],
    deps: {
      optimizer: { ssr: { include: ["@effect/vitest"] } },
    },
    css: {
      modules: {
        classNameStrategy: "stable",
      },
    },

    // --- Parallelism Configuration ---
    
    // 1. Enable File Parallelism (Now safe due to DB isolation)
    fileParallelism: true,

    // 2. Global Setup: Creates the 'template' database once before all tests
    globalSetup: ["./src/test/global-setup.ts"],

    // 3. Worker Setup: Clones the template DB for each worker thread
    setupFiles: ["./src/test/setup-worker.ts"],

    // 4. Limit Concurrency
    // Spinning up a Postgres DB per worker is heavy. 
    // Limiting to 4 concurrent workers prevents OOM or connection limit errors.
    maxWorkers: 4, 
  },
}));
