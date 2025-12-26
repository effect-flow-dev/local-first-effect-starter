// FILE: src/lib/server/sync/sync.registry.ts
import { blockSyncHandler } from "../../../features/block/block.sync";
import { noteSyncHandler } from "../../../features/note/note.sync";
import { notebookSyncHandler } from "../../../features/notebook/notebook.sync"; // ✅ NEW
import type { SyncableEntity } from "./sync.types";

/**
 * A central registry of all data types that can be synced with Replicache.
 */
export const syncableEntities: readonly SyncableEntity[] = [
  noteSyncHandler,
  blockSyncHandler,
  notebookSyncHandler, // ✅ NEW
];
