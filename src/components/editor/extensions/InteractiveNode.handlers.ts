// FILE: src/components/editor/extensions/InteractiveNode.handlers.ts
import { type EditorView } from "@tiptap/pm/view";
import { v4 as uuidv4 } from "uuid";
import { Effect } from "effect";
import { savePendingMedia, prewarmMemoryCache } from "../../../lib/client/media/mediaStore";
import { MediaSyncService } from "../../../lib/client/media/MediaSyncService"; 
import { runClientUnscoped } from "../../../lib/client/runtime";
import { clientLog } from "../../../lib/client/clientLog";

export const handleFileInsert = (view: EditorView, file: File, pos?: number) => {
  const uploadId = uuidv4();
  const blockId = uuidv4();

  if (!runClientUnscoped) {
    console.error("[InteractiveNode] CRITICAL: runClientUnscoped is not defined.");
    return;
  }

  const blobUrl = URL.createObjectURL(file);
  
  if (import.meta.env.DEV) {
    console.debug(`[InteractiveNode] Generated uploadId: ${uploadId}, blob: ${blobUrl}`);
  }

  prewarmMemoryCache(uploadId, blobUrl);

  runClientUnscoped(
    Effect.gen(function* () {
      yield* clientLog("info", "[InteractiveNode] Handling file insert", { uploadId, blockId, type: file.type, size: file.size });
      yield* savePendingMedia(uploadId, blockId, file);
      const service = yield* MediaSyncService;
      yield* service.queueUpload(uploadId);
    }).pipe(
      Effect.catchAll((err) => {
        return clientLog("error", "Failed to handle media insertion", err);
      }),
    ),
  );

  const nodeType = view.state.schema.nodes.interactiveBlock;
  if (!nodeType) {
    console.error("[InteractiveNode] interactiveBlock node type not found in schema.");
    return;
  }

  const node = nodeType.create({
    blockId,
    blockType: "image",
    fields: {
      uploadId,
    },
  });

  const transaction = view.state.tr.insert(
    pos ?? view.state.selection.from,
    node,
  );
  view.dispatch(transaction);

  // Force immediate save to ensure block exists in Replicache before upload finishes
  view.dom.dispatchEvent(new CustomEvent("force-save", { bubbles: true }));
};
