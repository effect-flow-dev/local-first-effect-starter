// FILE: ./vitest.config.ts
import { defineConfig, configDefaults } from "vitest/config";
import { loadEnv } from "vite";

// Convert to function to access 'mode'
export default defineConfig(({ mode }) => ({
  test: {
    // ✅ FIX: Load all env vars (empty prefix '') into process.env for tests.
    // This makes DATABASE_URL_TEST available.
    env: loadEnv(mode, process.cwd(), ""),
    
    globals: true,
    testTimeout: 10000,
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
    // ✅ FIX: Disable file parallelism.
    // Integration tests (LinkService, NoteMutations, TaskService) all connect to the 
    // SAME test database via `testDbGlobal` and run `beforeEach { deleteFrom(...) }`.
    // Running them in parallel causes one test to wipe the data required by another 
    // (e.g. creating a User in one file, then having it deleted by another file's cleanup),
    // leading to Foreign Key violations.
    fileParallelism: false,
  },
}));
