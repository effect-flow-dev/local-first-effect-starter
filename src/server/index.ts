// FILE: src/server/index.ts
/* eslint-disable no-console */
import { Elysia } from "elysia";
import { cors } from "@elysiajs/cors";
import { staticPlugin } from "@elysiajs/static";
import { authRoutes } from "./routes/auth";
import { replicacheRoutes } from "./routes/replicache";
import { userRoutes } from "./routes/user";
import { infraRoutes } from "./routes/infra";
import { mediaRoutes } from "./routes/media";
import { logRoutes } from "./routes/log";
import { noteRoutes } from "./routes/note";
import { subscribe } from "../lib/server/PokeService";
import { validateToken } from "../lib/server/JwtService";
import { Effect, Stream } from "effect";
import { effectPlugin } from "./middleware/effect-plugin";

const app = new Elysia()
  .onError(({ code, error, request }) => {
    console.error(
      `[Global Error] ${request.method} ${request.url} - ${code}`,
      error,
    );
  })
  // ✅ FIX: Allow 127.0.0.1 for Playwright/E2E testing
  .use(cors({
    origin: [
        /localhost.*/,           // Browser Dev
        /127\.0\.0\.1.*/,        // Playwright / E2E
        /.*\.life-io\.xyz/,      // Web Production Wildcard
        "https://life-io.xyz",   // Web Production Root
        "capacitor://localhost", // iOS Capacitor
        "http://localhost",      // Android Capacitor
    ],
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization", "X-Life-IO-Subdomain"],
    credentials: true,
  }))
  .use(effectPlugin)
  .use(authRoutes)
  .use(replicacheRoutes)
  .use(userRoutes)
  .use(infraRoutes)
  .use(mediaRoutes)
  .use(logRoutes)
  .use(noteRoutes)
  .ws("/ws", {
    async open(ws) {
      const protocolHeader = ws.data.request.headers.get(
        "sec-websocket-protocol",
      );

      let token: string | undefined;

      if (protocolHeader) {
        const parts = protocolHeader.split(",").map((p) => p.trim());
        token = parts[0];
      }

      if (!token) {
        console.warn("[Server WS] Connection attempted without token.");
        ws.close();
        return;
      }

      const result = await Effect.runPromise(
        Effect.either(validateToken(token)),
      );

      if (result._tag === "Left") {
        console.warn("[Server WS] Token validation failed.");
        ws.close();
        return;
      }

      const user = result.right;
      console.log(`[Server WS] Connected: ${user.id}`);

      const stream = subscribe(user.id);

      Effect.runFork(
        Stream.runForEach(stream, (msg) => {
          ws.send(msg);
          return Effect.void;
        }),
      );
    },
    message(_ws, _message) {},
  })
  .use(
    staticPlugin({
      assets: "./dist/assets",
      prefix: "/assets",
    }),
  )
  .get("/manifest.webmanifest", () => Bun.file("./dist/manifest.webmanifest"))
  .get("/sw.js", () => Bun.file("./dist/sw.js"))
  .get("/favicon.ico", () => Bun.file("./dist/favicon.ico"))
  .get("/icon-192.png", () => Bun.file("./dist/icon-192.png"))
  .get("/icon-512.png", () => Bun.file("./dist/icon-512.png"))
  .get("/apple-touch-icon.png", () => Bun.file("./dist/apple-touch-icon.png"))
  .get("*", () => Bun.file("./dist/index.html"))
  .listen(42069);

console.log(
  `🦊 Elysia is running at ${app.server?.hostname}:${app.server?.port}`,
);

export type App = typeof app;
