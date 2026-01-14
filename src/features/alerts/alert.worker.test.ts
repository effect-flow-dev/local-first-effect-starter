// File: ./src/features/alerts/alert.worker.test.ts
import { describe, it, expect, vi, beforeEach, afterAll } from "vitest";
import { Effect } from "effect";
import { scanAndAlert } from "./alert.worker";
import { createTestUserSchema, closeTestDb } from "../../test/db-utils";
import { randomUUID } from "node:crypto";
import type { UserId, NoteId, BlockId } from "../../lib/shared/schemas";
import type { TaskId } from "../../types/generated/tenant/tenant_template/Task";
import type { PushSubscriptionId } from "../../types/generated/tenant/tenant_template/PushSubscription";
import type { TenantId } from "../../types/generated/central/public/Tenant";
import type { ConsultancyId } from "../../types/generated/central/public/Consultancy";
import type { Kysely } from "kysely";
import type { Database } from "../../types";
// Import centralDb to seed the tenant record
import { centralDb } from "../../db/client";

const TEST_HLC = "1736612345000:0001:TEST";

// --- Mocks ---
const { mockSendPushNotification } = vi.hoisted(() => ({
  mockSendPushNotification: vi.fn(() => Effect.void),
}));

vi.mock("../../lib/server/push", () => ({
  sendPushNotification: mockSendPushNotification,
}));

describe("Alert Worker (Integration)", () => {
  let db: Kysely<Database>;
  let cleanup: () => Promise<void>;
  let userId: UserId;
  let tenantId: TenantId;
  let consultancyId: ConsultancyId;

  afterAll(async () => {
    await closeTestDb();
  });

  beforeEach(async () => {
    vi.clearAllMocks();
    userId = randomUUID() as UserId;
    tenantId = randomUUID() as TenantId;
    consultancyId = randomUUID() as ConsultancyId;

    // 1. Setup isolated test DB schema for the user
    const setup = await createTestUserSchema(userId);
    db = setup.db;
    cleanup = setup.cleanup;

    // 2. Seed Consultancy (Required for Foreign Key constraint on Tenant)
    await centralDb
      .insertInto("consultancy")
      .values({
        id: consultancyId,
        name: "Test Consultancy",
        created_at: new Date(),
      })
      .execute();

    // 3. Seed the Tenant record in the Central DB (public schema)
    await centralDb
      .insertInto("tenant")
      .values({
        id: tenantId,
        name: "Test Tenant",
        subdomain: `test-${tenantId}`,
        consultancy_id: consultancyId,
        tenant_strategy: "schema",
        schema_name: setup.schemaName,
        database_name: null,
        created_at: new Date(),
      })
      .execute();

    return async () => {
      await cleanup();
      // Cleanup both records
      await centralDb.deleteFrom("tenant").where("id", "=", tenantId).execute();
      await centralDb.deleteFrom("consultancy").where("id", "=", consultancyId).execute();
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
            global_version: TEST_HLC
          })
          .execute()
      );

      yield* Effect.promise(() =>
        db.insertInto("task")
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
            global_version: TEST_HLC
          })
          .execute()
      );

      yield* Effect.promise(() =>
        db.insertInto("push_subscription")
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

        // Run the worker logic
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
