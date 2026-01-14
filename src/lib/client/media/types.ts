// FILE: src/lib/client/media/types.ts
export type UploadStatus = "pending" | "uploading" | "error" | "uploaded" | "synced";

export interface PendingUpload {
  readonly id: string; // The uploadId (key in IDB)
  readonly blockId: string; // The Block ID to update upon success
  readonly file: File;
  readonly status: UploadStatus;
  readonly mimeType: string;
  readonly createdAt: number;
  readonly retryCount: number;
  readonly lastAttemptAt: number | null; // ✅ Timestamp of last try
  readonly lastError: string | null;     // ✅ Message of last error
  readonly lastAccessedAt: number;       // ✅ Timestamp of last read/write for GC
}
