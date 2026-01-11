// File: src/features/replicache/pull.ts
import { Effect, Schema } from "effect";
import { TreeFormatter } from "effect/ParseResult";
import { sql, type Kysely } from "kysely";
import type { Database } from "../../types";
import { syncableEntities } from "../../lib/server/sync/sync.registry";
import {
  PullRequestSchema,
  type PullResponse,
} from "../../lib/shared/replicache-schemas";
import type { PublicUser } from "../../lib/shared/schemas";
import type { ReplicacheClientGroupId } from "../../types/generated/tenant/tenant_template/ReplicacheClientGroup";
import { PullError, InvalidRequestError, ClientStateNotFoundError } from "./Errors";
import { getCurrentGlobalVersion } from "./versioning";

export const handlePull = (
    req: unknown,
    user: PublicUser,
    db: Kysely<Database>,
    schemaName?: string
) =>
  Effect.gen(function* () {
    const validatedReq = yield* Schema.decodeUnknownEither(PullRequestSchema)(req).pipe(
        Effect.mapError(
          (err) =>
            new InvalidRequestError({
              message: `Invalid Request: ${Effect.runSync(
                TreeFormatter.formatError(err),
              )}`,
            }),
        ),
    );

    const { clientGroupID, cookie, filter } = validatedReq;
    
    // Polished HLC Cookie Handling
    const requestCookie = cookie ?? 0;
    const isFreshSync = !cookie || cookie === 0 || cookie === "0";
    
    return yield* Effect.tryPromise({
      try: () =>
        db.transaction().execute(async (trx) => {
          if (schemaName) {
             await sql`SET search_path TO ${sql.ref(schemaName)}, public`.execute(trx);
          }

          let currentGlobalVersion: string = "0";
          try {
              currentGlobalVersion = await Effect.runPromise(getCurrentGlobalVersion(trx));
          } catch (e) {
              const err = e as { message?: string, code?: string };
              // ✅ Robustness: Handle race condition where schema exists but tables don't yet
              if (err.code === "42P01" || (err.message?.includes("relation") && err.message?.includes("does not exist"))) {
                  console.warn(`[Pull] Tenant schema ${schemaName} not ready. Returning empty patch.`);
                  return {
                      cookie: "0",
                      lastMutationIDChanges: {},
                      patch: []
                  } as PullResponse;
              }
              throw e;
          }

          // HLC Comparison Logic
          // "1736...:0001:USER" > "0" works lexicographically
          if (requestCookie > currentGlobalVersion) {
              throw new ClientStateNotFoundError();
          }

          await trx
            .insertInto("replicache_client_group")
            .values({
              id: clientGroupID as ReplicacheClientGroupId,
              user_id: user.id,
              cvr_version: 0,
              updated_at: new Date(),
            })
            .onConflict((oc) => oc.column("id").doNothing())
            .execute();

          const clients = await trx
            .selectFrom("replicache_client")
            .selectAll()
            .where("client_group_id", "=", clientGroupID as ReplicacheClientGroupId)
            .execute();
            
          const lastMutationIDChanges = Object.fromEntries(
            clients.map((c) => [c.id, c.last_mutation_id]),
          );

          // For delta queries, handlers expect a number (sinceVersion).
          // We extract the physical timestamp part of the HLC for numeric comparisons.
          const numericSince = typeof requestCookie === "number" 
            ? requestCookie 
            : parseInt(String(requestCookie).split(":")[0] || "0", 10);

          const patchPromises = syncableEntities.map((entity) => 
            Effect.runPromise(
              entity.getPatchOperations(trx, user.id, numericSince, filter)
            )
          );
          
          const patchOperations = await Promise.all(patchPromises);
          const finalPatch = patchOperations.flat();

          if (isFreshSync) {
            finalPatch.unshift({ op: "clear" });
          }

          return {
            cookie: currentGlobalVersion,
            lastMutationIDChanges,
            patch: finalPatch,
          } as PullResponse;
        }),
      catch: (error) => {
        if (error instanceof ClientStateNotFoundError) {
            return error; 
        }
        console.error("[Replicache] Pull Failed:", error instanceof Error ? error.message : error);
        return new PullError({ cause: error });
      },
    });
  });
