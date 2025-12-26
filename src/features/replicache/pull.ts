// FILE: src/features/replicache/pull.ts
import { Effect, Schema } from "effect";
import { TreeFormatter } from "effect/ParseResult";
import { sql, type Kysely } from "kysely"; // ✅ Added sql
import type { Database } from "../../types";
import { syncableEntities } from "../../lib/server/sync/sync.registry";
import {
  PullRequestSchema,
  type PullResponse,
} from "../../lib/shared/replicache-schemas";
import type { PublicUser } from "../../lib/shared/schemas";
import type { ReplicacheClientGroupId } from "../../types/generated/public/ReplicacheClientGroup";
import { PullError, InvalidRequestError, ClientStateNotFoundError } from "./Errors";
import { getCurrentGlobalVersion } from "./versioning";

export const handlePull = (
    req: unknown,
    user: PublicUser,
    db: Kysely<Database>,
    schemaName?: string // ✅ Added schemaName
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
    
    // Check if this is a fresh sync (cookie 0 or null)
    const isFreshSync = !cookie || cookie === 0;
    
    yield* Effect.logInfo(
        `[Replicache] Pull request from ${user.id} (cookie: ${requestCookie}). Filter: ${filter ? JSON.stringify(filter) : 'None'}`
    );

    return yield* Effect.tryPromise({
      try: () =>
        db.transaction().execute(async (trx) => {
          // ✅ FIX: Set search path if schemaName is provided
          // This ensures raw SQL (like sequences) resolves to the correct schema
          if (schemaName) {
             await sql`SET search_path TO ${sql.ref(schemaName)}, public`.execute(trx);
          }

          // 1. Get Current Server Version First
          // This queries the sequence in the tenant's schema/DB.
          const currentGlobalVersion = await Effect.runPromise(getCurrentGlobalVersion(trx));

          // 2. Time Travel Check
          // If the client sends a cookie higher than what the server knows, 
          // the client is "from the future" (likely connected to a different/wiped DB).
          if (requestCookie > currentGlobalVersion) {
              console.warn(`[Replicache] Client from Future! Client: ${requestCookie}, Server: ${currentGlobalVersion}.`);
              throw new ClientStateNotFoundError();
          }

          // 3. Ensure Client Group exists
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

          // 4. Get Last Mutation IDs
          const clients = await trx
            .selectFrom("replicache_client")
            .selectAll()
            .where("client_group_id", "=", clientGroupID as ReplicacheClientGroupId)
            .execute();
            
          const lastMutationIDChanges = Object.fromEntries(
            clients.map((c) => [c.id, c.last_mutation_id]),
          );

          // 5. Get Patch Operations via Delta Sync
          // We iterate over all registered sync entities (notes, blocks, notebooks)
          // and ask them for changes since the requestCookie.
          const patchPromises = syncableEntities.map((entity) => 
            Effect.runPromise(
              entity.getPatchOperations(trx, user.id, requestCookie, filter)
            )
          );
          
          const patchOperations = await Promise.all(patchPromises);
          const finalPatch = patchOperations.flat();

          // If it's a fresh sync, we must clear the client's local cache first
          // to ensure consistency.
          if (isFreshSync) {
            finalPatch.unshift({ op: "clear" });
          }

          const nextCookie = currentGlobalVersion;

          return {
            cookie: nextCookie,
            lastMutationIDChanges,
            patch: finalPatch,
          } as PullResponse;
        }),
      catch: (error) => {
        // Return the specific error type so the route handler can set the 200 OK status
        // that triggers the client-side reset logic.
        if (error instanceof ClientStateNotFoundError) {
            return error; 
        }
        console.error("[Replicache] Pull Failed. Cause:", error);
        return new PullError({ cause: error });
      },
    });
  });
