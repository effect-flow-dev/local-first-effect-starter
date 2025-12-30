// FILE: src/features/replicache/push.ts
import { Effect, Schema, Exit, Cause } from "effect";
import { TreeFormatter, type ParseError } from "effect/ParseResult";
import { sql, type Kysely } from "kysely";
import type { Database } from "../../types";
import { poke } from "../../lib/server/PokeService";
import type { PushRequest } from "../../lib/shared/replicache-schemas";
import type { PublicUser, BlockId } from "../../lib/shared/schemas"; 
import type { ReplicacheClientGroupId } from "#src/types/generated/tenant/tenant_template/ReplicacheClientGroup.js";
import type { ReplicacheClientId } from "#src/types/generated/tenant/tenant_template/ReplicacheClient.js";
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

const isParseError = (error: unknown): error is ParseError => {
  return (
    typeof error === 'object' &&
    error !== null &&
    '_tag' in error &&
    (error as { _tag: unknown })._tag === 'ParseError'
  );
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

          // 1. Ensure Client Group Exists
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

          // 2. Process Mutations sequentially
          for (const mutation of req.mutations) {
            const { clientID, id: mutationID, name, args } = mutation;

            // ✅ DEBUG LOG: Track incoming mutations to confirm flow
            console.info(`[Push] Processing mutation ${name} (ID: ${mutationID}) from ${clientID}`);

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

            if (mutationID < expectedID) {
              console.info(`[Push] Skipping duplicate mutation ${mutationID} (Current: ${lastMutationID})`);
              continue;
            }
            if (mutationID > expectedID) {
              console.warn(`[Push] Future mutation ${mutationID}? Expected ${expectedID}. Skipping/Gap.`);
              continue; 
            }

            // RBAC Check
            const requiredPerm = MUTATION_PERMISSIONS[name];
            if (requiredPerm) {
                if (!currentRole || !hasPermission(currentRole, requiredPerm)) {
                    console.warn(`[RBAC] User ${user.id} (${currentRole}) attempted ${name} without ${requiredPerm}. Denied.`);
                    await trx
                      .updateTable("replicache_client")
                      .set({ last_mutation_id: mutationID })
                      .where("id", "=", clientID as ReplicacheClientId)
                      .execute();
                    continue; 
                }
            } else {
                console.warn(`[RBAC] Unknown mutation type: ${name}. Denied by default.`);
                await trx
                  .updateTable("replicache_client")
                  .set({ last_mutation_id: mutationID })
                  .where("id", "=", clientID as ReplicacheClientId)
                  .execute();
                continue;
            }

            const effectToRun = Effect.gen(function* () {
              if (name === "createNote") {
                const a = yield* Schema.decodeUnknown(CreateNoteArgsSchema)(args);
                yield* handleCreateNote(trx, a);
              } else if (name === "updateNote") {
                const a = yield* Schema.decodeUnknown(UpdateNoteArgsSchema)(args);
                yield* handleUpdateNote(trx, a, user.id);
              } else if (name === "deleteNote") {
                const a = yield* Schema.decodeUnknown(DeleteNoteArgsSchema)(args);
                yield* handleDeleteNote(trx, a, user.id);
              } else if (name === "updateTask") {
                const a = yield* Schema.decodeUnknown(UpdateTaskArgsSchema)(args);
                yield* handleUpdateTask(trx, a, user.id);
              } else if (name === "updateBlock") {
                const a = yield* Schema.decodeUnknown(UpdateBlockArgsSchema)(args);
                yield* handleUpdateBlock(trx, a, user.id);
              } else if (name === "createBlock") { 
                const a = yield* Schema.decodeUnknown(CreateBlockArgsSchema)(args);
                yield* handleCreateBlock(trx, a, user.id);
              } else if (name === "createNotebook") {
                const a = yield* Schema.decodeUnknown(CreateNotebookArgsSchema)(args);
                yield* handleCreateNotebook(trx, a, user.id);
              } else if (name === "deleteNotebook") {
                const a = yield* Schema.decodeUnknown(DeleteNotebookArgsSchema)(args);
                yield* handleDeleteNotebook(trx, a, user.id);
              } else if (name === "revertBlock") {
                const a = yield* Schema.decodeUnknown(RevertBlockArgsSchema)(args);
                yield* handleRevertBlock(trx, a, user.id);
              } else if (name === "revertNote") {
                const a = yield* Schema.decodeUnknown(RevertNoteArgsSchema)(args);
                yield* handleRevertNote(trx, a, user.id);
              } else if (name === "incrementCounter") {
                const a = yield* Schema.decodeUnknown(IncrementCounterArgsSchema)(args);
                yield* handleIncrementCounter(trx, a, user.id);
              }
            });

            // ✅ FIX: Use runPromiseExit to properly catch and unwrap Effect errors (Fail/Die/Interrupt)
            const exit = await Effect.runPromiseExit(effectToRun);

            if (Exit.isFailure(exit)) {
                // Unwrap the cause to get the actual error object
                const actualError = Cause.squash(exit.cause);

                if (
                  actualError instanceof VersionConflictError || 
                  (typeof actualError === 'object' && actualError !== null && (actualError as { _tag?: unknown })._tag === 'VersionConflictError')
                ) {
                    // Safe cast
                    const conflictError = actualError as VersionConflictError;
                    console.warn(`[Push] Version Conflict detected for ${name}. Injecting alert...`);
                    
                    const conflictResolution = Effect.gen(function*() {
                        const blockRow = yield* Effect.tryPromise({
                          try: () => trx.selectFrom("block")
                              .select(["note_id", "fields"])
                              .where("id", "=", conflictError.blockId as BlockId)
                              .executeTakeFirst(),
                          catch: (e) => new NoteDatabaseError({ cause: e }),
                        });

                        if (!blockRow || !blockRow.note_id) {
                            console.error(`[Push] Conflict resolution aborted: Block ${conflictError.blockId} not found.`);
                            return;
                        }

                        const noteRow = yield* Effect.tryPromise({
                          try: () => trx.selectFrom("note")
                              .select("content")
                              .where("id", "=", blockRow.note_id!)
                              .executeTakeFirst(),
                          catch: (e) => new NoteDatabaseError({ cause: e }),
                        });

                        if (!noteRow || !noteRow.content) {
                            console.error(`[Push] Conflict resolution aborted: Note content missing for ${blockRow.note_id}.`);
                            return;
                        }

                        const message = `Sync Conflict: Server v${conflictError.expectedVersion} vs Your v${conflictError.actualVersion}`;
                        
                        // Robustly handle string vs object for content
                        const rawContent = noteRow.content;
                        // ✅ FIX: Cast rawContent using unknown for type safety
                        const contentObj = (typeof rawContent === 'string' 
                            ? JSON.parse(rawContent) 
                            : rawContent) as unknown;
                        
                        const content = JSON.parse(JSON.stringify(contentObj)) as ContentNode;
                        
                        // ✅ DEBUG LOG
                        console.info(`[Push] Injecting alert into note ${blockRow.note_id} for conflict on block ${conflictError.blockId}`);

                        if (injectConflictAlert(content, conflictError.blockId, message)) {
                             const res = yield* Effect.tryPromise({
                                 try: async () => {
                                     const result = await sql<{ nextval: string }>`select nextval('global_version_seq')`.execute(trx);
                                     return Number(result.rows[0]?.nextval);
                                 },
                                 catch: (e) => new NoteDatabaseError({ cause: e })
                             });
                             const newTick = res;

                             yield* Effect.tryPromise({
                                try: () => trx.updateTable("note").set({
                                    content: content as unknown,
                                    version: sql<number>`version + 1`,
                                    updated_at: sql<Date>`now()`,
                                    global_version: String(newTick)
                                }).where("id", "=", blockRow.note_id!).execute(),
                                catch: (e) => new NoteDatabaseError({ cause: e })
                             });
                             console.info(`[Push] Alert injected successfully. Note version bumped to ${newTick}`);
                        } else {
                            console.warn(`[Push] injectConflictAlert returned false. Block ${conflictError.blockId} not found in content tree.`);
                        }
                    });

                    await Effect.runPromise(conflictResolution.pipe(
                        Effect.catchAll(e => Effect.logError("Conflict resolution failed", e))
                    ));

                } else if (isParseError(actualError)) {
                    console.error(`[Push] Schema Validation Failed for ${name}:`, Effect.runSync(TreeFormatter.formatError(actualError)));
                } else {
                    console.error(`[Push] Poison Pill caught! Mutation ${name} (ID: ${mutationID}) failed. Consuming error to unblock queue.`, actualError);
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
        console.error("[Push] Transaction Failed (Transient):", cause);
        return new PushError({ cause });
      },
    });

    yield* poke(user.id);
  });
