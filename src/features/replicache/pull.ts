// FILE: src/features/replicache/pull.ts
// ------------------------
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
    const requestCookie = typeof cookie === "number" ? cookie : 0;
    const isFreshSync = !cookie || cookie === 0;
    
    return yield* Effect.tryPromise({
      try: () =>
        db.transaction().execute(async (trx) => {
          if (schemaName) {
             await sql`SET search_path TO ${sql.ref(schemaName)}, public`.execute(trx);
          }

          // ✅ FIX: Wrap version check in a safety check. 
          // If the sequence is missing, the tenant isn't ready.
          let currentGlobalVersion = 0;
          try {
              currentGlobalVersion = await Effect.runPromise(getCurrentGlobalVersion(trx));
          } catch (e) {
              const err = e as { message?: string };
              if (err.message?.includes("relation") && err.message?.includes("does not exist")) {
                  console.warn(`[Pull] Tenant schema ${schemaName} not ready. Returning empty patch.`);
                  return {
                      cookie: 0,
                      lastMutationIDChanges: {},
                      patch: []
                  } as PullResponse;
              }
              throw e;
          }

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

          const patchPromises = syncableEntities.map((entity) => 
            Effect.runPromise(
              entity.getPatchOperations(trx, user.id, requestCookie, filter)
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
        // ✅ Log clearly but don't crash the server
        console.error("[Replicache] Pull Failed:", error instanceof Error ? error.message : error);
        return new PullError({ cause: error });
      },
    });
  });
