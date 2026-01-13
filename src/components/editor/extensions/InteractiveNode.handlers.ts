// FILE: src/components/editor/extensions/InteractiveNode.handlers.ts
import { type EditorView } from "@tiptap/pm/view";
import { v4 as uuidv4 } from "uuid";
import { Effect } from "effect";
import { savePendingMedia, prewarmMemoryCache } from "../../../lib/client/media/mediaStore";
import { MediaSyncService } from "../../../lib/client/media/MediaSyncService"; 
import { runClientUnscoped } from "../../../lib/client/runtime";
import { clientLog } from "../../../lib/client/clientLog";
import type { InteractiveNodeAttributes } from "./InteractiveNode.types";

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
        console.error("[InteractiveNode] Handler Failed:", err);
        return clientLog("error", "Failed to handle media insertion", err);
      }),
    ),
  );

  const nodeType = view.state.schema.nodes.interactiveBlock;
  if (!nodeType) {
    console.error("[InteractiveNode] interactiveBlock node type not found in schema.");
    return;
  }

  const isImage = file.type.startsWith("image/");
  
  let blockType: InteractiveNodeAttributes["blockType"];
  let fields: InteractiveNodeAttributes["fields"];

  if (isImage) {
    blockType = "image";
    fields = {
        uploadId,
    };
  } else {
    blockType = "file_attachment";
    fields = {
        uploadId,
        filename: file.name,
        size: file.size,
        mimeType: file.type || "application/octet-stream"
    };
  }

  const node = nodeType.create({
    blockId,
    blockType,
    fields,
  });

  const transaction = view.state.tr.insert(
    pos ?? view.state.selection.from,
    node,
  );
  view.dispatch(transaction);

  // ✅ FIX: Increased delay to 300ms to robustly handle race conditions in slower CI environments.
  setTimeout(() => {
    runClientUnscoped(clientLog("debug", "[InteractiveNode] Dispatching force-save event"));
    view.dom.dispatchEvent(new CustomEvent("force-save", { bubbles: true }));
  }, 300);
};
