// FILE: src/features/replicache/push.ts
import { Effect, Schema } from "effect";
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
import { injectConflictAlert } from "../note/utils/content-traversal"; // ✅ IMPORTED


interface GenericTiptapNode {
  type: string;
  attrs?: {
    blockId?: string;
    level?: string;
    message?: string;
    [key: string]: unknown;
  };
  content?: GenericTiptapNode[];
  [key: string]: unknown;
}

// Map mutations to required permissions
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
              console.warn(`Mutation ${mutationID} from future? Expected ${expectedID}. Skipping/Gap.`);
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

            try {
                await Effect.runPromise(effectToRun);
            } catch (err: unknown) {
                if (err instanceof VersionConflictError) {
                    console.warn(`[Push] Version Conflict detected for ${name}. Injecting alert...`);
                    
                    const conflictResolution = Effect.gen(function*() {
                        const blockRow = yield* Effect.tryPromise({
                          try: () => trx.selectFrom("block")
                              .select(["note_id", "fields"])
                              .where("id", "=", err.blockId as BlockId)
                              .executeTakeFirst(),
                          catch: (e) => new NoteDatabaseError({ cause: e }),
                        });

                        if (!blockRow || !blockRow.note_id) return;

                        const noteRow = yield* Effect.tryPromise({
                          try: () => trx.selectFrom("note")
                              .select("content")
                              .where("id", "=", blockRow.note_id!)
                              .executeTakeFirst(),
                          catch: (e) => new NoteDatabaseError({ cause: e }),
                        });

                        if (!noteRow || !noteRow.content) return;

                        const message = `Sync Conflict: Server v${err.expectedVersion} vs Your v${err.actualVersion}`;
                        
                        const content = JSON.parse(JSON.stringify(noteRow.content)) as GenericTiptapNode;
                        
                        // Use Shared Injector
                        if (injectConflictAlert(content, err.blockId, message)) {
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
                        }
                    });

                    await Effect.runPromise(conflictResolution.pipe(
                        Effect.catchAll(e => Effect.logError("Conflict resolution failed", e))
                    ));

                } else if (isParseError(err)) {
                    console.error(`[Push] Schema Validation Failed for ${name}:`, Effect.runSync(TreeFormatter.formatError(err)));
                } else if (err && typeof err === 'object' && 'name' in err && (err as { name: string }).name === '(FiberFailure) ParseError') {
                    console.error(`[Push] Schema Validation Failed for ${name} (FiberFailure):`, JSON.stringify(err, null, 2));
                } else {
                    console.error(`[Push] Poison Pill caught! Mutation ${name} (ID: ${mutationID}) failed. Consuming error to unblock queue.`, err);
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
