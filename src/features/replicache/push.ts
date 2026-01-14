// FILE: src/features/replicache/push.ts
import { Effect, Schema, Exit, Cause } from "effect";
import { sql, type Kysely } from "kysely";
import type { Database } from "../../types";
import { poke } from "../../lib/server/PokeService";
import type { PushRequest } from "../../lib/shared/replicache-schemas";
import type { PublicUser, BlockId } from "../../lib/shared/schemas"; 
import type { ReplicacheClientGroupId } from "../../types/generated/tenant/tenant_template/ReplicacheClientGroup";
import type { ReplicacheClientId } from "../../types/generated/tenant/tenant_template/ReplicacheClient";
import { 
    initHlc, 
    receiveHlc, 
    tickHlc, 
    packHlc, 
    unpackHlc 
} from "../../lib/shared/hlc"; 

import {
  handleCreateNote,
  handleDeleteNote,
  handleUpdateNote,
  handleUpdateTask,
  handleUpdateBlock,
  handleRevertBlock,
  handleRevertNote,
  handleCreateBlock,
  handleIncrementCounter,
  RevertBlockArgsSchema,
  RevertNoteArgsSchema,
  CreateNoteArgsSchema,
  UpdateNoteArgsSchema,
  DeleteNoteArgsSchema,
  UpdateTaskArgsSchema,
  UpdateBlockArgsSchema,
  CreateBlockArgsSchema,
  IncrementCounterArgsSchema,
} from "../note/note.mutations";
import {
  handleCreateNotebook,
  handleDeleteNotebook,
  CreateNotebookArgsSchema,
  DeleteNotebookArgsSchema,
} from "../notebook/notebook.mutations";
import { PushError } from "./Errors";
import { NoteDatabaseError, VersionConflictError } from "../note/Errors";
import { hasPermission, PERMISSIONS, type Role, type Permission } from "../../lib/shared/permissions";
import { injectConflictAlert, type ContentNode } from "../note/utils/content-traversal"; 
import { serverRuntime } from "../../lib/server/server-runtime";

const MUTATION_PERMISSIONS: Record<string, Permission> = {
    createNote: PERMISSIONS.NOTE_CREATE,
    updateNote: PERMISSIONS.NOTE_EDIT,
    deleteNote: PERMISSIONS.NOTE_DELETE,
    updateTask: PERMISSIONS.TASK_UPDATE,
    updateBlock: PERMISSIONS.BLOCK_EDIT,
    createBlock: PERMISSIONS.BLOCK_EDIT, 
    createNotebook: PERMISSIONS.NOTEBOOK_CREATE,
    deleteNotebook: PERMISSIONS.NOTEBOOK_DELETE,
    revertBlock: PERMISSIONS.BLOCK_EDIT,
    revertNote: PERMISSIONS.NOTE_EDIT,
    incrementCounter: PERMISSIONS.BLOCK_EDIT,
};

const formatDbError = (error: unknown): string => {
    if (typeof error === "object" && error !== null) {
        const pgErr = error as { code?: string; detail?: string; message?: string };
        return `[PG ${pgErr.code || "UNKNOWN"}] ${pgErr.message}${pgErr.detail ? ` - Detail: ${pgErr.detail}` : ""}`;
    }
    return String(error);
};

export const handlePush = (
  req: PushRequest,
  user: PublicUser,
  db: Kysely<Database>,
  currentRole: Role | null,
  schemaName?: string
) =>
  Effect.gen(function* () {
    if (req.mutations.length === 0) return;

    yield* Effect.tryPromise({
      try: () =>
        db.transaction().execute(async (trx) => {
          if (schemaName) {
             await sql`SET search_path TO ${sql.ref(schemaName)}, public`.execute(trx);
          }

          const maxVersionRow = await trx
            .selectFrom("block_history")
            .select(sql<string>`max(hlc_timestamp)`.as("maxHlc"))
            .executeTakeFirst();
          
          let serverHlc = (maxVersionRow && maxVersionRow.maxHlc) 
            ? unpackHlc(maxVersionRow.maxHlc) 
            : initHlc("SERVER");

          await trx
            .insertInto("replicache_client_group")
            .values({
              id: req.clientGroupID as ReplicacheClientGroupId,
              user_id: user.id,
              cvr_version: 0,
              updated_at: new Date(),
            })
            .onConflict((oc) => oc.column("id").doNothing())
            .execute();

          for (const mutation of req.mutations) {
            const { clientID, id: mutationID, name, args } = mutation;
            const clientHlcPacked = (args as { hlcTimestamp?: string }).hlcTimestamp;
            
            if (clientHlcPacked) {
                serverHlc = receiveHlc(serverHlc, clientHlcPacked, Date.now());
            } else {
                serverHlc = tickHlc(serverHlc, Date.now());
            }
            
            const currentGlobalVersion = packHlc(serverHlc);

            let clientState = await trx
              .selectFrom("replicache_client")
              .selectAll()
              .where("id", "=", clientID as ReplicacheClientId)
              .forUpdate()
              .executeTakeFirst();

            if (!clientState) {
              await trx
                .insertInto("replicache_client")
                .values({
                  id: clientID as ReplicacheClientId,
                  client_group_id: req.clientGroupID as ReplicacheClientGroupId,
                  last_mutation_id: 0,
                  updated_at: new Date(),
                })
                .execute();
              clientState = {
                id: clientID as ReplicacheClientId,
                client_group_id: req.clientGroupID as ReplicacheClientGroupId,
                last_mutation_id: 0,
                updated_at: new Date(),
              };
            }

            const lastMutationID = clientState.last_mutation_id ?? 0;
            const expectedID = lastMutationID + 1;

            if (mutationID < expectedID) continue;
            if (mutationID > expectedID) {
              await serverRuntime.runPromise(
                Effect.logWarning(`[Push] Mutation Gap: Client ${clientID} sent ${mutationID}, expected ${expectedID}`)
              );
              continue; 
            }

            const requiredPerm = MUTATION_PERMISSIONS[name];
            if (requiredPerm) {
                if (!currentRole || !hasPermission(currentRole, requiredPerm)) {
                    await serverRuntime.runPromise(
                        Effect.logWarning(`[RBAC] User ${user.id} denied ${name}.`)
                    );
                    await trx
                      .updateTable("replicache_client")
                      .set({ last_mutation_id: mutationID })
                      .where("id", "=", clientID as ReplicacheClientId)
                      .execute();
                    continue; 
                }
            }

            const effectToRun = Effect.gen(function* () {
              if (name === "createNote") {
                const a = yield* Schema.decodeUnknown(CreateNoteArgsSchema)(args);
                yield* handleCreateNote(trx, a, currentGlobalVersion);
              } else if (name === "updateNote") {
                const a = yield* Schema.decodeUnknown(UpdateNoteArgsSchema)(args);
                yield* handleUpdateNote(trx, a, user.id, currentGlobalVersion);
              } else if (name === "deleteNote") {
                const a = yield* Schema.decodeUnknown(DeleteNoteArgsSchema)(args);
                yield* handleDeleteNote(trx, a, user.id, currentGlobalVersion);
              } else if (name === "updateTask") {
                const a = yield* Schema.decodeUnknown(UpdateTaskArgsSchema)(args);
                yield* handleUpdateTask(trx, a, user.id, currentGlobalVersion);
              } else if (name === "updateBlock") {
                const a = yield* Schema.decodeUnknown(UpdateBlockArgsSchema)(args);
                yield* handleUpdateBlock(trx, a, user.id, currentGlobalVersion);
              } else if (name === "createBlock") { 
                const a = yield* Schema.decodeUnknown(CreateBlockArgsSchema)(args);
                yield* handleCreateBlock(trx, a, user.id, currentGlobalVersion);
              } else if (name === "createNotebook") {
                const a = yield* Schema.decodeUnknown(CreateNotebookArgsSchema)(args);
                yield* handleCreateNotebook(trx, a, user.id, currentGlobalVersion);
              } else if (name === "deleteNotebook") {
                const a = yield* Schema.decodeUnknown(DeleteNotebookArgsSchema)(args);
                yield* handleDeleteNotebook(trx, a, user.id, currentGlobalVersion);
              } else if (name === "revertBlock") {
                const a = yield* Schema.decodeUnknown(RevertBlockArgsSchema)(args);
                yield* handleRevertBlock(trx, a, user.id, currentGlobalVersion);
              } else if (name === "revertNote") {
                const a = yield* Schema.decodeUnknown(RevertNoteArgsSchema)(args);
                yield* handleRevertNote(trx, a, user.id, currentGlobalVersion);
              } else if (name === "incrementCounter") {
                const a = yield* Schema.decodeUnknown(IncrementCounterArgsSchema)(args);
                yield* handleIncrementCounter(trx, a, user.id, currentGlobalVersion);
              }
            });

            // ✅ FIX: Use serverRuntime instead of Effect to ensure consistent context (Service dependencies)
            const exit = await serverRuntime.runPromiseExit(effectToRun);

            if (Exit.isFailure(exit)) {
                const actualError = Cause.squash(exit.cause);

                if (actualError instanceof VersionConflictError || (typeof actualError === "object" && actualError !== null && (actualError as Record<string, unknown>)._tag === "VersionConflictError")) {
                    const conflictError = actualError as VersionConflictError;
                    
                    const conflictResolution = Effect.gen(function*() {
                        const blockRow = yield* Effect.tryPromise(() => 
                            trx.selectFrom("block")
                               .select(["note_id"])
                               .where("id", "=", conflictError.blockId as BlockId)
                               .executeTakeFirst()
                        );
                        
                        if (!blockRow?.note_id) return;

                        const noteRow = yield* Effect.tryPromise(() => 
                            trx.selectFrom("note")
                               .select("content")
                               .where("id", "=", blockRow.note_id!)
                               .executeTakeFirst()
                        );
                        
                        if (!noteRow?.content) return;

                        const message = `Conflict: Server version ${conflictError.expectedVersion}, mutation version ${conflictError.actualVersion}`;
                        const content = JSON.parse(typeof noteRow.content === "string" ? noteRow.content : JSON.stringify(noteRow.content)) as ContentNode;

                        if (injectConflictAlert(content, conflictError.blockId, message)) {
                             yield* Effect.tryPromise(() => trx.updateTable("note").set({
                                    content: JSON.stringify(content),
                                    version: sql`version + 1`,
                                    updated_at: sql`now()`,
                                    global_version: currentGlobalVersion
                             }).where("id", "=", blockRow.note_id!).execute());
                        }
                    });

                    await serverRuntime.runPromise(conflictResolution.pipe(Effect.catchAll(() => Effect.void)));
                } else {
                    const errorDetail = formatDbError(actualError);
                    console.error(`[Push] Mutation FAILED: ${name} (ID: ${mutationID})`);
                    console.error(`[Push] HLC: ${currentGlobalVersion}`);
                    console.error(`[Push] Reason: ${errorDetail}`);
                    
                    if (actualError instanceof NoteDatabaseError && actualError.cause) {
                        console.error(`[Push] Underlying DB Cause:`, actualError.cause);
                    }
                }
            }

            await trx
              .updateTable("replicache_client")
              .set({ last_mutation_id: mutationID })
              .where("id", "=", clientID as ReplicacheClientId)
              .execute();
          }
        }),
      catch: (cause) => {
          console.error("[Push] Transaction CRASHED:", formatDbError(cause));
          return new PushError({ cause });
      },
    });

    yield* poke(user.id);
  });
