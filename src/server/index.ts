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
import { pushRoutes } from "./routes/push"; 
import { subscribe, broadcastPresence } from "../lib/server/PokeService";
import { validateToken } from "../lib/server/JwtService";
import { Effect, Stream } from "effect";
import { effectPlugin } from "./middleware/effect-plugin";
import { alertWorkerLive } from "../features/alerts/alert.worker"; 
import { serverRuntime } from "../lib/server/server-runtime";
import { centralDb } from "../db/client";
import { config } from "../lib/server/Config";
import type { PublicUser } from "../lib/shared/schemas";

// Start Background Alert Worker
serverRuntime.runFork(alertWorkerLive);
console.info("🚀 Background Alert Worker started.");

// --- Types for WebSocket Context & Messages ---

interface WsContext {
  user: PublicUser;
  tenantId: string | null;
}

interface FocusMessage {
  type: "focus";
  blockId: string;
}

interface TenantLookupResult {
  id: string;
}

const isFocusMessage = (msg: unknown): msg is FocusMessage => {
  return (
    typeof msg === "object" &&
    msg !== null &&
    (msg as Record<string, unknown>).type === "focus" &&
    typeof (msg as Record<string, unknown>).blockId === "string"
  );
};

const app = new Elysia()
  .onError(({ code, error, request }) => {
    console.error(
      `[Global Error] ${request.method} ${request.url} - ${code}`,
      error,
    );
  })
  .use(cors({
    origin: [
        /localhost.*/,           
        /127\.0\.0\.1.*/,        
        /.*\.life-io\.xyz/,      
        "https://life-io.xyz",   
        "capacitor://localhost", 
        "http://localhost",      
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
  .use(pushRoutes)
  .ws("/ws", {
    async open(ws) {
      const protocolHeader = ws.data.request.headers.get("sec-websocket-protocol");
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

      // --- Resolve Tenant Context ---
      let tenantId: string | null = null;
      const host = ws.data.request.headers.get("host") || "";
      const headerSubdomain = ws.data.request.headers.get("x-life-io-subdomain");
      
      const rootDomain = config.app.rootDomain;
      let requestedSubdomain: string | null = null;

      if (headerSubdomain) {
        requestedSubdomain = headerSubdomain;
      } else if (host.endsWith(`.${rootDomain}`)) {
        requestedSubdomain = host.slice(0, -(rootDomain.length + 1));
      }

      if (requestedSubdomain) {
        const tenant = await centralDb
          .withSchema("public")
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          .selectFrom("tenant" as any)
          .select("id")
          .where("subdomain", "=", requestedSubdomain)
          .executeTakeFirst();
        
        if (tenant) {
            // Explicitly cast to internal type to satisfy linter
            tenantId = (tenant as unknown as TenantLookupResult).id;
        }
      }
      
      console.log(`[Server WS] Connected: ${user.id} (Tenant: ${tenantId || "Global"})`);

      // Subscribe User & Register Session
      const stream = subscribe(user.id, tenantId);

      // Store typed context
      ws.data.store = { user, tenantId };

      Effect.runFork(
        Stream.runForEach(stream, (msg) => {
          ws.send(msg);
          return Effect.void;
        }),
      );
    },
    
    async message(ws, message) {
        try {
            // Cast to WsContext to ensure safety when accessing user/tenantId
            const ctx = ws.data.store as WsContext;
            if (!ctx || !ctx.tenantId) return;

            // ✅ FIX: Cast result to unknown to prevent 'any' assignment error
            const rawPayload = (typeof message === 'string' ? JSON.parse(message) : message) as unknown;
            
            if (isFocusMessage(rawPayload)) {
                // Broadcast 'presence' event to everyone in this tenant
                const presenceMsg = {
                    type: 'presence',
                    userId: ctx.user.id,
                    blockId: rawPayload.blockId,
                    timestamp: Date.now()
                };
                
                await Effect.runPromise(
                    broadcastPresence(ctx.tenantId, presenceMsg)
                );
            }
        } catch (e) {
            console.error("[Server WS] Failed to handle message", e);
        }
    },
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
