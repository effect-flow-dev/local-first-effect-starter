// FILE: src/features/alerts/alert.worker.test.ts
import { describe, it, expect, vi, beforeEach, afterAll } from "vitest";
import { Effect } from "effect";
import { scanAndAlert } from "./alert.worker";
import { createTestUserSchema, closeTestDb } from "../../test/db-utils";
import { randomUUID } from "node:crypto";
import type { UserId, NoteId, BlockId } from "../../lib/shared/schemas";
// ✅ FIX: Import Branded Types for DB Inserts
import type { TaskId } from "../../types/generated/tenant/tenant_template/Task";
import type { PushSubscriptionId } from "../../types/generated/tenant/tenant_template/PushSubscription";
import type { Kysely } from "kysely";
import type { Database } from "../../types";

const TEST_HLC = "1736612345000:0001:TEST";

// --- Mocks ---
const { mockSendPushNotification } = vi.hoisted(() => ({
  mockSendPushNotification: vi.fn(() => Effect.void),
}));

vi.mock("../../lib/server/push", () => ({
  sendPushNotification: mockSendPushNotification,
}));

// Mock centralDb
const { mockCentralDb, mockExecute } = vi.hoisted(() => {
  const mockExecute = vi.fn();
  return {
    mockCentralDb: {
      selectFrom: vi.fn(() => ({
        selectAll: vi.fn().mockReturnThis(),
        execute: mockExecute,
      })),
    },
    mockExecute,
  };
});

// ✅ FIX: Define a minimal interface for the global mock injection
interface GlobalWithTestDb {
    testDbInstance?: Kysely<Database>;
}

vi.mock("../../db/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../db/client")>();
  return {
    ...actual,
    centralDb: mockCentralDb,
    // Mock getTenantDb to return our test database instance using safe cast
    getTenantDb: () => (globalThis as unknown as GlobalWithTestDb).testDbInstance!,
  };
});

describe("Alert Worker (Integration)", () => {
  let db: Kysely<Database>;
  let cleanup: () => Promise<void>;
  let userId: UserId;
  let tenantId: string;

  afterAll(async () => {
    await closeTestDb();
  });

  beforeEach(async () => {
    vi.clearAllMocks();
    userId = randomUUID() as UserId;
    tenantId = randomUUID();

    // 1. Setup isolated test DB
    const setup = await createTestUserSchema(userId);
    db = setup.db;
    cleanup = setup.cleanup;
    
    // ✅ FIX: Use typed global property injection
    (globalThis as unknown as GlobalWithTestDb).testDbInstance = db;

    // 2. Mock Central DB Response via the hoisted mock function
    mockExecute.mockResolvedValue([
      {
        id: tenantId,
        tenant_strategy: "schema",
        schema_name: setup.schemaName, 
        database_name: null,
      },
    ]);

    return async () => {
      await cleanup();
      // ✅ FIX: Cleanup typed global property
      delete (globalThis as unknown as GlobalWithTestDb).testDbInstance;
    };
  });

  const seedTask = (opts: { dueAt: Date; isComplete: boolean; alertSent: boolean }) =>
    Effect.gen(function* () {
      const noteId = randomUUID() as NoteId;
      const blockId = randomUUID() as BlockId;

      yield* Effect.promise(() =>
        db.insertInto("note")
          .values({
            id: noteId,
            user_id: userId,
            title: "Task Note",
            content: { type: "doc", content: [] },
            version: 1,
            created_at: new Date(),
            updated_at: new Date(),
            // ✅ FIXED: Missing global_version
            global_version: TEST_HLC
          })
          .execute()
      );

      yield* Effect.promise(() =>
        db.insertInto("block")
          .values({
            id: blockId,
            note_id: noteId,
            user_id: userId,
            type: "task",
            content: "Do this thing",
            fields: {},
            tags: [],
            links: [],
            transclusions: [],
            file_path: "",
            depth: 0,
            order: 0,
            version: 1,
            created_at: new Date(),
            updated_at: new Date(),
            // ✅ FIXED: Missing global_version
            global_version: TEST_HLC
          })
          .execute()
      );

      yield* Effect.promise(() =>
        db.insertInto("task")
          // ✅ FIX: Use Branded Type ID to avoid 'any' cast
          .values({
            id: randomUUID() as TaskId,
            user_id: userId,
            source_block_id: blockId,
            content: "Do this thing",
            is_complete: opts.isComplete,
            due_at: opts.dueAt,
            alert_sent_at: opts.alertSent ? new Date() : null,
            created_at: new Date(),
            updated_at: new Date(),
            // ✅ FIXED: Missing global_version
            global_version: TEST_HLC
          })
          .execute()
      );

      yield* Effect.promise(() =>
        db.insertInto("push_subscription")
          // ✅ FIX: Use Branded Type ID to avoid 'any' cast
          .values({
            id: randomUUID() as PushSubscriptionId,
            user_id: userId,
            endpoint: "https://fcm.googleapis.com/fcm/send/test",
            p256dh: "key",
            auth: "auth",
            created_at: new Date(),
          })
          .execute()
      );
    });

  it("should send alerts for due, incomplete tasks and update alert_sent_at", async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const pastDate = new Date();
        pastDate.setHours(pastDate.getHours() - 1);
        
        yield* seedTask({ dueAt: pastDate, isComplete: false, alertSent: false });

        yield* scanAndAlert;

        expect(mockSendPushNotification).toHaveBeenCalledTimes(1);
        expect(mockSendPushNotification).toHaveBeenCalledWith(
            expect.objectContaining({ endpoint: "https://fcm.googleapis.com/fcm/send/test" }),
            expect.objectContaining({ title: "Task Due" })
        );

        const task = yield* Effect.promise(() => db.selectFrom("task").selectAll().executeTakeFirstOrThrow());
        expect(task.alert_sent_at).not.toBeNull();
      })
    );
  });

  it("should NOT alert if task is already completed", async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const pastDate = new Date();
        pastDate.setHours(pastDate.getHours() - 1);
        
        yield* seedTask({ dueAt: pastDate, isComplete: true, alertSent: false });

        yield* scanAndAlert;

        expect(mockSendPushNotification).not.toHaveBeenCalled();
      })
    );
  });

  it("should NOT alert if task is due in the future", async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const futureDate = new Date();
        futureDate.setHours(futureDate.getHours() + 1);
        
        yield* seedTask({ dueAt: futureDate, isComplete: false, alertSent: false });

        yield* scanAndAlert;

        expect(mockSendPushNotification).not.toHaveBeenCalled();
      })
    );
  });

  it("should NOT alert if already alerted", async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const pastDate = new Date();
        pastDate.setHours(pastDate.getHours() - 1);
        
        yield* seedTask({ dueAt: pastDate, isComplete: false, alertSent: true });

        yield* scanAndAlert;

        expect(mockSendPushNotification).not.toHaveBeenCalled();
      })
    );
  });
});
