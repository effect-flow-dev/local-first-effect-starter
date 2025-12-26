// FILE: src/lib/server/JwtService.test.ts
import { describe, it, expect, vi, afterEach } from "vitest";
import { Effect, Either } from "effect";
import { createJWT } from "oslo/jwt";
import { TimeSpan } from "oslo";
import { generateToken, validateToken } from "./JwtService";
import { AuthError } from "../shared/auth";
import type { UserId, PublicUser } from "../shared/schemas";

const TEST_USER_ID = "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11" as UserId;

// Mock user matching DB structure + New Fields
const mockUser: PublicUser = {
  id: TEST_USER_ID,
  email: "test@example.com",
  email_verified: true,
  created_at: new Date(), // This will be ISO string in token, Date in object
  avatar_url: null,
  permissions: [],
  tenant_strategy: "schema",
  database_name: null,
  subdomain: "test-user-subdomain"
};

const { testConfig } = vi.hoisted(() => ({
  testConfig: { jwt: { secret: "super-secret-test-key-1234567890" } },
}));

vi.mock("./Config", () => ({
  config: testConfig,
}));

// NOTE: We no longer mock centralDb because validateToken is stateless!

describe("JwtService", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("successfully embeds user data into token and retrieves it without DB", async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const token = yield* generateToken(mockUser);
        
        expect(token).toBeDefined();
        expect(typeof token).toBe("string");

        // Validate should extract the user directly from the token
        const userFromToken = yield* validateToken(token);

        // Check fields
        expect(userFromToken.id).toBe(mockUser.id);
        expect(userFromToken.email).toBe(mockUser.email);
        expect(userFromToken.subdomain).toBe(mockUser.subdomain);
        expect(userFromToken.tenant_strategy).toBe(mockUser.tenant_strategy);
        
        // Verify Date hydration
        expect(userFromToken.created_at).toBeInstanceOf(Date);
        expect(userFromToken.created_at.toISOString()).toBe(mockUser.created_at.toISOString());
      }),
    );
  });

  it("fails validation when token is expired", async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const secretKey = new TextEncoder().encode(testConfig.jwt.secret);

        // Create a manually expired token
        const expiredToken = yield* Effect.promise(() =>
          createJWT(
            "HS256",
            secretKey,
            { ...mockUser }, // Payload
            {
              subject: mockUser.id,
              expiresIn: new TimeSpan(-1, "s"),
              includeIssuedTimestamp: true,
            },
          ),
        );

        const result = yield* Effect.either(validateToken(expiredToken));

        expect(Either.isLeft(result)).toBe(true);
        if (Either.isLeft(result)) {
          const error = result.left;
          expect(error).toBeInstanceOf(AuthError);
          expect(error._tag).toBe("Unauthorized");
          expect(error.message).toMatch(/Invalid or expired token/);
        }
      }),
    );
  });

  it("fails validation if payload is malformed (missing required fields)", async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const secretKey = new TextEncoder().encode(testConfig.jwt.secret);

        // Create token with incomplete payload
        const badPayloadToken = yield* Effect.promise(() =>
          createJWT(
            "HS256",
            secretKey,
            { id: TEST_USER_ID }, // Missing email, subdomain, etc.
            { expiresIn: new TimeSpan(1, "h") }
          ),
        );

        const result = yield* Effect.either(validateToken(badPayloadToken));

        expect(Either.isLeft(result)).toBe(true);
        if (Either.isLeft(result)) {
          const error = result.left;
          // Should fail Schema validation
          expect(error._tag).toBe("Unauthorized");
          expect(error.message).toContain("Token payload is invalid");
        }
      }),
    );
  });
});
