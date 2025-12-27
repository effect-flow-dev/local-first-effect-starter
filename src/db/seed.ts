// FILE: src/db/seed.ts
import { PERMISSIONS } from "../lib/shared/permissions";
import type { UserId } from "../types/generated/central/public/User";
import type { ConsultancyId } from "../types/generated/central/public/Consultancy";
import type { TenantId } from "../types/generated/central/public/Tenant";
import { Argon2id } from "oslo/password";
import { Effect, Cause, Exit, Data } from "effect";
import { centralDb, getUserDb, type TenantConfig } from "./client";
import { provisionTenant } from "../features/auth/auth.service";
import { v4 as uuidv4 } from "uuid";
import type { NoteId, BlockId } from "../lib/shared/schemas";

class SeedingError extends Data.TaggedError("SeedingError")<{
  readonly cause: unknown;
}> {}

class PasswordHashingError extends Data.TaggedError("PasswordHashingError")<{
  readonly cause: unknown;
}> {}

const PASSWORD = "password123";

const seedHierarchy = (
  email: string,
  strategy: "schema" | "database",
  preferredUserId?: UserId,
) =>
  Effect.gen(function* () {
    yield* Effect.logInfo({ email, strategy }, "Seeding User & Hierarchy...");

    const argon2id = new Argon2id();
    const hashedPassword = yield* Effect.tryPromise({
      try: () => argon2id.hash(PASSWORD),
      catch: (cause) => new PasswordHashingError({ cause }),
    });

    // 1. Create/Update User
    const existingUser = yield* Effect.tryPromise({
      try: () =>
        centralDb
          .selectFrom("user")
          .select(["id"])
          .where("email", "=", email)
          .executeTakeFirst(),
      catch: (cause) => new SeedingError({ cause }),
    });

    const userId = existingUser?.id ?? (preferredUserId || (uuidv4() as UserId));

    // Default permissions for seeded users (Super Admin equivalent for now)
    const defaultPerms = [
        PERMISSIONS.NOTE_CREATE, 
        PERMISSIONS.NOTE_EDIT, 
        PERMISSIONS.NOTE_DELETE, 
        PERMISSIONS.BLOCK_EDIT, 
        PERMISSIONS.TASK_UPDATE,
        PERMISSIONS.NOTEBOOK_CREATE,
        PERMISSIONS.NOTEBOOK_DELETE
    ];

    if (existingUser) {
        yield* Effect.logInfo({ id: userId }, "User exists. Updating...");
        yield* Effect.tryPromise({
            try: () =>
                centralDb
                .updateTable("user")
                .set({
                    password_hash: hashedPassword,
                    permissions: defaultPerms,
                    email_verified: true,
                })
                .where("id", "=", userId)
                .execute(),
            catch: (cause) => new SeedingError({ cause }),
        });
    } else {
        yield* Effect.logInfo("Creating new user...");
        yield* Effect.tryPromise({
            try: () =>
                centralDb
                .insertInto("user")
                .values({
                    id: userId,
                    email: email,
                    password_hash: hashedPassword,
                    permissions: defaultPerms,
                    email_verified: true,
                })
                .execute(),
            catch: (cause) => new SeedingError({ cause }),
        });
    }

    // 2. Create Consultancy
    const consultancyId = uuidv4() as ConsultancyId;
    yield* Effect.tryPromise({
        try: () => centralDb
            .insertInto("consultancy")
            .values({
                id: consultancyId,
                name: `${email.split('@')[0]} Global`,
            })
            .execute(),
        catch: (cause) => new SeedingError({ cause }),
    });

    // 3. Create Tenant
    const tenantId = uuidv4() as TenantId;
    const emailLocalPart = email.split("@")[0] ?? "user";
    const subdomain = emailLocalPart.toLowerCase().replace(/[^a-z0-9]/g, "-");
    
    let dbName: string | null = null;
    // Define schema name explicitly to match legacy provisionTenant behavior (user_{id})
    const schemaName = strategy === 'schema' ? `user_${userId}` : null;

    if (strategy === "database") {
      dbName = `user_${userId.replace(/-/g, "")}`;
    }

    yield* Effect.tryPromise({
        try: () => centralDb
            .insertInto("tenant")
            .values({
                id: tenantId,
                consultancy_id: consultancyId,
                name: `${emailLocalPart} ${strategy === 'database' ? 'DB' : 'Schema'} Site`,
                subdomain: subdomain,
                tenant_strategy: strategy,
                database_name: dbName,
                // Store the schema name so context.ts finds the right one later
                schema_name: schemaName
            })
            .execute(),
        catch: (cause) => new SeedingError({ cause }),
    });

    // 4. Link User to Tenant
    yield* Effect.tryPromise({
        try: () => centralDb
            .insertInto("tenant_membership")
            .values({
                user_id: userId,
                tenant_id: tenantId,
                role: 'OWNER',
            })
            .execute(),
        catch: (cause) => new SeedingError({ cause }),
    });

    // 5. Provision the actual Physical Resources (Schema/DB)
    // provisionTenant (legacy) creates schema `user_{userId}`
     
    yield* provisionTenant(userId, strategy, (strategy === 'database' ? dbName : schemaName)!);

    // 6. Seed Tenant Data (Notes)
    const userConfig: TenantConfig = {
      id: userId,
      tenant_strategy: strategy,
      database_name: dbName || null,
      // Explicitly pass schema_name to getUserDb so it connects to user_{id} not tenant_{id}
      schema_name: schemaName,
    };

    const userDb = getUserDb(userConfig);
    const noteId = uuidv4() as NoteId;
    const blockId = uuidv4() as BlockId;

    yield* Effect.logInfo("Seeding sample note into tenant DB...");

    yield* Effect.tryPromise({
      try: async () => {
        // Safe check if table exists before deleting?
        // Assume provisionTenant worked.
        await userDb.deleteFrom("note").execute();

        await userDb
          .insertInto("note")
          .values({
            id: noteId,
            user_id: userId,
            title: `Welcome to ${strategy.toUpperCase()} Mode`,
            content: {
              type: "doc",
              content: [
                {
                  type: "paragraph",
                  content: [
                    {
                      type: "text",
                      text: `This note is stored in a ${strategy}-isolated tenant.`,
                    },
                  ],
                },
              ],
            },
            version: 1,
            created_at: new Date(),
            updated_at: new Date(),
          })
          .execute();

        await userDb
          .insertInto("block")
          .values({
            id: blockId,
            user_id: userId,
            note_id: noteId,
            type: "paragraph",
            content: `This note is stored in a ${strategy}-isolated tenant.`,
            file_path: "",
            depth: 0,
            order: 0,
            fields: {},
            tags: [],
            links: [],
            transclusions: [],
          })
          .execute();
      },
      catch: (cause) => new SeedingError({ cause }),
    });

    if (strategy === "database") {
      yield* Effect.promise(() => userDb.destroy());
    }
  });

const seedProgram = Effect.gen(function* () {
  // Clear central tables first to avoid conflicts during re-seed
  // Order matters due to FKs
  try {
    yield* Effect.tryPromise(() => centralDb.deleteFrom("tenant_membership").execute());
    yield* Effect.tryPromise(() => centralDb.deleteFrom("tenant").execute());
    yield* Effect.tryPromise(() => centralDb.deleteFrom("consultancy").execute());
    yield* Effect.tryPromise(() => centralDb.deleteFrom("user").execute());
  } catch {
    yield* Effect.logWarning("Could not clear some tables (might not exist yet or FK issues). Proceeding...");
  }

  // 1. Schema User (Default)
  yield* seedHierarchy(
    "effect-flow-dev@proton.me",
    "schema",
    "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11" as UserId,
  );

  // 2. Database User
  yield* seedHierarchy("effect-flow-dev.database@gmail.com", "database");

  yield* Effect.logInfo("✅ All seed operations completed.");
});

void Effect.runPromiseExit(seedProgram).then((exit) => {
  if (Exit.isSuccess(exit)) {
    process.exit(0);
  } else {
     
    console.error("\n❌ Seeding script failed. Details below:\n");
     
    console.error(Cause.pretty(exit.cause));
    process.exit(1);
  }
});
