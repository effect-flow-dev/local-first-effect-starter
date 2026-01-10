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
  };

  afterAll(async () => {
    await closeTestDb();
  });

  beforeEach(async () => {
    // 1. Provision two distinct schemas
    siteA = await createTestUserSchema(randomUUID());
    siteB = await createTestUserSchema(randomUUID());

    // ✅ FIX: Insert the *Shared User* into both isolated databases
    // createTestUserSchema inserts the *Owner* of the schema, but we are testing 
    // a user who has access to BOTH (like an auditor), so we must manually add them.
    const userRow = {
        id: sharedUserId,
        email: mockUser.email,
        password_hash: "hash",
        email_verified: true,
        permissions: [],
        created_at: new Date()
    };

    await siteA.db.insertInto("user").values(userRow).execute();
    await siteB.db.insertInto("user").values(userRow).execute();

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
          global_version: "1",
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
        yield* insertNote(siteA.db, "Site A Smart Log");
        yield* insertNote(siteB.db, "Site B Report");

        // 2. Perform Pull on Site A
        const requestA: PullRequest = {
          clientGroupID: "client-group-a",
          cookie: null,
        };

        const responseA = yield* handlePull(requestA, mockUser, siteA.db);

        const noteTitlesA = responseA.patch
          .filter((op) => op.op === "put" && op.value._tag === "note")
          // @ts-expect-error op.value union narrowing
          .map((op) => op.value.title);

        expect(noteTitlesA).toContain("Site A Smart Log");
        expect(noteTitlesA).not.toContain("Site B Report");

        // 3. Perform Pull on Site B
        const requestB: PullRequest = {
            clientGroupID: "client-group-b",
            cookie: null,
        };

        const responseB = yield* handlePull(requestB, mockUser, siteB.db);

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

        yield* handlePush(pushReq, mockUser, siteA.db, "MEMBER");

        // Verify existence in Site A
        const noteInA = yield* Effect.promise(() =>
          siteA.db.selectFrom("note").select("title").where("id", "=", newNoteId).executeTakeFirst()
        );
        expect(noteInA?.title).toBe("Confidential Site A Info");

        // Verify ABSENCE in Site B
        const noteInB = yield* Effect.promise(() =>
          siteB.db.selectFrom("note").select("title").where("id", "=", newNoteId).executeTakeFirst()
        );
        expect(noteInB).toBeUndefined();
      })
    );
  });
});
