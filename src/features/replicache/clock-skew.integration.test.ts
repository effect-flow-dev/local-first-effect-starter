// FILE: src/features/replicache/clock-skew.integration.test.ts
import { describe, it, expect, afterAll, beforeEach, afterEach, vi } from "vitest";
import { Effect, Either } from "effect";
import { handlePush } from "./push";
import { createTestUserSchema, closeTestDb } from "../../test/db-utils";
import { randomUUID } from "node:crypto";
import type { UserId, NoteId, PublicUser } from "../../lib/shared/schemas";
import type { PushRequest } from "../../lib/shared/replicache-schemas";
import { packHlc } from "../../lib/shared/hlc";
import { ClockSkewError } from "./Errors";
import type { Kysely } from "kysely";
import type { Database } from "../../types";

// Mock PokeService to prevent WebSocket side effects during test
vi.mock("../../lib/server/PokeService", () => ({
  poke: vi.fn(() => Effect.void),
}));

// Standardized Base Time (Jan 1 2025)
const BASE_TIME = 1735689600000; 
// Threshold is 24 hours, so 25 hours should trigger the error
const TWENTY_FIVE_HOURS = 25 * 60 * 60 * 1000;

describe("HLC Clock Skew Guardrail (Integration)", () => {
  let db: Kysely<Database>;
  let cleanup: () => Promise<void>;
  let schemaUserId: UserId;
  let schemaName: string;

  afterAll(async () => {
    await closeTestDb();
  });

  beforeEach(async () => {
    // Lock server time
    vi.useFakeTimers();
    vi.setSystemTime(BASE_TIME);

    const userId = randomUUID();
    schemaUserId = userId as UserId;
    const setup = await createTestUserSchema(userId);
    db = setup.db;
    cleanup = setup.cleanup;
    schemaName = setup.schemaName;

    return async () => await cleanup();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  const mockUser: PublicUser = {
    id: "u1" as UserId,
    email: "drifter@test.com",
    email_verified: true,
    created_at: new Date(),
    avatar_url: null,
    permissions: [],
  };

  it("should reject mutations from the far future (> 24h drift) and prevent DB writes", async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const noteId = randomUUID() as NoteId;
        const driftTime = BASE_TIME + TWENTY_FIVE_HOURS;
        
        // Construct HLC from the Future
        const futureHlc = packHlc({ 
            physical: driftTime, 
            counter: 0, 
            nodeId: "DELOREAN_CLIENT" 
        });

        const pushReq: PushRequest = {
          clientGroupID: "future-group",
          mutations: [
            {
              id: 1,
              clientID: "future-client",
              name: "createNote",
              args: {
                id: noteId,
                userID: schemaUserId,
                title: "Future Note",
                // This timestamp triggers the guard
                hlcTimestamp: futureHlc,
                deviceTimestamp: new Date(driftTime)
              },
            },
          ],
        };

        // 1. Attempt Push
        const result = yield* Effect.either(
            handlePush(pushReq, { ...mockUser, id: schemaUserId }, db, "OWNER", schemaName)
        );

        // 2. Assert Error Type (ClockSkewError)
        expect(Either.isLeft(result)).toBe(true);
        if (Either.isLeft(result)) {
            const error = result.left;
            expect(error).toBeInstanceOf(ClockSkewError);
            if (error instanceof ClockSkewError) {
                // Verify specific details from the error
                expect(error.serverTime).toBe(BASE_TIME);
                expect(error.clientTime).toBe(driftTime);
                expect(error.threshold).toBeDefined();
            }
        }

        // 3. Assert DB Integrity (Transaction aborted, Note NOT created)
        const note = yield* Effect.promise(() =>
          db.selectFrom("note").select("id").where("id", "=", noteId).executeTakeFirst()
        );
        expect(note).toBeUndefined();
      })
    );
  });
});
