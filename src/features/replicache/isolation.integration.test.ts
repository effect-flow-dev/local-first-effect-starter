// FILE: src/features/replicache/isolation.integration.test.ts
import { describe, it, expect, afterAll, beforeEach } from "vitest";
import { Effect } from "effect";
import { handlePull } from "./pull";
import { handlePush } from "./push";
import { createTestUserSchema, closeTestDb } from "../../test/db-utils";
import { randomUUID } from "node:crypto";
import type { UserId, NoteId, PublicUser } from "../../lib/shared/schemas";
import type { PullRequest, PushRequest } from "../../lib/shared/replicache-schemas";
import type { Kysely } from "kysely";
import type { Database } from "../../types";

describe("Replicache Isolation (Multi-Tenant)", () => {
  // We simulate two different tenants (sites)
  let siteA: { db: Kysely<Database>; cleanup: () => Promise<void>; schemaName: string };
  let siteB: { db: Kysely<Database>; cleanup: () => Promise<void>; schemaName: string };

  // The User is the same person accessing both sites
  const sharedUserId = randomUUID() as UserId;
  const mockUser: PublicUser = {
    id: sharedUserId,
    email: "inspector@business.com",
    email_verified: true,
    created_at: new Date(),
    avatar_url: null,
    permissions: [],
    // These legacy fields don't matter for the test as we pass the DB instance explicitly
    tenant_strategy: "schema",
    database_name: null,
    subdomain: "irrelevant",
  };

  afterAll(async () => {
    await closeTestDb();
  });

  beforeEach(async () => {
    // 1. Provision two distinct schemas (simulating two tenants)
    // We use random IDs for the "user" part of the schema helper to generate unique schema names
    siteA = await createTestUserSchema(randomUUID());
    siteB = await createTestUserSchema(randomUUID());

    return async () => {
      await siteA.cleanup();
      await siteB.cleanup();
    };
  });

  const insertNote = (db: Kysely<Database>, title: string) =>
    Effect.promise(() =>
      db
        .insertInto("note")
        .values({
          id: randomUUID() as NoteId,
          user_id: sharedUserId,
          title,
          content: { type: "doc", content: [] },
          version: 1,
          global_version: "1", // Manually set for test
          created_at: new Date(),
          updated_at: new Date(),
        })
        .returning("id")
        .executeTakeFirstOrThrow()
    );

  it("PULL: Should only return data from the connected Site (Tenant)", async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        // 1. Setup Data
        // Site A has "Site A Smart Log"
        yield* insertNote(siteA.db, "Site A Smart Log");
        
        // Site B has "Site B Report"
        yield* insertNote(siteB.db, "Site B Report");

        // 2. Perform Pull on Site A
        const requestA: PullRequest = {
          clientGroupID: "client-group-a",
          cookie: null, // Fresh sync
        };

        const responseA = yield* handlePull(requestA, mockUser, siteA.db);

        // 3. Verify Site A Data
        const noteTitlesA = responseA.patch
          .filter((op) => op.op === "put" && op.value._tag === "note")
          // @ts-expect-error op.value union narrowing
          .map((op) => op.value.title);

        expect(noteTitlesA).toContain("Site A Smart Log");
        expect(noteTitlesA).not.toContain("Site B Report");

        // 4. Perform Pull on Site B
        const requestB: PullRequest = {
            clientGroupID: "client-group-b",
            cookie: null,
        };

        const responseB = yield* handlePull(requestB, mockUser, siteB.db);

        // 5. Verify Site B Data
        const noteTitlesB = responseB.patch
            .filter((op) => op.op === "put" && op.value._tag === "note")
            // @ts-expect-error op.value union narrowing
            .map((op) => op.value.title);

        expect(noteTitlesB).toContain("Site B Report");
        expect(noteTitlesB).not.toContain("Site A Smart Log");
      })
    );
  });

  it("PUSH: Mutations should only affect the connected Site (Tenant)", async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const newNoteId = randomUUID() as NoteId;

        // 1. Push "Confidential Site A Info" to Site A
        const pushReq: PushRequest = {
          clientGroupID: "client-group-a",
          mutations: [
            {
              id: 1,
              clientID: "client-a",
              name: "createNote",
              args: {
                id: newNoteId,
                userID: sharedUserId,
                title: "Confidential Site A Info",
              },
            },
          ],
        };

        // Pass 'MEMBER' role to pass RBAC checks
        yield* handlePush(pushReq, mockUser, siteA.db, "MEMBER");

        // 2. Verify existence in Site A
        const noteInA = yield* Effect.promise(() =>
          siteA.db
            .selectFrom("note")
            .select("title")
            .where("id", "=", newNoteId)
            .executeTakeFirst()
        );
        expect(noteInA?.title).toBe("Confidential Site A Info");

        // 3. Verify ABSENCE in Site B
        // Even though it's the same User ID, the data must not leak to the other schema
        const noteInB = yield* Effect.promise(() =>
          siteB.db
            .selectFrom("note")
            .select("title")
            .where("id", "=", newNoteId)
            .executeTakeFirst()
        );
        expect(noteInB).toBeUndefined();
      })
    );
  });
});
