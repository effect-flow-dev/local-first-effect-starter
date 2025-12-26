// FILE: src/features/replicache/push.ts
import { Effect, Schema } from "effect";
import { sql, type Kysely } from "kysely";
import type { Database } from "../../types";
import { poke } from "../../lib/server/PokeService";
import type { PushRequest } from "../../lib/shared/replicache-schemas";
import type { PublicUser, BlockId } from "../../lib/shared/schemas"; 
import type { ReplicacheClientGroupId } from "../../types/generated/public/ReplicacheClientGroup";
import type { ReplicacheClientId } from "../../types/generated/public/ReplicacheClient";
import {
  handleCreateNote,
  handleDeleteNote,
  handleUpdateNote,
  handleUpdateTask,
  handleUpdateBlock,
  handleRevertBlock,
  handleRevertNote,
  handleCreateBlock, // ✅ Added
  RevertBlockArgsSchema,
  RevertNoteArgsSchema,
  CreateNoteArgsSchema,
  UpdateNoteArgsSchema,
  DeleteNoteArgsSchema,
  UpdateTaskArgsSchema,
  UpdateBlockArgsSchema,
  CreateBlockArgsSchema, // ✅ Added
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

// --- Conflict Resolution Helpers ---

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

const injectConflictAlert = (
  content: GenericTiptapNode,
  targetBlockId: string,
  message: string,
): boolean => {
  if (!content || !content.content || !Array.isArray(content.content))
    return false;

  const nodes = content.content;

  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i];
    
    if (node?.attrs?.blockId === targetBlockId) {
      const alertNode: GenericTiptapNode = {
        type: "alertBlock",
        attrs: {
          level: "error",
          message,
        },
      };
      nodes.splice(i + 1, 0, alertNode);
      return true;
    }

    if (node?.content && Array.isArray(node.content)) {
      if (injectConflictAlert(node, targetBlockId, message)) {
        return true;
      }
    }
  }
  return false;
};

// Map mutations to required permissions
const MUTATION_PERMISSIONS: Record<string, Permission> = {
    createNote: PERMISSIONS.NOTE_CREATE,
    updateNote: PERMISSIONS.NOTE_EDIT,
    deleteNote: PERMISSIONS.NOTE_DELETE,
    updateTask: PERMISSIONS.TASK_UPDATE,
    updateBlock: PERMISSIONS.BLOCK_EDIT,
    createBlock: PERMISSIONS.BLOCK_EDIT, // ✅ Added
    createNotebook: PERMISSIONS.NOTEBOOK_CREATE,
    deleteNotebook: PERMISSIONS.NOTEBOOK_DELETE,
    revertBlock: PERMISSIONS.BLOCK_EDIT,
    revertNote: PERMISSIONS.NOTE_EDIT,
};

// --- Main Handler ---

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

            // Lock client state
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
              continue;
            }
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

            // Execute the Business Logic (Authorized)
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
              } else if (name === "createBlock") { // ✅ Added
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
              }
            });

            await Effect.runPromise(
              (effectToRun as Effect.Effect<void, unknown>).pipe(
                Effect.catchAll((err) =>
                  Effect.gen(function* () {
                    // Conflict Handling
                    if (err instanceof VersionConflictError) {
                        const conflictErr = err;

                        yield* Effect.logWarning(
                          `[Push] Mutation ${name} rejected due to Version Conflict. Injecting Alert...`,
                          conflictErr,
                        );

                        const blockRow = yield* Effect.tryPromise({
                          try: () =>
                              trx
                              .selectFrom("block")
                              .select(["note_id", "fields"])
                              .where("id", "=", conflictErr.blockId as BlockId)
                              .executeTakeFirst(),
                          catch: (cause) => new NoteDatabaseError({ cause }),
                        });

                        if (!blockRow || !blockRow.note_id) {
                          yield* Effect.logWarning("[Push] Conflict block not found. Cannot inject alert.");
                          return;
                        }

                        const noteRow = yield* Effect.tryPromise({
                          try: () =>
                              trx
                              .selectFrom("note")
                              .select("content")
                              .where("id", "=", blockRow.note_id!)
                              .executeTakeFirst(),
                          catch: (cause) => new NoteDatabaseError({ cause }),
                        });

                        if (!noteRow || !noteRow.content) {
                          yield* Effect.logWarning("[Push] Note content not found. Cannot inject alert.");
                          return;
                        }

                        let message = `⚠️ Sync Conflict: Server version (${conflictErr.expectedVersion}) is ahead of yours (${conflictErr.actualVersion}). Update rejected.`;

                        try {
                          const serverFields = (blockRow.fields as Record<string, unknown>) || {};

                          if (name === "updateTask") {
                              const clientArgs = args as { isComplete: boolean };
                              const clientStatus = clientArgs.isComplete ? "done" : "todo";
                              const serverStatus = serverFields.is_complete ? "done" : "todo";
                              message = `⚠️ Sync Conflict: You tried to set this to '${clientStatus}', but Server is '${serverStatus}'. Update rejected.`;
                          } else if (name === "updateBlock") {
                              const clientArgs = args as { fields: Record<string, unknown> };
                              const clientFields = clientArgs.fields || {};
                              const statusKey = "status";
                              
                              if (statusKey in clientFields && statusKey in serverFields) {
                                const cStat = String(clientFields[statusKey]);
                                const sStat = String(serverFields[statusKey]);
                                message = `⚠️ Sync Conflict: You tried to set status to '${cStat}', but Server is '${sStat}'. Update rejected.`;
                              }
                          }
                        } catch (e) {
                            console.warn("Failed to construct detailed conflict error", e);
                        }

                        const content = JSON.parse(JSON.stringify(noteRow.content)) as GenericTiptapNode;
                        
                        const injected = injectConflictAlert(
                          content,
                          conflictErr.blockId,
                          message,
                        );

                        if (injected) {
                          const newTick = yield* Effect.tryPromise({
                              try: async () => {
                                  const res = await sql<{ nextval: string }>`select nextval('global_version_seq')`.execute(trx);
                                  return Number(res.rows[0]?.nextval);
                              },
                              catch: (e) => new NoteDatabaseError({ cause: e })
                          });

                          yield* Effect.tryPromise({
                              try: () =>
                              trx
                                  .updateTable("note")
                                  .set({
                                    content: content as unknown, 
                                    version: sql<number>`version + 1`,
                                    updated_at: sql<Date>`now()`,
                                    global_version: String(newTick), 
                                  })
                                  .where("id", "=", blockRow.note_id!)
                                  .execute(),
                              catch: (cause) => new NoteDatabaseError({ cause }),
                          });
                          yield* Effect.logInfo(`[Push] Injected conflict alert into note ${blockRow.note_id}`);
                        }
                    } else {
                        console.error(`[Push] Unhandled error during mutation ${name}:`, err);
                        return yield* Effect.fail(err);
                    }
                  }),
                ),
              ),
            );

            await trx
              .updateTable("replicache_client")
              .set({ last_mutation_id: mutationID })
              .where("id", "=", clientID as ReplicacheClientId)
              .execute();
          }
        }),
      catch: (cause) => {
        console.error("[Push] Transaction Failed:", cause);
        return new PushError({ cause });
      },
    });

    yield* poke(user.id);
  });
