// FILE: src/server/routes/replicache.ts
import { Elysia, t } from "elysia";
import { Effect, Either, Schema } from "effect";
import { TreeFormatter } from "effect/ParseResult";
import { handlePull } from "../../features/replicache/pull";
import { handlePush } from "../../features/replicache/push";
import { userContext } from "../context";
import { effectPlugin } from "../middleware/effect-plugin";
import {
  PullRequestSchema,
  PushRequestSchema,
} from "../../lib/shared/replicache-schemas";
import {
  InvalidRequestError,
  PullError,
  PushError,
  UnauthorizedError,
  ClientStateNotFoundError,
  ClockSkewError, // ✅ Imported
} from "../../features/replicache/Errors";
import type { Role } from "../../lib/shared/permissions";

const handleReplicacheResult = <A>(
  result: Either.Either<A, unknown>,
  set: { status?: number | string },
) => {
  if (Either.isRight(result)) {
    return result.right;
  }

  const error = result.left;

  if (error instanceof UnauthorizedError) {
    set.status = 401;
    return { error: "Unauthorized" };
  }
  
  if (error instanceof ClientStateNotFoundError) {
    console.warn("[Replicache] Client state not found (Time Travel). Sending reset signal.");
    set.status = 200; 
    return { error: "ClientStateNotFound" };
  }

  // ✅ 5. Update Route Handling (Error Mapping)
  if (error instanceof ClockSkewError) {
    console.warn(`[Replicache] Rejected Push due to Clock Skew. Client: ${error.clientTime}, Server: ${error.serverTime}`);
    set.status = 400;
    return { 
        error: "ClockSkewError",
        message: "Your device clock is significantly ahead of server time. Please check your system settings.",
        details: {
            serverTime: error.serverTime,
            clientTime: error.clientTime,
            threshold: error.threshold
        }
    };
  }

  if (error instanceof InvalidRequestError) {
    set.status = 400;
    return { error: error.message };
  }
  if (error instanceof PullError) {
    console.error("[Replicache] Pull failed:", error.cause);
    set.status = 500;
    return { error: "Pull failed" };
  }
  if (error instanceof PushError) {
    console.error("[Replicache] Push failed:", error.cause);
    set.status = 500;
    return { error: "Push failed" };
  }

  console.error("[Replicache] Unexpected error:", error);
  set.status = 500;
  return { error: "Internal Server Error" };
};

export const replicacheRoutes = new Elysia({ prefix: "/api/replicache" })
  .use(userContext)
  .use(effectPlugin)
  .post(
    "/pull",
    async ({ body, user, userDb, tenant, set, runEffect }) => {
      const pullEffect = Effect.gen(function* () {
        if (!user || !userDb) {
          return yield* Effect.fail(new UnauthorizedError());
        }

        const validatedBody = yield* Schema.decodeUnknownEither(
          PullRequestSchema,
        )(body).pipe(
          Effect.mapError(
            (err) =>
              new InvalidRequestError({
                message: `Invalid Request: ${Effect.runSync(
                  TreeFormatter.formatError(err),
                )}`,
              }),
          ),
        );

        yield* Effect.logInfo(
          `[Replicache] Pull request from ${user.id} (cookie: ${validatedBody.cookie})`,
        );

        const schemaName = tenant?.tenant_strategy === 'schema' && tenant.schema_name 
            ? tenant.schema_name 
            : undefined;

        return yield* handlePull(validatedBody, user, userDb, schemaName);
      });

      const result = await runEffect(Effect.either(pullEffect), {
        name: "Replicache Pull",
      });

      return handleReplicacheResult(result, set);
    },
    {
      body: t.Object({
        clientGroupID: t.String(),
        cookie: t.Union([t.String(), t.Number(), t.Null()]),
        filter: t.Optional(t.Any()),
      }),
    },
  )
  .post(
    "/push",
    async ({ body, user, userDb, currentRole, tenant, set, runEffect }) => {
      const pushEffect = Effect.gen(function* () {
        if (!user || !userDb) {
          return yield* Effect.fail(new UnauthorizedError());
        }

        const validatedBody = yield* Schema.decodeUnknownEither(
          PushRequestSchema,
        )(body).pipe(
          Effect.mapError(
            (err) =>
              new InvalidRequestError({
                message: `Invalid Request: ${Effect.runSync(
                  TreeFormatter.formatError(err),
                )}`,
              }),
          ),
        );

        yield* Effect.logInfo(
          `[Replicache] Push request from ${user.id} with ${validatedBody.mutations.length} mutations. Role: ${currentRole}`,
        );

        const schemaName = tenant?.tenant_strategy === 'schema' && tenant.schema_name 
            ? tenant.schema_name 
            : undefined;

        return yield* handlePush(validatedBody, user, userDb, currentRole as Role, schemaName);
      });

      const result = await runEffect(Effect.either(pushEffect), {
        name: "Replicache Push",
      });

      return handleReplicacheResult(result, set);
    },
    {
      body: t.Object({
        clientGroupID: t.String(),
        mutations: t.Array(
          t.Object({
            id: t.Number(),
            name: t.String(),
            args: t.Any(),
            clientID: t.String(),
          }),
        ),
      }),
    },
  );
