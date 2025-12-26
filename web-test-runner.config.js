/* eslint-disable @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment */
import { esbuildPlugin } from "@web/dev-server-esbuild";
import proxy from "koa-proxies";
import { config } from "dotenv";

// ✅ FIX: Load .env variables so we can inject them via esbuild define
config();

export default {
  // Only look for files explicitly named for WTR
  files: "src/**/*.wtr.test.ts",
  nodeResolve: {
    exportConditions: ["browser", "development"],
  },
  // Proxy /api and /ws requests to the Bun backend
  middleware: [
    proxy("/api", {
      // ✅ FIX: Use 127.0.0.1
      target: "http://127.0.0.1:42069",
      changeOrigin: true,
    }),
    proxy("/ws", {
      // ✅ FIX: Use 127.0.0.1
      target: "ws://127.0.0.1:42069",
      ws: true,
      changeOrigin: true,
    }),
  ],
  plugins: [
    // ✅ FIX 1: Inject 'process' global for Replicache/libs relying on process.env.NODE_ENV
    {
      name: "env-injection",
      transform(context) {
        if (context.response.is("html")) {
          return {
            body: context.body.replace(
              "<head>",
              '<head><script>window.process = { env: { NODE_ENV: "development" } };</script>'
            ),
          };
        }
      },
    },
    // ✅ FIX 2: Point to tsconfig.json and DEFINE VITE ENV VARS
    esbuildPlugin({
      ts: true,
      target: "es2022",
      tsconfig: "./tsconfig.json",
      define: {
        // Substitute import.meta.env.* with string literals from process.env
        "import.meta.env.VITE_API_BASE_URL": JSON.stringify(process.env.VITE_API_BASE_URL || "http://127.0.0.1:42069"),
        "import.meta.env.VITE_WS_URL": JSON.stringify(process.env.VITE_WS_URL || "ws://127.0.0.1:42069"),
        // Standard Vite flags
        "import.meta.env.DEV": "true",
        "import.meta.env.PROD": "false",
        "import.meta.env.SSR": "false",
      },
    }),
    {
      name: "css-mock",
      // Fix: Mock ALL css files
      serve(context) {
        if (context.path.endsWith(".css")) {
          return {
            body: "export default new Proxy({}, { get: (_, prop) => prop });",
            type: "js",
          };
        }
      },
    },
    // ✅ FIX 3: Mock 'turndown' (CommonJS) for Browser Tests
    // Turndown is CJS and fails to import natively in WTR.
    {
      name: "turndown-mock",
      resolveImport({ source }) {
        if (source === "turndown") {
          return "/__mocks__/turndown.js";
        }
      },
      serve(context) {
        if (context.path === "/__mocks__/turndown.js") {
          return {
            body: "export default class TurndownService { turndown(html) { return html; } }",
            type: "js",
          };
        }
      },
    },
  ],
  testFramework: {
    config: {
      timeout: 10000,
    },
  },
};
