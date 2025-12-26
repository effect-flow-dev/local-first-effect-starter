// FILE: src/features/note/mutations/block.ts
import { Effect } from "effect";
import { sql, type Kysely, type Transaction } from "kysely";
import type { Database } from "../../../types";
import { NoteDatabaseError, VersionConflictError } from "../Errors";
import { getNextGlobalVersion } from "../../replicache/versioning";
import { logBlockHistory, markHistoryRejected } from "../history.utils";
import { updateBlockInContent, revertBlockInContent } from "../utils/content-traversal";
import type { UpdateBlockArgsSchema, RevertBlockArgsSchema, CreateBlockArgsSchema } from "../note.schemas";
import type { UserId } from "../../../lib/shared/schemas";

interface ContentNode {
  type: string;
  attrs?: {
    blockId?: string;
    version?: number;
    fields?: Record<string, unknown>;
    [key: string]: unknown;
  };
  content?: ContentNode[];
}

export const handleCreateBlock = (
  db: Kysely<Database> | Transaction<Database>,
  args: typeof CreateBlockArgsSchema.Type,
  userId: UserId,
) =>
  Effect.gen(function* () {
    yield* Effect.logInfo(`[handleCreateBlock] Creating block ${args.blockId} in note ${args.noteId}`);
    const globalVersion = yield* getNextGlobalVersion(db);

    // 1. Calculate Order (Append to bottom)
    const maxOrderRow = yield* Effect.tryPromise({
      try: () => 
        db.selectFrom("block")
          .select(db.fn.max("order").as("maxOrder"))
          .where("note_id", "=", args.noteId)
          .executeTakeFirst(),
      catch: (cause) => new NoteDatabaseError({ cause }),
    });

    const nextOrder = (maxOrderRow?.maxOrder ?? 0) + 1;

    // 2. Insert Block
    yield* Effect.tryPromise({
      try: () => 
        db.insertInto("block")
          .values({
            id: args.blockId,
            note_id: args.noteId,
            user_id: userId,
            type: args.type,
            content: args.content || "",
            fields: args.fields || {},
            order: nextOrder,
            depth: 0,
            file_path: "",
            tags: [],
            links: [],
            transclusions: [],
            version: 1,
            created_at: sql<Date>`now()`,
            updated_at: sql<Date>`now()`,
            global_version: String(globalVersion),
          })
          .execute(),
      catch: (cause) => new NoteDatabaseError({ cause }),
    });

    // 3. Log History
    yield* logBlockHistory(db, {
        blockId: args.blockId,
        noteId: args.noteId,
        userId: userId,
        mutationType: "createBlock",
        args: args
    });
  });

export const handleUpdateBlock = (
  db: Kysely<Database> | Transaction<Database>,
  args: typeof UpdateBlockArgsSchema.Type,
  userId: UserId,
) =>
  Effect.gen(function* () {
    yield* Effect.logInfo(`[handleUpdateBlock] Updating block ${args.blockId}`);
    const globalVersion = yield* getNextGlobalVersion(db);

    const blockRow = yield* Effect.tryPromise({
      try: () => db.selectFrom("block").select(["note_id", "version"]).where("id", "=", args.blockId).executeTakeFirst(),
      catch: (cause) => new NoteDatabaseError({ cause }),
    });

    if (!blockRow) {
      yield* Effect.logWarning(`[handleUpdateBlock] Block ${args.blockId} not found.`);
      return;
    }

    let historyId: string | null = null;
    if (blockRow?.note_id) {
        historyId = yield* logBlockHistory(db, {
            blockId: args.blockId,
            noteId: blockRow.note_id,
            userId: userId,
            mutationType: "updateBlock",
            args: args
        });
    }

    const currentVersion = blockRow?.version ?? 1;
    if (args.version !== currentVersion) {
        // Optimistic Locking: Simple strict check for now.
        // In "Forms First", we expect the client to have the latest version via sync or optimistic update.
        // If they don't, it's a conflict.
        
        // However, for "Fat Finger" forms (toggles), LWW might be acceptable if we didn't want strictness.
        // But we are sticking to the architecture.
        
        // We log warning but allow it for now if we want LWW behavior, 
        // OR we fail. Let's fail to trigger the Conflict Resolution UI logic if we want robustness.
        // But since we removed the generic conflict UI for simplicity in this pass, 
        // let's LOG and OVERWRITE for now to ensure usability in "Fat Finger" mode where latency might exist.
        // Actually, let's keep the fail logic but only if it's a critical text edit. 
        // For checklist toggles, LWW is often preferred.
        
        // Let's keep strict check to verify the test suite (conflict.integration.test.ts)
        yield* Effect.logWarning(`[handleUpdateBlock] Version Conflict!`);
        if (historyId) yield* markHistoryRejected(db, historyId);
        return yield* Effect.fail(new VersionConflictError({
            blockId: args.blockId,
            expectedVersion: currentVersion,
            actualVersion: args.version
        }));
    }

    // Update Note Content (Legacy/Tiptap compatibility)
    if (blockRow?.note_id) {
      const noteRow = yield* Effect.tryPromise({
        try: () => db.selectFrom("note").select(["id", "content"]).where("id", "=", blockRow.note_id!).executeTakeFirst(),
        catch: (cause) => new NoteDatabaseError({ cause }),
      });

      if (noteRow && noteRow.content) {
        const content = JSON.parse(JSON.stringify(noteRow.content)) as ContentNode;
        if (updateBlockInContent(content, args.blockId, args.fields)) {
          yield* Effect.tryPromise({
            try: () => db.updateTable("note").set({
                  content: content as unknown,
                  version: sql<number>`version + 1`,
                  updated_at: sql<Date>`now()`,
                  global_version: String(globalVersion),
                }).where("id", "=", noteRow.id).execute(),
            catch: (cause) => new NoteDatabaseError({ cause }),
          });
        }
      }
    }

    yield* Effect.tryPromise({
      try: () => db.updateTable("block").set({
            fields: sql`fields || ${JSON.stringify(args.fields)}::jsonb`,
            version: sql<number>`version + 1`, 
            updated_at: sql<Date>`now()`,
            global_version: String(globalVersion),
          }).where("id", "=", args.blockId).execute(),
      catch: (cause) => new NoteDatabaseError({ cause }),
    });
  });

export const handleRevertBlock = (
  db: Kysely<Database> | Transaction<Database>,
  args: typeof RevertBlockArgsSchema.Type,
  userId: UserId
) =>
  Effect.gen(function* () {
    yield* Effect.logInfo(`[handleRevertBlock] Reverting block ${args.blockId} to history ${args.historyId}`);
    const globalVersion = yield* getNextGlobalVersion(db);

    const blockRow = yield* Effect.tryPromise({
      try: () => db.selectFrom("block").select("note_id").where("id", "=", args.blockId).executeTakeFirst(),
      catch: (cause) => new NoteDatabaseError({ cause }),
    });

    if (!blockRow) {
        yield* Effect.logWarning(`[handleRevertBlock] Block ${args.blockId} not found (might be deleted).`);
        return;
    }

    const snapshot = args.targetSnapshot;

    yield* logBlockHistory(db, {
        blockId: args.blockId,
        noteId: blockRow.note_id!,
        userId: userId,
        mutationType: "revertBlock",
        args: { revertedTo: args.historyId, ...snapshot },
        snapshot: snapshot 
    });

    const fieldsToRestore = (snapshot.fields && typeof snapshot.fields === 'object') 
        ? JSON.stringify(snapshot.fields)
        : undefined;

    yield* Effect.tryPromise({
        try: () =>
            db.updateTable("block")
            .set({
                fields: fieldsToRestore,
                version: sql<number>`version + 1`,
                updated_at: sql<Date>`now()`,
                global_version: String(globalVersion)
            })
            .where("id", "=", args.blockId)
            .execute(),
        catch: (cause) => new NoteDatabaseError({ cause })
    });

    const noteRow = yield* Effect.tryPromise({
        try: () => db.selectFrom("note").select(["id", "content"]).where("id", "=", blockRow.note_id!).executeTakeFirst(),
        catch: (cause) => new NoteDatabaseError({ cause })
    });

    if (noteRow && noteRow.content) {
        const content = JSON.parse(JSON.stringify(noteRow.content)) as ContentNode;
        if (revertBlockInContent(content, args.blockId, snapshot)) {
            yield* Effect.tryPromise({
                try: () => db.updateTable("note").set({
                      content: content as unknown,
                      version: sql<number>`version + 1`,
                      updated_at: sql<Date>`now()`,
                      global_version: String(globalVersion),
                    }).where("id", "=", noteRow.id).execute(),
                catch: (cause) => new NoteDatabaseError({ cause }),
            });
        }
    }
  });
